import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  formatearFolioReparacion,
  nombreContadorReparacion,
  partesFechaNegocio,
} from '../dominio/folioReparacion';
import { ContactoCliente, DiagnosticoReparacion, EquipoReparacion, EstatusReparacion } from '../dominio/tipos';
import { validarTransicionReparacion } from '../dominio/reparacion';
import { crearBorrador } from './cotizaciones';

export class ErrorReparacion extends Error {
  constructor(mensaje: string, public codigo: string) {
    super(mensaje);
    this.name = 'ErrorReparacion';
  }
}

export interface DatosRecepcion {
  clienteId?: string | null;
  clienteNombre: string;
  contacto?: ContactoCliente | null;
  equipo: EquipoReparacion;
  fallaReportada: string;
  fotosRecepcion?: string[];
  recibidoPor?: string | null; // correo del operador que recibió
}

// Recibe un equipo en el taller: asigna el folio OR-… en transacción (contador
// mensual, mismo patrón que la aprobación de cotizaciones y los reportes) y crea
// la Orden de Reparación en estatus 'recibido'. El folio es el número de rastreo
// desde que el equipo entra.
export async function crearOrdenReparacion(
  db: Firestore,
  datos: DatosRecepcion,
  ahora: Date
): Promise<{ ordenId: string; folio: string; consecutivo: number }> {
  if (!datos.clienteNombre?.trim()) throw new ErrorReparacion('Falta el cliente.', 'cliente');
  if (!datos.equipo?.descripcion?.trim()) throw new ErrorReparacion('Describe el equipo que llegó.', 'equipo');
  if (!datos.fallaReportada?.trim()) throw new ErrorReparacion('Falta la falla reportada.', 'falla');

  const { anio, mes } = partesFechaNegocio(ahora);
  const ordenRef = db.collection('ordenes_reparacion').doc();

  return db.runTransaction(async (tx) => {
    const contadorRef = db.doc(`counters/${nombreContadorReparacion(anio, mes)}`);
    const cSnap = await tx.get(contadorRef);
    const consecutivo = (cSnap.exists ? (cSnap.data()!.ultimo as number) : 0) + 1;
    const folio = formatearFolioReparacion(anio, mes, consecutivo);
    const ts = Timestamp.fromDate(ahora);

    tx.set(contadorRef, { ultimo: consecutivo });
    tx.set(ordenRef, {
      folio,
      estatus: 'recibido',
      clienteId: datos.clienteId ?? null,
      clienteNombre: datos.clienteNombre.trim(),
      contacto: datos.contacto ?? null,
      equipo: {
        descripcion: datos.equipo.descripcion.trim(),
        marca: datos.equipo.marca?.trim() || null,
        modelo: datos.equipo.modelo?.trim() || null,
        numeroSerie: datos.equipo.numeroSerie?.trim() || null,
        accesorios: datos.equipo.accesorios?.trim() || null,
      },
      fallaReportada: datos.fallaReportada.trim(),
      fotosRecepcion: datos.fotosRecepcion ?? [],
      recibidoPor: datos.recibidoPor ?? null,
      diagnostico: null,
      cotizacionId: null,
      reparacion: null,
      entrega: null,
      rechazoRazon: null,
      garantia: null,
      fechaRecepcion: ts,
      fechas: { recibido: ts },
      creadoEn: FieldValue.serverTimestamp(),
    });
    return { ordenId: ordenRef.id, folio, consecutivo };
  });
}

// Guarda el diagnóstico del técnico. Si la orden estaba 'recibido', avanza a
// 'en_diagnostico' (aquí es donde se decide si se puede/quiere reparar).
export async function guardarDiagnostico(
  db: Firestore,
  ordenId: string,
  datos: DiagnosticoReparacion,
  ahora: Date
): Promise<{ ok: true }> {
  if (!ordenId) throw new ErrorReparacion('Falta la orden.', 'orden');
  if (!datos.hallazgos?.trim()) throw new ErrorReparacion('Escribe los hallazgos del diagnóstico.', 'hallazgos');
  const ref = db.doc(`ordenes_reparacion/${ordenId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ErrorReparacion('No existe la orden.', 'no-existe');
    const estatus = snap.get('estatus') as EstatusReparacion;
    const ts = Timestamp.fromDate(ahora);
    const cambios: Record<string, unknown> = {
      diagnostico: {
        hallazgos: datos.hallazgos.trim(),
        refacciones: datos.refacciones?.trim() || null,
        tecnico: datos.tecnico?.trim() || null,
      },
    };
    // Al primer diagnóstico, sale de 'recibido' a 'en_diagnostico'.
    if (estatus === 'recibido') {
      cambios.estatus = 'en_diagnostico';
      cambios['fechas.en_diagnostico'] = ts;
    }
    tx.update(ref, cambios);
  });
  return { ok: true };
}

// Cambia el estatus de una orden validando la transición (dominio/reparacion.ts)
// y sellando la fecha de la etapa. 'rechazado' acepta un motivo.
export async function cambiarEstatusReparacion(
  db: Firestore,
  ordenId: string,
  nuevo: EstatusReparacion,
  ahora: Date,
  motivo?: string | null
): Promise<{ ok: true; estatus: EstatusReparacion }> {
  if (!ordenId) throw new ErrorReparacion('Falta la orden.', 'orden');
  const ref = db.doc(`ordenes_reparacion/${ordenId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ErrorReparacion('No existe la orden.', 'no-existe');
    const actual = snap.get('estatus') as EstatusReparacion;
    // Lanza si la transición no es válida (mensaje legible para el usuario).
    validarTransicionReparacion(actual, nuevo);
    const ts = Timestamp.fromDate(ahora);
    const cambios: Record<string, unknown> = { estatus: nuevo };
    cambios[`fechas.${nuevo}`] = ts;
    if (nuevo === 'rechazado' && motivo?.trim()) cambios.rechazoRazon = motivo.trim();
    tx.update(ref, cambios);
  });
  return { ok: true, estatus: nuevo };
}

// Entrega el equipo: valida la transición 'listo' → 'entregado', registra quién
// recibe y (opcional) la URL de la firma/acuse, y sella la fecha de entrega.
export async function entregarOrden(
  db: Firestore,
  ordenId: string,
  datos: { recibeNombre: string; firmaUrl?: string | null },
  ahora: Date
): Promise<{ ok: true }> {
  if (!ordenId) throw new ErrorReparacion('Falta la orden.', 'orden');
  if (!datos.recibeNombre?.trim()) throw new ErrorReparacion('Anota quién recibe el equipo.', 'recibe');
  const ref = db.doc(`ordenes_reparacion/${ordenId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ErrorReparacion('No existe la orden.', 'no-existe');
    validarTransicionReparacion(snap.get('estatus') as EstatusReparacion, 'entregado');
    tx.update(ref, {
      estatus: 'entregado',
      'fechas.entregado': Timestamp.fromDate(ahora),
      entrega: { recibeNombre: datos.recibeNombre.trim(), firmaUrl: datos.firmaUrl?.trim() || null },
    });
  });
  return { ok: true };
}

// Crea una cotización (borrador) a partir de la orden, reutilizando el módulo de
// cotizaciones: cliente y "atención" salen de la orden, el asunto del equipo. La
// enlaza (cotizacionId) y mueve la orden a 'cotizado'. Idempotente: si la orden
// ya tiene cotización, devuelve esa (no crea otra).
export async function crearCotizacionDesdeOrden(
  db: Firestore,
  ordenId: string,
  creadoPor: string,
  ahora: Date
): Promise<{ cotizacionId: string; yaExistia: boolean }> {
  if (!ordenId) throw new ErrorReparacion('Falta la orden.', 'orden');
  const ref = db.doc(`ordenes_reparacion/${ordenId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new ErrorReparacion('No existe la orden.', 'no-existe');

  const existente = snap.get('cotizacionId') as string | undefined;
  if (existente) return { cotizacionId: existente, yaExistia: true };

  // Debe estar diagnosticada para cotizar (valida la transición → 'cotizado').
  const estatus = snap.get('estatus') as EstatusReparacion;
  validarTransicionReparacion(estatus, 'cotizado');

  const equipo = (snap.get('equipo') ?? {}) as { descripcion?: string };
  const contacto = snap.get('contacto') as { nombre?: string } | null;
  const { cotizacionId } = await crearBorrador(db, {
    clienteNombre: String(snap.get('clienteNombre') ?? ''),
    titulo: `Reparación de ${equipo.descripcion ?? 'equipo'}`,
    creadoPor,
    atencion: contacto?.nombre,
  });

  await ref.update({
    cotizacionId,
    estatus: 'cotizado',
    'fechas.cotizado': Timestamp.fromDate(ahora),
  });
  return { cotizacionId, yaExistia: false };
}
