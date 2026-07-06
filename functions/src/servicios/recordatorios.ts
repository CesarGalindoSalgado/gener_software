import { FieldValue, Firestore } from 'firebase-admin/firestore';

// Recordatorios del dueño ("recuérdame cotizar a tal cliente"). Se capturan
// desde el portal o por WhatsApp (fase 5). El scheduler L/M/V avisa si hay
// pendientes.

export async function crearRecordatorioPortal(
  db: Firestore,
  params: { correo: string; descripcion: string; clienteTexto?: string }
): Promise<{ recordatorioId: string }> {
  if (!params.descripcion.trim()) throw new Error('El recordatorio necesita una descripción.');
  const ref = await db.collection('recordatorios').add({
    duenoCorreo: params.correo,
    descripcion: params.descripcion.trim(),
    clienteTexto: params.clienteTexto?.trim() || null,
    estatus: 'pendiente',
    fechaCreacion: FieldValue.serverTimestamp(),
  });
  return { recordatorioId: ref.id };
}

// Lista los recordatorios PENDIENTES de un dueño, en orden estable (por fecha de
// creación), para consultarlos por chat. Orden estable = el "número N" significa
// lo mismo entre listar y marcar-hecho.
export async function listarRecordatoriosDe(
  db: Firestore,
  correo: string
): Promise<{ recordatorioId: string; descripcion: string; cliente: string | null }[]> {
  const q = await db.collection('recordatorios').where('duenoCorreo', '==', correo).get();
  return q.docs
    .map((d) => ({ id: d.id, data: d.data() as { estatus?: string; descripcion?: string; clienteTexto?: string | null; fechaCreacion?: { toMillis?: () => number } } }))
    .filter((r) => r.data.estatus === 'pendiente')
    .sort((a, b) => (a.data.fechaCreacion?.toMillis?.() ?? 0) - (b.data.fechaCreacion?.toMillis?.() ?? 0))
    .map((r) => ({ recordatorioId: r.id, descripcion: r.data.descripcion ?? '', cliente: r.data.clienteTexto ?? null }));
}

export async function editarRecordatorio(
  db: Firestore,
  recordatorioId: string,
  cambios: { descripcion?: string; clienteTexto?: string }
): Promise<void> {
  const upd: Record<string, unknown> = {};
  if (cambios.descripcion !== undefined) {
    const d = cambios.descripcion.trim();
    if (!d) throw new Error('El recordatorio necesita una descripción.');
    upd.descripcion = d;
  }
  if (cambios.clienteTexto !== undefined) {
    upd.clienteTexto = cambios.clienteTexto.trim() || null;
  }
  if (Object.keys(upd).length === 0) return;
  await db.doc(`recordatorios/${recordatorioId}`).update(upd);
}

export async function eliminarRecordatorio(db: Firestore, recordatorioId: string): Promise<void> {
  await db.doc(`recordatorios/${recordatorioId}`).delete();
}

export async function marcarRecordatorio(
  db: Firestore,
  recordatorioId: string,
  estatus: 'pendiente' | 'hecho'
): Promise<void> {
  await db.doc(`recordatorios/${recordatorioId}`).update({
    estatus,
    fechaHecho: estatus === 'hecho' ? FieldValue.serverTimestamp() : FieldValue.delete(),
  });
}

// Cuenta los recordatorios pendientes (para el aviso del scheduler).
export async function contarPendientes(db: Firestore): Promise<number> {
  const q = await db.collection('recordatorios').where('estatus', '==', 'pendiente').count().get();
  return q.data().count;
}

// Pendientes agrupados por dueño (correo → cuántos), para avisar a cada quien
// solo de lo suyo por WhatsApp.
export async function pendientesPorDueno(db: Firestore): Promise<Record<string, number>> {
  const q = await db.collection('recordatorios').where('estatus', '==', 'pendiente').get();
  const acc: Record<string, number> = {};
  for (const d of q.docs) {
    const correo = d.data().duenoCorreo as string | undefined;
    if (correo) acc[correo] = (acc[correo] ?? 0) + 1;
  }
  return acc;
}
