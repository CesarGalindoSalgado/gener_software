# Ficha de Entendimiento — Módulo de Cotizaciones

**Cliente:** G-ener (Gener Power & Control) · Dueño: Gabriel Gutiérrez Salgado
**Asistente virtual:** Portteo · **Plataforma web:** Porttea-Gener · **Canal:** WhatsApp (sesión) + Telegram de respaldo
**Documento preparatorio para el brief de Claude Code (ejecuta: Diego)**
**Estatus:** supuestos confirmados con Gabriel · listo para convertir en brief

---

## 1. Propósito y alcance

Automatizar la generación de cotizaciones para eliminar el cuello de botella actual: hoy el requerimiento llega al dueño, la secretaria busca el histórico en Excel o Drive, se lo pasa por WhatsApp, y el dueño edita una cotización vieja a mano (folio, fecha, nombre de equipo, precio). El proceso es lento y se cometen errores que se ven poco profesionales.

El objetivo es que el dueño o la secretaria armen la cotización en **Porttea-Gener** (plataforma web, dos paneles: chat + documento en vivo), tomando el folio correcto y con precios sugeridos del histórico, y que al aprobarla se genere el PDF profesional, se suba a Drive y se grabe todo en base de datos para que el histórico se llene solo. Portteo también responde y arma cotizaciones por WhatsApp como forma secundaria.

**Dentro del MVP:** creación de cotizaciones en **Porttea-Gener** (dos paneles) como forma principal y por **WhatsApp** como forma secundaria; consultar/renderizar cotizaciones pasadas y clonar una como base; plantillas de servicios, versiones, folio automático, PDF, subida a Drive, bitácora de precios automática, portal (usuarios, plantillas, listado, seguimiento) y recordatorios para el dueño.

**Fuera del MVP (estacionado consciente):** cobranza, márgenes/costeo (visto en hojas COMOSA/ANSA del Excel), módulo de Taller y módulo de Rutinas.

---

## 2. Actores y roles

Un solo número de WhatsApp. La identidad es el número que escribe; según su rol, Portteo ramifica el menú al saludar ("¿en qué te puedo ayudar?").

| Rol | Puede |
|---|---|
| Dueño | Todo: crear/editar cotizaciones, aprobar, fijar total, gestionar plantillas, recordatorios |
| Secretaria | Consultar histórico, armar borradores, buscar cotizaciones previas |
| Trabajador | Acceso limitado (relevante en Taller/Rutinas, no en este módulo) |

Solo la lista blanca de números puede invocar a Portteo.

---

## 3. Cómo se crea una cotización + ciclo de vida

**Dos formas de crear/editar (misma lógica, distinto punto de entrada):**
- **Forma 1 — Porttea-Gener (web · prioridad):** el dueño o la secretaria arman la cotización en la plataforma, en una pantalla de **dos paneles**: chat a la izquierda, cotización renderizándose en vivo a la derecha. Es la forma principal y **la primera que construye Diego**.
- **Forma 2 — WhatsApp:** el dueño o la secretaria la arman por chat; cada vez que piden un cambio, Portteo les manda un **link** donde ven la cotización renderizada para editarla. Se habilita **después** de que la Forma 1 funcione bien.

**Capacidades de consulta y reutilización (en ambas formas):**
- **Consultar y renderizar una cotización pasada:** "muéstrame la cotización de tal cliente" → se renderiza para verla.
- **Clonar como base:** "toma como base esta cotización para crear una nueva" → se copia su estructura (bloques y precios) a un borrador nuevo, con nuevo cliente/fecha y **sin folio hasta aprobar**.

**Ciclo de vida:**
1. **Requerimiento** — llega por WhatsApp o directo en Porttea-Gener.
2. **Borrador** — se arma en la pantalla de dos paneles (Forma 1) o por chat con link de render (Forma 2). Sin folio y sin PDF.
3. **Enviada** — al aprobar el dueño se asigna el folio, se genera el PDF y Portteo pregunta si lo manda al WhatsApp del cliente o lo descarga. En la plataforma se ve "enviada hace X días" para dar seguimiento.
4. **Revisión (negociación)** — un cambio del mismo trabajo = **versión nueva con el mismo folio** (Rev. A → B → …). No se pisa la anterior.
5. **Autorizada por cliente** — pasa al área de **Trabajos**.
6. **Trabajos → Realizado** — un check la marca como realizada. (Sin cobranza por ahora.)

---

## 4. Modelo de datos

- **CLIENTE** tiene muchas **COTIZACION**.
- **COTIZACION** tiene un folio (asignado al aprobar) y muchas **VERSION**.
- **VERSION** agrupa muchas **PARTIDA** y guarda subtotal, IVA, total, tiempo de entrega y forma de pago.
- **PARTIDA (bloque)** tiene un título, una descripción, un **importe (precio del bloque)** y muchas **LINEA** de alcance. El precio vive en el bloque, no en las líneas.
- **LINEA** es una actividad de alcance (texto, sin precio individual).
- **PLANTILLA** es un bloque guardado y reutilizable (título + líneas de alcance + precio sugerido). Es la fuente para armar partidas rápido.
- **PRECIO_HIST** (bitácora de precios) se **alimenta automáticamente** de las versiones aprobadas. No es una tabla que alguien llene: es la consulta "¿cuánto le cobré la vez pasada?" resuelta sola.

> Nota: cotizar "por paquete" o "por conceptos sueltos" es el mismo modelo — un bloque con precio, o varios bloques con precio. No hay dos caminos.

---

## 5. Reglas de negocio

**Folio**
- Formato: `GPC-MMYY-NNN` (prefijo fijo, mes y año de aprobación, consecutivo).
- Serie única para toda la empresa (no una por tipo de servicio).
- **El consecutivo reinicia cada año** — CONFIRMADO por Gabriel (consistente con la evidencia: 2025 en 016/019; 2026 en 003/005/007).
- Se asigna **al aprobar**, no antes. Un solo dueño del contador (la base de datos), cero colisiones ni huecos por rechazos.
- Semilla: se captura al entrar en vigor (Gabriel sigue cotizando hoy); se toma su folio 2026 más alto vigente ese día.

**Impuestos y montos**
- IVA fijo 16% (verificado en las cinco cotizaciones de muestra). Configurable.
- "Importe con letra" se genera automáticamente del total (número → texto en español, pesos M.N.).

**Ajuste de precio**
- Un solo camino en el MVP: "cambia el costo del bloque X a tanto" → se recalcula el total. Sin repartos proporcionales.

**Versiones**
- Borradores: sin folio, sin PDF.
- Revisiones tras el envío: mismo folio + Rev. A/B… Se conserva el historial completo.

**Forma de pago**
- Varía por proyecto y cliente. Regla: **sugerir la última forma de pago usada con ese cliente** (mismo principio que la memoria de precios). Fallback inicial: 70% anticipo / 30% a la entrega.

**Observaciones (pie del documento)**
- Fijas: "precios en M.N.", forma de pago (sugerida), "en caso de encontrar algún desperfecto…".
- Variable por cotización: "tiempo de entrega".

---

## 6. Plantillas de servicios (bloques guardados)

Tres plantillas iniciales (crecen y se editan desde Porttea-Gener). Datos semilla listos para cargar en `plantillas-gener.json`. El **precio sugerido de cada plantilla lo define Gabriel** (hoy no viene en las listas); las líneas de abajo son el alcance (van sin precio individual, el precio es a nivel bloque).

**1. Suministro de radiador nuevo**
- Traslado a lugar de servicio con herramientas y equipos
- Suministro de radiador de acuerdo a especificaciones del equipo
- Puesta en fuera de servicio de grupo electrógeno para servicio
- Drenado de anticongelante de sistema de enfriamiento de motor
- Desmontaje mecánico de radiador de motor
- Montaje de radiador nuevo
- Montaje y conexión de mangueras de sistema de enfriamiento
- Suministro de anticongelante drenado a sistema de enfriamiento
- Prueba de funcionamiento de grupo electrógeno sin carga
- Prueba de funcionamiento grupo electrógeno con carga

**2. Mantenimiento preventivo**
- Traslado al lugar del servicio
- Suministro de aceite para motor a Diesel
- Suministro de anticongelante trabajo pesado
- Suministro de líquido electrolítico para batería
- Suministro de desengrasante
- Suministro de material de limpieza
- Suministro de filtros de aceite según modelo de filtro
- Suministro de filtros de combustible según modelo de filtro
- Suministro de filtros de aire según modelo de filtro
- Suministro de líquido electrolítico en depósito de batería
- Retirar y contener aceite usado de generador en contenedor
- Cambio de filtro de aceite
- Retirar y contener líquido anticongelante usado de generador
- Cambio de filtro de anticongelante
- Montaje y conexión de mangueras de sistema de enfriamiento
- Cambio de filtro de combustible y purga de sistema
- Carga de aceite a depósito de motor de combustión
- Carga de anticongelante a depósito de motor de combustión
- Cambio de batería y limpieza de terminales
- Limpieza general a motor con desengrasante
- Limpieza general a generador eléctrico
- Revisión de instalación eléctrica de control de motor de combustión
- Revisión de condiciones de tapón de radiador
- Pruebas de aislamiento con Megger a devanados de generador
- Reapriete de tornillería de conexiones de potencia a generador
- Reapriete de tornillería de conexiones de potencia a transferencia
- Reapriete de tornillería de conexiones de control a generador
- Pruebas de funcionamiento a cargador de baterías
- Pruebas de funcionamiento a generador sin carga
- Pruebas de funcionamiento a generador con carga

**3. Reparación de radiador**
- Traslado a lugar de servicio con herramientas y equipos
- Puesta en fuera de servicio de grupo electrógeno para servicio
- Drenado de anticongelante de sistema de enfriamiento de motor
- Desmontaje mecánico de radiador de motor
- Traslado a taller de servicio para reparación
- Traslado a sitio para montaje de radiador
- Montaje y conexión de mangueras de sistema de enfriamiento
- Suministro de anticongelante drenado a sistema de enfriamiento
- Prueba de funcionamiento de grupo electrógeno sin carga
- Prueba de funcionamiento grupo electrógeno con carga

Al pedir "hazme una cotización de reparación de radiador", Portteo inserta ese bloque en el borrador con su precio sugerido, y el dueño lo confirma o ajusta. Requiere CRUD de plantillas en Porttea-Gener. La lista completa y exacta vive en `docs/muestras/plantillas-gener.json`.

---

## 7. Bitácora de precios (histórico)

- **Origen continuo:** cada versión aprobada escribe sus datos a PRECIO_HIST (concepto/bloque, precio, cliente, equipo, fecha). El histórico se llena solo.
- **Carga semilla (fuente primaria: PDFs):** el corpus de cotizaciones en PDF de sus carpetas de Drive es la fuente principal, porque son la verdad (lo que sí salió) y traen folio, fecha real, cliente, partidas con precios, totales, forma de pago y tiempo de entrega. Se extraen a JSON normalizado (mismo esquema del sistema) y se cargan como cotizaciones históricas (`estatus: importada`); la bitácora de precios se deriva de sus partidas. Reglas: validar que los totales reconcilien (suma de partidas = subtotal, IVA 16%, total) como filtro de calidad; OCR previo si hay PDFs escaneados; carga idempotente por folio; muestreo humano de control. La **semilla del folio se deriva de este corpus** (el consecutivo más alto por año).
- **Fuente secundaria (Excel):** el Excel actual (`Registros_Precios_maquinas_y_servicios.xlsm`, 351 filas) pasa a ser un **diccionario de conceptos de taller ad-hoc** (los ~257 conceptos sueltos que quizá no llegaron a PDF), previa limpieza:
  - Normalizar nombres de cliente (ej. "Emesa"/"EMESA") y tipos de equipo (mayúsculas/espacios).
  - Resolver o marcar las filas sin fecha (58% del archivo).
  - Ignorar columnas de costo abandonadas ($ Refacciones, $ Mano de obra); solo el precio al cliente es confiable.
- **Búsqueda:** para servicios con plantilla, el match es limpio (bloque + cliente). Para reparaciones ad-hoc (conceptos libres, ~257 distintos), el match es difuso y conviene apoyo de IA.

---

## 8. Documento / PDF

- Conservar la estructura reconocible: encabezado (logo + cliente + folio + fecha + asunto), tabla de partidas (Partida · Cant. · Conceptos · P. Unit · Importe), totales (Subtotal · IVA · Total), importe con letra, observaciones, firma.
- Construir como **plantilla HTML → PDF**: es el mismo render que se ve en vivo en el taller web; al aprobar se exporta a PDF.
- Estandarización: unificar el rótulo "COTIZACIÓN" con acento, **quitar el rayo de fondo** que estorba bajo la tabla, y mantener el motivo eléctrico limpio en el logo (y opcionalmente una línea fina tipo onda).
- Datos oficiales del pie (CONFIRMADO — opción A): Paseo de los Fresnos S/N, Col. Bugambilias, 62577, Jiutepec, Morelos, México · correo generpowercontrol@gmail.com. (Teléfono en el pie: por confirmar; solo aparecía en el membrete antiguo.)
- Campos variables: cliente, atención/tel/correo, folio, fecha, título/asunto, bloques, tiempo de entrega, totales. El resto es fijo.

---

## 9. Porttea-Gener (plataforma web)

Plataforma web de G-ener. El **módulo de creación de cotizaciones (dos paneles) está disponible solo para dueño y secretaria**.

- **Cotizaciones (dos paneles):** chat + cotización en vivo; la **forma principal** de crear, editar y aprobar. Permite **consultar/renderizar una cotización pasada** y **clonar una como base** para otra nueva.
- **Usuarios:** alta y gestión de usuarios y roles.
- **Plantillas:** agregar y modificar bloques guardados.
- **Listado de cotizaciones:** con su estatus (borrador / enviada / autorizada / realizada).
- **Seguimiento:** foco en las cotizaciones enviadas que aún no cierran en compra (aging, "enviada hace X días").

---

## 10. Recordatorios del dueño

- Captura por WhatsApp: "recuérdame crear una cotización para tal cliente de tal cosa" → se agrega a su lista de pendientes.
- Al sentarse a cotizar, el dueño selecciona de esa lista para crear cada cotización.
- Mensaje **lunes, miércoles y viernes a las 9:00 am**, y **solo si hay cotizaciones pendientes**, con el número de pendientes y un empujón motivacional ("¡vamos, las haces en 5 minutos, no te rindas!"). Tono configurable; deliberadamente pocos mensajes para no volverse ruido.

---

## 11. Integraciones

- **WhatsApp** por servicio de sesión (número propio), Telegram como respaldo. Principio de diseño: el chat es solo transporte; **la fuente de verdad es la base de datos**. Si el número se cae, no se pierde nada.
- **Google Drive:** al aprobar, se sube el PDF a la carpeta del cliente, organizada **por cliente y dentro por año**.
- **Base de datos:** fuente única de folios, versiones, partidas e histórico.

---

## 12. Pendientes menores (no bloquean el brief)

1. Folio: la semilla de 2026 se **deriva automáticamente** del corpus de PDFs al importarlos (el consecutivo más alto del año). Si la importación se hiciera después del arranque, se toma el folio 2026 más alto vigente ese día.
2. Teléfono en el pie del PDF: confirmar si se incluye y cuál.

---

## 13. Fuera de alcance del MVP

Cobranza · márgenes y costeo (costo Gener vs. precio) · módulo de Taller · módulo de Rutinas. Se abordan en iteraciones posteriores con las correcciones que dé el uso real.
