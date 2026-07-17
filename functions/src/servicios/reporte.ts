import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { formatearFolioReporte, nombreContadorReporte, partesFechaNegocio } from '../dominio/folioReporte';
import { RutinaEjecucion, RutinaPlantilla } from '../dominio/tipos';
import { DatosReporte } from './documentoReporteHtml';

export class ErrorReporte extends Error {
  constructor(mensaje: string, public codigo: string) {
    super(mensaje);
  }
}

// Valida una ejecución completada y le asigna folio de reporte en transacción
// (counters/reporte_{anio}). Idempotente: si ya tiene folio, lo devuelve tal
// cual sin consumir otro. Mismo patrón que la aprobación de cotizaciones.
export async function validarYFoliar(
  db: Firestore,
  ejecucionId: string,
  ahora: Date
): Promise<{ folio: string; consecutivo: number }> {
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`rutinas_ejecucion/${ejecucionId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ErrorReporte('No existe la ejecución.', 'no-existe');
    const ejec = snap.data() as RutinaEjecucion;

    if (ejec.folio) return { folio: ejec.folio, consecutivo: -1 }; // ya foliada

    // El flujo de campo termina en firmada / faltante_firma (o completada si no
    // se pidió firma). Cualquiera de esos se puede foliar; en_proceso/cancelada no.
    if (!['completada', 'firmada', 'faltante_firma'].includes(ejec.estatus)) {
      throw new ErrorReporte('La rutina aún no ha terminado.', 'estado');
    }

    const { anio, mes } = partesFechaNegocio(ahora);
    const contadorRef = db.doc(`counters/${nombreContadorReporte(anio)}`);
    const cSnap = await tx.get(contadorRef);
    const ultimo = cSnap.exists ? (cSnap.data()!.ultimo as number) : 0;
    const consecutivo = ultimo + 1;
    const folio = formatearFolioReporte(anio, mes, consecutivo);

    tx.set(contadorRef, { ultimo: consecutivo });
    // No pisamos el estatus (firmada / faltante_firma / completada): "validado"
    // = tiene folio. Solo asignamos folio + sello de validación.
    tx.update(ref, { folio, fechaValidacion: Timestamp.fromDate(ahora) });
    return { folio, consecutivo };
  });
}

// Arma los datos del reporte (resuelve nombres de equipo/sede/rutina) para
// renderizar el HTML/PDF.
export async function datosReporte(db: Firestore, ejecucionId: string): Promise<DatosReporte | null> {
  const snap = await db.doc(`rutinas_ejecucion/${ejecucionId}`).get();
  if (!snap.exists) return null;
  const e = snap.data() as RutinaEjecucion & { inicio?: Timestamp };
  const [equipoSnap, sedeSnap, rutinaSnap] = await Promise.all([
    db.doc(`equipos/${e.equipoId}`).get(),
    db.doc(`sedes/${e.sedeId}`).get(),
    db.doc(`rutinas_plantilla/${e.rutinaId}`).get(),
  ]);
  // Cliente de la sede (nombre) para el encabezado del reporte.
  const clienteId = sedeSnap.get('clienteId') as string | undefined;
  const clienteSnap = clienteId ? await db.doc(`clientes/${clienteId}`).get() : null;
  const fecha = (e.inicio as Timestamp | undefined)?.toDate?.() ?? new Date();
  // El rango (min/max) vive en la plantilla; lo copiamos a cada paso de medición
  // para que el reporte pueda dibujar la barra del gráfico.
  const plantilla = rutinaSnap.exists ? (rutinaSnap.data() as RutinaPlantilla) : undefined;
  const pasos = (e.pasos ?? []).map((p) => {
    const evp = plantilla?.pasos?.find((pp) => pp.orden === p.orden)?.evidencia;
    return evp?.rangoDefinido ? { ...p, rangoMin: evp.rangoMin, rangoMax: evp.rangoMax } : p;
  });
  return {
    folio: e.folio ?? null,
    fecha,
    rutinaNombre: (rutinaSnap.get('nombre') as string) ?? e.rutinaId,
    equipo: (equipoSnap.get('noInventario') as string) ?? '—',
    sede: (sedeSnap.get('nombre') as string) ?? '—',
    cliente: (clienteSnap?.get('nombre') as string) ?? null,
    // "Recibe": lo que capturó el técnico al cierre; si no, el responsable de la sede.
    recibe: ((e as { recibeNombre?: string }).recibeNombre || (sedeSnap.get('responsable') as string)) ?? null,
    tecnico: e.tecnicoNombre || e.tecnicoTelefono,
    pasos,
    oportunidad: e.oportunidad ?? null,
    evidenciaFirmaUrl: e.evidenciaFirmaUrl ?? null,
    faltanteFirmaRazon: e.faltanteFirmaRazon ?? null,
    aprobado: (e as { reporteAprobado?: boolean }).reporteAprobado === true,
  };
}
