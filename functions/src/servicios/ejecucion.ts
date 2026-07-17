import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { RutinaEjecucion, RutinaPlantilla, Usuario } from '../dominio/tipos';
import { avanzarEjecucion, iniciarEjecucion, textoPaso } from '../dominio/ejecucion';
import { buscarClientes } from './cotizaciones';
import { crearEquipo, crearSede } from './rutinas';

// El técnico puede anotar una oportunidad comercial en cualquier momento.
const RE_OPORTUNIDAD = /^\s*oportunidad\s*[:\-]?\s*(.+)/is;
const RE_SI = /\b(si|s[ií]|sip|claro|dale|ok|okay|va|correcto|hazlo|adelante|de acuerdo|as[ií]|listo)\b/i;
const RE_NO = /\b(no|nel|mejor no)\b/i;
const RE_CANCELAR_ALTA = /\b(cancelar|cancela|salir|olvidalo|olvídalo)\b/i;
// El equipo NO tiene número de serie: "s/n", "sn", "sin serie", "sin número", "no tiene".
const RE_SIN_SERIE = /(^|\b)(s\/?n|sin\s*(n[uú]mero|serie|nº|no\.?)|no\s*tiene\s*(n[uú]mero|serie))(\b|$)/i;
// El técnico quiere registrar OTRO equipo distinto a los ofrecidos.
const RE_NUEVO = /\b(nuevo|otro|registrar|no est[aá]|ninguno)\b/i;
// Señal de que el técnico quiere arrancar una rutina dentro de una frase (además
// de mandar el código solo). Evita secuestrar mensajes casuales con números.
// Prefijos (solo límite inicial de palabra): "inici" empata "iniciar/inicio",
// "maquin" empata "maquina/máquina", "manten" empata "mantenimiento", etc.
const RE_SENAL_RUTINA =
  /\b(inici|empiez|empez|comenz|arranc|nuev|manten|rutina|servici|revis|inspec|chec|chequ|maquin|aparato|unidad|equipo|inventario|serie|folio|n[uú]m|nro)/i;

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

async function registrarOportunidad(
  db: Firestore,
  activa: { id: string; ejec: RutinaEjecucion },
  texto: string
): Promise<string> {
  await db.collection('oportunidades').add({
    ejecucionId: activa.id,
    sedeId: activa.ejec.sedeId,
    equipoId: activa.ejec.equipoId,
    tecnicoNombre: activa.ejec.tecnicoNombre,
    texto,
    estatus: 'abierta',
    fecha: FieldValue.serverTimestamp(),
  });
  await db.doc(`rutinas_ejecucion/${activa.id}`).set({ oportunidad: texto }, { merge: true });
  return `💡 Anoté la oportunidad: "${texto}". La pasé a la lista de ventas. Sigamos con la rutina.`;
}

// Servicio del flujo guiado de Rutinas (Fase 2): I/O de Firestore + orquestación.
// La lógica pura vive en dominio/ejecucion.ts. El técnico opera por WhatsApp:
//   - Sin ejecución activa: manda el nº de inventario del equipo → arranca.
//   - Con ejecución activa: cada mensaje/foto avanza el flujo guiado.

interface EjecucionConId {
  id: string;
  ejec: RutinaEjecucion;
}

export async function buscarEjecucionActiva(
  db: Firestore,
  tecnicoTelefono: string
): Promise<EjecucionConId | null> {
  const snap = await db
    .collection('rutinas_ejecucion')
    .where('tecnicoTelefono', '==', tecnicoTelefono)
    .where('estatus', '==', 'en_proceso')
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ejec: snap.docs[0].data() as RutinaEjecucion };
}

// Busca un equipo por nº de inventario DENTRO de una sede (dos clientes/sedes
// distintos pueden repetir el mismo número de serie, por eso se acota a la sede).
async function buscarEquipoEnSede(db: Firestore, sedeId: string, noInventario: string) {
  const objetivo = norm(noInventario);
  const snap = await db.collection('equipos').where('sedeId', '==', sedeId).get();
  const doc = snap.docs.find((d) => norm(d.get('noInventario')) === objetivo);
  if (!doc) return null;
  return { id: doc.id, ...(doc.data() as { sedeId: string; noInventario: string; descripcion?: string | null }) };
}

// El técnico dijo que el equipo NO tiene serie. Si la sede ya tiene equipos sin
// serie, se los ofrecemos (para no duplicar y poder correrles rutina); si no,
// pasamos a capturar su descripción para darlo de alta.
async function manejarSinSerie(db: Firestore, telefono: string, alta: AltaEquipo): Promise<string> {
  const snap = await db.collection('equipos').where('sedeId', '==', alta.sedeId!).get();
  const sinSerie = snap.docs
    .filter((d) => !String(d.get('noInventario') ?? '').trim())
    .map((d) => ({
      id: d.id,
      noInventario: (d.get('noInventario') as string) || undefined,
      descripcion: (d.get('descripcion') as string) || undefined,
    }));
  if (sinSerie.length) {
    await guardarAlta(db, telefono, { ...alta, sinSerie: true, noInventario: undefined, candidatosEquipo: sinSerie, paso: 'equipo_elegir' });
    const lista = sinSerie.map((e, i) => `${i + 1}. ${e.descripcion || '(sin descripción)'}`).join('\n');
    return `En *${alta.sedeNombre}* hay equipos *sin número de serie*. ¿Es alguno? Responde el *número*, o escribe *nuevo* para registrar otro:\n${lista}`;
  }
  await guardarAlta(db, telefono, { ...alta, sinSerie: true, noInventario: undefined, paso: 'equipo_desc' });
  return 'Va, lo registro *sin número de serie*. Dame una *breve descripción o característica* para identificarlo (ej. "UPS APC en rack 3").';
}

async function cargarPlantilla(db: Firestore, rutinaId: string): Promise<RutinaPlantilla | null> {
  const doc = await db.doc(`rutinas_plantilla/${rutinaId}`).get();
  if (!doc.exists) return null;
  return doc.data() as RutinaPlantilla;
}

async function persistir(db: Firestore, id: string, ejec: RutinaEjecucion): Promise<void> {
  await db.doc(`rutinas_ejecucion/${id}`).set({ ...ejec, actualizadoEn: FieldValue.serverTimestamp() }, { merge: true });
}

// Arranca la ejecución de una rutina para un equipo (crea el doc y devuelve el
// primer paso). Reutilizado por el arranque normal y por el alta guiada.
async function arrancarEjecucion(
  db: Firestore,
  equipo: { id: string; sedeId: string; noInventario: string },
  rutinaId: string,
  usuario: Usuario,
  telefono: string,
  plantilla: RutinaPlantilla,
  ahora: Date
): Promise<string> {
  const ejec = iniciarEjecucion(
    plantilla,
    {
      rutinaId,
      sedeId: equipo.sedeId,
      equipoId: equipo.id,
      tecnicoTelefono: telefono,
      tecnicoNombre: usuario.nombre ?? '',
    },
    ahora
  );
  await db.collection('rutinas_ejecucion').add({ ...ejec, creadoEn: FieldValue.serverTimestamp() });
  const encabezado =
    `🛠️ *${plantilla.nombre}*\nEquipo: ${equipo.noInventario}\n` +
    `_Tip: en cualquier momento escribe "oportunidad: ..." para anotar una venta potencial._\n\n`;
  return encabezado + textoPaso(ejec, plantilla, ejec.pasoActual!);
}

// Extrae un posible nº de inventario/serie de un texto del técnico. Acepta el
// código solo ("278493", "EQ-005") o dentro de una frase ("quiero iniciar un
// mantenimiento con el número de serie 278493"). Devuelve null si no hay nada
// que parezca un código o no hay señal de que quiera arrancar una rutina.
export function extraerInventario(texto: string, opts: { exigirSenal?: boolean } = {}): string | null {
  const exigirSenal = opts.exigirSenal !== false; // por defecto, exige señal de rutina
  const t = texto.trim();
  // El técnico mandó SOLO el código. Un nº de inventario/serie SIEMPRE trae al
  // menos un dígito; así "cancelar", "hola", "gracias", "ok" no se confunden con
  // un código (antes cualquier palabra suelta arrancaba un alta por error).
  if (/^[A-Za-z0-9][A-Za-z0-9\-_/]{1,30}$/.test(t) && /\d/.test(t)) return t;
  // En una frase, solo interpretamos un código si hay una señal de rutina (salvo
  // cuando ya le pedimos expresamente el número: ahí exigirSenal es false).
  if (exigirSenal && !RE_SENAL_RUTINA.test(t)) return null;
  // Preferimos el código que sigue a una palabra de campo (serie/inventario/…).
  const tras = t.match(
    /\b(?:serie|inventario|inv|equipo|maquin\w*|m[aá]quina|folio|n[uú]mero|nro|num|no)\b\.?\s*[:\-#.]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{1,30})/i
  );
  if (tras && /\d/.test(tras[1])) return tras[1];
  // Si no, el token alfanumérico más largo que tenga al menos un dígito.
  const tokens = (t.match(/[A-Za-z0-9][A-Za-z0-9\-_/]{1,30}/g) ?? []).filter((x) => /\d/.test(x));
  if (tokens.length) return tokens.sort((a, b) => b.length - a.length)[0];
  return null;
}

// Arranca el flujo guiado SIEMPRE por el cliente (no por el nº de serie): dos
// clientes/sedes pueden repetir el mismo número, así que primero acotamos
// cliente → sede y hasta entonces buscamos el equipo dentro de esa sede.
// Si el técnico ya mandó un nº de inventario, lo recordamos para no repreguntarlo.
async function iniciarAltaGuiada(
  db: Firestore,
  telefono: string,
  noInventario?: string
): Promise<string> {
  await guardarAlta(db, telefono, { paso: 'cliente', noInventario: noInventario?.trim() || undefined });
  return '¡Va! Para arrancar la rutina, ¿de qué *cliente* es el equipo?  _(o escribe *cancelar*)_';
}

// ---------- Alta guiada / arranque (cliente → sede → equipo) ----------
// Se guarda en rutinas_onboarding/{telefono}. El CLIENTE debe existir; la SEDE y
// el EQUIPO se pueden registrar en campo (siempre con confirmación).

// Flujo: cliente → sede → equipo (existente o alta con descripción) → elegir
// rutina. La rutina NO pertenece al equipo: se elige en cada arranque, así un
// mismo equipo puede recibir distintas rutinas.
type PasoAlta =
  | 'cliente'
  | 'sede'
  | 'sede_confirmar'
  | 'inventario'
  | 'equipo_confirmar' // se encontró un equipo existente: ¿es este?
  | 'equipo_elegir' // hay equipos SIN serie en la sede: ¿es alguno o registro otro?
  | 'equipo_desc' // no existe: capturar descripción para darlo de alta
  | 'equipo_registrar' // confirmar el alta del equipo nuevo
  | 'rutina'; // elegir qué rutina correr (todas las activas)
interface AltaEquipo {
  noInventario?: string; // se conoce al mandarlo (paso 'inventario') o desde el arranque
  sinSerie?: boolean; // el equipo se registra SIN número de serie (se identifica por descripción)
  paso: PasoAlta;
  clienteId?: string;
  clienteNombre?: string;
  sedeId?: string;
  sedeNombre?: string;
  sedeNombreNueva?: string;
  equipoId?: string; // el equipo (existente o recién creado) sobre el que corre la rutina
  descripcion?: string; // descripción capturada al dar de alta un equipo nuevo
  candidatosCliente?: { id: string; nombre: string }[]; // clientes parecidos ofrecidos para elegir
  candidatosEquipo?: { id: string; noInventario?: string; descripcion?: string }[]; // equipos sin serie ofrecidos
  candidatosRutina?: { id: string; nombre: string }[]; // rutinas activas ofrecidas para elegir
}

async function leerAlta(db: Firestore, telefono: string): Promise<AltaEquipo | null> {
  const snap = await db.doc(`rutinas_onboarding/${telefono}`).get();
  return snap.exists ? (snap.data() as AltaEquipo) : null;
}
async function guardarAlta(db: Firestore, telefono: string, data: AltaEquipo): Promise<void> {
  await db.doc(`rutinas_onboarding/${telefono}`).set({ ...data, actualizadoEn: FieldValue.serverTimestamp() });
}
async function borrarAlta(db: Firestore, telefono: string): Promise<void> {
  await db.doc(`rutinas_onboarding/${telefono}`).delete();
}
async function sedesDeCliente(db: Firestore, clienteId: string): Promise<{ id: string; nombre: string }[]> {
  const snap = await db.collection('sedes').where('clienteId', '==', clienteId).get();
  return snap.docs.map((d) => ({ id: d.id, nombre: String(d.get('nombre') ?? '') })).filter((s) => s.nombre);
}
async function rutinasPorTexto(db: Firestore, texto: string): Promise<{ id: string; nombre: string }[]> {
  const objetivo = norm(texto);
  if (!objetivo) return [];
  const snap = await db.collection('rutinas_plantilla').where('activa', '==', true).get();
  return snap.docs
    .map((d) => ({ id: d.id, nombre: String(d.get('nombre') ?? ''), n: norm(d.get('nombre')) }))
    .filter((x) => x.n === objetivo || x.n.includes(objetivo) || objetivo.includes(x.n))
    .slice(0, 6)
    .map(({ id, nombre }) => ({ id, nombre }));
}
const listaNum = (arr: { nombre: string }[]) => arr.map((x, i) => `${i + 1}. ${x.nombre}`).join('\n');

// Intérprete IA de un paso del alta (inyectado por el webhook). Normaliza el
// mensaje libre a intención + valor, para no depender de palabras exactas.
type InterpretarAlta = (
  paso: 'cliente' | 'sede' | 'rutina' | 'confirmar',
  mensaje: string
) => Promise<{ intencion: 'cancelar' | 'confirmar' | 'negar' | 'responder' | 'listar'; valor: string | null }>;

// El técnico pide ver las opciones en vez de nombrar una ("¿qué rutinas hay?").
const RE_PIDE_LISTA = /\b(qu[eé] (tipos?|rutinas?|opciones|hay)|cu[aá]les|lista(do)?|opciones|mu[eé]stra|ens[eé]ñ|no s[eé] cu[aá]l)\b/i;
// Comando explícito "todas / ver la lista / catálogo" (anclado: solo esa frase),
// para mostrar el catálogo completo aunque la IA lo interprete como respuesta.
const RE_PIDE_TODAS = /^\s*(tod[oa]s|ver (la )?lista|lista completa|cat[aá]logo|el listado)\s*$/i;

// Todas las rutinas activas (para enlistar el catálogo cuando el técnico lo pide).
async function listarRutinas(db: Firestore): Promise<{ id: string; nombre: string }[]> {
  const snap = await db.collection('rutinas_plantilla').where('activa', '==', true).get();
  return snap.docs
    .map((d) => ({ id: d.id, nombre: String(d.get('nombre') ?? '') }))
    .filter((r) => r.nombre)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}
// Nombre corto para la lista (quita el prefijo formal repetido de cada rutina).
function nombreCortoRutina(nombre: string): string {
  return nombre.replace(/^\s*rutina de mantenimiento preventivo (para|de)\s+/i, '').trim() || nombre;
}

// Máquina del alta guiada. Devuelve el texto de respuesta al técnico. Cada paso
// se interpreta con IA (si se inyecta `interpretar`); el regex queda de respaldo.
async function manejarAltaEquipo(
  db: Firestore,
  usuario: Usuario,
  telefono: string,
  texto: string,
  alta: AltaEquipo,
  ahora: Date,
  interpretar?: InterpretarAlta
): Promise<string> {
  const t = texto.trim();
  // La IA interpreta el mensaje según el paso; si no está o falla, usamos regex.
  let interp: { intencion: 'cancelar' | 'confirmar' | 'negar' | 'responder' | 'listar'; valor: string | null } | null = null;
  // Los pasos de confirmación (sí/no) se interpretan como 'confirmar'; el paso
  // 'inventario' no usa IA (se extrae el código directo del texto).
  const PASO_IA: Record<string, 'cliente' | 'sede' | 'rutina' | 'confirmar' | undefined> = {
    cliente: 'cliente',
    sede: 'sede',
    rutina: 'rutina',
    sede_confirmar: 'confirmar',
    equipo_confirmar: 'confirmar',
    equipo_registrar: 'confirmar',
  };
  const pasoIA = PASO_IA[alta.paso];
  if (interpretar && pasoIA) {
    try {
      interp = await interpretar(pasoIA, texto);
    } catch {
      interp = null;
    }
  }
  // "q" = lo que el técnico quiso decir (valor limpio por IA) o el texto crudo.
  const q = interp?.valor || t;

  if (interp?.intencion === 'cancelar' || RE_CANCELAR_ALTA.test(t)) {
    await borrarAlta(db, telefono);
    return '🚫 Cancelé el alta del equipo. Cuando quieras, mándame de nuevo el número de inventario.';
  }

  if (alta.paso === 'cliente') {
    // Si ya ofrecimos una lista de candidatos y responde con un NÚMERO, tómalo
    // (usamos el texto crudo por si la IA transformó el "1"). Así "1" elige la
    // opción 1 en vez de buscarse como si fuera el nombre del cliente.
    if (alta.candidatosCliente?.length) {
      const sel = parseInt(t, 10);
      if (!isNaN(sel) && sel >= 1 && sel <= alta.candidatosCliente.length) {
        return await avanzarAClienteElegido(db, telefono, alta, alta.candidatosCliente[sel - 1]);
      }
    }
    const cands = await buscarClientes(db, q);
    // Procedemos directo solo con confianza ALTA: coincidencia exacta, o una única
    // por SUBCADENA ("coca" → "Coca-Cola"). Un typo ("microsoift") NO se asume:
    // se ofrecen las opciones parecidas para que el técnico elija.
    const contiene = cands.filter((c) => c.contiene);
    const elegido = cands.find((c) => c.exacta) ?? (contiene.length === 1 ? contiene[0] : undefined);
    if (elegido) {
      return await avanzarAClienteElegido(db, telefono, alta, elegido);
    }
    if (cands.length) {
      // Recordamos los candidatos para poder aceptar el número en la respuesta.
      await guardarAlta(db, telefono, { ...alta, candidatosCliente: cands.map((c) => ({ id: c.id, nombre: c.nombre })) });
      return `No encontré *${q}* exacto. ¿Te refieres a alguno de estos? _(responde el número o el nombre)_\n${cands.map((c, i) => `${i + 1}. ${c.nombre}`).join('\n')}\n_(o *cancelar*)_`;
    }
    await guardarAlta(db, telefono, { ...alta, candidatosCliente: undefined });
    return `No encontré ningún cliente parecido a *${q}*. Pídele a tu *administrador* que lo dé de alta en el sistema, y luego lo intentamos de nuevo. _(o *cancelar*)_`;
  }

  if (alta.paso === 'sede') {
    const sedes = await sedesDeCliente(db, alta.clienteId!);
    // Pide ver las sedes ("¿cuáles hay?"): se las volvemos a enlistar.
    if (interp?.intencion === 'listar' || (!interp && RE_PIDE_LISTA.test(t))) {
      return `Sedes de *${alta.clienteNombre}* (responde el número o el nombre):\n${listaNum(sedes)}`;
    }
    const num = parseInt(q, 10);
    let elegida = !isNaN(num) && num >= 1 && num <= sedes.length ? sedes[num - 1] : undefined;
    if (!elegida) {
      const o = norm(q);
      elegida = sedes.find((s) => norm(s.nombre) === o) ?? sedes.find((s) => norm(s.nombre).includes(o) || o.includes(norm(s.nombre)));
    }
    if (elegida) {
      return await trasSede(db, usuario, telefono, { ...alta, sedeId: elegida.id, sedeNombre: elegida.nombre }, ahora);
    }
    // No existe: ofrecemos registrarla (el técnico la puede dar de alta en campo).
    await guardarAlta(db, telefono, { ...alta, sedeNombreNueva: q, paso: 'sede_confirmar' });
    const otras = sedes.length ? `\n_O responde el nombre/número de una ya registrada:_\n${listaNum(sedes)}` : '';
    return `No tengo la sede *${q}* en *${alta.clienteNombre}*. ¿La *registro*? Responde *sí* / *no*.${otras}`;
  }

  if (alta.paso === 'sede_confirmar') {
    if (interp?.intencion === 'confirmar' || RE_SI.test(t)) {
      const { sedeId } = await crearSede(db, { clienteId: alta.clienteId!, nombre: alta.sedeNombreNueva! });
      return await trasSede(
        db,
        usuario,
        telefono,
        { ...alta, sedeId, sedeNombre: alta.sedeNombreNueva, sedeNombreNueva: undefined },
        ahora,
        `✅ Registré la sede *${alta.sedeNombreNueva}* en *${alta.clienteNombre}*.\n`
      );
    }
    if (interp?.intencion === 'negar' || RE_NO.test(t)) {
      const sedes = await sedesDeCliente(db, alta.clienteId!);
      await guardarAlta(db, telefono, { ...alta, sedeNombreNueva: undefined, paso: 'sede' });
      const lista = sedes.length ? `\n${listaNum(sedes)}` : ' _(escribe el nombre y la registro)_';
      return `Va. ¿En qué *sede* está el equipo?${lista}`;
    }
    // Otro texto: lo tratamos como el nombre de otra sede (buscar o registrar).
    const reintento: AltaEquipo = { ...alta, sedeNombreNueva: undefined, paso: 'sede' };
    await guardarAlta(db, telefono, reintento);
    return await manejarAltaEquipo(db, usuario, telefono, texto, reintento, ahora, interpretar);
  }

  // Ya tenemos cliente + sede: pedimos (o ya tenemos) el nº de inventario y
  // buscamos el equipo DENTRO de la sede.
  if (alta.paso === 'inventario') {
    // El equipo no tiene número de serie: se registra por descripción.
    if (RE_SIN_SERIE.test(t)) {
      return await manejarSinSerie(db, telefono, alta);
    }
    const inv = extraerInventario(texto, { exigirSenal: false });
    if (!inv) {
      return 'No alcancé a ver el número. Mándame *solo el número de serie/inventario* del equipo (viene en su etiqueta). Si el equipo *no tiene serie*, escribe *s/n*. _(o cancelar)_';
    }
    return await resolverInventarioEnSede(db, usuario, telefono, alta, inv, ahora);
  }

  // Equipos SIN serie de la sede: el técnico elige uno o registra otro.
  if (alta.paso === 'equipo_elegir') {
    const cands = alta.candidatosEquipo ?? [];
    if (RE_NUEVO.test(t)) {
      await guardarAlta(db, telefono, { ...alta, sinSerie: true, noInventario: undefined, candidatosEquipo: undefined, paso: 'equipo_desc' });
      return 'Va, lo registro *sin número de serie*. Dame una *breve descripción o característica* para identificarlo (ej. "UPS APC en rack 3").';
    }
    const num = parseInt(t, 10);
    if (!isNaN(num) && num >= 1 && num <= cands.length) {
      const e = cands[num - 1];
      const conEquipo: AltaEquipo = { ...alta, equipoId: e.id, noInventario: e.noInventario || undefined, descripcion: e.descripcion, candidatosEquipo: undefined };
      return await pedirRutina(db, telefono, conEquipo);
    }
    const lista = cands.map((e, i) => `${i + 1}. ${e.descripcion || '(sin descripción)'}`).join('\n');
    return `Responde el *número* del equipo, o escribe *nuevo* para registrar otro:\n${lista}`;
  }

  // Encontramos un equipo existente en la sede: el técnico confirma que es ese.
  // Al confirmar, pasamos a ELEGIR la rutina (no arranca una "suya").
  if (alta.paso === 'equipo_confirmar') {
    if (interp?.intencion === 'confirmar' || RE_SI.test(t)) {
      return await pedirRutina(db, telefono, alta);
    }
    if (interp?.intencion === 'negar' || RE_NO.test(t)) {
      await guardarAlta(db, telefono, { ...alta, equipoId: undefined, noInventario: undefined, paso: 'inventario' });
      return 'Ok. Dime otra vez el *número de serie / inventario* del equipo.';
    }
    return `¿Es este equipo (*${alta.noInventario}*)? Responde *sí* para elegir la rutina, o *no*.`;
  }

  // El equipo NO existe (o es sin serie): capturamos una descripción para darlo de
  // alta. El texto que mande el técnico ES la descripción (salvo "no"/"cancelar").
  if (alta.paso === 'equipo_desc') {
    if (interp?.intencion === 'negar' || RE_NO.test(t)) {
      await borrarAlta(db, telefono);
      return '🚫 Ok, no registré el equipo. Cuando quieras, mándame el número de inventario otra vez.';
    }
    const desc = q.trim();
    const ref = alta.sinSerie ? '(sin número de serie)' : `*${alta.noInventario}*`;
    if (!desc) {
      return `Mándame una *breve descripción o característica* del equipo ${ref} para registrarlo (ej. "UPS APC 3kVA"), o escribe *no* para cancelar.`;
    }
    await guardarAlta(db, telefono, { ...alta, descripcion: desc, paso: 'equipo_registrar' });
    const etiqueta = alta.sinSerie ? `_${desc}_ (sin serie)` : `*${alta.noInventario}* — _${desc}_`;
    return `¿Registro el equipo ${etiqueta} en *${alta.sedeNombre}* (${alta.clienteNombre})? Responde *sí* / *no*.`;
  }

  // Confirmación del alta del equipo nuevo. Al crearlo, pasamos a elegir rutina.
  if (alta.paso === 'equipo_registrar') {
    if (interp?.intencion === 'confirmar' || RE_SI.test(t)) {
      const { equipoId } = await crearEquipo(db, {
        sedeId: alta.sedeId!,
        noInventario: alta.noInventario ?? '', // vacío = sin número de serie
        descripcion: alta.descripcion,
      });
      const idEquipo = alta.sinSerie ? `_${alta.descripcion}_ (sin serie)` : `*${alta.noInventario}*`;
      const intro = `✅ Equipo ${idEquipo} registrado en *${alta.sedeNombre}*.\n`;
      return await pedirRutina(db, telefono, { ...alta, equipoId }, intro);
    }
    if (interp?.intencion === 'negar' || RE_NO.test(t)) {
      await borrarAlta(db, telefono);
      return '🚫 Ok, no registré el equipo. Cuando quieras, mándame el número de inventario otra vez.';
    }
    const etiqueta = alta.sinSerie ? `_${alta.descripcion}_ (sin serie)` : `*${alta.noInventario}* — _${alta.descripcion}_`;
    return `¿Registro el equipo ${etiqueta} en *${alta.sedeNombre}*? Responde *sí* / *no*.`;
  }

  // Elegir la rutina para este arranque. Primero pedimos una palabra clave (no
  // volcamos el catálogo); aquí buscamos las que apliquen, o mostramos todas.
  if (alta.paso === 'rutina') {
    // Si ya hay una lista numerada en pantalla (por "todas" o por varios matches)
    // y responde con un número, tómalo (usamos el texto crudo para el número).
    if (alta.candidatosRutina?.length) {
      const num = parseInt(t, 10);
      if (!isNaN(num) && num >= 1 && num <= alta.candidatosRutina.length) {
        return await lanzarRutinaElegida(db, usuario, telefono, alta, alta.candidatosRutina[num - 1], ahora);
      }
    }
    // Pide ver TODO el catálogo ("todas", "muéstrame la lista"): lo enlistamos.
    if (interp?.intencion === 'listar' || RE_PIDE_TODAS.test(t) || (!interp && RE_PIDE_LISTA.test(t))) {
      return await mostrarTodasRutinas(db, telefono, alta);
    }
    const rutinas = await rutinasPorTexto(db, q);
    if (!rutinas.length) {
      return `No encontré una rutina que empate con "${q}". Prueba otra *palabra clave* (ej. *chiller*, *báscula*, *UPS*) o escribe *todas* para ver la lista completa.`;
    }
    if (rutinas.length > 1) {
      await guardarAlta(db, telefono, { ...alta, candidatosRutina: rutinas });
      return `Encontré varias que aplican. ¿Cuál? (responde el número, o escribe *todas* para ver el catálogo completo)\n${listaNum(rutinas.map((r) => ({ nombre: nombreCortoRutina(r.nombre) })))}`;
    }
    return await lanzarRutinaElegida(db, usuario, telefono, alta, rutinas[0], ahora);
  }

  // Paso desconocido (no debería pasar): reiniciamos por seguridad.
  await borrarAlta(db, telefono);
  return 'Se me perdió el hilo 😅. Escríbeme de nuevo el *cliente* para arrancar la rutina.';
}

// Cliente confirmado (por coincidencia exacta o elegido de la lista): guarda y
// pasa al paso de sede, ofreciendo las sedes existentes o pidiendo la primera.
async function avanzarAClienteElegido(
  db: Firestore,
  telefono: string,
  alta: AltaEquipo,
  cliente: { id: string; nombre: string }
): Promise<string> {
  const sedes = await sedesDeCliente(db, cliente.id);
  await guardarAlta(db, telefono, {
    ...alta,
    clienteId: cliente.id,
    clienteNombre: cliente.nombre,
    candidatosCliente: undefined,
    paso: 'sede',
  });
  if (!sedes.length) {
    return `Cliente *${cliente.nombre}*. Todavía no tiene sedes registradas. ¿Cómo se llama la *sede* donde está el equipo? La registro.`;
  }
  return `Cliente *${cliente.nombre}*. ¿En qué *sede*? Responde el número o el nombre — o dime una *nueva* y la registro.\n${listaNum(sedes)}`;
}

// Entra al paso 'rutina'. En vez de volcar el catálogo completo (son decenas),
// pregunta qué tipo de rutina y deja que el técnico dé una palabra clave; abajo
// (paso 'rutina') buscamos las que apliquen. Puede escribir "todas" para el listado.
// Etiqueta legible del equipo: su nº de serie o, si no tiene, su descripción.
function etiquetaEquipo(alta: AltaEquipo): string {
  return (alta.noInventario && alta.noInventario.trim()) || alta.descripcion || 'sin serie';
}

async function pedirRutina(db: Firestore, telefono: string, alta: AltaEquipo, prefijo = ''): Promise<string> {
  const todas = await listarRutinas(db);
  if (!todas.length) {
    await borrarAlta(db, telefono);
    return `${prefijo}No hay rutinas activas en el catálogo. Pídele a la oficina que registre alguna en el portal.`;
  }
  // No guardamos candidatosRutina todavía: primero pedimos la palabra clave.
  await guardarAlta(db, telefono, { ...alta, candidatosRutina: undefined, paso: 'rutina' });
  return (
    `${prefijo}Equipo *${etiquetaEquipo(alta)}* listo. ¿Qué *rutina* le hacemos?\n` +
    `Dime el *tipo de equipo* o una palabra clave (ej. *UPS*, *chiller*, *báscula*) y te muestro las que apliquen — o escribe *todas* para ver la lista completa.`
  );
}

// Muestra el catálogo COMPLETO de rutinas activas (numerado) cuando el técnico lo
// pide expresamente ("todas", "muéstrame la lista"). Guarda los candidatos para
// aceptar el número en la respuesta.
async function mostrarTodasRutinas(db: Firestore, telefono: string, alta: AltaEquipo): Promise<string> {
  const todas = await listarRutinas(db);
  if (!todas.length) {
    await borrarAlta(db, telefono);
    return 'No hay rutinas activas en el catálogo. Pídele a la oficina que registre alguna en el portal.';
  }
  await guardarAlta(db, telefono, { ...alta, candidatosRutina: todas, paso: 'rutina' });
  const lista = todas.map((r, i) => `${i + 1}. ${nombreCortoRutina(r.nombre)}`).join('\n');
  return `Hay *${todas.length}* rutinas. Responde el *número*:\n${lista}`;
}

// Carga la plantilla elegida y arranca la ejecución sobre el equipo del alta.
async function lanzarRutinaElegida(
  db: Firestore,
  usuario: Usuario,
  telefono: string,
  alta: AltaEquipo,
  rutina: { id: string; nombre: string },
  ahora: Date
): Promise<string> {
  const plantilla = await cargarPlantilla(db, rutina.id);
  if (!plantilla || plantilla.activa === false) {
    return `La rutina *${rutina.nombre}* no está disponible. Elige otra de la lista o avísale a la oficina.`;
  }
  await borrarAlta(db, telefono);
  return await arrancarEjecucion(
    db,
    { id: alta.equipoId!, sedeId: alta.sedeId!, noInventario: etiquetaEquipo(alta) },
    rutina.id,
    usuario,
    telefono,
    plantilla,
    ahora
  );
}

// Tras confirmar la sede: si ya tenemos el nº de inventario (lo mandó al arrancar),
// buscamos el equipo dentro de la sede; si no, se lo pedimos.
async function trasSede(
  db: Firestore,
  usuario: Usuario,
  telefono: string,
  alta: AltaEquipo,
  ahora: Date,
  prefijo = ''
): Promise<string> {
  if (alta.noInventario) {
    return await resolverInventarioEnSede(db, usuario, telefono, alta, alta.noInventario, ahora, prefijo);
  }
  await guardarAlta(db, telefono, { ...alta, paso: 'inventario' });
  return `${prefijo}Sede *${alta.sedeNombre}*. Ahora dime el *número de serie / inventario* del equipo (viene en su etiqueta). Si *no tiene serie*, escribe *s/n*.`;
}

// Busca el equipo por inventario DENTRO de la sede. Si existe → confirmar y
// arrancar; si no → ofrecer registrarlo (pasa al paso de rutina).
async function resolverInventarioEnSede(
  db: Firestore,
  usuario: Usuario,
  telefono: string,
  alta: AltaEquipo,
  inv: string,
  ahora: Date,
  prefijo = ''
): Promise<string> {
  void usuario;
  void ahora;
  const equipo = await buscarEquipoEnSede(db, alta.sedeId!, inv);
  if (equipo) {
    const desc = equipo.descripcion ? ` — _${equipo.descripcion}_` : '';
    await guardarAlta(db, telefono, {
      ...alta,
      noInventario: inv,
      equipoId: equipo.id,
      descripcion: equipo.descripcion ?? undefined,
      paso: 'equipo_confirmar',
    });
    return `${prefijo}✅ Encontré el equipo *${inv}*${desc} en *${alta.sedeNombre}*. ¿Es este? Responde *sí* para elegir la rutina, o *no*.`;
  }
  await guardarAlta(db, telefono, { ...alta, noInventario: inv, paso: 'equipo_desc' });
  return `${prefijo}No tengo el equipo *${inv}* en *${alta.sedeNombre}*. Para darlo de alta, mándame una *breve descripción* del equipo (ej. "UPS APC 3kVA") _(o escribe *no* para cancelar)_.`;
}

// Cuando la rutina ACABA de pasar a la etapa de firma (terminó el último paso),
// añade el enlace del reporte para que el técnico lo revise antes de firmar.
function conEnlaceAlFirmar(
  respuesta: string,
  ejecucionId: string,
  etapaAntes: string | undefined,
  etapaDespues: string | undefined,
  construirEnlace?: (ejecucionId: string) => string
): string {
  if (construirEnlace && etapaDespues === 'firma' && etapaAntes !== 'firma') {
    return `${respuesta}\n\n📄 *Así quedó tu reporte* — revísalo aquí. Si todo está bien, presiona el botón *Aprobar* y te envío el PDF:\n${construirEnlace(ejecucionId)}`;
  }
  return respuesta;
}

// Punto de entrada para TEXTO de un técnico. Devuelve el texto de respuesta, o
// null si no hay nada del flujo de rutinas que atender (para caer al menú).
export async function manejarTextoRutina(
  db: Firestore,
  usuario: Usuario,
  telefono: string,
  texto: string,
  ahora: Date,
  // Clasificador IA opcional (inyectado por el webhook, que tiene la API key):
  // entiende CUALQUIER redacción cuando el reconocimiento por palabras no basta.
  clasificar?: (texto: string) => Promise<{ quiereIniciar: boolean; numeroSerie: string | null }>,
  // Intérprete IA de cada paso del alta (cliente/sede/rutina/confirmar).
  interpretar?: InterpretarAlta,
  // Arma el enlace firmado del reporte (lo inyecta el webhook). Se manda solo al
  // llegar a la etapa de firma, para que el técnico vea cómo quedó su reporte.
  construirEnlaceReporte?: (ejecucionId: string) => string
): Promise<string | null> {
  const activa = await buscarEjecucionActiva(db, telefono);
  if (activa) {
    // Oportunidad comercial (en cualquier momento): no avanza el paso.
    const opo = texto.match(RE_OPORTUNIDAD);
    if (opo && opo[1].trim()) {
      return await registrarOportunidad(db, activa, opo[1].trim());
    }
    // En la etapa de FIRMA (ya terminó los pasos), si el técnico manda un nº de
    // inventario suelto = quiere arrancar OTRA rutina. Cerramos la anterior
    // (pasos listos; la firma queda pendiente para subirla en el portal) y
    // arrancamos la nueva, para no dejarlo atorado en la firma.
    const t0 = texto.trim();
    if (activa.ejec.etapa === 'firma' && /^[A-Za-z0-9][A-Za-z0-9\-_/]{1,30}$/.test(t0) && /\d/.test(t0)) {
      await db.doc(`rutinas_ejecucion/${activa.id}`).set(
        { estatus: 'completada', fin: FieldValue.serverTimestamp() },
        { merge: true }
      );
      const arranque = await iniciarAltaGuiada(db, telefono, t0);
      return `📋 La rutina anterior quedó lista (su firma queda *pendiente*; la puedes subir desde el portal).\n\n${arranque}`;
    }
    const plantilla = await cargarPlantilla(db, activa.ejec.rutinaId);
    if (!plantilla) return 'No pude cargar la rutina en curso. Avísale a la oficina.';
    const etapaAntes = activa.ejec.etapa;
    const r = avanzarEjecucion(activa.ejec, plantilla, { clase: 'texto', texto }, ahora);
    await persistir(db, activa.id, r.ejec);
    return conEnlaceAlFirmar(r.respuesta, activa.id, etapaAntes, r.ejec.etapa, construirEnlaceReporte);
  }
  // ¿Hay un alta/arranque de rutina a medias? Cada texto avanza esa máquina
  // (cliente → sede → inventario → …). Aplica a CUALQUIER rol: si ya está creando
  // una rutina, sigue el flujo (no lo mandamos a Portteo a media captura).
  const alta = await leerAlta(db, telefono);
  if (alta) {
    return await manejarAltaEquipo(db, usuario, telefono, texto, alta, ahora, interpretar);
  }
  // Arrancar una rutina NUEVA (sin ejecución ni alta en curso):
  // - El técnico (trabajador) arranca flexible: nombre de cliente, nº de serie o "iniciar".
  // - El administrador (dueño / superAdmin) TAMBIÉN puede hacer rutinas, pero SOLO con
  //   un disparador explícito ("rutina"), para no chocar con sus consultas de cotización
  //   (un nombre de cliente suelto es para Portteo, no para arrancar una rutina).
  // - Los demás roles (secretaria) no arrancan rutinas por aquí.
  if (usuario.rol !== 'trabajador') {
    const esAdmin = usuario.rol === 'superAdmin' || usuario.rol === 'dueno';
    if (esAdmin && /\brutinas?\b/i.test(texto)) return await iniciarAltaGuiada(db, telefono);
    return null;
  }
  // Arranque: SIEMPRE empezamos preguntando el cliente (no buscamos por serie de
  // entrada, porque el mismo número puede repetirse entre clientes/sedes). Si el
  // técnico ya mandó un nº de inventario, lo recordamos para no repreguntarlo.
  const inventario = extraerInventario(texto);
  if (inventario) {
    return await iniciarAltaGuiada(db, telefono, inventario);
  }
  // ¿El mensaje ES (o trae) el NOMBRE de un cliente? El menú invita a escribirlo.
  // Quitamos rellenos ("cliente", "es", "el/la"…) para que "cliente microsoift"
  // empate. Si hay algún parecido, arrancamos el flujo tomándolo como el cliente
  // (el paso de cliente ofrece opciones si es typo, o pide contactar al admin).
  const posibleCliente = limpiarPosibleCliente(texto);
  // El técnico enmarcó su mensaje como un cliente ("cliente X", "es para X"…):
  // entramos al flujo aunque no haya match, para poder decirle "contacta al admin".
  const enmarcadoCliente = /^\s*(cliente|es\s+(el|la|para|de)|para\s+(el|la)|(la\s+)?empresa)\b/i.test(texto);
  if (posibleCliente.length >= 3) {
    const cands = await buscarClientes(db, posibleCliente);
    if (cands.length || enmarcadoCliente) {
      const nueva: AltaEquipo = { paso: 'cliente' };
      await guardarAlta(db, telefono, nueva);
      return await manejarAltaEquipo(db, usuario, telefono, posibleCliente, nueva, ahora, interpretar);
    }
  }
  // Sin cliente reconocido: dejamos que la IA decida si quiere arrancar una rutina.
  if (clasificar) {
    try {
      const r = await clasificar(texto);
      if (r.quiereIniciar) return await iniciarAltaGuiada(db, telefono, r.numeroSerie ?? undefined);
    } catch {
      // Si la IA falla, caemos a lo de abajo (mejor que nada).
    }
  }
  // Respaldo sin IA: intención por palabras clave.
  if (RE_SENAL_RUTINA.test(texto)) return await iniciarAltaGuiada(db, telefono);
  return null;
}

// Quita rellenos iniciales para aislar el posible nombre de cliente:
// "cliente microsoift" → "microsoift", "es la empresa coca" → "coca".
function limpiarPosibleCliente(texto: string): string {
  let s = texto.trim();
  const relleno = /^(hola|buenas|el|la|los|las|del|de|es|son|para|con|cliente|clientes|empresa|compania|compañia|un|una|mi)\b[\s,:.\-]*/i;
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(relleno, '');
  }
  return s.trim();
}

// Punto de entrada para FOTO de un técnico con ejecución activa. Asocia la foto
// al paso actual y avanza. Devuelve { respuesta, equipoId, reporteId, paso }
// para guardar la foto bajo la ruta del equipo. null si no hay ejecución activa.
export async function manejarFotoRutina(
  db: Firestore,
  telefono: string,
  url: string,
  ahora: Date,
  construirEnlaceReporte?: (ejecucionId: string) => string
): Promise<{ respuesta: string } | null> {
  const activa = await buscarEjecucionActiva(db, telefono);
  if (!activa) return null;
  const plantilla = await cargarPlantilla(db, activa.ejec.rutinaId);
  if (!plantilla) return { respuesta: 'No pude cargar la rutina en curso.' };
  const etapaAntes = activa.ejec.etapa;
  const r = avanzarEjecucion(activa.ejec, plantilla, { clase: 'foto', url }, ahora);
  await persistir(db, activa.id, r.ejec);
  return { respuesta: conEnlaceAlFirmar(r.respuesta, activa.id, etapaAntes, r.ejec.etapa, construirEnlaceReporte) };
}

// Para asociar la foto a la ruta equipo→reporte→paso al subirla a Storage.
export async function contextoEjecucionActiva(
  db: Firestore,
  telefono: string
): Promise<{ equipoId: string; reporteId: string; paso: number } | null> {
  const activa = await buscarEjecucionActiva(db, telefono);
  if (!activa) return null;
  // En la etapa de firma pasoActual es undefined; usamos 0 (carpeta "firma").
  return { equipoId: activa.ejec.equipoId, reporteId: activa.id, paso: activa.ejec.pasoActual ?? 0 };
}
