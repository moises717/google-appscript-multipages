# Instrucciones para agentes de IA en este repositorio

Este repo compila una app multipágina para Google Apps Script (GAS) usando React + Vite (cliente) y TypeScript (servidor) y produce artefactos listos para `clasp`.

## Panorama general
- Frontend: React 19 + Vite + Tailwind 4 + Radix UI, con alias `@` a `src/`. Páginas en `src/client/pages/<page>/App.tsx`.
- Backend (GAS): funciones en `src/server/**`. El build genera:
  - `dist/Code.js` con las funciones Apps Script (IIFE a funciones planas).
  - `dist/<page>.html` (cada página React empaquetada como single-file HTML).
  - Archivo generado: `src/server/doGet.generated.ts`.
- Comunicación cliente-servidor: `gas-client` expone `serverFunctions` en el cliente y re-exporta funciones públicas desde `src/server/index.ts`.

## Flujo de build y deploy
- Ejecutar build: `npm run build` → compila TypeScript y corre `scripts/build-apps.mjs`.
- Salida: `dist/` contiene `Code.js`, `appsscript.json` (si existe en raíz) y cada página como `<name>.html`.
- Deploy manual: `cd dist && clasp push` (también `npm run deploy`).
- Desarrollo local UI: `npm run dev` (Vite). Nota: `gas-client` permite desarrollo local sólo para orígenes `https://*.googleusercontent.com` (ver `src/client/lib/client.ts`).

## Convenciones clave
- Páginas: una carpeta por página bajo `src/client/pages/<name>/`. Debe contener `App.tsx`. Si además existe `index.html`, el build la tomará; si no, usará `src/client/template.html` como base.
- Routing en GAS: `doGet` generado selecciona la página por parámetro `?page=<name>`. Archivo de verdad: `src/server/doGet.generated.ts` (no editar a mano).
- Exportaciones públicas del servidor: re-exportar desde `src/server/index.ts` para que estén disponibles vía `gas-client` en el cliente, p.ej. `export { sheetToJsonFromName } from './sheets.ts'`.
- CSS/utilidades: importar utilidades vía `@/client/...`. Tailwind está configurado con `@tailwindcss/vite`. Variables de diseño en `src/client/index.css`.

## Patrones y ejemplos
- Llamar funciones GAS desde React:
  ```ts
  import { serverFunctions } from '@/client/lib/client';
  const rows = await serverFunctions.sheetToJsonFromName('Cuentas', { useDisplayValues: true });
  ```
- Crear una nueva página "reports":
  1) `mkdir src/client/pages/reports` y crear `App.tsx` exportando `default`.
  2) (opcional) `index.html` si quieres un `<title>` propio; si no, se usa `src/client/template.html`.
  3) `npm run build` → obtendrás `dist/reports.html` y `doGet` incluirá la nueva página.
- Servidor a GAS: coloca funciones en `src/server/*.ts` y re-expórtalas en `src/server/index.ts`.

## Detalles del script de build (`scripts/build-apps.mjs`)
- Descubre páginas en `src/client/pages/*` y genera single-file HTML con `vite-plugin-singlefile`.
- Genera `doGet.generated.ts` en `src/server/`.
- Compila el servidor a IIFE y lo transforma para Apps Script (extiende globalThis y elimina el wrapper).
- Copia `appsscript.json` a `dist/` si existe.

## Qué tocar / qué no tocar
- No edites archivos `*.generated.ts` ni el contenido dentro de `dist/` manualmente; son regenerados en cada build.
- Edita `vite.config.ts` para alias/plugins. El outDir por defecto de Vite no aplica al build final (el script usa sus propias rutas temporales y `dist/`).

## Dependencias externas
- GAS: `SpreadsheetApp`, `HtmlService`, etc. Usar tipos de `@types/google-apps-script`.
- Cliente: `gas-client`, Radix UI, shadcn-like componentes en `src/client/components/ui/*`, gráficos `recharts`.

## Comandos útiles
- Dev UI: `npm run dev`
- Linter: `npm run lint`
- Build: `npm run build`
- Preview Vite: `npm run preview`
- Deploy: `npm run deploy` o `cd dist && clasp push`

Si algo no está claro (p.ej., comportamiento exacto del transform del servidor), abre un issue o pide que ampliemos esta guía.