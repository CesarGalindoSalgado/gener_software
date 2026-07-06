# Ficha de Entendimiento — Módulo de Rutinas (anexo)

**Cliente:** G-ener (Gener Power & Control) · Dueño: Gabriel Gutiérrez Salgado
**Cliente final de las rutinas:** Servicios de Salud de Morelos
**Asistente virtual:** Portteo · **Plataforma web:** Porttea-Gener · **Canal:** WhatsApp (sesión) + Telegram de respaldo
**Anexo de:** `Ficha_Entendimiento_Cotizaciones_Gener.md` (infraestructura compartida)
**Seed de datos:** `rutinas-gener.json` (74 rutinas)

---

## 1. Propósito y alcance

Hoy el técnico de Gener llega a una sede, hace el mantenimiento y **después** descubre que le faltó una foto o un paso; entonces regresa por el sello. El módulo existe para que eso no pase: Portteo **guía al técnico paso por paso**, le exige evidencia en el momento, arma el reporte profesional en PDF y lo deja listo para firmar y sellar en sitio.

**Dentro del MVP:** flujo guiado por WhatsApp, catálogo de rutinas (74) y de sedes/equipos en Porttea-Gener, captura de evidencia por tipo (foto+comentario, antes/después, medición con gráfico), comentarios del técnico, lista de oportunidades de negocio, validación por link, reporte PDF, impresión de 2 copias, evidencia de firma/sello, bandera de faltante de firma, respaldo en Drive y tablero.

**Fuera del MVP (estacionado consciente):** cotización automática desde la rutina (solo queda el comentario de oportunidad); optimización de firma por lote; renta multi-inquilino "real" (ver §11, sí se deja preparado el diseño).

---

## 2. Actores y roles

| Rol | Puede |
|---|---|
| Dueño / Secretaria | En Porttea-Gener: crear y editar rutinas, crear sedes y equipos, ver todas las rutinas ejecutadas, tablero, oportunidades, faltantes de firma |
| Trabajador (técnico) | Por WhatsApp: ejecutar una rutina guiada por Portteo, capturar evidencia, validar y aprobar su reporte |

El reporte lleva el **nombre del técnico** dueño del número que lo ejecutó.

---

## 3. Catálogo (homologación)

Todo cuelga de **cliente → sede → equipo**:
- **Rutinas** (74, del seed): tipo de mantenimiento por categoría de equipo; cada una con equipos incluidos, pasos y refacciones referenciales.
- **Sedes / sitios:** se dan de alta en Porttea-Gener (dueño/secretaria) para homologarlas; cuando el técnico inicia, Portteo le pide primero **en qué sede** está.
- **Equipos:** identificados por **número de inventario** (Servicios de Salud rastrea por inventario). El histórico se acumula por equipo.

---

## 4. Flujo de ejecución (Portteo)

1. **Inicio** — el técnico dice que va a iniciar una rutina.
2. **Sede** — Portteo pregunta en qué sede está (de las homologadas).
3. **Tipo de rutina** — el técnico dice el tipo ("pararrayos"); si hay varias coincidencias, Portteo **las enlista numeradas** para que elija ("es la opción 2").
4. **Paso a paso (entrevista)** — Portteo dicta cada paso y pide su evidencia según el tipo (ver §5). Sella la **hora de inicio, de cada paso y de fin**.
5. **Comentarios del técnico** — al final puede agregar **tantos comentarios como quiera, cada uno con foto opcional** (ej. "todo en buen estado", "sugiero cambiar tal equipo").
6. **Oportunidad de negocio** — un comentario aparte para la empresa ("aquí se puede cotizar tal servicio") que alimenta la lista de **Oportunidades** en Porttea-Gener.
7. **Validación** — Portteo manda un **link con el reporte renderizado**; el técnico corrige textos si algo no está bien y presiona **Aprobar**.
8. **Cierre** — se guarda en base de datos, se genera el PDF y se envía por WhatsApp (o se descarga del link).
9. **Firma y sello** — Portteo pide **imprimir 2 tantos** (uno para el cliente, uno para Gener, que es con lo que cobra), conseguir firma y sello en sitio, y **tomar foto de la hoja firmada/sellada** y enviarla. Si no la envía, el técnico da la razón y Portteo **levanta bandera roja**: el reporte va a la sección **"Faltante de firmas"** del portal.

**Corrección de comentarios:** la IA corrige ortografía y redacción, pero **preserva textual los términos técnicos, unidades y números**; ante la duda, no cambia. El técnico valida el texto en el link antes de aprobar.

---

## 5. Tipos de evidencia por paso

- **Foto + comentario** — una foto y un comentario, **ambos opcionales**; si se omiten, el paso igual aparece en el reporte. Al cerrar, Portteo da un **empujón suave** si hay pasos sin evidencia ("terminaste con 3 pasos sin foto, ¿lo cierras así?"), sin bloquear.
- **Antes / después** — para limpiezas y desinfecciones: **dos fotos** (una limpieza no se prueba con una sola).
- **Medición** — captura de **valor + unidad**, una foto, y un **gráfico** (garantiza al cliente y al control de calidad que la medición se hizo). El **rango** aceptable es opcional: mientras el cliente no lo defina, **el técnico determina cumple / no cumple**. Únicos rangos definidos hoy: refrigeración (2–8 °C / −15 a −25 °C). La sugerencia de qué pasos convendría acotar va en documento aparte (`Sugerencia_Rangos_Mediciones_Electromecanico.md`).

> La clasificación de evidencia por paso en el seed es una **sugerencia** (por palabras clave); Gabriel/Diego la ajustan (ej. "cableado de potencia" no es una medición de potencia).

---

## 6. Modelo de datos

- **CLIENTE → SEDE → EQUIPO** (equipo por número de inventario).
- **RUTINA_PLANTILLA** (74, del seed): nombre, partida, equipos incluidos, refacciones referenciales, pasos (cada paso con su tipo de evidencia sugerido).
- **RUTINA_EJECUCION**: sedeId, equipoId, tecnico (teléfono/nombre), folio, tiempos (inicio, por paso, fin), estatus, y por cada paso: comentario, foto(s), lectura+unidad(+rango).
- **COMENTARIOS** (múltiples, con foto opcional) y **OPORTUNIDAD** (marca para la lista comercial).
- **REPORTE** (PDF en Drive) y **EVIDENCIA_FIRMA** (foto de la hoja firmada/sellada; o bandera de faltante con su razón).

---

## 7. Reglas de negocio

- **Candado de foco:** una vez iniciada la rutina, Portteo **solo atiende esa rutina** hasta finalizarla. Se puede **cancelar** dando la razón → aparece **"cancelada"** en el portal.
- **Un reporte por equipo** (por número de inventario). Es lo que hace que exista el histórico por equipo. (La firma por lote de varios reportes de una misma visita queda como mejora futura.)
- **Folio** de reporte consecutivo, para trazabilidad y para la sección de faltantes.
- **Tiempos** sellados (inicio/pasos/fin) para estadísticas de duración por sede y técnico.
- **Imprimir 2 tantos** al firmar (cliente + Gener).
- **Bandera roja** de faltante de firma → sección "Faltante de firmas"; cuando el técnico consiga la firma después, puede **adjuntar la foto y quitar la bandera**. Recordatorio de reportes sin firma.
- **Resiliencia de campo:** el estado vive en base de datos; si el técnico pierde señal o se apaga el teléfono, Portteo **retoma donde se quedó** ("vas en el paso 4 de 7").

---

## 8. Reporte / PDF

Mismo lenguaje visual que la cotización (azul marino + acento dorado), para que se sienta un solo producto. Incluye: encabezado (logo, folio, fecha, sede, técnico, tipo de rutina, **número de inventario**), pasos con su evidencia (medición con **gráfico**, antes/después, foto+comentario), comentarios del técnico, bloque de **oportunidad**, y bloque final con **nombre de quien recibe, firma/rúbrica y sello**, más la nota **"imprimir 2 tantos"**. Plantilla HTML → PDF; se entrega plantilla + muestra (como en Cotizaciones).

---

## 9. Porttea-Gener (portal) — sección Rutinas

- **Crear/editar rutinas** (solo dueño y secretaria) y ver todas las creadas.
- **Crear sedes/sitios y equipos** (homologación).
- **Ver rutinas ejecutadas** por los técnicos, **organizables por fecha, rango de fechas y sitio**; con estatus (en proceso / completada / cancelada / faltante de firma).
- **Tablero** (rutinas por técnico, por sede, tiempos).
- **Faltante de firmas** (sección aparte).
- **Oportunidades** (lista comercial que alimentan los técnicos).
- **Acceso a reportes y hojas de firma** respaldados en Drive.

---

## 10. Integraciones

- **WhatsApp** es el protagonista aquí (el técnico en campo no abre una web). Telegram de respaldo.
- **Google Drive:** se guardan los **reportes PDF y las hojas de evidencia de firma/sello**, para respaldo y acceso fácil desde el portal.
- **Base de datos:** fuente de verdad (rutinas, ejecuciones, evidencias, tiempos).

---

## 11. Principio de diseño multi-inquilino (visión de renta)

Gener ve una oportunidad de **rentar el sistema** (~$10k por empresa de mantenimiento y ~$10k a Servicios de Salud) porque hoy nadie puede ver el historial de sus equipos, solo Excel y copias de reportes. **No se construye la renta en el MVP**, pero se respeta una disciplina barata que la habilita después: que **todo cuelgue de cliente → sede → equipo** y no de "Gener" hardcodeado. Así, más adelante se puede dar a Servicios de Salud un **acceso de solo lectura a sus equipos y su historial**, y sumar otras empresas como inquilinos, sin rehacer el modelo.

---

## 12. Fuera de alcance del MVP

Cotización automática desde la rutina (solo el comentario de oportunidad) · firma por lote · renta multi-inquilino "real". Se abordan después con el uso real.
