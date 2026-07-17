import { collection, limit, onSnapshot, orderBy, query, type Timestamp, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

export interface OportunidadDoc {
  id: string;
  ejecucionId: string;
  sedeId: string;
  equipoId?: string | null;
  tecnicoNombre?: string | null;
  texto: string;
  estatus: 'abierta' | 'atendida';
  fecha?: Timestamp | null;
}

// Oportunidades comerciales que dejan los técnicos en campo (más recientes primero).
export function suscribirOportunidades(cb: (items: OportunidadDoc[]) => void): Unsubscribe {
  const q = query(collection(db, 'oportunidades'), orderBy('fecha', 'desc'), limit(100));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OportunidadDoc, 'id'>) })));
  });
}

const cbAtender = httpsCallable<{ oportunidadId: string; estatus?: 'abierta' | 'atendida' }, { ok: boolean }>(
  functions,
  'atenderOportunidadCallable'
);
export async function atenderOportunidad(oportunidadId: string, estatus: 'abierta' | 'atendida' = 'atendida') {
  return (await cbAtender({ oportunidadId, estatus })).data;
}
