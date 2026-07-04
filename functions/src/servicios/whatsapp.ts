import { FieldValue, Firestore } from 'firebase-admin/firestore';

// Estado de la conversación de Portteo por WhatsApp y cola de mensajes que el
// bot debe entregar. El canal es solo transporte: aquí (Firestore) vive la
// memoria del chat y los avisos pendientes de enviar.

// ---------- Historial de chat por teléfono (Portteo por WhatsApp) ----------

export interface MensajeWA {
  rol: 'usuario' | 'portteo';
  texto: string;
}

export async function guardarMensajeWA(
  db: Firestore,
  telefono: string,
  m: MensajeWA
): Promise<void> {
  await db.collection('chats_whatsapp').doc(telefono).collection('mensajes').add({
    rol: m.rol,
    texto: m.texto,
    fecha: FieldValue.serverTimestamp(),
  });
}

// Devuelve los últimos `limite` mensajes en orden cronológico (viejo → nuevo).
export async function leerHistorialWA(
  db: Firestore,
  telefono: string,
  limite = 12
): Promise<MensajeWA[]> {
  const q = await db
    .collection('chats_whatsapp')
    .doc(telefono)
    .collection('mensajes')
    .orderBy('fecha', 'desc')
    .limit(limite)
    .get();
  return q.docs
    .map((d) => ({ rol: d.data().rol as MensajeWA['rol'], texto: String(d.data().texto ?? '') }))
    .reverse();
}

// ---------- Cola de mensajes salientes (los entrega el bot por WhatsApp) ----------

export interface SalientePendiente {
  id: string;
  telefono: string;
  texto: string;
}

// Encola un mensaje con id determinista: si ya existe (misma clave), no hace
// nada y devuelve false. Sirve para que el aviso L/M/V no se duplique aunque el
// scheduler reintente.
export async function encolarSalienteUnico(
  db: Firestore,
  id: string,
  params: { telefono: string; texto: string; motivo?: string }
): Promise<boolean> {
  const ref = db.collection('mensajes_salientes').doc(id);
  try {
    await ref.create({
      telefono: params.telefono,
      texto: params.texto,
      motivo: params.motivo ?? null,
      estatus: 'pendiente',
      creadoEn: FieldValue.serverTimestamp(),
      enviadoEn: null,
    });
    return true;
  } catch {
    // create() falla si el documento ya existe: el aviso ya estaba encolado.
    return false;
  }
}

export async function salientesPendientes(
  db: Firestore,
  limite = 20
): Promise<SalientePendiente[]> {
  const q = await db
    .collection('mensajes_salientes')
    .where('estatus', '==', 'pendiente')
    .limit(limite)
    .get();
  return q.docs.map((d) => ({
    id: d.id,
    telefono: String(d.data().telefono ?? ''),
    texto: String(d.data().texto ?? ''),
  }));
}

export async function marcarSaliente(
  db: Firestore,
  id: string,
  estatus: 'enviado' | 'error',
  motivo?: string
): Promise<void> {
  await db.doc(`mensajes_salientes/${id}`).update({
    estatus,
    enviadoEn: FieldValue.serverTimestamp(),
    error: motivo ?? null,
  });
}
