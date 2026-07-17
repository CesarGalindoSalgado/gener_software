# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es este proyecto

Módulo de Cotizaciones de **Portteo**, el asistente virtual de G-ener (Gener Power & Control). Permite armar, aprobar y dar seguimiento a cotizaciones desde **Porttea-Gener** (plataforma web, dos paneles: chat + documento en vivo — forma principal) y por WhatsApp (forma secundaria), con folio automático, memoria de precios, PDF y respaldo en Drive.

**Leer primero:** [docs/Ficha_Entendimiento_Cotizaciones_Gener.md](docs/Ficha_Entendimiento_Cotizaciones_Gener.md) (negocio) y [docs/Brief_Construccion_Cotizaciones.md](docs/Brief_Construccion_Cotizaciones.md) (técnico). Si negocio y brief difieren, manda la Ficha.

## Comandos

Todo el backend vive en `functions/` (TypeScript):

```bash
cd functions
npm install          # dependencias
npm run build        # compilar TypeScript
npm test             # correr todos los tests (vitest)
npx vitest run src/dominio/importeConLetra.test.ts   # un solo archivo de tests
npm run emuladores   # emuladores de Firebase (Firestore + Functions)
```

## Arquitectura (capas, de fuera hacia dentro)

1. **`functions/src/canal/`** — adaptadores de WhatsApp/Telegram. Ambos normalizan al mismo `MensajeEntrante`; el resto del sistema es agnóstico al canal. El canal es solo transporte: **la fuente de verdad es Firestore**.
2. **`functions/src/router/`** — resuelve `usuarios/{telefono}` → rol (lista blanca; número desconocido se ignora) y enruta la intención.
3. **`functions/src/agente/`** — Portteo: LLM (Claude API) con herramientas del dominio. Regla dura: **el LLM nunca inventa precios** — solo del histórico o dictados por el dueño.
4. **`functions/src/dominio/`** — lógica pura de negocio: folio, estados, totales, importe con letra. Sin dependencias de canal ni de LLM; es lo más testeado.
5. **`web/`** — Porttea-Gener (**Vue 3 + Vite + TypeScript + Tailwind v4 + shadcn-vue + lucide-vue-next**; Firestore en vivo con VueFire/onSnapshot). Fase 2. Sigue [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) (el PDF NO — tiene plantilla HTML propia aprobada por el cliente, agnóstica al framework).

## Reglas de negocio que el código debe respetar siempre

- **Folio `GPC-MMYY-NNN`:** consecutivo **mensual** — se reinicia en 1 cada mes (`counters/folio_{anio}_{mm}`). Se asigna **solo al aprobar** y en **transacción** Firestore. Nunca antes, nunca dos veces. Revisiones (Rev. B, C…) conservan el mismo folio.
- **Aprobación = transacción + efectos:** la transacción cubre folio + estatus (`borrador` → `enviada`) + `fechaEnvio`. PDF, Drive, bitácora y notificación son efectos **idempotentes con reintento** (clave `cotizacionId` + `rev`), nunca dentro de la transacción.
- **Solo rol `dueno` aprueba** — validado en backend, no solo en UI.
- **Dos identidades por usuario:** la web (Porttea-Gener) usa **Firebase Auth correo + contraseña** y la identidad es el correo (`usuarios/{correo}`, id del doc); el bot (WhatsApp/Telegram) usa el **teléfono** (campo `telefono`, resuelto por query con Admin SDK). El dueño da de alta las cuentas web.
- **IVA 16%**, redondeo a 2 decimales: `iva = round2(subtotal * 0.16)`. Reconciliación de importes históricos tolera ±0.01.
- **Estados:** `borrador → enviada → autorizada → realizada`, rama `rechazada`; `importada` es solo para históricos del ETL.
- El precio vive en la **partida (bloque)**, no en las líneas de alcance.

## Convenciones

- **Dominio en español:** colecciones, campos, tipos y funciones de negocio en español sin acentos en identificadores (`cotizacion`, `dueno`, `precioSugerido`). Comentarios y mensajes al usuario en español.
- **Secretos** (WhatsApp/Telegram, API del LLM, service account de Drive) solo en variables de entorno / Secret Manager. Nunca en el repo — `functions/.env` está en `.gitignore`; usa `functions/.env.example` como referencia.
- **Git:** ramas por feature, PRs pequeños contra `main`. Mensajes de commit en español, imperativo ("Agrega folio transaccional").
- **Fuera de alcance del MVP** (no construir): cobranza, costeo/márgenes, módulos Taller y Rutinas. La infra sí debe quedar lista para que se monten encima.
