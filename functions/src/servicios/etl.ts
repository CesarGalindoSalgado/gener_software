import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import { reconciliarTotales } from '../dominio/totales';
import { nombreContador, parsearFolio } from '../dominio/folio';
import { Partida } from '../dominio/tipos';

// ETL de carga semilla del histórico. Consume cotizaciones ya extraídas a JSON
// normalizado (mismo esquema del sistema) y:
//   1) valida reconciliación de totales (IVA 16%, ±0.01) como filtro de calidad
//   2) carga cada una como cotización `estatus: importada` (idempotente por folio)
//   3) deriva la bitácora de precios (precios_historicos, origen: import)
//   4) calcula la semilla del contador de folio por año (consecutivo más alto)
//
// Idempotente: el id del doc de cotización se deriva del folio, y los registros
// de bitácora usan id determinista; re-ejecutar no duplica.

export interface CotizacionImportada {
  folio: string;
  fecha: string; // ISO
  cliente: { nombre: string; atencion?: string | null; telefono?: string | null; correo?: string | null };
  asunto: string;
  partidas: Partida[];
  subtotal: number;
  iva: number;
  total: number;
  formaPago?: string;
  tiempoEntrega?: string;
  anio?: number;
}

export interface ResultadoETL {
  procesadas: number;
  importadas: number;
  rechazadas: { folio: string; motivo: string }[];
  registrosBitacora: number;
  semillasFolio: Record<string, number>; // por mes: { "folio_2026_07": 7, "folio_2025_12": 19 }
}

function idDeFolio(folio: string): string {
  return folio.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '_');
}

export async function importarCotizaciones(
  db: Firestore,
  registros: CotizacionImportada[]
): Promise<ResultadoETL> {
  const res: ResultadoETL = {
    procesadas: registros.length,
    importadas: 0,
    rechazadas: [],
    registrosBitacora: 0,
    semillasFolio: {},
  };

  // Semilla por MES (clave = nombre del contador, ej. "folio_2026_07").
  const semillas: Record<string, number> = {};

  for (const r of registros) {
    const parsed = parsearFolio(r.folio);
    if (!parsed) {
      res.rechazadas.push({ folio: r.folio, motivo: 'Folio con formato inválido.' });
      continue;
    }

    // Filtro de calidad: los totales deben reconciliar (suma = subtotal, IVA 16%).
    const rec = reconciliarTotales(r.partidas, { subtotal: r.subtotal, iva: r.iva, total: r.total });
    if (!rec.ok) {
      res.rechazadas.push({
        folio: r.folio,
        motivo: `No reconcilia (suma:${rec.sumaPartidasOk} iva16:${rec.iva16Ok} total:${rec.totalOk}).`,
      });
      continue;
    }

    const clave = nombreContador(parsed.anio, parsed.mes); // ej. folio_2026_07
    semillas[clave] = Math.max(semillas[clave] ?? 0, parsed.consecutivo);

    const cotId = idDeFolio(r.folio);
    const fecha = Timestamp.fromDate(new Date(r.fecha));
    const cotRef = db.doc(`cotizaciones/${cotId}`);
    const versionId = `${cotId}_import`;

    const batch = db.batch();

    // Cliente denormalizado (no creamos doc en `clientes` para el histórico).
    batch.set(cotRef, {
      folio: r.folio.trim().toUpperCase(),
      clienteId: null,
      cliente: {
        nombre: r.cliente.nombre,
        atencion: r.cliente.atencion ?? null,
        telefono: r.cliente.telefono ?? null,
        correo: r.cliente.correo ?? null,
      },
      titulo: r.asunto,
      estatus: 'importada',
      revActual: 'A',
      versionActualId: versionId,
      fechaCreacion: fecha,
      fechaEnvio: fecha,
      origen: 'import',
    });

    batch.set(db.doc(`cotizaciones/${cotId}/versiones/${versionId}`), {
      rev: 'A',
      estatus: 'importada',
      partidas: r.partidas,
      subtotal: r.subtotal,
      iva: r.iva,
      total: r.total,
      formaPago: r.formaPago ?? '',
      tiempoEntrega: r.tiempoEntrega ?? '',
      fecha,
    });

    // Bitácora: una entrada por partida (id determinista → idempotente).
    r.partidas.forEach((p, i) => {
      batch.set(db.doc(`precios_historicos/${versionId}_${i}`), {
        clienteId: null,
        clienteNombre: r.cliente.nombre,
        concepto: p.titulo,
        precio: p.importe,
        fecha,
        origen: 'import',
        versionId,
        cotizacionId: cotId,
        folio: r.folio.trim().toUpperCase(),
        registradoEn: FieldValue.serverTimestamp(),
      });
      res.registrosBitacora++;
    });

    await batch.commit();
    res.importadas++;
  }

  // Semilla del contador por MES: el consecutivo más alto encontrado en cada mes.
  // Solo se sube (nunca baja) para no pisar folios ya emitidos por el sistema.
  for (const [contador, maxConsecutivo] of Object.entries(semillas)) {
    const ref = db.doc(`counters/${contador}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const actual = snap.exists ? (snap.data()!.ultimo as number) : 0;
      const nuevo = Math.max(actual, maxConsecutivo);
      tx.set(ref, { ultimo: nuevo });
      res.semillasFolio[contador] = nuevo;
    });
  }

  return res;
}
