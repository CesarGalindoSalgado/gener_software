import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { PasoRutina, PartidaRutina } from '../dominio/tipos';

// Catálogo del módulo de Rutinas (Fase 0): clientes, sedes, equipos y rutinas
// plantilla. Todo se escribe con Admin SDK (la web solo lee). El modelo cuelga
// de cliente → sede → equipo (por número de inventario).

// ---------- Clientes (compartido con cotizaciones) ----------
export async function crearClienteRutinas(db: Firestore, nombre: string): Promise<{ clienteId: string }> {
  const n = nombre.trim();
  if (!n) throw new Error('El cliente necesita un nombre.');
  const ref = await db.collection('clientes').add({ nombre: n, creadoEn: FieldValue.serverTimestamp() });
  return { clienteId: ref.id };
}

// ---------- Sedes ----------
export async function crearSede(
  db: Firestore,
  params: { clienteId: string; nombre: string; direccion?: string; responsable?: string }
): Promise<{ sedeId: string }> {
  if (!params.clienteId) throw new Error('Falta el cliente.');
  if (!params.nombre.trim()) throw new Error('La sede necesita un nombre.');
  const ref = await db.collection('sedes').add({
    clienteId: params.clienteId,
    nombre: params.nombre.trim(),
    direccion: params.direccion?.trim() || null,
    responsable: params.responsable?.trim() || null,
    creadoEn: FieldValue.serverTimestamp(),
  });
  return { sedeId: ref.id };
}

export async function actualizarSede(
  db: Firestore,
  sedeId: string,
  cambios: { nombre?: string; direccion?: string; responsable?: string }
): Promise<void> {
  const upd: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) {
    if (!cambios.nombre.trim()) throw new Error('La sede necesita un nombre.');
    upd.nombre = cambios.nombre.trim();
  }
  if (cambios.direccion !== undefined) upd.direccion = cambios.direccion.trim() || null;
  if (cambios.responsable !== undefined) upd.responsable = cambios.responsable.trim() || null;
  if (Object.keys(upd).length) await db.doc(`sedes/${sedeId}`).update(upd);
}

// ---------- Equipos (por número de inventario) ----------
export async function crearEquipo(
  db: Firestore,
  params: { sedeId: string; noInventario: string; descripcion?: string; rutinaTipoId?: string }
): Promise<{ equipoId: string }> {
  if (!params.sedeId) throw new Error('Falta la sede.');
  if (!params.noInventario.trim()) throw new Error('El equipo necesita número de inventario.');
  const ref = await db.collection('equipos').add({
    sedeId: params.sedeId,
    noInventario: params.noInventario.trim(),
    descripcion: params.descripcion?.trim() || null,
    rutinaTipoId: params.rutinaTipoId || null,
    creadoEn: FieldValue.serverTimestamp(),
  });
  return { equipoId: ref.id };
}

export async function actualizarEquipo(
  db: Firestore,
  equipoId: string,
  cambios: { noInventario?: string; descripcion?: string; rutinaTipoId?: string | null }
): Promise<void> {
  const upd: Record<string, unknown> = {};
  if (cambios.noInventario !== undefined) {
    if (!cambios.noInventario.trim()) throw new Error('El equipo necesita número de inventario.');
    upd.noInventario = cambios.noInventario.trim();
  }
  if (cambios.descripcion !== undefined) upd.descripcion = cambios.descripcion.trim() || null;
  if (cambios.rutinaTipoId !== undefined) upd.rutinaTipoId = cambios.rutinaTipoId || null;
  if (Object.keys(upd).length) await db.doc(`equipos/${equipoId}`).update(upd);
}

// ---------- Rutinas plantilla ----------
export interface DatosRutina {
  partida: PartidaRutina;
  nombre: string;
  equiposIncluidos?: string[];
  refaccionesReferenciales?: string[];
  pasos?: PasoRutina[];
  activa?: boolean;
}

export async function crearRutina(db: Firestore, datos: DatosRutina): Promise<{ rutinaId: string }> {
  if (!datos.nombre.trim()) throw new Error('La rutina necesita un nombre.');
  const ref = await db.collection('rutinas_plantilla').add({
    partida: datos.partida,
    nombre: datos.nombre.trim(),
    equiposIncluidos: datos.equiposIncluidos ?? [],
    refaccionesReferenciales: datos.refaccionesReferenciales ?? [],
    pasos: datos.pasos ?? [],
    activa: datos.activa ?? true,
    creadoEn: FieldValue.serverTimestamp(),
  });
  return { rutinaId: ref.id };
}

export async function actualizarRutina(
  db: Firestore,
  rutinaId: string,
  cambios: Partial<DatosRutina>
): Promise<void> {
  const upd: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) {
    if (!cambios.nombre.trim()) throw new Error('La rutina necesita un nombre.');
    upd.nombre = cambios.nombre.trim();
  }
  if (cambios.partida !== undefined) upd.partida = cambios.partida;
  if (cambios.equiposIncluidos !== undefined) upd.equiposIncluidos = cambios.equiposIncluidos;
  if (cambios.refaccionesReferenciales !== undefined) upd.refaccionesReferenciales = cambios.refaccionesReferenciales;
  if (cambios.pasos !== undefined) upd.pasos = cambios.pasos;
  if (cambios.activa !== undefined) upd.activa = cambios.activa;
  if (Object.keys(upd).length) await db.doc(`rutinas_plantilla/${rutinaId}`).update(upd);
}

// Importa el seed de rutinas (idempotente por id "RUT-001"...). Cada objeto trae
// su id; se usa como id del documento para poder recargar sin duplicar.
export async function importarRutinas(
  db: Firestore,
  rutinas: (DatosRutina & { id: string })[]
): Promise<{ importadas: number }> {
  let importadas = 0;
  for (const r of rutinas) {
    if (!r.id) continue;
    await db.doc(`rutinas_plantilla/${r.id}`).set(
      {
        partida: r.partida,
        nombre: r.nombre,
        equiposIncluidos: r.equiposIncluidos ?? [],
        refaccionesReferenciales: r.refaccionesReferenciales ?? [],
        pasos: r.pasos ?? [],
        activa: r.activa ?? true,
      },
      { merge: true }
    );
    importadas++;
  }
  return { importadas };
}
