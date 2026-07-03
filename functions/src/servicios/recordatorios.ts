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
