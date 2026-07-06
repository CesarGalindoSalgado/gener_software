# Brief de construcción — Módulo de Rutinas (Portteo · G-ener) — anexo

**Para:** Diego (desarrollo con Claude Code)
**Fuente de verdad de negocio:** `Ficha_Entendimiento_Rutinas_Gener.md`
**Reutiliza la infraestructura de:** `Brief_ClaudeCode_Cotizaciones_Gener.md` (Firebase, canal WhatsApp de sesión, Porttea-Gener, PDF HTML→PDF, Drive, auth por número/roles)
**Seed de datos:** `rutinas-gener.json` (74 rutinas)

---

## 0. Objetivo

Portteo guía al técnico por WhatsApp para ejecutar una rutina de mantenimiento paso por paso, capturando evidencia (foto, antes/después, medición con gráfico), y produce un reporte PDF profesional listo para firmar y sellar en sitio, con respaldo en Drive y tablero en Porttea-Gener. Mata el dolor de "regresar por sellos" y evidencia faltante.

**Este módulo se monta sobre la infraestructura compartida del brief de Cotizaciones; no se rehace.**

---

## 1. Stack

Igual que Cotizaciones: Firestore, Cloud Functions, Cloud Scheduler, Firebase Hosting (Porttea-Gener), canal WhatsApp de sesión + Telegram, LLM para Portteo, HTML→PDF, Drive. Storage (Firebase Storage o Drive) para **fotos de evidencia**.

**Principio de diseño (obligatorio):** todo cuelga de **cliente → sede → equipo (por número de inventario)**, nunca de "Gener" hardcodeado. Esto habilita la renta futura (acceso de solo lectura al cliente; otras empresas como inquilinos) sin rehacer el modelo. No construir la renta ahora.

---

## 2. Modelo de datos (Firestore)

### `clientes/{clienteId}`
- `nombre` (string) — ej. Servicios de Salud de Morelos

### `sedes/{sedeId}`
- `clienteId` (ref), `nombre`, `direccion` (string?), `responsable` (string?)

### `equipos/{equipoId}`
- `sedeId` (ref), `noInventario` (string), `descripcion` (string?), `rutinaTipoId` (ref?)

### `rutinas_plantilla/{rutinaId}`  — seed desde `rutinas-gener.json`
- `partida` (enum: `Equipo médico` | `Equipo electromecánico`), `nombre`, `activa` (bool)
- `equiposIncluidos` (array string), `refaccionesReferenciales` (array string)
- `pasos` (array): `{ orden, instruccion, evidencia }`
  - `evidencia`: `{ tipo: 'foto_comentario'|'antes_despues'|'medicion', requiereFoto (bool), fotosAntesDespues (bool), requiereLectura (bool), unidadSugerida (string?), graficoSugerido (bool?), rangoMin? , rangoMax?, rangoDefinido? }`

### `rutinas_ejecucion/{ejecucionId}`
- `folio` (string), `rutinaId` (ref), `sedeId` (ref), `equipoId` (ref), `tecnicoTelefono` (string), `tecnicoNombre` (string)
- `estatus` (enum: `en_proceso` | `cancelada` | `completada` | `validada` | `aprobada` | `firmada` | `faltante_firma`)
- `tiempos`: `{ inicio (ts), fin (ts?) }`; y por paso su timestamp
- `pasos` (array): `{ orden, instruccion, tipo, comentario?, fotos[] (urls), fotoAntes?, fotoDespues?, lectura?, unidad?, cumple? (bool?) }`
- `comentarios` (array): `{ texto, fotoUrl? }`  — múltiples
- `oportunidad` (string?) — alimenta la lista comercial
- `cancelacionRazon` (string?)
- `reportePdfUrl` (string?), `evidenciaFirmaUrl` (string?), `faltanteFirmaRazon` (string?)

### `oportunidades/{id}`
- `ejecucionId` (ref), `sedeId` (ref), `texto`, `estatus` (enum: `abierta` | `atendida`), `fecha` (ts)

### `counters/reporte_{anio}`
- `ultimo` (number) — folio de reporte, mismo patrón transaccional que cotizaciones.

---

## 3. Máquina de estados de la ejecución

`en_proceso → completada → validada → aprobada → (firmada | faltante_firma)`
Rama alterna desde `en_proceso`: `cancelada` (con razón).

- **aprobada:** al aprobar en el link se asigna folio (transaccional), se genera PDF, se sube a Drive, se escriben oportunidades.
- **firmada:** el técnico sube la foto de la hoja firmada/sellada.
- **faltante_firma:** no se consiguió firma; con razón; aparece en la sección "Faltante de firmas". Al conseguir la firma después, adjunta la foto → pasa a `firmada` y se quita la bandera.

---

## 4. Componentes a construir (con criterios de aceptación)

### 4.1 Flujo guiado + candado de foco
- Inicia rutina → pide **sede** → pide **tipo de rutina**; si hay varias coincidencias, las **enlista numeradas** para elegir.
- Guía paso por paso pidiendo la evidencia según `evidencia.tipo`. Sella tiempos.
- **Candado:** iniciada la rutina, Portteo solo atiende esa rutina hasta finalizar. Cancelable dando razón.
- **Resiliencia:** el estado vive en Firestore; si se pierde señal o se apaga el teléfono, Portteo **retoma** ("vas en el paso 4 de 7").
- **Hecho cuando:** se completa una rutina de principio a fin; al perder señal y volver, retoma en el paso correcto; durante la rutina Portteo no responde a temas ajenos; cancelar deja la ejecución como `cancelada` con su razón.

### 4.2 Captura de evidencia
- `foto_comentario`: foto y comentario opcionales; si faltan, el paso igual entra al reporte. **Empujón suave** al cerrar si hay pasos sin evidencia (no bloquea).
- `antes_despues`: dos fotos (antes / después).
- `medicion`: valor + unidad, foto y **gráfico**; `cumple` lo marca el técnico (rango opcional; sólo refrigeración viene con rango).
- Corrección de texto por IA que **preserva términos técnicos, unidades y números**.
- **Hecho cuando:** cada tipo captura y almacena su evidencia; las fotos quedan ligadas a su paso; los comentarios corrigen ortografía sin alterar términos técnicos.

### 4.3 Validación por link + aprobación
- Portteo manda **link con el reporte renderizado**; el técnico corrige textos y presiona **Aprobar**.
- Al aprobar: folio + PDF + Drive + oportunidades, de forma atómica.
- **Hecho cuando:** el técnico ve el reporte en el link, edita texto, y al aprobar se cumplen los efectos sin estados a medias.

### 4.4 Generador de PDF del reporte
- Plantilla HTML → PDF, lenguaje visual de la cotización; con medición graficada, antes/después, comentarios, oportunidad y bloque **nombre/firma/sello**, más la nota **"imprimir 2 tantos"** y el **número de inventario**.
- **Hecho cuando:** el PDF coincide con el render del link e incluye todos los pasos, evidencias y el bloque de firma.

### 4.5 Firma, sello y bandera de faltantes
- Portteo pide imprimir **2 tantos**, conseguir firma+sello y **enviar foto** de la hoja. Si no, pide razón y levanta **bandera roja** → sección "Faltante de firmas".
- Adjuntar firma después quita la bandera. Recordatorio de reportes sin firma.
- **Hecho cuando:** con foto de firma la ejecución queda `firmada`; sin ella, aparece en "Faltante de firmas" con su razón y se puede completar después.

### 4.6 Oportunidades
- El comentario de oportunidad crea un registro en `oportunidades` visible en Porttea-Gener para dueño/secretaria.
- **Hecho cuando:** una oportunidad marcada en una rutina aparece en la lista comercial con su sede y fecha.
- *(Fuera de MVP: generar cotización automática desde la oportunidad.)*

### 4.7 Porttea-Gener — sección Rutinas
- CRUD de **rutinas** (dueño/secretaria) y ver todas; alta de **sedes** y **equipos** (inventario).
- Vista de rutinas ejecutadas **organizable por fecha, rango de fechas y sitio**; tablero; "Faltante de firmas"; "Oportunidades"; acceso a reportes/hojas de firma en Drive.
- **Hecho cuando:** se puede crear una rutina y una sede, ejecutar y ver la ejecución filtrada por fecha/sitio, y abrir su PDF.

### 4.8 Carga seed
- Importar `rutinas-gener.json` (74) a `rutinas_plantilla`. La clasificación de evidencia por paso es editable en el portal.
- **Hecho cuando:** las 74 rutinas quedan cargadas y editables.

---

## 5. Fases de entrega

1. **Seed + catálogo:** cargar rutinas (74), CRUD de sedes/equipos/rutinas en Porttea-Gener.
2. **Flujo guiado + candado + captura de evidencia** (los tres tipos) con resiliencia de sesión.
3. **Validación por link + PDF + Drive + folio.**
4. **Firma/sello + bandera de faltantes + recordatorio.**
5. **Tablero, vistas por fecha/sitio y lista de Oportunidades.**

---

## 6. Criterios de aceptación globales

- El estado de una rutina nunca se pierde por mala señal (Firestore es la verdad; Portteo retoma).
- Ningún reporte se cierra sin pasar por la validación del técnico.
- Un reporte por equipo, con su número de inventario y su folio.
- Toda medición muestra su gráfico; el "cumple/no cumple" lo decide el técnico salvo rangos definidos.
- Reportes y hojas de firma quedan respaldados en Drive.
- El modelo cuelga de cliente→sede→equipo (listo para renta futura), sin "Gener" hardcodeado.

---

## 7. Fuera de alcance (no construir aún)

Cotización automática desde rutina · firma por lote · renta multi-inquilino "real" (solo se deja preparado el modelo).
