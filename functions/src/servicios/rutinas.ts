import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { PasoRutina, PartidaRutina, ContactoCliente } from '../dominio/tipos';

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

export async function renombrarCliente(db: Firestore, clienteId: string, nombre: string): Promise<void> {
  const n = nombre.trim();
  if (!clienteId) throw new Error('Falta el cliente.');
  if (!n) throw new Error('El cliente necesita un nombre.');
  await db.doc(`clientes/${clienteId}`).update({ nombre: n });
}

// Reemplaza la lista completa de contactos del cliente. La web arma el arreglo y
// lo manda entero; aquí lo limpiamos (trim, quita vacíos) y lo guardamos.
export async function guardarContactosCliente(
  db: Firestore,
  clienteId: string,
  contactos: ContactoCliente[]
): Promise<void> {
  if (!clienteId) throw new Error('Falta el cliente.');
  const limpios = (contactos ?? [])
    .map((c) => ({
      nombre: (c.nombre ?? '').trim(),
      puesto: (c.puesto ?? '').toString().trim() || null,
      correo: (c.correo ?? '').toString().trim() || null,
      telefono: (c.telefono ?? '').toString().trim() || null,
    }))
    // Un contacto sirve si al menos trae nombre, correo o teléfono.
    .filter((c) => c.nombre || c.correo || c.telefono);
  await db.doc(`clientes/${clienteId}`).update({ contactos: limpios });
}

export async function eliminarCliente(db: Firestore, clienteId: string): Promise<void> {
  if (!clienteId) throw new Error('Falta el cliente.');
  // No lo borramos si tiene sedes colgando (rompería la jerarquía de Rutinas).
  const sedes = await db.collection('sedes').where('clienteId', '==', clienteId).limit(1).get();
  if (!sedes.empty) {
    throw new Error('Este cliente tiene sedes/equipos registrados. Quítalos antes de eliminarlo.');
  }
  await db.doc(`clientes/${clienteId}`).delete();
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
  params: { sedeId: string; noInventario: string; descripcion?: string }
): Promise<{ equipoId: string }> {
  if (!params.sedeId) throw new Error('Falta la sede.');
  const serie = params.noInventario.trim();
  const desc = params.descripcion?.trim() || '';
  // Un equipo se identifica por su serie O por su descripción. Sin ninguna de las
  // dos no hay forma de reconocerlo.
  if (!serie && !desc) throw new Error('El equipo necesita número de serie o una descripción.');
  const ref = await db.collection('equipos').add({
    sedeId: params.sedeId,
    noInventario: serie, // '' = sin número de serie
    descripcion: desc || null,
    creadoEn: FieldValue.serverTimestamp(),
  });
  return { equipoId: ref.id };
}

export async function actualizarEquipo(
  db: Firestore,
  equipoId: string,
  cambios: { noInventario?: string; descripcion?: string }
): Promise<void> {
  const upd: Record<string, unknown> = {};
  // El nº de serie SÍ puede quedar vacío (equipo sin serie); se identifica por descripción.
  if (cambios.noInventario !== undefined) upd.noInventario = cambios.noInventario.trim();
  if (cambios.descripcion !== undefined) upd.descripcion = cambios.descripcion.trim() || null;
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

export async function eliminarRutina(db: Firestore, rutinaId: string): Promise<void> {
  if (!rutinaId) throw new Error('Falta rutinaId.');
  await db.doc(`rutinas_plantilla/${rutinaId}`).delete();
}

// ---------- Catálogo editable de tipos de equipo (partidas) ----------

export async function crearTipoEquipo(db: Firestore, nombre: string): Promise<{ tipoId: string }> {
  const limpio = nombre.trim();
  if (!limpio) throw new Error('El tipo de equipo necesita un nombre.');
  // Evita duplicados (case-insensitive).
  const existentes = await db.collection('tipos_equipo').get();
  if (existentes.docs.some((d) => String(d.get('nombre') ?? '').trim().toLowerCase() === limpio.toLowerCase())) {
    throw new Error('Ya existe un tipo de equipo con ese nombre.');
  }
  const ref = await db.collection('tipos_equipo').add({ nombre: limpio, creadoEn: FieldValue.serverTimestamp() });
  return { tipoId: ref.id };
}

export async function eliminarTipoEquipo(db: Firestore, tipoId: string): Promise<void> {
  if (!tipoId) throw new Error('Falta tipoId.');
  await db.doc(`tipos_equipo/${tipoId}`).delete();
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
