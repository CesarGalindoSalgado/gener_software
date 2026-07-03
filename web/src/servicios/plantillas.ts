import { collection, onSnapshot, orderBy, query, type Timestamp, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

export interface PlantillaDoc {
  plantillaId: string;
  nombre: string;
  descripcion?: string | null;
  precioSugerido?: number | null;
  lineas: string[];
  activa: boolean;
  creadaEn?: Timestamp | null;
}

const callableCrear = httpsCallable<
  { nombre: string; descripcion?: string; precioSugerido?: number | null; lineas: string[]; activa?: boolean },
  { plantillaId: string }
>(functions, 'crearPlantillaCallable');

const callableActualizar = httpsCallable<
  { plantillaId: string; nombre?: string; descripcion?: string; precioSugerido?: number | null; lineas?: string[]; activa?: boolean },
  { ok: boolean }
>(functions, 'actualizarPlantillaCallable');

export async function crearPlantilla(datos: {
  nombre: string;
  descripcion?: string;
  precioSugerido?: number | null;
  lineas: string[];
}) {
  return (await callableCrear(datos)).data;
}

export async function actualizarPlantilla(datos: {
  plantillaId: string;
  nombre?: string;
  descripcion?: string;
  precioSugerido?: number | null;
  lineas?: string[];
  activa?: boolean;
}) {
  return (await callableActualizar(datos)).data;
}

// Para el portal de admin: trae todas (activas e inactivas).
export function suscribirPlantillas(cb: (items: PlantillaDoc[]) => void): Unsubscribe {
  const q = query(collection(db, 'plantillas'), orderBy('nombre', 'asc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ plantillaId: d.id, ...(d.data() as Omit<PlantillaDoc, 'plantillaId'>) })));
  });
}
