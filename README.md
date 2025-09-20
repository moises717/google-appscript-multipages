# Plantilla Google Apps Script (React + Vite)

Proyecto para crear aplicaciones multipágina sobre Google Apps Script (GAS) utilizando React, TypeScript y Vite. El repositorio compila la parte de servidor (Apps Script) y el cliente (React) y produce artefactos listos para desplegar con `clasp`.

## 📌 Resumen

- Cliente: React + Vite + Tailwind + Shadcn (páginas en `src/client/pages/*`).
- Servidor: TypeScript compilado y transformado para Apps Script (salida en `dist/` o `server/` según configuración).
- Build: `node scripts/build-apps.mjs` genera los HTML "single-file" por página y el `Code.js` para GAS.
- Deploy: con `clasp` (ver sección de despliegue).

## 🚀 Características principales

- Generación automática del código servidor adaptado a Apps Script (`Code.js`).
- Soporte de múltiples páginas; cada página se empaqueta como un HTML independiente y se coloca en `dist/` o `server/` según el build.
- Generación dinámica de `doGet` y un manifiesto de páginas (`src/server/pages.generated.ts`, `src/server/doGet.generated.ts`).
- Flujo de build y deploy integrado: `npm run build` y opciones para `clasp push`.

## 📂 Estructura del proyecto (resumen)

```
.
├─ appsscript.json             # Opcional: manifest de Apps Script que se copia al build
├─ scripts/
│  └─ build-apps.mjs          # Script que compila servidor + cliente en artefactos para GAS
├─ src/
│  ├─ client/                 # Código React (páginas, componentes, estilos)
│  │  └─ pages/               # Cada carpeta representa una página (ej. home, dashboard)
│  └─ server/                 # Utilidades y stubs para Apps Script (generados durante build)
├─ dist/                      # Salida del build (Code.js, <page>.html, appsscript.json)
├─ package.json               # Scripts y dependencias
```

> Nota: durante el build los artefactos finales se colocan en `dist/` o `server/` (el script `scripts/build-apps.mjs` gestiona el destino).

## 📋 Scripts importantes (en `package.json`)

- `npm run dev` — Ejecuta Vite en modo desarrollo para el cliente.
- `npm run build` — Compila TypeScript y ejecuta `scripts/build-apps.mjs` (genera `dist/`).
- `npm run lint` — Ejecuta ESLint sobre el proyecto.
- `npm run preview` — Previsualiza el build con `vite preview`.
- `npm run deploy` — Ejecuta `npm run build` y (según configuración) lanza `clasp push` (ver despliegue abajo).

```
npm install
npm run build
```

### ⚡ Compilación incremental por páginas

El script `scripts/build-apps.mjs` soporta flags para acelerar el build:

- `--pages=home,dashboard` compila solo esas páginas.
- `--changed` compila únicamente páginas (y opcionalmente servidor) que hayan cambiado desde el último build (usa un cache en `dist/.build-cache.json`).
- `--skip-server` salta la compilación del servidor (útil si solo cambiaste UI).

Ejemplos (Windows cmd):

```
node scripts/build-apps.mjs --pages=home --skip-server
node scripts/build-apps.mjs --changed
node scripts/build-apps.mjs --changed --pages=dashboard
```

Con npm puedes pasar flags al script de build:

```
npm run build -- --changed
npm run build -- --pages=home --skip-server
```

## 🔧 Despliegue a Google Apps Script (clasp)

1. Instala y autentica `clasp` si no lo tienes:

```
npm i -g @google/clasp
clasp login
```

2. Construye el proyecto:

```
npm run build
```

3. Desde la carpeta de salida (por defecto `dist/` o `server/`) ejecuta `clasp push`:

```
cd dist
clasp push
```

Nota: el script `npm run deploy` del `package.json` puede lanzar `clasp push` tras el build, pero dependiendo de tu configuración quizá necesites hacer `cd dist && clasp push` manualmente.
