import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { validarTransicion } from '../dominio/estados';
import { formatearFolio, nombreContador, partesFechaNegocio } from '../dominio/folio';

export type CodigoErrorAprobacion = 'sin-permiso' | 'no-existe' | 'ya-tiene-folio';

export class ErrorAprobacion extends Error {
  constructor(mensaje: string, public codigo: CodigoErrorAprobacion) {
    super(mensaje);
    this.name = 'ErrorAprobacion';
  }
}

export interface ResultadoAprobacion {
  folio: string;
  consecutivo: number;
}

// Aprobación = transacción + efectos.
// AQUÍ solo la parte transaccional (atómica de verdad): contador de folio,
// folio, estatus borrador → enviada y fechaEnvio. Los efectos (PDF, Drive,
// bitácora, "¿enviar o descargar?") se disparan con el cambio de estatus y
// son idempotentes con reintento — NUNCA van dentro de la transacción.
export async function aprobarCotizacion(
  db: Firestore,
  params: {
    cotizacionId: string;
    telefonoAprobador: string;
    ahora?: Date;
    semilla?: number; // solo se usa si el contador del año aún no existe
  }
): Promise<ResultadoAprobacion> {
  const ahora = params.ahora ?? new Date();

  // Gate de rol validado en backend, no solo en UI: solo el dueño aprueba.
  const usuarioSnap = await db.doc(`usuarios/${params.telefonoAprobador}`).get();
  const usuario = usuarioSnap.data();
  if (!usuarioSnap.exists || !usuario?.activo || usuario.rol !== 'dueno') {
    throw new ErrorAprobacion('Solo el dueño puede aprobar cotizaciones.', 'sin-permiso');
  }

  return db.runTransaction(async (tx) => {
    const cotRef = db.doc(`cotizaciones/${params.cotizacionId}`);
    const cotSnap = await tx.get(cotRef);
    if (!cotSnap.exists) {
      throw new ErrorAprobacion(`No existe la cotización ${params.cotizacionId}.`, 'no-existe');
    }
    const cot = cotSnap.data()!;
    if (cot.folio) {
      // El folio se asigna UNA sola vez; una revisión no consume folio nuevo.
      throw new ErrorAprobacion(`La cotización ya tiene folio ${cot.folio}.`, 'ya-tiene-folio');
    }
    validarTransicion(cot.estatus, 'enviada');

    // MM/YY del mes de aprobación en la zona del negocio (Morelos), no en UTC.
    const { anio, mes } = partesFechaNegocio(ahora);
    const contadorRef = db.doc(`counters/${nombreContador(anio)}`);
    const contadorSnap = await tx.get(contadorRef);
    const ultimo = contadorSnap.exists
      ? (contadorSnap.data()!.ultimo as number)
      : params.semilla ?? 0;
    const consecutivo = ultimo + 1;
    const folio = formatearFolio(anio, mes, consecutivo);

    tx.set(contadorRef, { ultimo: consecutivo });
    tx.update(cotRef, {
      folio,
      estatus: 'enviada',
      fechaEnvio: Timestamp.fromDate(ahora),
    });
    return { folio, consecutivo };
  });
}
