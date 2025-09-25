import { build as viteBuild } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve, dirname, relative, basename } from 'path';
import { createHash } from 'node:crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { rmSync } from 'fs';

const PROJECT_ROOT = process.cwd();
console.log('Project root:', PROJECT_ROOT);
const SERVER_DIR = resolve(PROJECT_ROOT, 'dist'); // carpeta de destino para Apps Script
const TEMP_ROOT = resolve(PROJECT_ROOT, '.vite_tmp'); // temp builds
const CACHE_FILE = resolve(SERVER_DIR, '.build-cache.json');

// --- CLI flags
// --pages=home,dashboard   -> compila solo esas páginas
// --changed                -> compila solo páginas (y opcionalmente servidor) que hayan cambiado
// --skip-server            -> no compila el servidor
const ARGS = process.argv.slice(2);
const getArgVal = (key) => {
	const prefix = key + '=';
	const found = ARGS.find((a) => a.startsWith(prefix));
	return found ? found.slice(prefix.length) : undefined;
};
const PAGES_ARG = getArgVal('--pages');
const ONLY_CHANGED = ARGS.includes('--changed');
const SKIP_SERVER = ARGS.includes('--skip-server');

// --- Descubre entradas dinámicamente: escanea src/client/pages en busca de carpetas que contengan index.html
async function discoverEntries() {
	const pagesRoot = resolve(PROJECT_ROOT, 'src/client/pages');
	const list = [];
	try {
		const dirents = await fs.readdir(pagesRoot, { withFileTypes: true });
		for (const d of dirents) {
			if (!d.isDirectory()) continue;
			const name = d.name;
			const indexPath = resolve(pagesRoot, name, 'index.html');
			try {
				await fs.stat(indexPath);
				list.push({ name, html: indexPath });
			} catch (e) {
				try {
					const appTsx = resolve(pagesRoot, name, 'App.tsx');
					await fs.stat(appTsx);
					// No hay index.html, pero sí App.tsx — lo permitimos y usaremos una plantilla compartida
					list.push({ name, html: null });
				} catch (e2) {
					continue;
				}
			}
		}
	} catch (err) {
		console.error('Error discovering pages in', pagesRoot, err);
	}

	return list.sort((a, b) => a.name.localeCompare(b.name));
}

const SERVER_SRC_DIR = resolve(PROJECT_ROOT, 'src', 'server');

async function ensureServerDir() {
	if (!existsSync(SERVER_DIR)) {
		await fs.mkdir(SERVER_DIR, { recursive: true });
	}
}

// Removed generated aggregator: we now rely solely on manual exports in src/server/index.ts

async function buildServer() {
	console.log('Building server code (Apps Script) -> dist/Code.js ...');
	// usamos index.ts como entry y confiamos en sus exports manuales
	// eliminar cualquier index.all.generated.ts leftover
	try {
		const leftover = resolve(SERVER_SRC_DIR, 'index.all.generated.ts');
		await fs.unlink(leftover).catch(() => {});
	} catch {}
	const serverEntry = resolve(SERVER_SRC_DIR, 'index.ts');
	await viteBuild({
		build: {
			emptyOutDir: false,
			outDir: resolve(PROJECT_ROOT, 'temp_server_build'),
			sourcemap: false,
			minify: false,
			lib: {
				entry: serverEntry,
				formats: ['iife'],
				name: 'globalThis',
				fileName: 'Code',
			},
			rollupOptions: {
				output: {
					entryFileNames: 'Code.js',
					extend: true,
				},
			},
		},
		configFile: resolve(PROJECT_ROOT, 'vite.config.ts'),
	});

	const tmp = resolve(PROJECT_ROOT, 'temp_server_build', 'Code.js');
	const dest = resolve(SERVER_DIR, 'Code.js');
	await ensureServerDir();

	try {
		let content = await fs.readFile(tmp, 'utf-8');

		// Extraer el cuerpo del IIFE usando SWC (rápido) con fallback por llaves
		async function extractWithSwc(text) {
			try {
				const swcMod = await import('@swc/core');
				const swc = swcMod.default ?? swcMod;
				const parse = swc.parseSync ? (code, opts) => swc.parseSync(code, opts) : (code, opts) => swc.parse(code, opts);
				const ast = parse(text, {
					jsc: { target: 'es2022' },
					syntax: 'ecmascript',
					isModule: false,
					comments: false,
				});

				function getBlockFromCallee(callee) {
					if (!callee) return null;
					if (callee.type === 'FunctionExpression' && callee.body && callee.body.type === 'BlockStatement') {
						return callee.body;
					}
					if (callee.type === 'ArrowFunctionExpression' && callee.body && callee.body.type === 'BlockStatement') {
						return callee.body;
					}
					if (callee.type === 'ParenExpression') {
						return getBlockFromCallee(callee.expression);
					}
					return null;
				}

				let block = null;
				const body = ast.body || [];
				for (const stmt of body) {
					if (stmt.type === 'ExpressionStatement' && stmt.expression && stmt.expression.type === 'CallExpression') {
						block = getBlockFromCallee(stmt.expression.callee);
						if (block) break;
					}
				}
				if (!block || !block.span) return null;
				const start = block.span.start; // incluye '{'
				const end = block.span.end; // incluye '}'
				let slice = text.slice(start, end);
				// Retirar llaves externas si existen
				if (slice.startsWith('{') && slice.endsWith('}')) {
					slice = slice.slice(1, -1);
				}
				return slice;
			} catch (e) {
				return null;
			}
		}

		let body = await extractWithSwc(content);
		function extractByBraces(text) {
			const iifePos = text.indexOf('(function');
			if (iifePos === -1) return null;
			let openIdx = text.indexOf('{', iifePos);
			if (openIdx === -1) return null;
			let i = openIdx + 1,
				depth = 1,
				inString = null,
				escape = false;
			for (; i < text.length; i++) {
				const ch = text[i];
				if (inString) {
					if (escape) {
						escape = false;
						continue;
					}
					if (ch === '\\') {
						escape = true;
						continue;
					}
					if (ch === inString) {
						inString = null;
						continue;
					}
					continue;
				} else {
					if (ch === '"' || ch === "'" || ch === '`') {
						inString = ch;
						continue;
					}
					if (ch === '{') {
						depth++;
						continue;
					}
					if (ch === '}') {
						depth--;
						if (depth === 0) break;
						continue;
					}
				}
			}
			if (depth !== 0) return null;
			return text.slice(openIdx + 1, i);
		}
		if (!body) body = extractByBraces(content);
		if (!body) {
			// fallback a heurística anterior (use strict / last index)
			const usIdx = content.indexOf('"use strict"');
			const usIdx2 = usIdx === -1 ? content.indexOf("'use strict'") : usIdx;
			const start = usIdx2 >= 0 ? usIdx2 + 12 : 0;
			const end = content.lastIndexOf('})()');
			if (end > start) body = content.slice(start, end);
		}

		if (body != null) {
			const pubIdx = body.indexOf('for (const __mod of __modules)');
			if (pubIdx >= 0) body = body.slice(0, pubIdx);

			let functionsOnly = body
				// eliminar variables __mN
				.replace(/\n?\s*(?:var|const|let)\s+__m\d+[^\n]*?=[\s\S]*?;\s*/g, '')
				// eliminar arreglo __modules
				.replace(/\n?\s*(?:var|const|let)\s+__modules\s*=\s*\[[\s\S]*?\];\s*/g, '')
				// eliminar loop de publicación a globalThis
				.replace(/for\s*\(const\s+__mod\s+of\s+__modules\)[\s\S]*$/g, '')
				// Importante: NO eliminar catch vacíos. Si los quitamos, dejaríamos un try sin
				// catch/finally y se produce un error de sintaxis. Mantenerlos es seguro.
				// eliminar 'use strict'
				.replace(/^(?:\s*'use strict'|\s*"use strict");?/m, '')
				// eliminar asignaciones a exports.NAME (no queremos exponerlas en Apps Script)
				.replace(/(^|\n)\s*exports\.([A-Za-z0-9_$]+)\s*=\s*([^;\n]+);?/g, '')
				// eliminar Object.defineProperty(exports, ...)
				.replace(/Object\.defineProperty\(exports,[\s\S]*?\);?/g, '')
				// eliminar exports.__esModule = true
				.replace(/(^|\n)\s*exports\.__esModule\s*=\s*true;?/g, '')
				.trim();

			// Validación de sintaxis: parsear con SWC para detectar retornos ilegales u otros errores.
			async function validateSyntaxOrDie(code, label) {
				try {
					let swcMod;
					try {
						swcMod = await import('@swc/core');
					} catch (e) {
						// Si no está disponible @swc/core, omitir validación pero continuar el build.
						const msg = e?.message || String(e);
						if (msg.includes('Cannot find module') || msg.includes('MODULE_NOT_FOUND')) {
							console.warn('Warning: @swc/core no está instalado; se omite la validación de sintaxis.');
							return true;
						}
						throw e;
					}
					const swc = swcMod.default ?? swcMod;
					const parse = swc.parseSync ? (c, o) => swc.parseSync(c, o) : (c, o) => swc.parse(c, o);
					parse(code, {
						jsc: { target: 'es2022' },
						syntax: 'ecmascript',
						isModule: false,
						comments: false,
					});
					return true;
				} catch (err) {
					try {
						await fs.writeFile(resolve(SERVER_DIR, 'Code.invalid.js'), code, 'utf-8');
					} catch {}
					console.error(`\n❌ Syntax error while transforming ${label}.`);
					console.error('   Message:', err?.message || String(err));
					console.error('   A copy of the invalid output was saved as dist/Code.invalid.js for inspection.');
					process.exit(1);
				}
			}

			await validateSyntaxOrDie(functionsOnly, 'server Code.js');

			// Not exposing top-level functions via globalThis is intentional: Apps Script
			// will pick up top-level function declarations (e.g. function doGet) automatically.
			// We only keep explicit conversions from `exports.*` to `globalThis.*` above.

			functionsOnly = functionsOnly.trim() + '\n';
			await fs.writeFile(dest, functionsOnly, 'utf-8');
			console.log('  -> dist/Code.js created (Apps Script transform)');
		} else {
			console.warn('Could not transform server code, writing original. It may not work in Apps Script.');
			await fs.copyFile(tmp, dest);
		}
	} catch (err) {
		console.error('Error processing server Code.js:', err);
		process.exit(1);
	} finally {
		try {
			rmSync(resolve(PROJECT_ROOT, 'temp_server_build'), { recursive: true, force: true });
		} catch (e) {}
	}
}

// Genera src/server/doGet.generated.ts con un lookup O(1) para cada página
async function writeDoGetGenerated(pageNames) {
	try {
		await fs.mkdir(SERVER_SRC_DIR, { recursive: true });
	} catch {}

	const pages = pageNames;
	const defaultPage = pages.includes('home') ? 'home' : pages[0] || 'home';

	const content = `// GENERATED by scripts/build-apps.mjs - do not edit\nexport function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {\n  const page = (e && e.parameter && e.parameter.page ? String(e.parameter.page) : '').trim();\n  const known = new Set(${JSON.stringify(
		pages,
	)});\n  const target = known.has(page) ? page : '${defaultPage}';\n  return HtmlService.createHtmlOutputFromFile(target);\n}\n`;

	const outPath = resolve(SERVER_SRC_DIR, 'doGet.generated.ts');
	await fs.writeFile(outPath, content, 'utf-8');
	console.log('  -> src/server/doGet.generated.ts written');
}

// busca recursivamente el primer .html dentro de una carpeta
async function findHtmlFile(dir) {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const e of entries) {
			const full = resolve(dir, e.name);
			if (e.isFile() && full.toLowerCase().endsWith('.html')) return full;
			if (e.isDirectory()) {
				const found = await findHtmlFile(full);
				if (found) return found;
			}
		}
	} catch (err) {
		return null;
	}
	return null;
}

async function buildClientSingleFile(entry) {
	console.log(`\nBuilding client single-file: ${entry.name} ...`);
	const outDir = resolve(TEMP_ROOT, entry.name);
	const tempPageDir = resolve(TEMP_ROOT, entry.name, 'page');

	// limpia temp por si acaso
	try {
		rmSync(outDir, { recursive: true, force: true });
	} catch (e) {}

	// Crear carpeta temporal para esta página y generar un main.tsx que importe el App de la página
	try {
		await fs.mkdir(tempPageDir, { recursive: true });
		const sharedTemplatePath = resolve(PROJECT_ROOT, 'src/client/template.html');
		let indexContent;
		if (!entry.html) {
			if (!existsSync(sharedTemplatePath)) {
				console.error(`No index.html for page "${entry.name}" and no shared template at ${sharedTemplatePath}.`);
				process.exit(1);
			}
			indexContent = await fs.readFile(sharedTemplatePath, 'utf-8');
			indexContent = indexContent.replace(/{{PAGE_NAME}}/g, entry.name);
			indexContent = indexContent.replace(/{{TITLE}}/g, entry.name);
		} else {
			indexContent = await fs.readFile(entry.html, 'utf-8');
		}

		await fs.writeFile(resolve(tempPageDir, 'index.html'), indexContent, 'utf-8');
		// generar main.tsx dinámico que use el alias '@' para importar App y CSS
		// Debug: nombre de página
		console.log(entry.name);
		const genMain = `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport '@/client/index.css';\nimport App from '@/client/pages/${entry.name}/App';\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n`;
		await fs.writeFile(resolve(tempPageDir, 'main.tsx'), genMain, 'utf-8');
	} catch (e) {
		console.error('Error preparing temporary page files for', entry.name, e);
		process.exit(1);
	}

	// configuración por entrada: heredamos vite.config.js (alias/plugins) usando configFile, pero también forzamos outDir e input al index.html temporal
	const configForEntry = {
		plugins: [viteSingleFile({ useRecommendedBuildConfig: true })],
		build: {
			outDir,
			emptyOutDir: true,
			rollupOptions: {
				input: resolve(tempPageDir, 'index.html'),
			},
			minify: true,
			sourcemap: false,
		},
		configFile: resolve(PROJECT_ROOT, 'vite.config.ts'),
	};

	try {
		await viteBuild(configForEntry);
	} catch (err) {
		console.error(`Error building ${entry.name}:`, err);
		process.exit(1);
	}

	const generatedIndex = await findHtmlFile(outDir);
	if (!generatedIndex) {
		console.error(`\n⚠️ No se encontró ningún .html en ${outDir} después del build.`);
		try {
			const list = await fs.readdir(outDir);
			console.error('Contenido de la carpeta temporal:', list);
		} catch (e) {
			console.error('No se pudo leer la carpeta temporal:', e.message || e);
		}
		console.error('Asegúrate de que la entrada HTML existe y que el build produjo archivos. Saliendo.');
		process.exit(1);
	}

	const targetHtml = resolve(SERVER_DIR, `${entry.name}.html`);

	try {
		const content = await fs.readFile(generatedIndex, 'utf-8');
		await ensureServerDir();
		await fs.writeFile(targetHtml, content, 'utf-8');
		console.log(`  -> dist/${entry.name}.html written (desde ${generatedIndex})`);
	} catch (err) {
		console.error(`Error writing server/${entry.name}.html:`, err);
		process.exit(1);
	} finally {
		try {
			rmSync(outDir, { recursive: true, force: true });
		} catch (e) {}
	}
}

// Utilidades de hashing para compilación incremental
async function walkFiles(dir) {
	const out = [];
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const e of entries) {
			const full = resolve(dir, e.name);
			if (e.isDirectory()) {
				const nested = await walkFiles(full);
				out.push(...nested);
			} else {
				out.push(full);
			}
		}
	} catch {}
	return out;
}

async function hashFiles(files) {
	const h = createHash('sha1');
	for (const f of files.sort()) {
		try {
			const buf = await fs.readFile(f);
			h.update(f);
			h.update(buf);
		} catch {}
	}
	return h.digest('hex');
}

async function computePageHash(pageName) {
	const srcRoot = resolve(PROJECT_ROOT, 'src');
	const pageDir = resolve(srcRoot, 'client/pages', pageName);
	const entry = resolve(pageDir, 'App.tsx');

	// Resolver imports con alias '@/'
	const codeExtRe = /\.(ts|tsx|js|jsx)$/i;
	const anyExtRe = /\.(ts|tsx|js|jsx|css|json|html)$/i;

	function resolveImport(fromFile, spec) {
		// externos (react, gas-client, etc.) -> ignorar
		if (!spec.startsWith('.') && !spec.startsWith('@/')) return null;
		let base;
		if (spec.startsWith('@/')) {
			base = resolve(srcRoot, spec.slice(2));
		} else {
			base = resolve(dirname(fromFile), spec);
		}
		const candidates = [];
		// si ya trae extensión válida, probar directo
		if (anyExtRe.test(base)) candidates.push(base);
		// variantes con extensión
		const exts = ['.ts', '.tsx', '.js', '.jsx', '.css', '.json'];
		for (const ext of exts) candidates.push(base + ext);
		// índice dentro de carpeta
		for (const ext of exts) candidates.push(resolve(base, 'index' + ext));
		for (const cand of candidates) {
			try {
				if (existsSync(cand)) return cand;
			} catch {}
		}
		return null;
	}

	async function collectGraph(startFile) {
		const toVisit = [startFile];
		const visited = new Set();
		const files = new Set();
		while (toVisit.length) {
			const file = toVisit.pop();
			if (!file || visited.has(file)) continue;
			visited.add(file);
			files.add(file);
			if (!codeExtRe.test(file)) continue; // solo parseamos código
			let text;
			try {
				text = await fs.readFile(file, 'utf-8');
			} catch {
				continue;
			}
			// importar: import ... from 'x'; export ... from 'x'; import('x')
			const re = /(import|export)\s+[^'"\n]*from\s*['"]([^'"\n]+)['"]|import\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
			let m;
			while ((m = re.exec(text))) {
				const spec = m[2] || m[3];
				if (!spec) continue;
				const resolved = resolveImport(file, spec);
				if (!resolved) continue;
				// añadimos siempre al conjunto de archivos
				files.add(resolved);
				// si es código, seguimos el grafo
				if (codeExtRe.test(resolved)) toVisit.push(resolved);
			}
		}
		return Array.from(files);
	}

	const files = [];
	// incluir entry si existe
	if (existsSync(entry)) {
		const graph = await collectGraph(entry);
		files.push(...graph);
	}
	// incluir index.html propio o plantilla compartida
	const pageHtml = resolve(pageDir, 'index.html');
	if (existsSync(pageHtml)) files.push(pageHtml);
	else {
		const sharedTemplate = resolve(srcRoot, 'client', 'template.html');
		if (existsSync(sharedTemplate)) files.push(sharedTemplate);
	}
	// incluir hoja de estilos global usada por main.tsx generado
	const globalCss = resolve(srcRoot, 'client', 'index.css');
	if (existsSync(globalCss)) files.push(globalCss);

	// de-duplicar y hashear
	const unique = Array.from(new Set(files)).filter((f) => anyExtRe.test(f));
	return await hashFiles(unique);
}

async function computeServerHash() {
	const serverDir = resolve(PROJECT_ROOT, 'src/server');
	const files = await walkFiles(serverDir);
	const filtered = files.filter((f) => /\.(ts|js|json)$/.test(f));
	return await hashFiles(filtered);
}

async function loadCache() {
	try {
		const txt = await fs.readFile(CACHE_FILE, 'utf-8');
		return JSON.parse(txt);
	} catch {
		return { pages: {}, server: '' };
	}
}

async function saveCache(cache) {
	try {
		await ensureServerDir();
		await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
	} catch {}
}

// Ejecuta trabajos en paralelo con un límite de concurrencia pequeño
async function runWithConcurrency(items, limit, worker) {
	const queue = items.slice();
	let active = 0;
	let ended = false;
	return new Promise((resolve, reject) => {
		const next = () => {
			if (ended) return;
			const item = queue.shift();
			if (item == null) {
				if (active === 0) {
					ended = true;
					resolve();
				}
				return;
			}
			active++;
			Promise.resolve()
				.then(() => worker(item))
				.then(() => {
					active--;
					next();
				})
				.catch((err) => {
					ended = true;
					reject(err);
				});
		};
		const starters = Math.min(limit, queue.length || 0);
		if (starters === 0) return resolve();
		for (let i = 0; i < starters; i++) next();
	});
}

(async () => {
	console.log('Starting Apps Script build (server + single-file clients)...');

	await ensureServerDir();

	const allEntries = await discoverEntries();
	let entries = allEntries;
	// Filtra por --pages si se pasa
	if (PAGES_ARG) {
		const allow = new Set(
			PAGES_ARG.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
		);
		entries = allEntries.filter((e) => allow.has(e.name));
	}
	console.log('Discovered pages:', allEntries.map((e) => e.name).join(', ') || '(none)');

	// Generate doGet implementation only (no pages.generated.ts)
	try {
		const pageNames = allEntries.map((e) => e.name);
		const serverSrcDir = resolve(PROJECT_ROOT, 'src', 'server');
		await fs.mkdir(serverSrcDir, { recursive: true });
		await writeDoGetGenerated(pageNames);
	} catch (e) {
		console.error('Error writing server generated files:', e);
		process.exit(1);
	}

	// Build server con cache si no se pasa --skip-server
	const cache = await loadCache();
	// asegurar estructura para nuevas claves
	cache.pages = cache.pages || {};
	cache.templates = cache.templates || {};
	// set para recolectar templates actuales y poder depurar huérfanos
	const currentTemplateKeys = new Set();
	if (!SKIP_SERVER) {
		const newServerHash = await computeServerHash();
		const hasServerChanged = cache.server !== newServerHash;
		if (!ONLY_CHANGED || hasServerChanged) {
			await buildServer();
			cache.server = newServerHash;
		} else {
			console.log('Skipping server build (no changes detected)');
		}
	} else {
		console.log('Skipping server build due to --skip-server flag');
	}

	// Determinar qué páginas compilar
	const pagesToBuild = [];
	for (const entry of entries) {
		if (entry.html) {
			if (!existsSync(entry.html)) {
				console.warn(`Warning: entry html not found: ${entry.html} — skipping`);
				continue;
			}
		} else {
			console.log(`Note: page "${entry.name}" has no index.html; using shared template (if present).`);
		}
		let shouldBuild = true;
		if (ONLY_CHANGED) {
			const newHash = await computePageHash(entry.name);
			const prevHash = cache.pages?.[entry.name];
			if (prevHash && prevHash === newHash && existsSync(resolve(SERVER_DIR, `${entry.name}.html`))) {
				shouldBuild = false;
			} else {
				// registrar el nuevo hash antes o después
				cache.pages = cache.pages || {};
				cache.pages[entry.name] = newHash;
			}
		}
		if (shouldBuild) pagesToBuild.push(entry);
	}

	if (pagesToBuild.length === 0) {
		console.log('No pages to build (either filtered by --pages or unchanged with --changed).');
	} else {
		const CONCURRENCY = 3;
		console.log(`Building ${pagesToBuild.length} page(s) with concurrency=${CONCURRENCY} ...`);
		await runWithConcurrency(pagesToBuild, CONCURRENCY, (entry) => buildClientSingleFile(entry));
	}

	// Copiar HTMLs arbitrarios (no-index) como plantillas para Apps Script
	try {
		const pagesRoot = resolve(PROJECT_ROOT, 'src/client/pages');
		const allFiles = await walkFiles(pagesRoot);
		const htmlFiles = allFiles.filter((f) => f.toLowerCase().endsWith('.html'));
		const extraHtmls = htmlFiles.filter((f) => basename(f).toLowerCase() !== 'index.html');
		const pageNameSet = new Set(allEntries.map((e) => e.name));

		for (const srcFile of extraHtmls) {
			const relPath = relative(pagesRoot, srcFile).split('\\').join('/');
			const segments = relPath.split('/');
			const file = segments.pop() || '';
			const nameNoExt = file.replace(/\.html$/i, '');
			let destBaseName = [...segments, nameNoExt].join('.');
			// Evitar colisión con páginas build (p.ej., src/client/pages/about.html vs carpeta page "about")
			// Si el archivo está en la raíz de pages/ (sin subcarpeta) y coincide con un nombre de página, renombrar con sufijo .template
			if (segments.length === 0 && pageNameSet.has(nameNoExt)) {
				destBaseName = `${nameNoExt}.template`;
			}
			if (!destBaseName) continue;
			currentTemplateKeys.add(destBaseName);
			const destFile = resolve(SERVER_DIR, `${destBaseName}.html`);

			let shouldCopy = true;
			let fileHash = '';
			try {
				fileHash = await hashFiles([srcFile]);
			} catch {}
			if (ONLY_CHANGED) {
				const prev = cache.templates?.[destBaseName];
				if (prev && prev === fileHash && existsSync(destFile)) {
					shouldCopy = false;
				}
			}
			if (shouldCopy) {
				const content = await fs.readFile(srcFile, 'utf-8');
				await ensureServerDir();
				await fs.writeFile(destFile, content, 'utf-8');
				cache.templates = cache.templates || {};
				cache.templates[destBaseName] = fileHash || (await hashFiles([srcFile]));
				console.log(`  -> dist/${destBaseName}.html copied (template from ${relPath})`);
			}
		}
	} catch (e) {
		console.warn('Warning copying extra HTML templates:', e?.message || e);
	}

	// Limpieza: eliminar HTMLs de páginas eliminadas
	try {
		const currentPageNames = new Set(allEntries.map((e) => e.name));
		for (const name of Object.keys(cache.pages || {})) {
			if (!currentPageNames.has(name)) {
				const f = resolve(SERVER_DIR, `${name}.html`);
				try {
					await fs.unlink(f);
					console.log(`  -> dist/${name}.html removed (page deleted)`);
				} catch {}
				delete cache.pages[name];
			}
		}
	} catch {}

	// Limpieza: eliminar HTMLs de plantillas eliminadas
	try {
		for (const key of Object.keys(cache.templates || {})) {
			if (!currentTemplateKeys.has(key)) {
				const f = resolve(SERVER_DIR, `${key}.html`);
				try {
					await fs.unlink(f);
					console.log(`  -> dist/${key}.html removed (template deleted)`);
				} catch {}
				delete cache.templates[key];
			}
		}
	} catch {}

	// 3) Copiar appsscript.json (si tienes una plantilla local)
	const appsscriptSrc = resolve(PROJECT_ROOT, 'appsscript.json');
	const appsscriptDest = resolve(SERVER_DIR, 'appsscript.json');
	if (existsSync(appsscriptSrc)) {
		await fs.copyFile(appsscriptSrc, appsscriptDest);
		console.log('  -> appsscript.json copied to dist/');
	} else {
		console.log('  -> No local appsscript.json found (skipping copy).');
	}

	try {
		rmSync(TEMP_ROOT, { recursive: true, force: true });
	} catch (e) {}

	// Guardar cache
	await saveCache(cache);

	console.log('\nBuild finished. Result files in /dist (list):');
	const files = await fs.readdir(SERVER_DIR);
	files.forEach((f) => console.log('  -', f));
	console.log('\nPuedes ejecutar: clasp push (desde la carpeta dist) o configurar tu workflow.');
})();
