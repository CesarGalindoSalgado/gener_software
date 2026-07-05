import { collection, onSnapshot, orderBy, query, type Timestamp, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

export interface RecordatorioDoc {
  id: string;
  duenoCorreo: string;
  descripcion: string;
  clienteTexto?: string | null;
  estatus: 'pendiente' | 'hecho';
  fechaCreacion?: Timestamp | null;
}

const callableCrear = httpsCallable<{ descripcion: string; clienteTexto?: string }, { recordatorioId: string }>(
  functions,
  'crearRecordatorioCallable'
);
const callableMarcar = httpsCallable<{ recordatorioId: string; estatus: 'pendiente' | 'hecho' }, { ok: boolean }>(
  functions,
  'marcarRecordatorioCallable'
);
const callableEditar = httpsCallable<{ recordatorioId: string; descripcion?: string; clienteTexto?: string }, { ok: boolean }>(
  functions,
  'editarRecordatorioCallable'
);
const callableEliminar = httpsCallable<{ recordatorioId: string }, { ok: boolean }>(
  functions,
  'eliminarRecordatorioCallable'
);

export async function crearRecordatorio(descripcion: string, clienteTexto?: string) {
  return (await callableCrear({ descripcion, clienteTexto })).data;
}

export async function marcarRecordatorio(recordatorioId: string, estatus: 'pendiente' | 'hecho') {
  return (await callableMarcar({ recordatorioId, estatus })).data;
}

export async function editarRecordatorio(recordatorioId: string, descripcion: string, clienteTexto?: string) {
  return (await callableEditar({ recordatorioId, descripcion, clienteTexto: clienteTexto ?? '' })).data;
}

export async function eliminarRecordatorio(recordatorioId: string) {
  return (await callableEliminar({ recordatorioId })).data;
}

export function suscribirRecordatorios(cb: (items: RecordatorioDoc[]) => void): Unsubscribe {
  const q = query(collection(db, 'recordatorios'), orderBy('fechaCreacion', 'desc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RecordatorioDoc, 'id'>) })));
  });
}
