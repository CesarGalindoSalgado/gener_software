import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import { calcularTotales } from '../dominio/totales';
import { Partida } from '../dominio/tipos';

// Servicios de dominio sobre Firestore (Admin SDK). Los invoca el ejecutor de
// herramientas del agente y las Cloud Functions callables. Toda escritura del
// sistema pasa por aquí — los clientes web solo leen (reglas).

const FORMA_PAGO_DEFAULT = '70% anticipo / 30% entrega';

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

export async function crearBorrador(
  db: Firestore,
  params: { clienteNombre: string; titulo: string; creadoPor: string }
): Promise<RefsBorrador> {
  const clienteId = await obtenerOCrearCliente(db, params.clienteNombre);
  const clienteSnap = await db.doc(`clientes/${clienteId}`).get();
  const cliente = clienteSnap.data() ?? { nombre: params.clienteNombre };

  const cotRef = await db.collection('cotizaciones').add({
    folio: null,
    clienteId,
    // Snapshot denormalizado para render directo en el taller
    cliente: {
      nombre: cliente.nombre ?? params.clienteNombre,
      atencion: cliente.atencion ?? null,
      telefono: cliente.telefono ?? null,
      correo: cliente.correo ?? null,
    },
    titulo: params.titulo,
    estatus: 'borrador',
    revActual: 'A',
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
    formaPago: cliente.ultimaFormaPago ?? FORMA_PAGO_DEFAULT,
    tiempoEntrega: 'Por definir',
    fecha: FieldValue.serverTimestamp(),
  });

  await cotRef.update({ versionActualId: verRef.id });
  return { cotizacionId: cotRef.id, versionId: verRef.id };
}

// Muta las partidas de una versión con recálculo de totales, en transacción.
async function mutarPartidas(
  db: Firestore,
  refs: RefsBorrador,
  mutacion: (partidas: Partida[]) => Partida[]
): Promise<{ partidas: Partida[]; subtotal: number; iva: number; total: number }> {
  const verRef = db.doc(`cotizaciones/${refs.cotizacionId}/versiones/${refs.versionId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(verRef);
    if (!snap.exists) throw new Error('No existe la versión de la cotización.');
    const actuales = (snap.data()!.partidas ?? []) as Partida[];
    const nuevas = mutacion(actuales);
    const totales = calcularTotales(nuevas);
    tx.update(verRef, { partidas: nuevas, ...totales });
    return { partidas: nuevas, ...totales };
  });
}

export async function agregarBloque(
  db: Firestore,
  refs: RefsBorrador,
  bloque: { titulo: string; descripcion?: string; lineas?: string[]; cantidad?: number; importe: number }
) {
  return mutarPartidas(db, refs, (partidas) => [
    ...partidas,
    {
      titulo: bloque.titulo,
      descripcion: bloque.descripcion ?? '',
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

export async function actualizarDatos(
  db: Firestore,
  refs: RefsBorrador,
  datos: { titulo?: string; formaPago?: string; tiempoEntrega?: string; atencion?: string }
) {
  const cotRef = db.doc(`cotizaciones/${refs.cotizacionId}`);
  const verRef = db.doc(`cotizaciones/${refs.cotizacionId}/versiones/${refs.versionId}`);

  const cotUpdate: Record<string, unknown> = {};
  if (datos.titulo) cotUpdate.titulo = datos.titulo;
  if (datos.atencion !== undefined) cotUpdate['cliente.atencion'] = datos.atencion;
  if (Object.keys(cotUpdate).length) await cotRef.update(cotUpdate);

  const verUpdate: Record<string, unknown> = {};
  if (datos.formaPago) verUpdate.formaPago = datos.formaPago;
  if (datos.tiempoEntrega) verUpdate.tiempoEntrega = datos.tiempoEntrega;
  if (Object.keys(verUpdate).length) await verRef.update(verUpdate);

  return { ok: true, actualizado: { ...cotUpdate, ...verUpdate } };
}

export async function consultarCotizaciones(
  db: Firestore,
  filtro: { folio?: string; cliente?: string }
): Promise<unknown[]> {
  let q;
  if (filtro.folio) {
    q = await db.collection('cotizaciones').where('folio', '==', filtro.folio.trim().toUpperCase()).limit(5).get();
  } else if (filtro.cliente) {
    q = await db.collection('cotizaciones').where('cliente.nombre', '==', filtro.cliente.trim()).limit(10).get();
  } else {
    q = await db.collection('cotizaciones').orderBy('fechaCreacion', 'desc').limit(10).get();
  }
  return q.docs.map((d) => {
    const c = d.data();
    return {
      cotizacionId: d.id,
      folio: c.folio,
      cliente: c.cliente?.nombre,
      titulo: c.titulo,
      estatus: c.estatus,
      rev: c.revActual,
    };
  });
}

export async function clonarComoBase(
  db: Firestore,
  params: { cotizacionId: string; clienteNombre: string; creadoPor: string }
): Promise<RefsBorrador> {
  const origenSnap = await db.doc(`cotizaciones/${params.cotizacionId}`).get();
  if (!origenSnap.exists) throw new Error('No existe la cotización origen.');
  const origen = origenSnap.data()!;
  const verSnap = await db
    .doc(`cotizaciones/${params.cotizacionId}/versiones/${origen.versionActualId}`)
    .get();
  const verOrigen = verSnap.data() ?? { partidas: [] };

  // Nuevo borrador para el cliente destino; la forma de pago NO se arrastra
  // (crearBorrador sugiere la ultimaFormaPago del destino o el fallback 70/30).
  const refs = await crearBorrador(db, {
    clienteNombre: params.clienteNombre,
    titulo: origen.titulo,
    creadoPor: params.creadoPor,
  });

  const partidas = (verOrigen.partidas ?? []) as Partida[];
  if (partidas.length) {
    await mutarPartidas(db, refs, () => partidas);
  }
  return refs;
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
      descripcion: p.descripcion ?? null,
      precioSugerido: p.precioSugerido ?? null,
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
  params: { nombre?: string; plantillaId?: string; importe?: number }
) {
  let plantilla: FirebaseFirestore.DocumentData | undefined;
  if (params.plantillaId) {
    const snap = await db.doc(`plantillas/${params.plantillaId}`).get();
    plantilla = snap.data();
  } else if (params.nombre) {
    const q = await db.collection('plantillas').where('nombre', '==', params.nombre).limit(1).get();
    plantilla = q.empty ? undefined : q.docs[0].data();
  }
  if (!plantilla) throw new Error('No se encontró la plantilla indicada.');

  const importe = params.importe ?? plantilla.precioSugerido ?? 0;
  return agregarBloque(db, refs, {
    titulo: plantilla.nombre,
    descripcion: plantilla.descripcion ?? undefined,
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
