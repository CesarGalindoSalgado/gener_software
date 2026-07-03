import { FieldValue, Firestore } from 'firebase-admin/firestore';

// CRUD de plantillas (Admin SDK). Las escrituras pasan por aquí (los clientes
// solo leen). El dueño y el superAdmin gestionan plantillas.

export interface DatosPlantilla {
  nombre: string;
  descripcion?: string;
  precioSugerido?: number | null;
  lineas: string[];
  activa: boolean;
}

function limpiar(datos: Partial<DatosPlantilla>) {
  const out: Record<string, unknown> = {};
  if (datos.nombre !== undefined) out.nombre = datos.nombre.trim();
  if (datos.descripcion !== undefined) out.descripcion = datos.descripcion?.trim() || null;
  if (datos.precioSugerido !== undefined) {
    out.precioSugerido = datos.precioSugerido === null ? null : Number(datos.precioSugerido);
  }
  if (datos.lineas !== undefined) {
    out.lineas = datos.lineas.map((l) => l.trim()).filter(Boolean);
  }
  if (datos.activa !== undefined) out.activa = !!datos.activa;
  return out;
}

export async function crearPlantilla(db: Firestore, datos: DatosPlantilla): Promise<string> {
  if (!datos.nombre?.trim()) throw new Error('La plantilla necesita un nombre.');
  const ref = await db.collection('plantillas').add({
    ...limpiar(datos),
    activa: datos.activa ?? true,
    creadaEn: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function actualizarPlantilla(
  db: Firestore,
  plantillaId: string,
  cambios: Partial<DatosPlantilla>
): Promise<void> {
  const upd = limpiar(cambios);
  if (Object.keys(upd).length === 0) return;
  await db.doc(`plantillas/${plantillaId}`).set(upd, { merge: true });
}
