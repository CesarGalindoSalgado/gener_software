# ETL — Carga semilla del histórico

Importador de cotizaciones históricas a Firestore. Ya se ejecutó con las 5
cotizaciones de muestra (`docs/muestras/extraccion_cotizaciones_muestra.json`):
quedaron cargadas como `estatus: importada`, su bitácora de precios derivada, y
la **semilla del contador de folio** ajustada (2025→19, 2026→7).

La lógica vive en `functions/src/servicios/etl.ts` (`importarCotizaciones`). El
endpoint HTTP para dispararla es **temporal** y se agrega solo cuando hay que
cargar; se quita después por seguridad.

## Formato de entrada

Un arreglo JSON de cotizaciones ya extraídas, con el esquema de la muestra:

```json
[
  {
    "folio": "GPC-0326-005",
    "fecha": "2026-03-05",
    "cliente": { "nombre": "Jardines México", "atencion": null, "telefono": null, "correo": null },
    "asunto": "Mantenimiento preventivo básico a grupo electrógeno",
    "partidas": [ { "titulo": "...", "descripcion": "...", "lineas": ["..."], "cantidad": 1, "importe": 16437.0 } ],
    "subtotal": 16437.0, "iva": 2629.92, "total": 19066.92,
    "formaPago": "70% anticipo / 30% entrega", "tiempoEntrega": "1 a 2 días"
  }
]
```

Reglas del importador:
- **Filtro de calidad:** rechaza (sin cargar) las que no reconcilian (suma de
  partidas = subtotal, IVA 16%, total, tolerancia ±0.01). Las devuelve en
  `rechazadas` con el motivo, para revisión manual.
- **Idempotente por folio:** re-ejecutar no duplica (id de doc derivado del folio).
- **Semilla del folio:** sube el contador `counters/folio_{anio}` al consecutivo
  más alto encontrado (nunca lo baja).

## Cómo cargar el corpus completo (cuando lo tengas en JSON)

1. Extrae los PDFs a un arreglo JSON con el esquema de arriba (Claude Cowork
   para el lote de carpetas de Drive, o un script para PDFs de texto).
2. En `functions/src/index.ts`, reactiva el endpoint temporal (bloque comentado
   "ETL de histórico") + su secreto `ETL_TOKEN`. Genera el token, súbelo con
   `functions:secrets:set ETL_TOKEN` y despliega `functions:importarHistorico`.
3. Dispara con:
   ```powershell
   Invoke-WebRequest -Uri "https://us-central1-gener-3ecc1.cloudfunctions.net/importarHistorico" `
     -Method POST -Headers @{ "x-etl-token" = "<token>" } `
     -ContentType "application/json; charset=utf-8" `
     -Body ([System.Text.Encoding]::UTF8.GetBytes((Get-Content corpus.json -Raw)))
   ```
4. Revisa el resultado (`importadas`, `rechazadas`, `semillasFolio`).
5. **Limpia:** quita el endpoint del código, `functions:delete importarHistorico`
   y `functions:secrets:destroy ETL_TOKEN`.

> Para lotes grandes, parte el corpus en tandas (el endpoint tiene 540s de
> timeout). La idempotencia permite re-enviar tandas sin duplicar.
