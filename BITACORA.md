# Bitácora del proyecto

## Sobre el proyecto

_Pendiente de rellenar._

## Registro de cambios

> Entradas automáticas escritas por nexus-bot tras cada trabajo.

### 2026-07-02 21:27 · 📋 Plan propuesto

**Petición:** hola, dime qué archivos hay en este proyecto

El proyecto tiene **57 archivos versionados**. Aquí está la estructura organizada por capa:

## Raíz / configuración
- `CLAUDE.md`, `README.md`, `DESIGN-SYSTEM.md`
- `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`
- `.gitignore`, `.claude/launch.json`

## `docs/` — documentación de negocio y técnica
- `Ficha_Entendimiento_Cotizaciones_Gener.md` (negocio, manda esta)
- `Brief_Construccion_Cotizaciones.md` (técnico)
- `muestras/extraccion_cotizaciones_muestra.json`

## `functions/` — backend (TypeScript, Firebase Functions)
Organizado en las capas que describe CLAUDE.md:
- **`src/canal/`** — adaptadores: `whatsapp.ts`, `telegram.ts`, `tipos.ts`
- **`src/router/`** — `router.ts` + test
- **`src/agente/`** — Portteo (LLM): `portteo.ts`, `herramientas.ts`
- **`src/dominio/`** — lógica pura (lo más testeado): `folio.ts`, `estados.ts`, `totales.ts`, `importeConLetra.ts`, `tipos.ts` — todos con su `.test.ts`
- **`src/servicios/`** — `aprobar.ts` + test
- **`src/index.ts`** — punto de entrada
- Config: `package.json`, `tsconfig.json`, `.env.example`

## `web/` — Porttea-Gener (Vue 3 + Vite + TS)
- **`src/vistas/`** — `Login.vue`, `Cotizaciones.vue`
- **`src/layout/`** — `Shell.vue`
- **`src/`** — `App.vue`, `main.ts`, `router.ts`, `sesion.ts`, `firebase.ts`, `style.css`, `dominio/tipos.ts`
- `index.html`, `public/` (iconos, favicon), configs de Vite/TS

---

Un par de observaciones rápidas:
- La capa **`servicios/`** (con `aprobar.ts`) no aparece mencionada en el CLAUDE.md pero existe — es donde vive la lógica transaccional de aprobación.
- Hay `web/dominio/tipos.ts` y `functions/dominio/tipos.ts` como archivos de tipos separados por lado.

¿Quieres que profundice en alguna capa en concreto, o buscabas algo específico dentro del proyecto?
