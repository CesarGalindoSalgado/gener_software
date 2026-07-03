import { Firestore } from 'firebase-admin/firestore';
import { aprobarCotizacion } from '../servicios/aprobar';
import {
  actualizarDatos,
  agregarBloque,
  ajustarPrecioBloque,
  buscarHistorico,
  clonarComoBase,
  consultarCotizaciones,
  crearBorrador,
  crearRecordatorio,
  quitarBloque,
} from '../servicios/cotizaciones';
import { ContextoEjecucion, EjecutorHerramientas } from './herramientas';

// Implementación real (fase 2) del contrato de herramientas: conecta el LLM
// con los servicios de dominio sobre Firestore.

function refsDeContexto(ctx: ContextoEjecucion) {
  if (!ctx.cotizacionId || !ctx.versionId) {
    throw new Error(
      'No hay una cotización en edición. Crea primero un borrador con crearBorrador.'
    );
  }
  return { cotizacionId: ctx.cotizacionId, versionId: ctx.versionId };
}

export function crearEjecutor(db: Firestore): EjecutorHerramientas {
  return {
    async ejecutar(nombre, entrada, ctx): Promise<string> {
      const input = (entrada ?? {}) as Record<string, unknown>;

      switch (nombre) {
        case 'buscarHistorico': {
          const res = await buscarHistorico(db, {
            cliente: input.cliente as string | undefined,
            concepto: String(input.concepto ?? ''),
          });
          return JSON.stringify(
            res.length ? res : { aviso: 'Sin registros en el histórico todavía (la carga semilla llega en la fase 3). Pide el precio al usuario.' }
          );
        }

        case 'crearBorrador': {
          const refs = await crearBorrador(db, {
            clienteNombre: String(input.clienteNombre ?? 'Cliente'),
            titulo: String(input.titulo ?? 'Cotización'),
            creadoPor: ctx.correo,
          });
          return JSON.stringify({ ...refs, aviso: 'Borrador creado (Rev. A, sin folio).' });
        }

        case 'agregarBloque': {
          const res = await agregarBloque(db, refsDeContexto(ctx), {
            titulo: String(input.titulo ?? 'Concepto'),
            descripcion: input.descripcion as string | undefined,
            lineas: (input.lineas as string[] | undefined) ?? [],
            cantidad: input.cantidad as number | undefined,
            importe: Number(input.importe ?? 0),
          });
          return JSON.stringify({ bloques: res.partidas.length, subtotal: res.subtotal, iva: res.iva, total: res.total });
        }

        case 'ajustarPrecioBloque': {
          const res = await ajustarPrecioBloque(
            db,
            refsDeContexto(ctx),
            Number(input.bloque ?? -1),
            Number(input.nuevoImporte ?? 0)
          );
          return JSON.stringify({ subtotal: res.subtotal, iva: res.iva, total: res.total });
        }

        case 'quitarBloque': {
          const res = await quitarBloque(db, refsDeContexto(ctx), Number(input.bloque ?? -1));
          return JSON.stringify({ bloques: res.partidas.length, subtotal: res.subtotal, iva: res.iva, total: res.total });
        }

        case 'actualizarDatos': {
          const res = await actualizarDatos(db, refsDeContexto(ctx), {
            titulo: input.titulo as string | undefined,
            formaPago: input.formaPago as string | undefined,
            tiempoEntrega: input.tiempoEntrega as string | undefined,
            atencion: input.atencion as string | undefined,
          });
          return JSON.stringify(res);
        }

        case 'aprobarCotizacion': {
          const cotizacionId = (input.cotizacionId as string | undefined) ?? ctx.cotizacionId;
          if (!cotizacionId) throw new Error('No hay cotización para aprobar.');
          const res = await aprobarCotizacion(db, {
            cotizacionId,
            correoAprobador: ctx.correo,
          });
          return JSON.stringify({ folio: res.folio, aviso: 'Cotización aprobada y enviada.' });
        }

        case 'consultarCotizacion': {
          const res = await consultarCotizaciones(db, {
            folio: input.folio as string | undefined,
            cliente: input.cliente as string | undefined,
          });
          return JSON.stringify(res.length ? res : { aviso: 'No se encontraron cotizaciones con ese criterio.' });
        }

        case 'clonarComoBase': {
          const refs = await clonarComoBase(db, {
            cotizacionId: String(input.cotizacionId ?? ''),
            clienteNombre: String(input.clienteNombre ?? 'Cliente'),
            creadoPor: ctx.correo,
          });
          return JSON.stringify({ ...refs, aviso: 'Borrador clonado (sin folio, forma de pago del cliente destino).' });
        }

        case 'crearRecordatorio': {
          const res = await crearRecordatorio(db, {
            correo: ctx.correo,
            descripcion: String(input.descripcion ?? ''),
            clienteTexto: input.clienteTexto as string | undefined,
          });
          return JSON.stringify({ ...res, aviso: 'Recordatorio guardado.' });
        }

        default:
          throw new Error(`Herramienta desconocida: ${nombre}`);
      }
    },
  };
}
