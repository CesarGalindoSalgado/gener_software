import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { Partida } from '../dominio/tipos';

// Bitácora de precios: efecto POSTERIOR a la aprobación (no va en la
// transacción del folio). Cada partida de la versión aprobada se guarda en
// precios_historicos con origen 'version'.
//
// Idempotente por (versionId + índice de partida): el id del documento es
// determinista, así que reintentar la aprobación no duplica registros.

export interface DatosBitacora {
  cotizacionId: string;
  versionId: string;
  clienteId: string;
  clienteNombre: string;
  folio: string;
  fecha: Date;
  partidas: Partida[];
}

export async function escribirBitacora(db: Firestore, datos: DatosBitacora): Promise<number> {
  const batch = db.batch();
  datos.partidas.forEach((p, i) => {
    // Id determinista → reejecución idempotente (mismo doc, no duplica).
    const id = `${datos.versionId}_${i}`;
    const ref = db.doc(`precios_historicos/${id}`);
    batch.set(ref, {
      clienteId: datos.clienteId,
      clienteNombre: datos.clienteNombre,
      concepto: p.titulo,
      precio: p.importe,
      fecha: datos.fecha,
      origen: 'version',
      versionId: datos.versionId,
      cotizacionId: datos.cotizacionId,
      folio: datos.folio,
      registradoEn: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  return datos.partidas.length;
}
