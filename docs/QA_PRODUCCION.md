# Prueba de humo en PRODUCCIÓN (y limpieza posterior)

Checklist para verificar que **cada módulo** funciona en producción
(https://gener-3ecc1.web.app) y dejar la base **limpia** antes de entregarla al
cliente.

---

## ⚠️ Reglas de oro (léelas antes de empezar)

1. **Usa SIEMPRE tu propio teléfono y tu propio correo.** Nunca los de un cliente
   real: al aprobar, el sistema **envía WhatsApp y correo de verdad** y eso NO se
   puede deshacer.
2. **Todo lo de prueba va bajo un solo cliente: `ZZZ PRUEBA`.** Así queda todo
   junto y es fácil de encontrar y borrar.
3. El prefijo `ZZZ` lo manda al final de las listas y lo hace inconfundible.
4. **No hay botón de borrar** para cotizaciones, plantillas, sedes, equipos,
   ejecuciones ni reportes. Esos los limpia Claude con la CLI al final (Fase 7).

### Semáforo de impacto

| | Significado |
|---|---|
| 🟢 | No deja huella. Prueba libremente. |
| 🟡 | Deja registro, pero **tú** lo borras desde el portal. |
| 🔴 | Deja registro y **no hay botón de borrar** → lo limpia Claude (Fase 7). |
| ⛔ | Efectos reales (folio, envíos). Requiere limpieza especial. |

---

## Fase 1 — Módulos de solo lectura 🟢

Sin ningún efecto. Solo confirma que cargan y muestran datos.

- [ ] **Login** — entra a https://gener-3ecc1.web.app con tu cuenta.
- [ ] **Panel** — carga el tablero principal.
- [ ] **Cotizaciones** — el listado abre (estará vacío, es normal).
- [ ] **Seguimiento** — abre sin error.
- [ ] **Tablero de Rutinas** — abre.
- [ ] **Oportunidades** — abre.
- [ ] **WhatsApp** — debe decir **conectado** y mostrar el número del bot en AWS.

## Fase 2 — Configuración 🟢

- [ ] **Configuración → Correo** → botón **Probar**. Te llega un correo a tu
      bandeja. *(No guarda nada en la base.)* 🟢
- [ ] **Configuración → Drive** → botón **Probar**. Crea el archivo
      **`Prueba G-ener.txt`** en tu Drive. 🟡 → **bórralo a mano de Drive** al final.
- [ ] **Configuración → Telegram** — muestra el estado del bot.

## Fase 3 — Catálogos que TÚ puedes borrar 🟡

- [ ] **Clientes → Nuevo** → nombre: **`ZZZ PRUEBA`**, contacto: **tu teléfono y
      tu correo**. Guarda.
- [ ] **Recordatorios → Nuevo** → crea uno para mañana. Márcalo **hecho**.
      Luego **elimínalo** con el botón. ✅
- [ ] **Rutinas → Nueva** → crea `ZZZ RUTINA PRUEBA` con 2–3 pasos.
      *(La borras al final desde el portal.)*

## Fase 4 — Sedes, Equipos y Rutinas 🔴

- [ ] **Sedes → Nueva** → bajo el cliente `ZZZ PRUEBA`, nombre `ZZZ SEDE PRUEBA`.
- [ ] **Equipos → Nuevo** → en esa sede, `ZZZ EQUIPO PRUEBA`. Prueba también la
      opción **sin número de serie (s/n)**.
- [ ] **Rutina por WhatsApp** — desde tu teléfono, escríbele al bot la palabra
      **`rutina`** y sigue el flujo: elegir equipo, responder pasos, mandar una
      **foto** de evidencia.
- [ ] **Ejecuciones** — en el portal, confirma que aparece tu ejecución.
- [ ] **Reporte** — verifica que se generó el **reporte con folio `GPC-R-…`** y
      que el PDF se ve bien.

> Esto crea: sede, equipo, ejecución, reporte y consume el contador
> `counters/reporte_2026`. Todo se limpia en la Fase 7.

## Fase 5 — Cotizaciones (el núcleo) 🔴 / ⛔

- [ ] **Plantillas → Nueva** → `ZZZ PLANTILLA PRUEBA` con un precio sugerido. 🔴
- [ ] **Taller → Nueva cotización** para el cliente `ZZZ PRUEBA`. 🔴
- [ ] **Portteo (IA)** — pídele por chat que agregue una partida desde la
      plantilla. Confirma que **no inventa precios**.
- [ ] Prueba editar: **agregar/quitar renglones de alcance**, **notas**,
      **forma de pago** (anticipo % + contra entrega %, deben sumar 100).
- [ ] **Documento en vivo** — el panel derecho refleja los cambios al instante.
- [ ] **PDF** — descárgalo y revisa que no se corte del lado derecho.

### ⛔ Aprobación (el paso con efectos reales)

> Antes de darle: confirma que el contacto de `ZZZ PRUEBA` es **TU** número y
> **TU** correo. Aquí sí se envía de verdad.

- [ ] **Aprobar** → verifica que:
  - [ ] Se asignó folio **`GPC-0726-001`** (mes actual, consecutivo 1).
  - [ ] El estatus cambió a **enviada**.
  - [ ] Te llegó el **PDF por WhatsApp**.
  - [ ] Te llegó el **correo** con la cotización.
  - [ ] Apareció el **PDF en tu Google Drive**.
- [ ] **Revisión (Rev. B)** → crea una revisión y apruébala. **Debe conservar el
      mismo folio** `GPC-0726-001` (no consumir uno nuevo).
- [ ] **Cambiar estatus** → `autorizada` → `realizada`.
- [ ] **Seguimiento** → confirma que la cotización aparece con su antigüedad.

## Fase 6 — Bots 🟢

- [ ] **WhatsApp** → mándale `hola` al bot. Prueba:
  - [ ] Consultar seguimiento
  - [ ] Buscar un precio del histórico
  - [ ] Listar plantillas
- [ ] **Telegram** → lo mismo por el bot de respaldo.

## Fase 7 — Limpieza 🧹

### Lo que borras TÚ (desde el portal / Drive)

- [ ] **Recordatorios** → ya los borraste en la Fase 3.
- [ ] **Rutinas** → elimina `ZZZ RUTINA PRUEBA`.
- [ ] **Clientes** → elimina `ZZZ PRUEBA` (hazlo **al final**, después de que
      Claude borre sedes/equipos/cotizaciones).
- [ ] **Google Drive** → borra a mano:
  - [ ] `Prueba G-ener.txt`
  - [ ] El PDF de la cotización de prueba
  - [ ] El PDF del reporte de prueba

### Lo que borra Claude (CLI de Firestore) — avísale al terminar

- [ ] `cotizaciones/{id}` de prueba (y sus subcolecciones `versiones`, `bloques`)
- [ ] `plantillas/{id}` de prueba
- [ ] `sedes/{id}` y `equipos/{id}` de prueba
- [ ] `ejecuciones/{id}` y `reportes/{id}` de prueba
- [ ] Registros de la **bitácora de precios** generados al aprobar
- [ ] **Reiniciar contadores de folio:**
  - [ ] `counters/folio_2026_07` → para que la primera cotización real del cliente
        sea **`GPC-0726-001`**
  - [ ] `counters/reporte_2026` → para que el primer reporte real sea el **001**
- [ ] Historial de conversación del bot (`historial_wa/{telefono}`) si quedó tu
      chat de prueba

### Verificación final (debe quedar como nuevo)

- [ ] Cotizaciones: **vacío**
- [ ] Clientes / Sedes / Equipos: **vacío**
- [ ] Ejecuciones / Reportes: **vacío**
- [ ] Plantillas: solo las **3 por defecto**
- [ ] Rutinas: solo las **74 por defecto**
- [ ] Usuarios: **intactos** (no se tocan)
- [ ] Contadores de folio: **reiniciados**

---

## Nota sobre el módulo de Usuarios

**No crees usuarios de prueba.** Crear uno genera también una cuenta en Firebase
Auth y **no hay botón para borrarla**. Para probar ese módulo, simplemente
**edita un usuario existente** (cambia el nombre, guarda, y regrésalo como
estaba). Eso ejercita el módulo sin dejar basura.
