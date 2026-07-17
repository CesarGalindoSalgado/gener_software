import { randomUUID } from 'node:crypto';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Evidencia fotográfica de Rutinas. La foto entra por WhatsApp; el bot la
// descarga y la reenvía aquí (vía Cloud Function). Se guarda en Firebase
// Storage con una URL de descarga persistente (token de Firebase) y se
// registra la metadata en Firestore para que el portal la muestre.

export interface EntradaFoto {
  telefono: string;
  nombre: string;
  buffer: Buffer;
  mimetype: string;
  caption?: string;
  // Contexto opcional. En la Fase 2 (flujo guiado) se pasa a qué equipo /
  // reporte / paso pertenece; en la Fase 1 va a la bandeja por técnico.
  equipoId?: string;
  reporteId?: string;
  paso?: number;
}

export interface FotoGuardada {
  id: string;
  url: string;
  storagePath: string;
}

export async function guardarFotoEntrante(db: Firestore, entrada: EntradaFoto): Promise<FotoGuardada> {
  const bucket = getStorage().bucket();
  const ext = entrada.mimetype.includes('png') ? 'png' : entrada.mimetype.includes('webp') ? 'webp' : 'jpg';

  // Ruta forward-compatible: equipo → reporte → paso cuando hay contexto
  // (Fase 2); si no, bandeja por técnico (Fase 1).
  const base =
    entrada.equipoId && entrada.reporteId
      ? `equipos/${entrada.equipoId}/reportes/${entrada.reporteId}/pasos/${entrada.paso ?? 0}`
      : `entrantes/${entrada.telefono}`;
  const token = randomUUID();
  const storagePath = `${base}/${Date.now()}-${token.slice(0, 8)}.${ext}`;

  const file = bucket.file(storagePath);
  await file.save(entrada.buffer, {
    resumable: false,
    contentType: entrada.mimetype,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });

  // URL de descarga estilo Firebase (persistente mientras exista el token).
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    storagePath
  )}?alt=media&token=${token}`;

  const ref = await db.collection('fotos_entrantes').add({
    telefono: entrada.telefono,
    nombre: entrada.nombre,
    caption: entrada.caption ?? null,
    storagePath,
    url,
    mimetype: entrada.mimetype,
    equipoId: entrada.equipoId ?? null,
    reporteId: entrada.reporteId ?? null,
    paso: entrada.paso ?? null,
    recibidaEn: FieldValue.serverTimestamp(),
  });

  return { id: ref.id, url, storagePath };
}
