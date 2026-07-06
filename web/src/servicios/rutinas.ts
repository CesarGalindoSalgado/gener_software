import { collection, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

// Módulo de Rutinas — Fase 0: catálogo (clientes → sedes → equipos) y rutinas
// plantilla. La web solo LEE (onSnapshot); toda escritura pasa por callables.

export type EvidenciaTipo = 'foto_comentario' | 'antes_despues' | 'medicion';

export interface EvidenciaPaso {
  tipo: EvidenciaTipo;
  requiereFoto?: boolean;
  fotosAntesDespues?: boolean;
  requiereLectura?: boolean;
  unidadSugerida?: string | null;
  graficoSugerido?: boolean;
  rangoMin?: number;
  rangoMax?: number;
  rangoDefinido?: boolean;
}

export interface PasoRutina {
  orden: number;
  instruccion: string;
  evidencia: EvidenciaPaso;
}

export type PartidaRutina = 'Equipo médico' | 'Equipo electromecánico';

export interface RutinaDoc {
  id: string;
  partida: PartidaRutina;
  nombre: string;
  activa: boolean;
  equiposIncluidos: string[];
  refaccionesReferenciales: string[];
  pasos: PasoRutina[];
}

export interface ClienteDoc {
  id: string;
  nombre: string;
}

export interface SedeDoc {
  id: string;
  clienteId: string;
  nombre: string;
  direccion?: string | null;
  responsable?: string | null;
}

export interface EquipoDoc {
  id: string;
  sedeId: string;
  noInventario: string;
  descripcion?: string | null;
  rutinaTipoId?: string | null;
}

// ---------- Suscripciones en vivo ----------
export function suscribirRutinas(cb: (items: RutinaDoc[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'rutinas_plantilla'), (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RutinaDoc, 'id'>) }));
    items.sort((a, b) => a.id.localeCompare(b.id));
    cb(items);
  });
}

export function suscribirClientes(cb: (items: ClienteDoc[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'clientes'), (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, nombre: String(d.data().nombre ?? '') }));
    items.sort((a, b) => a.nombre.localeCompare(b.nombre));
    cb(items);
  });
}

export function suscribirSedes(cb: (items: SedeDoc[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'sedes'), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SedeDoc, 'id'>) })));
  });
}

export function suscribirEquipos(cb: (items: EquipoDoc[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'equipos'), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EquipoDoc, 'id'>) })));
  });
}

// Solo los equipos de una sede (para no traer todo).
export function suscribirEquiposDeSede(sedeId: string, cb: (items: EquipoDoc[]) => void): Unsubscribe {
  const q = query(collection(db, 'equipos'), where('sedeId', '==', sedeId));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EquipoDoc, 'id'>) })));
  });
}

// ---------- Callables ----------
const cbCrearCliente = httpsCallable<{ nombre: string }, { clienteId: string }>(functions, 'crearClienteRutinasCallable');
const cbCrearSede = httpsCallable<Record<string, unknown>, { sedeId: string }>(functions, 'crearSedeCallable');
const cbActualizarSede = httpsCallable<Record<string, unknown>, { ok: boolean }>(functions, 'actualizarSedeCallable');
const cbCrearEquipo = httpsCallable<Record<string, unknown>, { equipoId: string }>(functions, 'crearEquipoCallable');
const cbActualizarEquipo = httpsCallable<Record<string, unknown>, { ok: boolean }>(functions, 'actualizarEquipoCallable');
const cbCrearRutina = httpsCallable<Record<string, unknown>, { rutinaId: string }>(functions, 'crearRutinaCallable');
const cbActualizarRutina = httpsCallable<Record<string, unknown>, { ok: boolean }>(functions, 'actualizarRutinaCallable');
const cbImportarRutinas = httpsCallable<{ rutinas: unknown[] }, { importadas: number }>(functions, 'importarRutinasCallable');

export const crearCliente = (nombre: string) => cbCrearCliente({ nombre }).then((r) => r.data);
export const crearSede = (d: { clienteId: string; nombre: string; direccion?: string; responsable?: string }) =>
  cbCrearSede(d).then((r) => r.data);
export const actualizarSede = (d: { sedeId: string; nombre?: string; direccion?: string; responsable?: string }) =>
  cbActualizarSede(d).then((r) => r.data);
export const crearEquipo = (d: { sedeId: string; noInventario: string; descripcion?: string; rutinaTipoId?: string }) =>
  cbCrearEquipo(d).then((r) => r.data);
export const actualizarEquipo = (d: {
  equipoId: string;
  noInventario?: string;
  descripcion?: string;
  rutinaTipoId?: string | null;
}) => cbActualizarEquipo(d).then((r) => r.data);
export const crearRutina = (d: Record<string, unknown>) => cbCrearRutina(d).then((r) => r.data);
export const actualizarRutina = (d: Record<string, unknown>) => cbActualizarRutina(d).then((r) => r.data);
export const importarRutinas = (rutinas: unknown[]) => cbImportarRutinas({ rutinas }).then((r) => r.data);
