import { collection, limit, onSnapshot, orderBy, query, type Timestamp, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

export type EstatusEjecucion =
  | 'en_proceso'
  | 'cancelada'
  | 'completada'
  | 'validada'
  | 'aprobada'
  | 'firmada'
  | 'faltante_firma';

export type EvidenciaTipo = 'foto_comentario' | 'antes_despues' | 'medicion';

export interface PasoEjec {
  orden: number;
  instruccion: string;
  tipo: EvidenciaTipo;
  comentario?: string;
  fotos?: string[];
  fotoAntes?: string;
  fotoDespues?: string;
  lectura?: number;
  unidad?: string;
  cumple?: boolean;
}

export interface EjecucionDoc {
  id: string;
  folio: string | null;
  rutinaId: string;
  sedeId: string;
  equipoId: string;
  tecnicoNombre: string;
  tecnicoTelefono: string;
  estatus: EstatusEjecucion;
  etapa?: 'pasos' | 'firma' | null;
  inicio?: Timestamp | null;
  fin?: Timestamp | null;
  pasoActual?: number | null;
  pasos: PasoEjec[];
  evidenciaFirmaUrl?: string | null;
  faltanteFirmaRazon?: string | null;
}

// Ejecuciones de rutinas (más recientes primero). Las escribe el backend.
export function suscribirEjecuciones(cb: (items: EjecucionDoc[]) => void): Unsubscribe {
  const q = query(collection(db, 'rutinas_ejecucion'), orderBy('inicio', 'desc'), limit(80));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EjecucionDoc, 'id'>) })));
  });
}

// Ventana amplia para el tablero de estadísticas (recientes primero).
export function suscribirEjecucionesPanel(cb: (items: EjecucionDoc[]) => void): Unsubscribe {
  const q = query(collection(db, 'rutinas_ejecucion'), orderBy('inicio', 'desc'), limit(500));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EjecucionDoc, 'id'>) })));
  });
}

// Valida una rutina completada: asigna folio de reporte (idempotente) y
// devuelve el enlace firmado del reporte. Repetir la llamada devuelve el mismo.
const cbValidar = httpsCallable<{ ejecucionId: string }, { folio: string; enlace: string }>(
  functions,
  'validarEjecucionCallable'
);
export async function validarEjecucion(ejecucionId: string) {
  return (await cbValidar({ ejecucionId })).data;
}

// Liga de solo lectura del reporte (sin validar ni foliar): para verlo mientras
// la rutina sigue en proceso, "como se va generando".
const cbEnlaceReporte = httpsCallable<{ ejecucionId: string }, { enlace: string }>(
  functions,
  'enlaceReporteCallable'
);
export async function enlaceReporte(ejecucionId: string) {
  return (await cbEnlaceReporte({ ejecucionId })).data;
}

// Quita la bandera de "faltante de firma" (opcionalmente con la foto de la hoja).
const cbResolver = httpsCallable<{ ejecucionId: string; fotoUrl?: string }, { ok: boolean }>(
  functions,
  'resolverFaltanteFirmaCallable'
);
export async function resolverFaltanteFirma(ejecucionId: string, fotoUrl?: string) {
  return (await cbResolver({ ejecucionId, fotoUrl })).data;
}
