import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, functions, storage } from '../firebase';

// Sube imágenes al Storage bajo reparaciones/<carpeta>/ y devuelve sus URLs.
// La regla de Storage solo permite escribir bajo reparaciones/ a usuarios activos.
export async function subirImagenes(files: File[], carpeta: string): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) {
    const nombre = `${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]/g, '_')}`;
    const r = storageRef(storage, `reparaciones/${carpeta}/${nombre}`);
    await uploadBytes(r, f);
    urls.push(await getDownloadURL(r));
  }
  return urls;
}

// Módulo de Reparaciones (Taller). La web solo LEE (onSnapshot); la escritura
// pasa por callables (Admin SDK), que asignan el folio OR-… en transacción.

export type EstatusReparacion =
  | 'recibido'
  | 'en_diagnostico'
  | 'cotizado'
  | 'aprobado'
  | 'en_reparacion'
  | 'listo'
  | 'entregado'
  | 'rechazado'
  | 'devuelto';

export const ETIQUETA_ESTATUS: Record<EstatusReparacion, string> = {
  recibido: 'Recibido',
  en_diagnostico: 'En diagnóstico',
  cotizado: 'Cotizado',
  aprobado: 'Aprobado',
  en_reparacion: 'En reparación',
  listo: 'Listo',
  entregado: 'Entregado',
  rechazado: 'Rechazado',
  devuelto: 'Devuelto',
};

// Clases de color por estado (para las "pastillas" del listado/tablero).
export const COLOR_ESTATUS: Record<EstatusReparacion, string> = {
  recibido: 'bg-slate-100 text-slate-700',
  en_diagnostico: 'bg-amber-100 text-amber-800',
  cotizado: 'bg-blue-100 text-blue-800',
  aprobado: 'bg-indigo-100 text-indigo-800',
  en_reparacion: 'bg-violet-100 text-violet-800',
  listo: 'bg-emerald-100 text-emerald-800',
  entregado: 'bg-green-100 text-green-800',
  rechazado: 'bg-rose-100 text-rose-700',
  devuelto: 'bg-gray-200 text-gray-700',
};

export interface EquipoReparacion {
  descripcion: string;
  marca?: string | null;
  modelo?: string | null;
  numeroSerie?: string | null;
  accesorios?: string | null;
}

export interface DiagnosticoReparacion {
  hallazgos: string;
  refacciones?: string | null;
  tecnico?: string | null;
}

export interface OrdenReparacionDoc {
  id: string;
  folio: string;
  estatus: EstatusReparacion;
  clienteId?: string | null;
  clienteNombre: string;
  contacto?: { nombre?: string; puesto?: string | null; correo?: string | null; telefono?: string | null } | null;
  equipo: EquipoReparacion;
  fallaReportada: string;
  fotosRecepcion?: string[];
  diagnostico?: DiagnosticoReparacion | null;
  cotizacionId?: string | null;
  rechazoRazon?: string | null;
  entrega?: { recibeNombre: string; firmaUrl?: string | null } | null;
  fechaRecepcion?: { seconds: number } | null;
  fechas?: Partial<Record<EstatusReparacion, { seconds: number }>>;
}

// Transiciones válidas por estado (espejo de dominio/reparacion.ts). El portal
// solo muestra como acciones los estados a los que sí se puede pasar.
export const SIGUIENTES: Record<EstatusReparacion, EstatusReparacion[]> = {
  recibido: ['en_diagnostico'],
  en_diagnostico: ['cotizado', 'rechazado'],
  cotizado: ['aprobado', 'rechazado'],
  aprobado: ['en_reparacion'],
  en_reparacion: ['listo'],
  listo: ['entregado'],
  entregado: [],
  rechazado: ['devuelto'],
  devuelto: [],
};

// ---------- Suscripción en vivo ----------
export function suscribirOrdenes(cb: (items: OrdenReparacionDoc[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'ordenes_reparacion'), (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrdenReparacionDoc, 'id'>) }));
    // Más recientes primero (el folio ordena por mes/consecutivo).
    items.sort((a, b) => (b.folio ?? '').localeCompare(a.folio ?? ''));
    cb(items);
  });
}

// ---------- Callable ----------
export interface DatosRecepcion {
  clienteId?: string | null;
  clienteNombre: string;
  equipo: EquipoReparacion;
  fallaReportada: string;
  fotosRecepcion?: string[];
}

const cbCrearOrden = httpsCallable<DatosRecepcion, { ordenId: string; folio: string; consecutivo: number }>(
  functions,
  'crearOrdenReparacionCallable'
);
const cbDiagnostico = httpsCallable<
  { ordenId: string; hallazgos: string; refacciones?: string | null; tecnico?: string | null },
  { ok: boolean }
>(functions, 'guardarDiagnosticoReparacionCallable');
const cbEstatus = httpsCallable<
  { ordenId: string; estatus: EstatusReparacion; motivo?: string | null },
  { ok: boolean; estatus: EstatusReparacion }
>(functions, 'cambiarEstatusReparacionCallable');

export const crearOrdenReparacion = (d: DatosRecepcion) => cbCrearOrden(d).then((r) => r.data);
export const guardarDiagnostico = (d: {
  ordenId: string;
  hallazgos: string;
  refacciones?: string | null;
  tecnico?: string | null;
}) => cbDiagnostico(d).then((r) => r.data);
export const cambiarEstatus = (d: { ordenId: string; estatus: EstatusReparacion; motivo?: string | null }) =>
  cbEstatus(d).then((r) => r.data);

const cbCrearCotDesdeOrden = httpsCallable<{ ordenId: string }, { cotizacionId: string; yaExistia: boolean }>(
  functions,
  'crearCotizacionDesdeReparacionCallable'
);
export const crearCotizacionDesdeOrden = (ordenId: string) => cbCrearCotDesdeOrden({ ordenId }).then((r) => r.data);

const cbEntregar = httpsCallable<
  { ordenId: string; recibeNombre: string; firmaUrl?: string | null },
  { ok: boolean }
>(functions, 'entregarOrdenReparacionCallable');
export const entregarOrden = (d: { ordenId: string; recibeNombre: string; firmaUrl?: string | null }) =>
  cbEntregar(d).then((r) => r.data);
