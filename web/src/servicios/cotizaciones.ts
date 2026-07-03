import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import type { EstatusCotizacion, Partida } from '../dominio/tipos';

// ---------- Tipos de los documentos en Firestore ----------

export interface CotizacionDoc {
  folio: string | null;
  clienteId: string;
  cliente: { nombre: string; atencion?: string | null; telefono?: string | null; correo?: string | null };
  titulo: string;
  estatus: EstatusCotizacion;
  revActual: string;
  versionActualId: string;
  fechaCreacion: Timestamp | null;
  fechaEnvio?: Timestamp | null;
}

export interface VersionDoc {
  rev: string;
  estatus: EstatusCotizacion;
  partidas: Partida[];
  subtotal: number;
  iva: number;
  total: number;
  formaPago: string;
  tiempoEntrega: string;
  fecha: Timestamp | null;
  pdfUrl?: string;
}

export interface MensajeChat {
  id: string;
  rol: 'usuario' | 'portteo';
  texto: string;
  fecha: Timestamp | null;
}

// ---------- Callables (escrituras: siempre vía backend) ----------

const callableCrear = httpsCallable<{ clienteNombre: string; titulo: string }, { cotizacionId: string; versionId: string }>(functions, 'crearCotizacion');
const callablePortteo = httpsCallable<{ cotizacionId: string; mensaje: string }, { texto: string }>(functions, 'portteo');
const callableAprobar = httpsCallable<{ cotizacionId: string }, { folio: string }>(functions, 'aprobar');
const callableCambiarEstatus = httpsCallable<{ cotizacionId: string; estatus: EstatusCotizacion }, { ok: boolean; estatus: string }>(functions, 'cambiarEstatus');
const callableCrearRevision = httpsCallable<{ cotizacionId: string }, { versionId: string; rev: string }>(functions, 'crearRevisionCallable');

export async function crearCotizacion(clienteNombre: string, titulo: string) {
  const res = await callableCrear({ clienteNombre, titulo });
  return res.data;
}

export async function enviarMensajePortteo(cotizacionId: string, mensaje: string) {
  const res = await callablePortteo({ cotizacionId, mensaje });
  return res.data;
}

export async function aprobarCotizacion(cotizacionId: string) {
  const res = await callableAprobar({ cotizacionId });
  return res.data;
}

export async function cambiarEstatus(cotizacionId: string, estatus: EstatusCotizacion) {
  return (await callableCambiarEstatus({ cotizacionId, estatus })).data;
}

export async function crearRevision(cotizacionId: string) {
  return (await callableCrearRevision({ cotizacionId })).data;
}

// Cotizaciones enviadas sin cerrar (para seguimiento), más antiguas primero.
export function suscribirSeguimiento(
  cb: (items: ({ id: string } & CotizacionDoc)[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'cotizaciones'),
    where('estatus', '==', 'enviada'),
    orderBy('fechaEnvio', 'asc'),
    limit(100)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as CotizacionDoc) })));
  });
}

// ---------- Suscripciones en vivo (lecturas permitidas por reglas) ----------

export function suscribirCotizacion(
  cotizacionId: string,
  cb: (c: CotizacionDoc | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'cotizaciones', cotizacionId), (snap) => {
    cb(snap.exists() ? (snap.data() as CotizacionDoc) : null);
  });
}

export function suscribirVersion(
  cotizacionId: string,
  versionId: string,
  cb: (v: VersionDoc | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'cotizaciones', cotizacionId, 'versiones', versionId), (snap) => {
    cb(snap.exists() ? (snap.data() as VersionDoc) : null);
  });
}

export function suscribirChat(
  cotizacionId: string,
  cb: (mensajes: MensajeChat[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'cotizaciones', cotizacionId, 'chat'),
    orderBy('fecha', 'asc'),
    limit(100)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MensajeChat, 'id'>) })));
  });
}

export function suscribirListado(
  cb: (items: ({ id: string } & CotizacionDoc)[]) => void
): Unsubscribe {
  const q = query(collection(db, 'cotizaciones'), orderBy('fechaCreacion', 'desc'), limit(25));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as CotizacionDoc) })));
  });
}
