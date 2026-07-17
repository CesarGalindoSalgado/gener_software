import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import { calcularTotales } from '../dominio/totales';
import { siguienteRev } from '../dominio/folio';
import { Partida } from '../dominio/tipos';

// Servicios de dominio sobre Firestore (Admin SDK). Los invoca el ejecutor de
// herramientas del agente y las Cloud Functions callables. Toda escritura del
// sistema pasa por aquí — los clientes web solo leen (reglas).

export interface RefsBorrador {
  cotizacionId: string;
  versionId: string;
}

async function obtenerOCrearCliente(db: Firestore, nombre: string): Promise<string> {
  const limpio = nombre.trim();
  const q = await db.collection('clientes').where('nombre', '==', limpio).limit(1).get();
  if (!q.empty) return q.docs[0].id;
  const ref = await db.collection('clientes').add({ nombre: limpio });
  return ref.id;
}

// Da de alta un cliente solo con el nombre (idempotente: si ya existe, lo reusa).
// Portteo la usa para registrar al cliente en cuanto el usuario confirma, sin
// necesitar todavía el asunto de la cotización.
export async function registrarCliente(db: Firestore, nombre: string): Promise<{ clienteId: string; nombre: string }> {
  const n = (nombre ?? '').trim();
  if (!n) throw new Error('El cliente necesita un nombre.');
  const clienteId = await obtenerOCrearCliente(db, n);
  return { clienteId, nombre: n };
}

// Lista TODOS los clientes (nombres, ordenados). La usa Portteo cuando piden
// "dame la lista de mis clientes".
export async function listarClientes(db: Firestore): Promise<{ nombre: string }[]> {
  const snap = await db.collection('clientes').limit(1000).get();
  return snap.docs
    .map((d) => ({ nombre: String(d.get('nombre') ?? '') }))
    .filter((c) => c.nombre)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Distancia de edición (Levenshtein) para tolerar errores de dedo.
function distanciaEdicion(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Busca clientes por nombre, TOLERANTE a errores de dedo (sin acentos/mayúsculas).
// La usa Portteo para ofrecer coincidencias antes de crear un cliente nuevo.
// Devuelve candidatos ordenados por parecido; incluye si es parecido aunque no
// sea substring (ej. "liberppol" → "Liverpool").
export async function buscarClientes(
  db: Firestore,
  texto: string
): Promise<{ id: string; nombre: string; exacta: boolean; contiene: boolean; score: number }[]> {
  const t = normClaveNombre(texto);
  if (!t) return [];
  const snap = await db.collection('clientes').limit(500).get();
  return snap.docs
    .map((d) => {
      const nombre = String(d.get('nombre') ?? '');
      const n = normClaveNombre(nombre);
      // exacta = MISMAS letras (ignorando mayúsculas/acentos/puntuación).
      // contiene = uno es subcadena del otro ("coca" ⊂ "coca cola") → alta confianza.
      // Si no, parecido por distancia de edición (typos: "microsoift" ≈ "microsoft").
      const contiene = n !== t && (n.includes(t) || t.includes(n));
      let score: number;
      if (n === t) score = 1;
      else if (contiene) score = 0.9;
      else score = 1 - distanciaEdicion(t, n) / Math.max(t.length, n.length);
      return { id: d.id, nombre, score, contiene };
    })
    .filter((c) => c.score >= 0.6) // umbral: parecido razonable, tolera 1-3 typos
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ id, nombre, score, contiene }) => ({ id, nombre, exacta: score === 1, contiene, score }));
}

// Clave para comparar nombres: minúsculas, sin acentos, y con guiones/puntos/
// comas colapsados a espacios (así "Coca-Cola FEMSA" y "coca cola femsa" empatan).
function normClaveNombre(s: unknown): string {
  return normalizarTexto(s).replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function crearBorrador(
  db: Firestore,
  params: { clienteNombre: string; titulo: string; creadoPor: string; atencion?: string }
): Promise<RefsBorrador> {
  // El nombre puede venir vacío: el borrador arranca "en blanco" y Portteo pide
  // cliente/asunto/dirigida a en el chat.
  const nombre = (params.clienteNombre ?? '').trim();
  const clienteId = nombre ? await obtenerOCrearCliente(db, nombre) : null;
  const cliente = clienteId ? (await db.doc(`clientes/${clienteId}`).get()).data() ?? { nombre } : null;

  const cotRef = await db.collection('cotizaciones').add({
    folio: null,
    clienteId,
    // Snapshot denormalizado para render directo en el taller
    cliente: {
      nombre: cliente?.nombre ?? nombre,
      atencion: params.atencion?.trim() || cliente?.atencion || null,
      telefono: cliente?.telefono ?? null,
      correo: cliente?.correo ?? null,
    },
    titulo: params.titulo ?? '',
    estatus: 'borrador',
    revActual: 'A',
    subtotal: 0,
    iva: 0,
    total: 0, // denormalizado (se actualiza al mutar bloques); para el Dashboard
    fechaCreacion: FieldValue.serverTimestamp(),
    creadoPor: params.creadoPor,
  });

  const verRef = await cotRef.collection('versiones').add({
    rev: 'A',
    estatus: 'borrador',
    partidas: [],
    subtotal: 0,
    iva: 0,
    total: 0,
    // Forma de pago VACÍA en una cotización nueva (aunque el cliente tenga una
    // previa): el usuario captura ahí los porcentajes de anticipo/contra entrega
    // (ej. "70% anticipo / 30% entrega"), que se validan al aprobar. Solo en
    // copias se hereda la del origen (ver clonarComoBase).
    formaPago: '',
    // Vacío: el documento siempre añade "según disponibilidad de refacciones"
    // como sufijo fijo, así que una cotización nueva ya lo muestra solo.
    tiempoEntrega: '',
    notas: '', // Notas VACÍAS en una cotización nueva; el usuario las agrega.
    fecha: FieldValue.serverTimestamp(),
  });

  await cotRef.update({ versionActualId: verRef.id });
  return { cotizacionId: cotRef.id, versionId: verRef.id };
}

// Muta las partidas de una versión con recálculo de totales, en transacción.
export async function mutarPartidas(
  db: Firestore,
  refs: RefsBorrador,
  mutacion: (partidas: Partida[]) => Partida[]
): Promise<{ partidas: Partida[]; subtotal: number; iva: number; total: number }> {
  const verRef = db.doc(`cotizaciones/${refs.cotizacionId}/versiones/${refs.versionId}`);
  const cotRef = db.doc(`cotizaciones/${refs.cotizacionId}`);
  return db.runTransaction(async (tx) => {
    // Todas las lecturas antes de las escrituras (regla de transacciones).
    const snap = await tx.get(verRef);
    if (!snap.exists) throw new Error('No existe la versión de la cotización.');
    const cotSnap = await tx.get(cotRef);
    const actuales = (snap.data()!.partidas ?? []) as Partida[];
    const nuevas = mutacion(actuales);
    const totales = calcularTotales(nuevas);
    tx.update(verRef, { partidas: nuevas, ...totales });
    // Denormaliza el total en la cotización (para el Dashboard) solo si esta es
    // la versión vigente; así el monto del doc refleja siempre lo que se ve.
    if (cotSnap.exists && cotSnap.get('versionActualId') === refs.versionId) {
      tx.update(cotRef, { subtotal: totales.subtotal, iva: totales.iva, total: totales.total });
    }
    return { partidas: nuevas, ...totales };
  });
}

export async function agregarBloque(
  db: Firestore,
  refs: RefsBorrador,
  bloque: { titulo: string; lineas?: string[]; cantidad?: number; importe: number }
) {
  return mutarPartidas(db, refs, (partidas) => [
    ...partidas,
    {
      titulo: bloque.titulo,
      lineas: bloque.lineas ?? [],
      cantidad: bloque.cantidad && bloque.cantidad > 0 ? bloque.cantidad : 1,
      importe: bloque.importe,
    },
  ]);
}

export async function ajustarPrecioBloque(
  db: Firestore,
  refs: RefsBorrador,
  indice: number,
  nuevoImporte: number
) {
  return mutarPartidas(db, refs, (partidas) => {
    if (indice < 0 || indice >= partidas.length) {
      throw new Error(`No existe el bloque ${indice + 1} (hay ${partidas.length}).`);
    }
    const copia = [...partidas];
    copia[indice] = { ...copia[indice], importe: nuevoImporte };
    return copia;
  });
}

export async function quitarBloque(db: Firestore, refs: RefsBorrador, indice: number) {
  return mutarPartidas(db, refs, (partidas) => {
    if (indice < 0 || indice >= partidas.length) {
      throw new Error(`No existe el bloque ${indice + 1} (hay ${partidas.length}).`);
    }
    return partidas.filter((_, i) => i !== indice);
  });
}

// --- Líneas (renglones de alcance) dentro de un bloque ---
// Todos los índices llegan 0-based; el bloque/renglón "1" del usuario ya se
// convirtió afuera. Validan que el bloque y el renglón existan.
function bloqueEn(partidas: Partida[], indice: number): Partida {
  if (indice < 0 || indice >= partidas.length) {
    throw new Error(`No existe el bloque ${indice + 1} (hay ${partidas.length}).`);
  }
  return partidas[indice];
}

export async function agregarLineaBloque(db: Firestore, refs: RefsBorrador, indice: number, texto: string) {
  return mutarPartidas(db, refs, (partidas) => {
    const p = bloqueEn(partidas, indice);
    const copia = [...partidas];
    copia[indice] = { ...p, lineas: [...(p.lineas ?? []), texto] };
    return copia;
  });
}

export async function editarLineaBloque(
  db: Firestore,
  refs: RefsBorrador,
  indice: number,
  lineaIdx: number,
  texto: string
) {
  return mutarPartidas(db, refs, (partidas) => {
    const p = bloqueEn(partidas, indice);
    const lineas = [...(p.lineas ?? [])];
    if (lineaIdx < 0 || lineaIdx >= lineas.length) {
      throw new Error(`El bloque ${indice + 1} no tiene el renglón ${lineaIdx + 1} (tiene ${lineas.length}).`);
    }
    lineas[lineaIdx] = texto;
    const copia = [...partidas];
    copia[indice] = { ...p, lineas };
    return copia;
  });
}

export async function quitarLineaBloque(db: Firestore, refs: RefsBorrador, indice: number, lineaIdx: number) {
  return mutarPartidas(db, refs, (partidas) => {
    const p = bloqueEn(partidas, indice);
    const lineas = p.lineas ?? [];
    if (lineaIdx < 0 || lineaIdx >= lineas.length) {
      throw new Error(`El bloque ${indice + 1} no tiene el renglón ${lineaIdx + 1} (tiene ${lineas.length}).`);
    }
    const copia = [...partidas];
    copia[indice] = { ...p, lineas: lineas.filter((_, i) => i !== lineaIdx) };
    return copia;
  });
}

// Lee las partidas actuales (para que el agente sepa los números de bloque/renglón).
export async function leerPartidas(db: Firestore, refs: RefsBorrador): Promise<Partida[]> {
  const snap = await db.doc(`cotizaciones/${refs.cotizacionId}/versiones/${refs.versionId}`).get();
  return (snap.data()?.partidas ?? []) as Partida[];
}

export async function actualizarDatos(
  db: Firestore,
  refs: RefsBorrador,
  datos: { titulo?: string; formaPago?: string; tiempoEntrega?: string; notas?: string; atencion?: string; clienteNombre?: string }
) {
  const cotRef = db.doc(`cotizaciones/${refs.cotizacionId}`);
  const verRef = db.doc(`cotizaciones/${refs.cotizacionId}/versiones/${refs.versionId}`);

  const cotUpdate: Record<string, unknown> = {};
  if (datos.titulo) cotUpdate.titulo = datos.titulo;
  if (datos.atencion !== undefined) cotUpdate['cliente.atencion'] = datos.atencion;
  // Fijar/cambiar el cliente: lo resuelve o registra en la colección `clientes`.
  if (datos.clienteNombre && datos.clienteNombre.trim()) {
    const clienteId = await obtenerOCrearCliente(db, datos.clienteNombre.trim());
    cotUpdate.clienteId = clienteId;
    cotUpdate['cliente.nombre'] = datos.clienteNombre.trim();
  }
  if (Object.keys(cotUpdate).length) await cotRef.update(cotUpdate);

  const verUpdate: Record<string, unknown> = {};
  if (datos.formaPago) verUpdate.formaPago = datos.formaPago;
  if (datos.tiempoEntrega) verUpdate.tiempoEntrega = datos.tiempoEntrega;
  if (datos.notas !== undefined) verUpdate.notas = datos.notas; // permite vaciarlas también
  if (Object.keys(verUpdate).length) await verRef.update(verUpdate);

  return { ok: true, actualizado: { ...cotUpdate, ...verUpdate } };
}

export async function consultarCotizaciones(
  db: Firestore,
  filtro: { folio?: string; cliente?: string; orden?: 'reciente' | 'antigua' }
): Promise<unknown[]> {
  const dir = filtro.orden === 'antigua' ? 'asc' : 'desc'; // antigua = ascendente
  let docs: FirebaseFirestore.QueryDocumentSnapshot[];
  if (filtro.folio) {
    docs = (await db.collection('cotizaciones').where('folio', '==', filtro.folio.trim().toUpperCase()).limit(5).get()).docs;
  } else if (filtro.cliente) {
    // Por cliente: match tolerante a mayúsculas/acentos (Firestore no lo hace en
    // la query). Ordena por fecha según el criterio y filtra en memoria;
    // "microsoft" empata con "Microsoft". El primero es "la última"/"la primera".
    const objetivo = normalizarTexto(filtro.cliente);
    const snap = await db.collection('cotizaciones').orderBy('fechaCreacion', dir).limit(400).get();
    docs = snap.docs
      .filter((d) => {
        const n = normalizarTexto((d.data().cliente as { nombre?: string })?.nombre);
        return n === objetivo || n.includes(objetivo) || objetivo.includes(n);
      })
      .slice(0, 10);
  } else {
    docs = (await db.collection('cotizaciones').orderBy('fechaCreacion', dir).limit(10).get()).docs;
  }
  return docs.map((d) => {
    const c = d.data();
    return {
      cotizacionId: d.id,
      versionId: c.versionActualId, // para poder renderizarla en el taller
      folio: c.folio,
      cliente: c.cliente?.nombre,
      titulo: c.titulo,
      estatus: c.estatus,
      rev: c.revActual,
    };
  });
}

// Normaliza texto para comparar clientes sin importar mayúsculas ni acentos.
function normalizarTexto(s: unknown): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Resuelve el id de la cotización ORIGEN. Acepta un id directo o el NOMBRE del
// cliente (más confiable: los LLM garabotean los ids largos). Por cliente,
// devuelve la MÁS RECIENTE (o la MÁS ANTIGUA si orden='antigua'). Tolerante a
// mayúsculas/acentos.
export async function resolverCotizacionOrigen(
  db: Firestore,
  ref: { cotizacionId?: string; folio?: string; cliente?: string; orden?: 'reciente' | 'antigua' }
): Promise<string | null> {
  if (ref.cotizacionId) {
    const snap = await db.doc(`cotizaciones/${ref.cotizacionId}`).get();
    if (snap.exists) return snap.id;
  }
  if (ref.folio) {
    const snap = await db
      .collection('cotizaciones')
      .where('folio', '==', ref.folio.trim().toUpperCase())
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0].id;
  }
  if (ref.cliente) {
    const objetivo = normalizarTexto(ref.cliente);
    const snap = await db.collection('cotizaciones').limit(800).get();
    const docs = snap.docs.filter((d) => {
      const n = normalizarTexto((d.data().cliente as { nombre?: string })?.nombre);
      return n === objetivo || n.includes(objetivo) || objetivo.includes(n);
    });
    if (!docs.length) return null;
    const asc = ref.orden === 'antigua';
    docs.sort((a, b) => {
      const ta = a.get('fechaCreacion')?.toMillis?.() ?? 0;
      const tb = b.get('fechaCreacion')?.toMillis?.() ?? 0;
      return asc ? ta - tb : tb - ta; // antigua = ascendente; reciente = descendente
    });
    return docs[0].id;
  }
  return null;
}

// Vista PREVIA (solo lectura, sin guardar nada) de una cotización existente,
// para mostrarla en el panel antes de decidir si se usa de base.
export async function datosPreviewCotizacion(
  db: Firestore,
  params: { cotizacionId?: string; folio?: string; cliente?: string; orden?: 'reciente' | 'antigua' }
): Promise<{
  cotizacionId: string;
  folio: string | null;
  titulo: string;
  cliente: { nombre: string; atencion: string | null; telefono: string | null; correo: string | null };
  rev: string;
  fecha: string;
  partidas: Partida[];
  formaPago: string | null;
  tiempoEntrega: string | null;
  notas: string | null;
} | null> {
  const id = await resolverCotizacionOrigen(db, params);
  if (!id) return null;
  const cotSnap = await db.doc(`cotizaciones/${id}`).get();
  const cot = cotSnap.data() ?? {};
  const verSnap = await db.doc(`cotizaciones/${id}/versiones/${cot.versionActualId}`).get();
  const ver = verSnap.data() ?? {};
  const cli = (cot.cliente ?? {}) as { nombre?: string; atencion?: string; telefono?: string; correo?: string };
  return {
    cotizacionId: id,
    folio: (cot.folio as string | null) ?? null,
    titulo: (cot.titulo as string) ?? '',
    cliente: { nombre: cli.nombre ?? '', atencion: cli.atencion ?? null, telefono: cli.telefono ?? null, correo: cli.correo ?? null },
    rev: (ver.rev as string) ?? 'A',
    fecha: (ver.fecha?.toDate?.() ?? new Date()).toISOString(),
    partidas: (ver.partidas ?? []) as Partida[],
    formaPago: (ver.formaPago as string | null) ?? null,
    tiempoEntrega: (ver.tiempoEntrega as string | null) ?? null,
    notas: (ver.notas as string | null) ?? null,
  };
}

export async function clonarComoBase(
  db: Firestore,
  params: { cotizacionId?: string; folio?: string; cliente?: string; clienteNombre?: string; orden?: 'reciente' | 'antigua'; creadoPor: string }
): Promise<RefsBorrador & { origen: { cliente: string; titulo: string; folio: string | null } }> {
  const origenId = await resolverCotizacionOrigen(db, params);
  if (!origenId) throw new Error('No encontré una cotización de ese cliente para usar de base.');
  const origenSnap = await db.doc(`cotizaciones/${origenId}`).get();
  const origen = origenSnap.data()!;
  const verSnap = await db
    .doc(`cotizaciones/${origenId}/versiones/${origen.versionActualId}`)
    .get();
  const verOrigen = verSnap.data() ?? { partidas: [] };

  // Nuevo borrador. El cliente destino: el que indique el usuario o, por
  // defecto, el mismo de la cotización origen.
  const refs = await crearBorrador(db, {
    clienteNombre: (params.clienteNombre || (origen.cliente as { nombre?: string })?.nombre) ?? '',
    titulo: origen.titulo,
    creadoPor: params.creadoPor,
  });

  const partidas = (verOrigen.partidas ?? []) as Partida[];
  if (partidas.length) {
    await mutarPartidas(db, refs, () => partidas);
  }
  // En COPIAS se hereda la forma de pago del origen (con sus porcentajes de
  // anticipo/contra entrega), a diferencia de una cotización 100% nueva que va vacía.
  if (verOrigen.formaPago) {
    await db.doc(`cotizaciones/${refs.cotizacionId}/versiones/${refs.versionId}`).update({
      formaPago: verOrigen.formaPago as string,
    });
  }
  return {
    ...refs,
    origen: {
      cliente: (origen.cliente as { nombre?: string })?.nombre ?? '',
      titulo: (origen.titulo as string) ?? '',
      folio: (origen.folio as string | null) ?? null,
    },
  };
}

// Copia TODAS las partidas de una cotización origen y las AGREGA a la cotización
// que se está editando ahora (refs). No crea nada nuevo: engorda la actual.
export async function copiarBloquesEnActual(
  db: Firestore,
  refs: RefsBorrador,
  origen: { cotizacionId?: string; cliente?: string }
): Promise<{ agregados: number; subtotal: number; iva: number; total: number }> {
  const origenId = await resolverCotizacionOrigen(db, origen);
  if (!origenId) throw new Error('No encontré la cotización origen (verifica el nombre del cliente).');
  const origenSnap = await db.doc(`cotizaciones/${origenId}`).get();
  const origenData = origenSnap.data()!;
  const verSnap = await db.doc(`cotizaciones/${origenId}/versiones/${origenData.versionActualId}`).get();
  const partidasOrigen = (verSnap.data()?.partidas ?? []) as Partida[];
  if (!partidasOrigen.length) throw new Error('La cotización origen no tiene partidas que copiar.');
  const res = await mutarPartidas(db, refs, (actuales) => [...actuales, ...partidasOrigen]);
  return { agregados: partidasOrigen.length, subtotal: res.subtotal, iva: res.iva, total: res.total };
}

// Crea una revisión (Rev. B, C…) de una cotización YA enviada: copia las
// partidas de la versión actual a una versión nueva, avanza revActual y regresa
// la cotización a 'borrador' para editarla. El FOLIO NO CAMBIA. Al re-aprobar,
// aprobarCotizacion no consume folio nuevo.
export async function crearRevision(
  db: Firestore,
  cotizacionId: string
): Promise<{ versionId: string; rev: string }> {
  const cotRef = db.doc(`cotizaciones/${cotizacionId}`);
  const cotSnap = await cotRef.get();
  if (!cotSnap.exists) throw new Error('No existe la cotización.');
  const cot = cotSnap.data()!;

  if (!cot.folio) {
    throw new Error('Solo se puede revisar una cotización ya enviada (con folio).');
  }
  if (!['enviada', 'rechazada'].includes(cot.estatus)) {
    throw new Error(`No se puede crear una revisión desde estatus "${cot.estatus}".`);
  }

  const verActualSnap = await db.doc(`cotizaciones/${cotizacionId}/versiones/${cot.versionActualId}`).get();
  const v = verActualSnap.data() ?? { partidas: [] };
  const nuevaRev = siguienteRev(cot.revActual ?? 'A');

  const nuevaVerRef = await cotRef.collection('versiones').add({
    rev: nuevaRev,
    estatus: 'borrador',
    partidas: (v.partidas ?? []) as Partida[],
    subtotal: v.subtotal ?? 0,
    iva: v.iva ?? 0,
    total: v.total ?? 0,
    formaPago: v.formaPago ?? '',
    tiempoEntrega: v.tiempoEntrega ?? '',
    fecha: FieldValue.serverTimestamp(),
  });

  // Mismo folio; vuelve a borrador; apunta a la nueva versión.
  await cotRef.update({
    versionActualId: nuevaVerRef.id,
    revActual: nuevaRev,
    estatus: 'borrador',
  });

  return { versionId: nuevaVerRef.id, rev: nuevaRev };
}

export async function buscarHistorico(
  db: Firestore,
  filtro: { cliente?: string; concepto: string }
): Promise<unknown[]> {
  // Filtra por cliente si viene; el match fino del concepto lo hace el LLM
  // sobre los resultados. Ordena por fecha desc para que lo más reciente
  // (lo "último cobrado") quede primero.
  const col = db.collection('precios_historicos');
  let q;
  try {
    q = filtro.cliente
      ? await col.where('clienteNombre', '==', filtro.cliente.trim()).orderBy('fecha', 'desc').limit(25).get()
      : await col.orderBy('fecha', 'desc').limit(25).get();
  } catch {
    // Si falta el índice compuesto, cae a consulta simple sin ordenar.
    q = filtro.cliente
      ? await col.where('clienteNombre', '==', filtro.cliente.trim()).limit(25).get()
      : await col.limit(25).get();
  }
  return q.docs.map((d) => {
    const p = d.data();
    return {
      concepto: p.concepto,
      precio: p.precio,
      cliente: p.clienteNombre,
      equipo: p.equipo ?? null,
      fecha: p.fecha?.toDate?.()?.toISOString?.() ?? null,
      folio: p.folio ?? null,
    };
  });
}

// Cotizaciones ENVIADAS sin cerrar (esperando respuesta del cliente), con su
// antigüedad en días. Para consultas de seguimiento por chat.
export async function consultarSeguimiento(db: Firestore): Promise<unknown[]> {
  const snap = await db.collection('cotizaciones').where('estatus', '==', 'enviada').limit(50).get();
  const hoy = Date.now();
  return snap.docs.map((d) => {
    const c = d.data();
    const env = c.fechaEnvio?.toDate?.();
    const dias = env ? Math.floor((hoy - env.getTime()) / 86400000) : null;
    return {
      folio: c.folio ?? null,
      cliente: c.cliente?.nombre ?? null,
      asunto: c.titulo ?? null,
      diasDesdeEnvio: dias,
    };
  });
}

export async function crearRecordatorio(
  db: Firestore,
  params: { correo: string; descripcion: string; clienteTexto?: string }
) {
  const ref = await db.collection('recordatorios').add({
    duenoCorreo: params.correo,
    descripcion: params.descripcion,
    clienteTexto: params.clienteTexto ?? null,
    estatus: 'pendiente',
    fechaCreacion: FieldValue.serverTimestamp(),
  });
  return { recordatorioId: ref.id };
}

// ---------- Plantillas de servicio ----------

export async function listarPlantillas(db: Firestore): Promise<unknown[]> {
  const q = await db.collection('plantillas').where('activa', '==', true).get();
  return q.docs.map((d) => {
    const p = d.data();
    return {
      plantillaId: d.id,
      nombre: p.nombre,
      precioSugerido: p.precioSugerido ?? null,
      tieneSubtipos: !!p.tieneSubtipos,
      subtipos: (p.subtipos ?? []) as { nombre: string; precio: number }[],
      lineas: p.lineas ?? [],
    };
  });
}

// Inserta una plantilla como bloque en la versión en edición. El precio viene
// del argumento (dictado por el usuario o el precioSugerido de la plantilla);
// si no hay precio, se inserta en 0 y Portteo debe pedirlo.
export async function agregarDesdePlantilla(
  db: Firestore,
  refs: RefsBorrador,
  params: { nombre?: string; plantillaId?: string; importe?: number; subtipo?: string }
) {
  // Match tolerante: ignora mayúsculas y acentos, y acepta coincidencia parcial.
  const norm = (s: unknown) =>
    String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  let plantilla: FirebaseFirestore.DocumentData | undefined;
  if (params.plantillaId) {
    const snap = await db.doc(`plantillas/${params.plantillaId}`).get();
    plantilla = snap.data();
  } else if (params.nombre) {
    const objetivo = norm(params.nombre);
    const q = await db.collection('plantillas').where('activa', '==', true).get();
    const docs = q.docs.map((d) => ({ data: d.data(), n: norm(d.data().nombre) }));
    const hit =
      docs.find((x) => x.n === objetivo) ??
      docs.find((x) => x.n.includes(objetivo) || objetivo.includes(x.n));
    plantilla = hit?.data;
  }
  if (!plantilla) throw new Error('No se encontró la plantilla indicada.');

  const subtipos = (plantilla.subtipos ?? []) as { nombre: string; precio: number }[];
  const tieneSubtipos = !!plantilla.tieneSubtipos && subtipos.length > 0;

  // Con subtipos: hay que elegir uno (define el precio y el nombre del concepto).
  if (tieneSubtipos) {
    const objetivoSub = norm(params.subtipo);
    const sub = objetivoSub
      ? subtipos.find((s) => norm(s.nombre) === objetivoSub) ??
        subtipos.find((s) => norm(s.nombre).includes(objetivoSub) || objetivoSub.includes(norm(s.nombre)))
      : undefined;
    if (!sub) {
      const lista = subtipos.map((s) => `${s.nombre} ($${s.precio})`).join(', ');
      throw new Error(`La plantilla "${plantilla.nombre}" tiene varios tipos; dime cuál usar: ${lista}.`);
    }
    const importe = params.importe ?? sub.precio ?? 0;
    return agregarBloque(db, refs, {
      titulo: `${plantilla.nombre} — ${sub.nombre}`,
      lineas: plantilla.lineas ?? [],
      cantidad: 1,
      importe,
    });
  }

  // Sin subtipos: precio único (como siempre).
  const importe = params.importe ?? plantilla.precioSugerido ?? 0;
  return agregarBloque(db, refs, {
    titulo: plantilla.nombre,
    lineas: plantilla.lineas ?? [],
    cantidad: 1,
    importe,
  });
}

// Mensajería del chat del taller (subcolección de la cotización)
export async function guardarMensajeChat(
  db: Firestore,
  cotizacionId: string,
  mensaje: { rol: 'usuario' | 'portteo'; texto: string; correo?: string }
) {
  await db.collection(`cotizaciones/${cotizacionId}/chat`).add({
    ...mensaje,
    fecha: Timestamp.now(),
  });
}

export async function leerHistorialChat(
  db: Firestore,
  cotizacionId: string,
  limite = 30
): Promise<{ rol: 'usuario' | 'portteo'; texto: string }[]> {
  const q = await db
    .collection(`cotizaciones/${cotizacionId}/chat`)
    .orderBy('fecha', 'desc')
    .limit(limite)
    .get();
  return q.docs
    .map((d) => d.data() as { rol: 'usuario' | 'portteo'; texto: string })
    .reverse();
}

// Backfill de montos: copia el total de la versión vigente a cada cotización que
// no lo tenga denormalizado (para el Dashboard). Idempotente; devuelve cuántas
// actualizó. Se corre una vez tras introducir el campo `total` en la cotización.
export async function backfillTotalesCotizaciones(db: Firestore): Promise<{ actualizadas: number; total: number }> {
  const snap = await db.collection('cotizaciones').get();
  let actualizadas = 0;
  for (const doc of snap.docs) {
    const c = doc.data();
    if (typeof c.total === 'number') continue; // ya tiene monto
    const verId = c.versionActualId as string | undefined;
    let totales = { subtotal: 0, iva: 0, total: 0 };
    if (verId) {
      const v = await db.doc(`cotizaciones/${doc.id}/versiones/${verId}`).get();
      if (v.exists) {
        const d = v.data()!;
        totales = { subtotal: Number(d.subtotal ?? 0), iva: Number(d.iva ?? 0), total: Number(d.total ?? 0) };
      }
    }
    await doc.ref.update(totales);
    actualizadas++;
  }
  return { actualizadas, total: snap.size };
}
