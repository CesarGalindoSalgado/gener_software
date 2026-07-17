import { Firestore } from 'firebase-admin/firestore';
import { aprobarCotizacion } from '../servicios/aprobar';
import {
  actualizarDatos,
  agregarBloque,
  agregarDesdePlantilla,
  agregarLineaBloque,
  ajustarPrecioBloque,
  buscarClientes,
  buscarHistorico,
  clonarComoBase,
  copiarBloquesEnActual,
  consultarCotizaciones,
  consultarSeguimiento,
  crearBorrador,
  datosPreviewCotizacion,
  crearRecordatorio,
  editarLineaBloque,
  leerPartidas,
  listarClientes,
  listarPlantillas,
  quitarBloque,
  quitarLineaBloque,
  registrarCliente,
} from '../servicios/cotizaciones';
import { listarRecordatoriosDe, marcarRecordatorio } from '../servicios/recordatorios';
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
            clienteNombre: String(input.clienteNombre ?? ''),
            titulo: String(input.titulo ?? ''),
            atencion: input.atencion as string | undefined,
            creadoPor: ctx.correo,
          });
          // Deja la cotización recién creada como la "en edición": el intake sin
          // cotización pasa a modo taller y las siguientes herramientas ya operan.
          ctx.cotizacionId = refs.cotizacionId;
          ctx.versionId = refs.versionId;
          return JSON.stringify({ ...refs, aviso: 'Borrador creado (Rev. A, sin folio).' });
        }

        case 'agregarBloque': {
          const res = await agregarBloque(db, refsDeContexto(ctx), {
            titulo: String(input.titulo ?? 'Concepto'),
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

        case 'listarPlantillas': {
          const res = await listarPlantillas(db);
          return JSON.stringify(res.length ? res : { aviso: 'No hay plantillas cargadas todavía.' });
        }

        case 'agregarDesdePlantilla': {
          const res = await agregarDesdePlantilla(db, refsDeContexto(ctx), {
            nombre: input.nombre as string | undefined,
            plantillaId: input.plantillaId as string | undefined,
            subtipo: input.subtipo as string | undefined,
            importe: input.importe as number | undefined,
          });
          return JSON.stringify({ bloques: res.partidas.length, subtotal: res.subtotal, iva: res.iva, total: res.total });
        }

        case 'quitarBloque': {
          const res = await quitarBloque(db, refsDeContexto(ctx), Number(input.bloque ?? -1));
          return JSON.stringify({ bloques: res.partidas.length, subtotal: res.subtotal, iva: res.iva, total: res.total });
        }

        case 'verBloques': {
          const partidas = await leerPartidas(db, refsDeContexto(ctx));
          // Devolvemos los índices 0-based explícitos para que el agente los use en
          // agregarLinea/editarLinea/quitarLinea sin equivocarse.
          return JSON.stringify({
            bloques: partidas.map((p, i) => ({
              bloque: i,
              titulo: p.titulo,
              lineas: (p.lineas ?? []).map((texto, j) => ({ linea: j, texto })),
            })),
          });
        }

        case 'agregarLinea': {
          const res = await agregarLineaBloque(db, refsDeContexto(ctx), Number(input.bloque ?? -1), String(input.texto ?? ''));
          const b = res.partidas[Number(input.bloque ?? -1)];
          return JSON.stringify({ aviso: 'Renglón agregado.', bloque: Number(input.bloque), lineas: b?.lineas ?? [] });
        }

        case 'editarLinea': {
          const res = await editarLineaBloque(
            db,
            refsDeContexto(ctx),
            Number(input.bloque ?? -1),
            Number(input.linea ?? -1),
            String(input.texto ?? '')
          );
          const b = res.partidas[Number(input.bloque ?? -1)];
          return JSON.stringify({ aviso: 'Renglón actualizado.', bloque: Number(input.bloque), lineas: b?.lineas ?? [] });
        }

        case 'quitarLinea': {
          const res = await quitarLineaBloque(db, refsDeContexto(ctx), Number(input.bloque ?? -1), Number(input.linea ?? -1));
          const b = res.partidas[Number(input.bloque ?? -1)];
          return JSON.stringify({ aviso: 'Renglón eliminado.', bloque: Number(input.bloque), lineas: b?.lineas ?? [] });
        }

        case 'listarClientes': {
          const res = await listarClientes(db);
          return JSON.stringify(
            res.length ? { clientes: res.map((c) => c.nombre), total: res.length } : { clientes: [], aviso: 'Aún no hay clientes registrados.' }
          );
        }

        case 'agregarCliente': {
          const res = await registrarCliente(db, String(input.nombre ?? ''));
          return JSON.stringify({ ...res, aviso: 'Cliente registrado.' });
        }

        case 'buscarCliente': {
          const res = await buscarClientes(db, String(input.nombre ?? ''));
          return JSON.stringify(
            res.length
              ? { clientes: res }
              : { clientes: [], aviso: 'No hay ningún cliente con ese nombre. Pregúntale al usuario si quiere agregarlo antes de fijarlo.' }
          );
        }

        case 'actualizarDatos': {
          const res = await actualizarDatos(db, refsDeContexto(ctx), {
            clienteNombre: input.clienteNombre as string | undefined,
            titulo: input.titulo as string | undefined,
            formaPago: input.formaPago as string | undefined,
            tiempoEntrega: input.tiempoEntrega as string | undefined,
            notas: input.notas as string | undefined,
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
          // De cara al usuario el estatus se llama "aprobada" (internamente es
          // 'enviada'); NO menciones "enviada" al usuario.
          return JSON.stringify({ folio: res.folio, estatus: 'aprobada', aviso: `Cotización aprobada. Folio ${res.folio}. Ya está en estatus "aprobada".` });
        }

        case 'consultarCotizacion': {
          // Solo INFORMA / lista (para que el usuario elija). Para ABRIR una copia
          // de trabajo se usa clonarComoBase (crea un borrador nuevo).
          const res = await consultarCotizaciones(db, {
            folio: input.folio as string | undefined,
            cliente: input.cliente as string | undefined,
            orden: input.orden === 'antigua' ? 'antigua' : undefined,
          });
          return JSON.stringify(res.length ? res : { aviso: 'No se encontraron cotizaciones con ese criterio.' });
        }

        case 'previsualizarCotizacion': {
          const preview = await datosPreviewCotizacion(db, {
            cotizacionId: input.cotizacionId ? String(input.cotizacionId) : undefined,
            folio: input.folio ? String(input.folio) : undefined,
            cliente: input.cliente ? String(input.cliente) : undefined,
            orden: input.orden === 'antigua' ? 'antigua' : undefined,
          });
          if (!preview) {
            return JSON.stringify({ error: 'No encontré una cotización de ese cliente para mostrar.' });
          }
          // El front la renderiza en el panel (solo lectura). NO se guarda nada.
          ctx.preview = preview;
          return JSON.stringify({
            folio: preview.folio,
            titulo: preview.titulo,
            cliente: preview.cliente.nombre,
            aviso: `Mostré en el panel la cotización de ${preview.cliente.nombre}${preview.folio ? ` (${preview.folio})` : ''}: "${preview.titulo}". PREGÚNTALE al usuario si usamos ESTA como base o buscamos otra. NO la clones hasta que confirme.`,
          });
        }

        case 'clonarComoBase': {
          // Si el usuario está confirmando una VISTA PREVIA, clonamos EXACTAMENTE
          // esa cotización (por id), no re-resolvemos por cliente (que tomaría la
          // más reciente y podría clonar otra distinta a la que vio).
          const idPreview = ctx.preview?.cotizacionId ?? ctx.previewCotizacionId;
          const refs = await clonarComoBase(db, {
            cotizacionId: idPreview ?? (input.cotizacionId ? String(input.cotizacionId) : undefined),
            folio: idPreview ? undefined : input.folio ? String(input.folio) : undefined,
            cliente: idPreview ? undefined : input.cliente ? String(input.cliente) : undefined,
            clienteNombre: input.clienteNombre ? String(input.clienteNombre) : undefined,
            orden: idPreview ? undefined : input.orden === 'antigua' ? 'antigua' : undefined,
            creadoPor: ctx.correo,
          });
          ctx.preview = undefined;
          ctx.previewCotizacionId = undefined;
          // Deja el clon como la cotización "en edición": el portal redirige al
          // taller del clon (tanto en intake como con otra cotización abierta).
          ctx.cotizacionId = refs.cotizacionId;
          ctx.versionId = refs.versionId;
          return JSON.stringify({
            cotizacionId: refs.cotizacionId,
            clonadaDe: refs.origen, // { cliente, titulo, folio } — di EXACTAMENTE esto, no inventes
            aviso: `Copia de trabajo creada a partir de la cotización de ${refs.origen.cliente}${refs.origen.folio ? ` (${refs.origen.folio})` : ''}: "${refs.origen.titulo}". Ya está abierta en el panel. Confírmalo con ESE cliente y asunto exactos.`,
          });
        }

        case 'copiarBloques': {
          const res = await copiarBloquesEnActual(db, refsDeContexto(ctx), {
            cotizacionId: input.cotizacionId ? String(input.cotizacionId) : undefined,
            cliente: input.cliente ? String(input.cliente) : undefined,
          });
          return JSON.stringify({ ...res, aviso: 'Bloques agregados a la cotización actual.' });
        }

        case 'crearRecordatorio': {
          const res = await crearRecordatorio(db, {
            correo: ctx.correo,
            descripcion: String(input.descripcion ?? ''),
            clienteTexto: input.clienteTexto as string | undefined,
          });
          return JSON.stringify({ ...res, aviso: 'Recordatorio guardado.' });
        }

        case 'misRecordatorios': {
          const res = await listarRecordatoriosDe(db, ctx.correo);
          if (!res.length) return JSON.stringify({ aviso: 'No tienes recordatorios pendientes.' });
          // Sin IDs: numerados para el usuario. El número sirve para marcarlos hechos.
          return JSON.stringify(
            res.map((r, i) => ({ numero: i + 1, descripcion: r.descripcion, cliente: r.cliente }))
          );
        }

        case 'marcarRecordatorioHecho': {
          const numero = Number(input.numero ?? 0);
          const lista = await listarRecordatoriosDe(db, ctx.correo);
          const objetivo = lista[numero - 1];
          if (!objetivo) {
            return JSON.stringify({
              error: `No hay un recordatorio número ${numero}. Tienes ${lista.length} pendiente(s).`,
            });
          }
          await marcarRecordatorio(db, objetivo.recordatorioId, 'hecho');
          return JSON.stringify({ ok: true, aviso: `Marcado como hecho: "${objetivo.descripcion}".` });
        }

        case 'consultarSeguimiento': {
          const res = await consultarSeguimiento(db);
          return JSON.stringify(
            res.length ? res : { aviso: 'No hay cotizaciones enviadas sin cerrar.' }
          );
        }

        default:
          throw new Error(`Herramienta desconocida: ${nombre}`);
      }
    },
  };
}
