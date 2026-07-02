# Brief de construcción — Módulo de Cotizaciones (Portteo · G-ener)

**Para:** Diego (desarrollo con Claude Code)
**Fuente de verdad de negocio:** `Ficha_Entendimiento_Cotizaciones_Gener.md` (leer primero)
**Este documento:** el "cómo" técnico. Si algo de negocio no está aquí, manda la Ficha.

> **Nota de revisión (2026-07-02):** esta versión integra los ajustes acordados en el análisis técnico:
> (1) se agrega `importada` al enum de estatus; (2) `clonarComoBase` recibe el cliente destino y no arrastra la forma de pago origen; (3) el botón/acción **Aprobar** se restringe por rol `dueno` en UI **y** backend; (4) autenticación de Porttea-Gener: **Firebase Auth con phone sign-in**; (5) la "atomicidad" de la aprobación se precisa como transacción (folio + estatus) + efectos idempotentes con reintento; (6) regla de redondeo de IVA a 2 decimales con tolerancia ±0.01 en reconciliación del ETL; (7) `fechaEnvio` se sella al aprobar y se agrega `fechaEntregaCliente` opcional.

---

## 0. Objetivo del módulo

Portteo (asistente virtual de G-ener) permite al dueño y a la secretaria armar, aprobar y dar seguimiento a cotizaciones. **Forma 1 (principal): Porttea-Gener**, la plataforma web, en una vista de dos paneles (chat + cotización en vivo). **Forma 2 (secundaria): WhatsApp**, donde cada cambio manda un link de render. Con folio automático, memoria de precios por cliente, PDF profesional y respaldo en Drive. Este brief cubre **solo Cotizaciones** (Taller y Rutinas son módulos posteriores) pero construye la infraestructura compartida que esos reutilizarán.

Prioridad de construcción: **infraestructura compartida primero; luego la creación en Porttea-Gener (dos paneles); y solo cuando esa funcione bien, la creación por WhatsApp.**

---

## 1. Stack y convenciones

- **Backend/datos:** Firebase — Firestore (datos), Cloud Functions (lógica), Cloud Scheduler (recordatorios), Firebase Hosting (**Porttea-Gener**: portal + vista de dos paneles), **Firebase Auth con phone sign-in** para la plataforma (la identidad sigue siendo el número, igual que en WhatsApp; da `request.auth` real para las Security Rules).
- **Canal:** servicio de sesión de WhatsApp (número propio, ya operado por el equipo, reconexión resuelta) + Telegram de respaldo. **El canal es solo transporte; la fuente de verdad es Firestore.** El router debe ser agnóstico al canal desde el día 1: ambos webhooks normalizan al mismo payload interno.
- **IA (cerebro de Portteo):** LLM vía API para intención, redacción de conceptos y sugerencias. Clave en secretos, nunca en cliente.
- **PDF:** render HTML → PDF (mismo HTML que el panel de vista en vivo).
- **Repo:** GitHub. Incluir `CLAUDE.md` en la raíz con convenciones (estructura, naming, comandos, reglas de commits). Ramas por feature, PRs pequeños.
- **Secretos/entorno:** credenciales de WhatsApp/Telegram, API del LLM, service account de Drive → en variables de entorno / Secret Manager. Nunca en el repo.
- **Idioma de dominio:** español (nombres de colecciones y campos en español para que el equipo los lea sin traducir).
- **Sistema de diseño (portal/app):** seguir `DESIGN-SYSTEM.md` (look editorial sobrio: tipografías, tokens, componentes) en su **variante con el mapa de color de G-ener**. Aplica al portal y al taller web, **no** al PDF (ver 5.4).
- **Frontend (Porttea-Gener):** **Vue 3 + Vite + TypeScript + Tailwind v4**, componentes con **shadcn-vue** e íconos **lucide-vue-next** (decisión del equipo: es el stack que Diego domina; el sistema de diseño es agnóstico al framework y sus tokens se mapean igual en `@theme`). Firestore en vivo vía VueFire/`onSnapshot` para el panel de render.
- **Formato del PDF de cotización:** se define y aprueba por separado con el cliente. A Claude Code se le entrega una **plantilla HTML final + un PDF de muestra renderizado** como referencia exacta de layout; no improvisar el diseño.

---

## 2. Arquitectura (capas)

1. **Canal** — webhook que recibe mensajes de WhatsApp/Telegram y envía respuestas.
2. **Router de intención** — identifica quién escribe (por número → rol) y qué quiere; enruta a la capacidad correcta.
3. **Agente Portteo** — LLM con las herramientas del módulo (buscar histórico, armar borrador, ajustar precio, aprobar, crear recordatorio).
4. **Servicios de dominio** — folio, cotizaciones/versiones, plantillas, bitácora, recordatorios.
5. **Infraestructura compartida** — Firestore, Drive, generador de PDF, Porttea-Gener (portal + vista de dos paneles).

---

## 3. Modelo de datos (Firestore)

Colecciones y documentos. Tipos entre paréntesis. Los arreglos embebidos se guardan juntos porque se leen/escriben juntos.

### `usuarios/{telefono}`
- `nombre` (string), `rol` (enum: `dueno` | `secretaria` | `trabajador`), `activo` (bool)
- La identidad es el número; solo números en esta colección pueden invocar a Portteo (lista blanca).

### `clientes/{clienteId}`
- `nombre` (string), `atencion` (string?), `telefono` (string?), `correo` (string?)
- `ultimaFormaPago` (string?) — para sugerir en la próxima cotización
- `driveFolderId` (string?) — carpeta del cliente en Drive

### `cotizaciones/{cotizacionId}`
- `folio` (string | null) — **null hasta la aprobación**
- `clienteId` (ref), `titulo` (string), `estatus` (enum: `borrador` | `enviada` | `autorizada` | `realizada` | `rechazada` | `importada`)
- `revActual` (string, ej. "A"), `fechaCreacion` (ts), `fechaEnvio` (ts?, se sella al aprobar), `fechaEntregaCliente` (ts?, opcional: cuándo se mandó realmente al cliente)
- Subcolección **`versiones/{versionId}`**:
  - `rev` (string: "A", "B", …), `estatus` (mismo enum a nivel versión)
  - `partidas` (array de objetos):
    - `titulo` (string), `descripcion` (string?), `lineas` (array de string, alcance sin precio), `cantidad` (number, default 1), `importe` (number, precio del bloque)
  - `subtotal` (number), `iva` (number), `total` (number) — redondeados a 2 decimales
  - `formaPago` (string), `tiempoEntrega` (string)
  - `fecha` (ts), `pdfUrl` (string?)

### `plantillas/{plantillaId}`
- `nombre` (string), `activa` (bool), `descripcion` (string?)
- `lineas` (array de string, alcance), `precioSugerido` (number?)

### `precios_historicos/{id}`
- `clienteId` (ref?), `clienteNombre` (string), `concepto` (string), `precio` (number)
- `equipo` (string?), `marca` (string?), `modelo` (string?), `capacidad` (string?)
- `fecha` (ts?), `origen` (enum: `import` | `version`), `versionId` (ref?)

### `recordatorios/{id}`
- `duenoTelefono` (string), `descripcion` (string), `clienteTexto` (string?)
- `estatus` (enum: `pendiente` | `hecho`), `fechaCreacion` (ts)

### `counters/folio_{anio}`
- `ultimo` (number) — contador anual del consecutivo. Se incrementa **transaccionalmente** al aprobar.

---

## 4. Máquina de estados y folio

**Estados de cotización:** `borrador → enviada → autorizada → realizada`. Rama alterna: `rechazada`. Estado especial de ETL: `importada` (histórico cargado desde PDFs; no participa en la máquina).

**Aprobación (dos partes — transacción + efectos):**

*Parte transaccional (Firestore, atómica de verdad):*
1. Verificar que quien aprueba tiene rol `dueno` (validado en backend, no solo en UI).
2. Leer `counters/folio_{anioActual}` (crear con `ultimo: semilla` si no existe — la semilla se define el día de puesta en vigor).
3. `nuevo = ultimo + 1`; escribir de vuelta `ultimo = nuevo`.
4. Formatear `folio = "GPC-" + MM + YY + "-" + zeroPad(nuevo, 3)` con MM/YY del mes de aprobación.
5. Guardar el folio en la cotización, cambiar estatus a `enviada`, sellar `fechaEnvio`.

*Efectos posteriores (idempotentes, con reintento; disparados por el cambio de estatus):*
6. Generar PDF → subir a Drive → escribir bitácora de precios → preguntar "¿enviar al cliente o descargar?". Cada paso puede reintentarse sin re-consumir folio ni duplicar registros (idempotencia por `cotizacionId` + `rev`). Si un paso falla, se reintenta; el folio ya quedó asignado y nunca se pierde ni se duplica.

- **Reinicio anual confirmado:** al cambiar de año, `counters/folio_{nuevoAnio}` arranca en su propia semilla (típicamente 0/1).
- El folio se asigna **una sola vez** y vive con la cotización. Las revisiones posteriores **no consumen folio nuevo** (ver abajo).

**Versiones:**
- Borrador y ajustes previos a aprobar: se edita la versión Rev. A, sin folio.
- Revisión después de enviada (negociación del mismo trabajo): crear versión nueva (Rev. B, C…), **mismo folio**, `revActual` avanza. La versión anterior se conserva.

**Redondeo:** `iva = round2(subtotal * 0.16)`, `total = round2(subtotal + iva)`. La reconciliación del ETL tolera ±0.01 por redondeos históricos.

---

## 5. Componentes a construir (con criterios de aceptación)

### 5.1 Canal + router de intención
- Recibe mensajes de WhatsApp (y Telegram como respaldo), responde por el mismo canal. Ambos adaptadores normalizan al mismo payload interno (canal agnóstico).
- Resuelve `usuarios/{telefono}` → rol; si no está en la lista blanca, no atiende.
- Saludo por rol: "¿en qué te puedo ayudar?" con menú según permisos.
- **Hecho cuando:** un número de la lista blanca recibe respuesta con menú acorde a su rol; un número desconocido es ignorado; si WhatsApp cae, el respaldo por Telegram entrega y responde sin pérdida de datos.

### 5.2 Agente Portteo (herramientas)
Herramientas expuestas al LLM: `buscarHistorico(cliente, concepto)`, `crearBorrador(cliente)`, `agregarBloque(versionId, {titulo, lineas, importe})`, `ajustarPrecioBloque(versionId, bloque, nuevoImporte)`, `aprobarCotizacion(cotizacionId)` (solo rol `dueno`; el backend rechaza a cualquier otro), `consultarCotizacion(folio | cliente)` (recupera y renderiza una cotización pasada; si la búsqueda por cliente devuelve varias, lista las últimas N con folio/fecha/asunto para que el usuario elija), `clonarComoBase(cotizacionId, clienteId)` (crea un borrador nuevo copiando bloques/precios para el cliente destino, sin folio; la forma de pago **no** se arrastra de la origen — se sugiere la `ultimaFormaPago` del cliente destino, con fallback 70/30), `crearRecordatorio(...)`.
- Redacta conceptos nuevos a partir de lo que dicta el dueño ("escribe esto, con este precio").
- **Hecho cuando:** desde el chat se puede armar una cotización de principio a fin invocando estas herramientas; se puede pedir una cotización pasada y verla renderizada; se puede clonar una como base; y el LLM nunca inventa precios (siempre del histórico o dictados por el dueño).

### 5.3 Porttea-Gener — construcción de cotizaciones (dos paneles) · PRIORIDAD
**Forma 1 (principal, se construye primero).** La creación ocurre en Porttea-Gener, en una vista de dos paneles, disponible **solo para dueño y secretaria** (Firebase Auth phone sign-in + rol de `usuarios/{telefono}`):
  - Izquierda: **chat** (mismo agente Portteo).
  - Derecha: **cotización renderizándose en vivo** (el mismo HTML que será el PDF), que refleja los cambios al instante (listener de Firestore sobre la versión).
- Botón **Aprobar** en el panel derecho — **visible y habilitado solo para rol `dueno`**, y validado también en backend. Al aprobar: transacción (folio + estatus + fechaEnvio) y efectos idempotentes (PDF, Drive, bitácora, pregunta **¿enviar al cliente o descargar aquí?**).
- Desde aquí también se puede **consultar/renderizar una cotización pasada** y **clonar una como base** ("toma como base esta para crear una nueva").

**Forma 2 (WhatsApp, posterior).** Solo cuando la Forma 1 funcione bien: el dueño/secretaria arman por chat de WhatsApp y, **cada vez que piden un cambio, Portteo manda un link** donde ven la cotización renderizada para editarla. El link lleva token firmado con expiración (no debe ser editable por terceros si se reenvía). Misma lógica y mismos datos; distinto punto de entrada.

- **Hecho cuando:** en Porttea-Gener, al escribir en el chat el documento de la derecha se actualiza sin recargar; al aprobar, la transacción y los efectos se completan sin estados a medias (los efectos reintentan hasta consumarse); la secretaria no ve/no puede ejecutar Aprobar; se puede consultar una cotización pasada y clonarla como base.

### 5.4 Generador de PDF (plantilla HTML)
- Plantilla fija con huecos: cliente, atención/tel/correo, folio, fecha, título/asunto, arreglo de bloques (título · alcance · cantidad · precio · importe), subtotal, IVA (16%), total, importe con letra, tiempo de entrega, forma de pago, pie oficial (opción A).
- **Importe con letra:** función número → texto en español, formato "SON: ( … PESOS XX/100 M.N.)".
- Diseño: estructura reconocible, **sin el rayo de fondo**, motivo eléctrico limpio en el logo.
- **Hecho cuando:** el PDF de una cotización de 1 bloque y otra de 3 bloques sale idéntico al render en vivo, con totales correctos (IVA 16%) y el importe con letra correcto.

### 5.5 Bitácora de precios
- Cada versión aprobada escribe sus datos a `precios_historicos` (`origen: version`).
- `buscarHistorico` devuelve "lo último cobrado a este cliente por este concepto/bloque".
- **Hecho cuando:** al aprobar una cotización, aparecen sus registros en la bitácora; y al armar la siguiente del mismo cliente, Portteo sugiere el precio previo.

### 5.6 Carga semilla del histórico (ETL de una vez)
- **Fuente primaria — corpus de PDFs de cotizaciones (carpetas de Drive):** extraer cada PDF a JSON normalizado con el esquema del sistema (cliente, folio, fecha, asunto, partidas[], subtotal, iva, total, formaPago, tiempoEntrega) y cargar como cotizaciones históricas (`estatus: importada`); la bitácora se deriva de sus partidas. Reglas: (1) validar reconciliación de totales (suma de partidas = subtotal, IVA 16%, total, tolerancia ±0.01) como filtro de calidad — lo que no reconcilie se marca para revisión manual; (2) OCR previo para PDFs escaneados; (3) carga **idempotente por folio** (re-ejecutable sin duplicar); (4) muestreo humano de control (15–20 registros). **La semilla del contador de folio se deriva de este corpus** (consecutivo más alto por año). Herramienta sugerida: Claude Cowork para el lote de carpetas, o script para PDFs de texto.
- **Fuente secundaria — Excel:** `Registros_Precios_maquinas_y_servicios.xlsm` (351 filas) se importa como **diccionario de conceptos de taller ad-hoc**, con limpieza: normalizar clientes ("Emesa"/"EMESA") y equipos (mayúsculas/espacios), marcar filas sin fecha, ignorar columnas de costo abandonadas.
- **Hecho cuando:** el corpus de PDFs queda importado y consultable con totales reconciliados; la semilla del folio queda derivada; el Excel queda como diccionario de conceptos normalizado.

### 5.7 Porttea-Gener — administración
- **Usuarios:** alta/edición de usuarios y roles.
- **Plantillas:** CRUD de bloques guardados (las 3 iniciales + nuevas).
- **Cotizaciones:** listado con estatus.
- **Seguimiento:** foco en `enviada` sin cerrar, con antigüedad ("enviada hace X días", contada desde `fechaEnvio` = aprobación).
- **Hecho cuando:** el dueño puede crear un usuario, editar una plantilla y ver la lista de cotizaciones con su antigüedad, todo desde Porttea-Gener.

### 5.8 Recordatorios del dueño
- Captura por WhatsApp ("recuérdame crear una cotización para tal cliente…") → `recordatorios` con `estatus: pendiente`.
- Selección desde el portal/chat para convertir en cotización; marcar `hecho`.
- **Cloud Scheduler: lunes, miércoles y viernes 9:00 am (zona horaria de Morelos = America/Mexico_City), solo si hay pendientes.** Mensaje con el conteo y un empujón motivacional (tono configurable).
- **Hecho cuando:** un recordatorio creado por WhatsApp aparece en la lista; el mensaje L/M/V solo llega si hay pendientes y nunca en otros días.

---

## 6. Fases de entrega (secuencia sugerida)

1. **Infra compartida:** repo + `CLAUDE.md`, Firestore, auth por número/roles, canal + router (para auth y notificaciones), esqueleto de Portteo.
2. **Porttea-Gener — creación de cotizaciones (Forma 1, PRIORIDAD):** vista de dos paneles, modelo, folio transaccional, PDF, subida a Drive, versiones/historial, consultar/renderizar pasada, clonar como base.
3. **Memoria de precios:** ETL semilla (corpus de PDFs) + bitácora automática + sugerencias en el armado.
4. **Porttea-Gener — administración:** usuarios, plantillas, listado, seguimiento.
5. **Creación por WhatsApp (Forma 2):** solo cuando la Forma 1 funcione bien; cada cambio manda link de render.
6. **Recordatorios:** captura + scheduler L/M/V.

Cada fase se entrega funcionando y se prueba con uso real antes de la siguiente.

---

## 7. Criterios de aceptación globales

- Cero folios repetidos y cero huecos por rechazos (el folio solo nace al aprobar).
- Ninguna pérdida de datos si el canal se cae (Firestore es la verdad; Telegram respalda).
- El PDF aprobado siempre coincide con lo visto en Porttea-Gener (dos paneles).
- El histórico se llena solo con cada aprobación; nadie tiene que actualizar un Excel.
- Portteo nunca inventa precios.
- Solo el rol `dueno` puede aprobar (validado en backend).

---

## 8. Pendientes menores (no bloquean el arranque)

1. Semilla del contador de folio 2026 — se captura el día de puesta en vigor (o se deriva del corpus de PDFs al importarlo).
2. Teléfono en el pie del PDF — confirmar si va y cuál.

---

## 9. Fuera de alcance (no construir aún)

Cobranza · márgenes/costeo (costo Gener vs. precio) · módulo de Taller · módulo de Rutinas. La infraestructura de este brief está pensada para que esos módulos se monten encima sin rehacerla.
