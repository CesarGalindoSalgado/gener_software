import Anthropic from '@anthropic-ai/sdk';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall, onRequest, CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { urlAPdf } from './servicios/render';
import { estadoConfigTelegram, guardarConfigTelegram, registrarWebhookTelegram, tokenTelegram } from './servicios/telegramConfig';
import { crearEjecutor } from './agente/ejecutor';
import { HERRAMIENTAS } from './agente/herramientas';
import { clasificarIntencionRutina, conversarConPortteoGemini, interpretarMensajeAlta } from './agente/portteoGemini';
import { normalizarWebhookWhatsapp } from './canal/whatsapp';
import { BASE_FUNCIONES, HOST_WEB } from './dominio/entorno';
import { ROLES_ADMIN, ROLES_OPERADOR, Rol, Usuario } from './dominio/tipos';
import { procesarMensaje } from './router/router';
import { aprobarCotizacion, ErrorAprobacion } from './servicios/aprobar';
import { validarTransicion } from './dominio/estados';
import { EstatusCotizacion } from './dominio/tipos';
import { escribirBitacora } from './servicios/bitacora';
import {
  actualizarDatos,
  backfillTotalesCotizaciones,
  crearBorrador,
  crearRevision,
  guardarMensajeChat,
  leerHistorialChat,
  mutarPartidas,
} from './servicios/cotizaciones';
import { actualizarUsuario, crearUsuario } from './servicios/usuarios';
import {
  actualizarEquipo,
  actualizarRutina,
  actualizarSede,
  crearClienteRutinas,
  guardarContactosCliente,
  renombrarCliente,
  eliminarCliente,
  crearEquipo,
  crearRutina,
  crearSede,
  crearTipoEquipo,
  eliminarRutina,
  eliminarTipoEquipo,
  importarRutinas,
} from './servicios/rutinas';
import { actualizarPlantilla, crearPlantilla } from './servicios/plantillas';
import { guardarFotoEntrante } from './servicios/evidencia';
import { contextoEjecucionActiva, manejarFotoRutina, manejarTextoRutina } from './servicios/ejecucion';
import {
  crearRecordatorioPortal,
  editarRecordatorio,
  eliminarRecordatorio,
  marcarRecordatorio,
  pendientesPorDueno,
} from './servicios/recordatorios';
import {
  encolarSaliente,
  encolarSalienteUnico,
  guardarMensajeWA,
  leerHistorialWA,
  marcarSaliente,
  salientesPendientes,
} from './servicios/whatsapp';
import { firmarEnlace, verificarEnlace } from './servicios/enlaces';
import { paginaCotizacionHtml, paginaError } from './servicios/documentoHtml';
import {
  enviarCorreoConAdjuntoPdf,
  enviarCorreoPrueba,
  estadoConfigCorreo,
  guardarConfigCorreo,
  leerConfigCorreo,
} from './servicios/correo';
import {
  estadoConfigDrive,
  guardarConfigDrive,
  intercambiarCodigoDrive,
  leerConfigDrive,
  subirADrive,
  urlConsentimientoDrive,
} from './servicios/drive';
import { paginaReporteHtml } from './servicios/documentoReporteHtml';
import { datosReporte, ErrorReporte, validarYFoliar } from './servicios/reporte';
import { MensajeEntrante } from './canal/tipos';
import { enviarTelegram, urlArchivoTelegram } from './servicios/telegramApi';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();
const db = getFirestore();
// Ignora campos `undefined` al escribir (p. ej. pasoActual al pasar a firma):
// Firestore los rechaza por defecto. Debe ir antes de cualquier operación.
db.settings({ ignoreUndefinedProperties: true });

// LLM de Portteo: Gemini (capa gratuita de Google AI Studio). El adaptador de
// Claude (agente/portteo.ts) queda disponible por si se cambia de proveedor.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const REGION = 'us-central1';
// BASE_FUNCIONES / HOST_WEB se derivan del ID del proyecto (ver dominio/entorno.ts),
// así el mismo código sirve en producción y en pruebas sin editar nada.

// ---------- Autenticación de callables (identidad web = correo) ----------

async function usuarioDesdeAuth(req: CallableRequest): Promise<Usuario> {
  const correo = req.auth?.token?.email;
  if (!correo) {
    throw new HttpsError('unauthenticated', 'Inicia sesión para usar Porttea-Gener.');
  }
  const snap = await db.doc(`usuarios/${correo}`).get();
  const usuario = snap.data() as Usuario | undefined;
  if (!snap.exists || !usuario?.activo) {
    throw new HttpsError('permission-denied', 'Tu cuenta no está autorizada.');
  }
  return { ...usuario, correo };
}

function exigirRol(usuario: Usuario, roles: Rol[]): void {
  if (!roles.includes(usuario.rol)) {
    throw new HttpsError('permission-denied', 'Tu rol no tiene permiso para esta acción.');
  }
}

// ---------- Callables de Porttea-Gener ----------

// Crea un borrador (Rev. A, sin folio) y regresa los ids para abrir el taller.
export const crearCotizacion = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);

  // El cliente/asunto pueden venir vacíos: se crea un borrador "en blanco" y
  // Portteo pide los datos en el chat. Si vienen, se usan tal cual.
  const clienteNombre = String(req.data?.clienteNombre ?? '').trim();
  const titulo = String(req.data?.titulo ?? '').trim();
  return crearBorrador(db, { clienteNombre, titulo, creadoPor: usuario.correo });
});

// Chat del taller: recibe un mensaje, corre el agente (que edita la cotización
// vía herramientas) y regresa la respuesta. El documento se actualiza solo en
// la web por los listeners de Firestore.
export const portteo = onCall(
  { region: REGION, secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: '512MiB' },
  async (req) => {
    const usuario = await usuarioDesdeAuth(req);
    exigirRol(usuario, ROLES_OPERADOR);

    const cotizacionId = String(req.data?.cotizacionId ?? '');
    const mensaje = String(req.data?.mensaje ?? '').trim();
    if (!cotizacionId || !mensaje) {
      throw new HttpsError('invalid-argument', 'Faltan cotizacionId o mensaje.');
    }

    const cotSnap = await db.doc(`cotizaciones/${cotizacionId}`).get();
    if (!cotSnap.exists) {
      throw new HttpsError('not-found', 'No existe la cotización.');
    }
    const versionId = cotSnap.data()!.versionActualId as string;

    // Historial previo (antes de guardar el mensaje nuevo, para no duplicarlo)
    const historialPrevio = await leerHistorialChat(db, cotizacionId);
    await guardarMensajeChat(db, cotizacionId, {
      rol: 'usuario',
      texto: mensaje,
      correo: usuario.correo,
    });

    const historial: Anthropic.MessageParam[] = [
      ...historialPrevio.map((m) => ({
        role: m.rol === 'usuario' ? ('user' as const) : ('assistant' as const),
        content: m.texto,
      })),
      { role: 'user' as const, content: mensaje },
    ];

    // Contexto mutable: si Portteo clona/abre otra cotización (clonarComoBase),
    // el ejecutor le cambia el cotizacionId aquí; lo usamos para navegar el panel.
    const contexto = {
      correo: usuario.correo,
      rol: usuario.rol,
      cotizacionId,
      versionId,
      // Id de la cotización en vista previa (para clonar EXACTAMENTE esa al confirmar).
      previewCotizacionId: req.data?.previewCotizacionId ? String(req.data.previewCotizacionId) : undefined,
    };
    let respuesta: { texto: string };
    try {
      respuesta = await conversarConPortteoGemini({
        apiKey: GEMINI_API_KEY.value(),
        ejecutor: crearEjecutor(db),
        contexto,
        historial,
      });
    } catch (e) {
      // No dejamos que un error del LLM (p. ej. 503 de Gemini) llegue como
      // "internal" al usuario: Portteo responde con un aviso amable en el chat.
      logger.error('portteo (taller) falló:', e);
      respuesta = {
        texto: 'Ando saturado en este momento (mucha demanda). Dame unos segundos y vuelve a intentar, por favor. 🙏',
      };
    }

    await guardarMensajeChat(db, cotizacionId, { rol: 'portteo', texto: respuesta.texto });
    // Si en este turno se abrió/clonó otra cotización, el chat ya se guardó en la
    // ORIGEN; devolvemos el id nuevo para que el taller navegue a la copia.
    const nuevaCotizacionId = contexto.cotizacionId !== cotizacionId ? contexto.cotizacionId : null;
    if (nuevaCotizacionId) {
      await guardarMensajeChat(db, nuevaCotizacionId, { rol: 'portteo', texto: respuesta.texto });
    }
    // Vista previa (solo lectura) si Portteo la mostró en este turno.
    const preview = (contexto as { preview?: unknown }).preview ?? null;
    return { texto: respuesta.texto, cotizacionId: nuevaCotizacionId, preview };
  }
);

// Chat de INTAKE: arranca SIN cotización. Portteo pide cliente/asunto/dirigida a
// y, cuando los tiene, crea el borrador (con crearBorrador). El historial se
// manda en la petición (aún no hay dónde guardarlo). Si en este turno se creó la
// cotización, devolvemos su id (el front navega al taller) y guardamos ahí el
// chat de intake para no perder la conversación.
export const portteoNuevo = onCall(
  { region: REGION, secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: '512MiB' },
  async (req) => {
    const usuario = await usuarioDesdeAuth(req);
    exigirRol(usuario, ROLES_OPERADOR);

    const mensaje = String(req.data?.mensaje ?? '').trim();
    if (!mensaje) throw new HttpsError('invalid-argument', 'Falta el mensaje.');
    const historialIn: { rol: string; texto: string }[] = Array.isArray(req.data?.historial)
      ? req.data.historial.map((m: { rol?: string; texto?: string }) => ({
          rol: m?.rol === 'usuario' ? 'usuario' : 'portteo',
          texto: String(m?.texto ?? ''),
        }))
      : [];

    const historial: Anthropic.MessageParam[] = [
      ...historialIn.map((m) => ({
        role: m.rol === 'usuario' ? ('user' as const) : ('assistant' as const),
        content: m.texto,
      })),
      { role: 'user' as const, content: mensaje },
    ];

    // Contexto SIN cotización; si Portteo llama crearBorrador, el ejecutor le
    // fija cotizacionId/versionId aquí mismo.
    const contexto = {
      correo: usuario.correo,
      rol: usuario.rol,
      cotizacionId: undefined as string | undefined,
      versionId: undefined as string | undefined,
      previewCotizacionId: req.data?.previewCotizacionId ? String(req.data.previewCotizacionId) : undefined,
    };

    let respuesta: { texto: string };
    try {
      respuesta = await conversarConPortteoGemini({
        apiKey: GEMINI_API_KEY.value(),
        ejecutor: crearEjecutor(db),
        contexto,
        historial,
      });
    } catch (e) {
      logger.error('portteoNuevo (intake) falló:', e);
      respuesta = { texto: 'Ando saturado en este momento. Dame unos segundos y vuelve a intentar, por favor. 🙏' };
    }

    const cotizacionId = contexto.cotizacionId ?? null;
    // Si ya se creó la cotización, volcamos el chat de intake a su historial.
    if (cotizacionId) {
      for (const m of historialIn) {
        await guardarMensajeChat(db, cotizacionId, { rol: m.rol === 'usuario' ? 'usuario' : 'portteo', texto: m.texto });
      }
      await guardarMensajeChat(db, cotizacionId, { rol: 'usuario', texto: mensaje, correo: usuario.correo });
      await guardarMensajeChat(db, cotizacionId, { rol: 'portteo', texto: respuesta.texto });
    }
    const preview = (contexto as { preview?: unknown }).preview ?? null;
    return { texto: respuesta.texto, cotizacionId, preview };
  }
);

// Edición directa de un campo del documento desde el taller (edición inline).
// Solo BORRADORES. Guarda al instante (el front lo llama al salir de cada campo).
export const editarCotizacionCampo = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  const cotizacionId = String(req.data?.cotizacionId ?? '');
  const campo = String(req.data?.campo ?? '');
  const valor = String(req.data?.valor ?? '');
  const partidaIndex = typeof req.data?.partidaIndex === 'number' ? req.data.partidaIndex : undefined;
  const lineaIndex = typeof req.data?.lineaIndex === 'number' ? req.data.lineaIndex : undefined;
  if (!cotizacionId || !campo) throw new HttpsError('invalid-argument', 'Faltan cotizacionId o campo.');

  const cotSnap = await db.doc(`cotizaciones/${cotizacionId}`).get();
  if (!cotSnap.exists) throw new HttpsError('not-found', 'No existe la cotización.');
  if (cotSnap.get('estatus') !== 'borrador') {
    throw new HttpsError('failed-precondition', 'Solo se pueden editar cotizaciones en borrador.');
  }
  const refs = { cotizacionId, versionId: cotSnap.get('versionActualId') as string };

  try {
    if (campo.startsWith('partida.')) {
      if (partidaIndex === undefined) throw new HttpsError('invalid-argument', 'Falta partidaIndex.');
      const sub = campo.slice('partida.'.length);
      await mutarPartidas(db, refs, (partidas) => {
        if (partidaIndex < 0 || partidaIndex >= partidas.length) throw new Error('Partida inexistente.');
        const copia = partidas.map((p) => ({ ...p, lineas: [...(p.lineas ?? [])] }));
        const p = copia[partidaIndex];
        if (sub === 'titulo') p.titulo = valor;
        else if (sub === 'cantidad') {
          const n = parseFloat(valor.replace(',', '.'));
          p.cantidad = Number.isFinite(n) && n > 0 ? n : 1;
        } else if (sub === 'importe') {
          const n = parseFloat(valor.replace(/[^0-9.,-]/g, '').replace(/,/g, ''));
          p.importe = Number.isFinite(n) ? n : 0;
        } else if (sub === 'linea' && lineaIndex !== undefined && lineaIndex >= 0 && lineaIndex < p.lineas.length) {
          if (valor) p.lineas[lineaIndex] = valor;
          else p.lineas.splice(lineaIndex, 1); // vaciar una línea la elimina
        }
        return copia;
      });
    } else if (campo === 'clienteNombre') {
      if (valor.trim()) await actualizarDatos(db, refs, { clienteNombre: valor });
    } else if (campo === 'titulo') {
      await db.doc(`cotizaciones/${cotizacionId}`).update({ titulo: valor });
    } else if (campo === 'atencion') {
      await actualizarDatos(db, refs, { atencion: valor });
    } else if (campo === 'formaPago') {
      await db.doc(`cotizaciones/${cotizacionId}/versiones/${refs.versionId}`).update({ formaPago: valor });
    } else if (campo === 'tiempoEntrega') {
      await db.doc(`cotizaciones/${cotizacionId}/versiones/${refs.versionId}`).update({ tiempoEntrega: valor });
    } else if (campo === 'notas') {
      await db.doc(`cotizaciones/${cotizacionId}/versiones/${refs.versionId}`).update({ notas: valor });
    } else if (campo === 'telefono') {
      await db.doc(`cotizaciones/${cotizacionId}`).update({ 'cliente.telefono': valor || null });
    } else if (campo === 'correo') {
      await db.doc(`cotizaciones/${cotizacionId}`).update({ 'cliente.correo': valor || null });
    } else {
      throw new HttpsError('invalid-argument', `Campo no soportado: ${campo}`);
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', e instanceof Error ? e.message : 'No se pudo guardar el cambio.');
  }
  return { ok: true };
});

// Aprobación desde el botón del taller (transacción de folio; gate en backend).
export const aprobar = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);

  const cotizacionId = String(req.data?.cotizacionId ?? '');
  if (!cotizacionId) throw new HttpsError('invalid-argument', 'Falta cotizacionId.');

  try {
    const res = await aprobarCotizacion(db, { cotizacionId, correoAprobador: usuario.correo });

    // Efecto posterior (idempotente): bitácora de precios. Fuera de la
    // transacción; si falla, el folio ya quedó y se puede reintentar.
    try {
      const cotSnap = await db.doc(`cotizaciones/${cotizacionId}`).get();
      const cot = cotSnap.data()!;
      const verSnap = await db.doc(`cotizaciones/${cotizacionId}/versiones/${cot.versionActualId}`).get();
      const ver = verSnap.data()!;
      await escribirBitacora(db, {
        cotizacionId,
        versionId: cot.versionActualId,
        clienteId: cot.clienteId,
        clienteNombre: cot.cliente?.nombre ?? '',
        folio: res.folio,
        fecha: ver.fecha?.toDate?.() ?? new Date(),
        partidas: ver.partidas ?? [],
      });
      // Sugerir la última forma de pago del cliente en la próxima cotización.
      if (cot.clienteId && ver.formaPago) {
        await db.doc(`clientes/${cot.clienteId}`).set({ ultimaFormaPago: ver.formaPago }, { merge: true });
      }
    } catch (efectoErr) {
      logger.error('Aprobación OK pero falló la bitácora (reintentable):', efectoErr);
    }

    return res;
  } catch (e) {
    if (e instanceof ErrorAprobacion) {
      const codigo = e.codigo === 'sin-permiso' ? 'permission-denied' : 'failed-precondition';
      throw new HttpsError(codigo, e.message);
    }
    throw e;
  }
});

// ---------- Revisiones (Rev. B/C con el mismo folio) ----------
export const crearRevisionCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  const cotizacionId = String(req.data?.cotizacionId ?? '');
  if (!cotizacionId) throw new HttpsError('invalid-argument', 'Falta cotizacionId.');
  try {
    return await crearRevision(db, cotizacionId);
  } catch (e) {
    throw new HttpsError('failed-precondition', e instanceof Error ? e.message : 'No se pudo crear la revisión.');
  }
});

// ---------- Cambio de estatus / seguimiento (operadores) ----------
// enviada → autorizada | rechazada ; autorizada → realizada. Validado por la
// máquina de estados. La transición borrador → enviada NO pasa por aquí (esa
// es la aprobación, con folio).
export const cambiarEstatus = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);

  const cotizacionId = String(req.data?.cotizacionId ?? '');
  const nuevo = String(req.data?.estatus ?? '') as EstatusCotizacion;
  if (!cotizacionId || !nuevo) {
    throw new HttpsError('invalid-argument', 'Faltan cotizacionId o estatus.');
  }

  const cotRef = db.doc(`cotizaciones/${cotizacionId}`);
  const snap = await cotRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No existe la cotización.');
  const actual = snap.data()!.estatus as EstatusCotizacion;

  // Aprobar (borrador → enviada) va por el callable `aprobar`, no por aquí.
  if (actual === 'borrador') {
    throw new HttpsError('failed-precondition', 'Usa Aprobar para enviar un borrador.');
  }
  try {
    validarTransicion(actual, nuevo);
  } catch {
    throw new HttpsError('failed-precondition', `Transición inválida: ${actual} → ${nuevo}.`);
  }

  const upd: Record<string, unknown> = { estatus: nuevo };
  await cotRef.update(upd);
  // Reflejar también a nivel de la versión actual.
  const versionActualId = snap.data()!.versionActualId as string | undefined;
  if (versionActualId) {
    await db.doc(`cotizaciones/${cotizacionId}/versiones/${versionActualId}`).update({ estatus: nuevo });
  }
  return { ok: true, estatus: nuevo };
});

// ---------- CRUD de plantillas (dueño / superAdmin) ----------

export const crearPlantillaCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  const nombre = String(req.data?.nombre ?? '').trim();
  if (!nombre) throw new HttpsError('invalid-argument', 'Falta el nombre de la plantilla.');
  try {
    const id = await crearPlantilla(db, {
      nombre,
      precioSugerido: req.data?.precioSugerido ?? null,
      tieneSubtipos: req.data?.tieneSubtipos,
      subtipos: Array.isArray(req.data?.subtipos) ? req.data.subtipos : undefined,
      lineas: Array.isArray(req.data?.lineas) ? req.data.lineas : [],
      activa: req.data?.activa ?? true,
    });
    return { plantillaId: id };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo crear la plantilla.');
  }
});

export const actualizarPlantillaCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  const plantillaId = String(req.data?.plantillaId ?? '');
  if (!plantillaId) throw new HttpsError('invalid-argument', 'Falta plantillaId.');
  try {
    await actualizarPlantilla(db, plantillaId, {
      nombre: req.data?.nombre,
      precioSugerido: req.data?.precioSugerido,
      tieneSubtipos: req.data?.tieneSubtipos,
      subtipos: Array.isArray(req.data?.subtipos) ? req.data.subtipos : undefined,
      lineas: req.data?.lineas,
      activa: req.data?.activa,
    });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo actualizar.');
  }
});

// ---------- Recordatorios del dueño (admin) ----------

export const crearRecordatorioCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  const descripcion = String(req.data?.descripcion ?? '').trim();
  if (!descripcion) throw new HttpsError('invalid-argument', 'Falta la descripción.');
  try {
    return await crearRecordatorioPortal(db, {
      correo: usuario.correo,
      descripcion,
      clienteTexto: req.data?.clienteTexto ? String(req.data.clienteTexto) : undefined,
    });
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo crear.');
  }
});

export const marcarRecordatorioCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  const recordatorioId = String(req.data?.recordatorioId ?? '');
  const estatus = String(req.data?.estatus ?? '') as 'pendiente' | 'hecho';
  if (!recordatorioId || !['pendiente', 'hecho'].includes(estatus)) {
    throw new HttpsError('invalid-argument', 'Faltan recordatorioId o estatus válido.');
  }
  await marcarRecordatorio(db, recordatorioId, estatus);
  return { ok: true };
});

export const editarRecordatorioCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  const recordatorioId = String(req.data?.recordatorioId ?? '');
  if (!recordatorioId) throw new HttpsError('invalid-argument', 'Falta recordatorioId.');
  try {
    await editarRecordatorio(db, recordatorioId, {
      descripcion: req.data?.descripcion !== undefined ? String(req.data.descripcion) : undefined,
      clienteTexto: req.data?.clienteTexto !== undefined ? String(req.data.clienteTexto) : undefined,
    });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo editar.');
  }
});

export const eliminarRecordatorioCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  const recordatorioId = String(req.data?.recordatorioId ?? '');
  if (!recordatorioId) throw new HttpsError('invalid-argument', 'Falta recordatorioId.');
  await eliminarRecordatorio(db, recordatorioId);
  return { ok: true };
});

// Scheduler: lunes, miércoles y viernes 9:00 am (Morelos), solo si hay
// pendientes. Encola un aviso por cada dueño con teléfono; el bot lo entrega
// por WhatsApp (endpoint colaSalientes). El id determinista evita duplicar el
// aviso del día si el scheduler reintenta.
export const avisoRecordatorios = onSchedule(
  { schedule: '0 9 * * 1,3,5', timeZone: 'America/Mexico_City', region: REGION },
  async () => {
    const porDueno = await pendientesPorDueno(db);
    const correos = Object.keys(porDueno);
    if (correos.length === 0) {
      logger.info('Aviso L/M/V: sin recordatorios pendientes, no se encola nada.');
      return;
    }

    // Fecha en Morelos (UTC-6) para armar la clave del día.
    const ahora = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const ymd = ahora.toISOString().slice(0, 10).replace(/-/g, '');

    for (const correo of correos) {
      const n = porDueno[correo];
      const snap = await db.doc(`usuarios/${correo}`).get();
      const u = snap.data();
      if (!u?.telefono || u.activo === false) {
        logger.info(`Aviso L/M/V: ${correo} tiene ${n} pendientes pero sin teléfono/activo; no se entrega.`);
        continue;
      }
      const texto =
        n === 1
          ? 'Tienes 1 cotización pendiente por armar. ¡La haces en 5 minutos, no te rindas! 💪'
          : `Tienes ${n} cotizaciones pendientes por armar. ¡Vamos, avanza aunque sea una hoy! 💪`;
      const id = `aviso_${correo.replace(/[^a-zA-Z0-9]/g, '_')}_${ymd}`;
      const nuevo = await encolarSalienteUnico(db, id, { telefono: u.telefono, texto, motivo: 'recordatorio' });
      logger.info(nuevo ? `Aviso L/M/V encolado para ${correo} (${n}).` : `Aviso L/M/V ya existía hoy para ${correo}.`);
    }
  }
);

// Backfill único de montos denormalizados en cotizaciones (solo superAdmin).
export const backfillTotalesCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ['superAdmin']);
  return await backfillTotalesCotizaciones(db);
});

// ---------- Gestión de usuarios (solo superAdmin) ----------

export const crearUsuarioCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ['superAdmin']);

  const correo = String(req.data?.correo ?? '').trim();
  const nombre = String(req.data?.nombre ?? '').trim();
  const rol = String(req.data?.rol ?? '') as Rol;
  const password = String(req.data?.password ?? '');
  const telefono = req.data?.telefono ? String(req.data.telefono) : undefined;
  const telegramChatId = req.data?.telegramChatId ? String(req.data.telegramChatId) : undefined;

  if (!correo || !nombre || !rol) {
    throw new HttpsError('invalid-argument', 'Faltan correo, nombre o rol.');
  }
  try {
    await crearUsuario(db, { correo, nombre, rol, password, telefono, telegramChatId });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo crear el usuario.');
  }
});

export const actualizarUsuarioCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ['superAdmin']);

  const correo = String(req.data?.correo ?? '').trim();
  if (!correo) throw new HttpsError('invalid-argument', 'Falta el correo.');

  // No permitir que el superAdmin se auto-desactive por accidente.
  if (correo.toLowerCase() === usuario.correo.toLowerCase() && req.data?.activo === false) {
    throw new HttpsError('failed-precondition', 'No puedes desactivar tu propia cuenta.');
  }
  // Ni cambiarse su propio rol (evita bloquearse solo al bajarse de superAdmin).
  if (
    correo.toLowerCase() === usuario.correo.toLowerCase() &&
    req.data?.rol &&
    req.data.rol !== usuario.rol
  ) {
    throw new HttpsError('failed-precondition', 'No puedes cambiar tu propio rol. Pídeselo a otro superAdmin.');
  }
  try {
    await actualizarUsuario(db, correo, {
      nombre: req.data?.nombre,
      rol: req.data?.rol as Rol | undefined,
      activo: req.data?.activo,
      telefono: req.data?.telefono,
      telegramChatId: req.data?.telegramChatId,
      password: req.data?.password,
    });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo actualizar.');
  }
});

// ---------- Módulo de Rutinas: catálogo (dueño/secretaria/superAdmin) ----------

export const crearClienteRutinasCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  try {
    return await crearClienteRutinas(db, String(req.data?.nombre ?? ''));
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo crear el cliente.');
  }
});

export const renombrarClienteCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  try {
    await renombrarCliente(db, String(req.data?.clienteId ?? ''), String(req.data?.nombre ?? ''));
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo renombrar.');
  }
});

export const eliminarClienteCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  try {
    await eliminarCliente(db, String(req.data?.clienteId ?? ''));
    return { ok: true };
  } catch (e) {
    throw new HttpsError('failed-precondition', e instanceof Error ? e.message : 'No se pudo eliminar.');
  }
});

export const guardarContactosClienteCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  const clienteId = String(req.data?.clienteId ?? '');
  if (!clienteId) throw new HttpsError('invalid-argument', 'Falta clienteId.');
  const contactos = Array.isArray(req.data?.contactos) ? req.data.contactos : [];
  try {
    await guardarContactosCliente(db, clienteId, contactos);
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudieron guardar los contactos.');
  }
});

export const crearSedeCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  try {
    return await crearSede(db, {
      clienteId: String(req.data?.clienteId ?? ''),
      nombre: String(req.data?.nombre ?? ''),
      direccion: req.data?.direccion ? String(req.data.direccion) : undefined,
      responsable: req.data?.responsable ? String(req.data.responsable) : undefined,
    });
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo crear la sede.');
  }
});

export const actualizarSedeCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  const sedeId = String(req.data?.sedeId ?? '');
  if (!sedeId) throw new HttpsError('invalid-argument', 'Falta sedeId.');
  try {
    await actualizarSede(db, sedeId, {
      nombre: req.data?.nombre,
      direccion: req.data?.direccion,
      responsable: req.data?.responsable,
    });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo actualizar.');
  }
});

export const crearEquipoCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  try {
    return await crearEquipo(db, {
      sedeId: String(req.data?.sedeId ?? ''),
      noInventario: String(req.data?.noInventario ?? ''),
      descripcion: req.data?.descripcion ? String(req.data.descripcion) : undefined,
    });
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo crear el equipo.');
  }
});

export const actualizarEquipoCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  const equipoId = String(req.data?.equipoId ?? '');
  if (!equipoId) throw new HttpsError('invalid-argument', 'Falta equipoId.');
  try {
    await actualizarEquipo(db, equipoId, {
      noInventario: req.data?.noInventario,
      descripcion: req.data?.descripcion,
    });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo actualizar.');
  }
});

export const crearRutinaCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  try {
    return await crearRutina(db, {
      partida: req.data?.partida,
      nombre: String(req.data?.nombre ?? ''),
      equiposIncluidos: req.data?.equiposIncluidos,
      refaccionesReferenciales: req.data?.refaccionesReferenciales,
      pasos: req.data?.pasos,
      activa: req.data?.activa,
    });
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo crear la rutina.');
  }
});

export const actualizarRutinaCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  const rutinaId = String(req.data?.rutinaId ?? '');
  if (!rutinaId) throw new HttpsError('invalid-argument', 'Falta rutinaId.');
  try {
    await actualizarRutina(db, rutinaId, {
      nombre: req.data?.nombre,
      partida: req.data?.partida,
      equiposIncluidos: req.data?.equiposIncluidos,
      refaccionesReferenciales: req.data?.refaccionesReferenciales,
      pasos: req.data?.pasos,
      activa: req.data?.activa,
    });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo actualizar.');
  }
});

export const eliminarRutinaCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  const rutinaId = String(req.data?.rutinaId ?? '');
  if (!rutinaId) throw new HttpsError('invalid-argument', 'Falta rutinaId.');
  try {
    await eliminarRutina(db, rutinaId);
    return { ok: true };
  } catch (e) {
    throw new HttpsError('internal', e instanceof Error ? e.message : 'No se pudo eliminar.');
  }
});

export const crearTipoEquipoCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  try {
    return await crearTipoEquipo(db, String(req.data?.nombre ?? ''));
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo crear el tipo.');
  }
});

export const eliminarTipoEquipoCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  const tipoId = String(req.data?.tipoId ?? '');
  if (!tipoId) throw new HttpsError('invalid-argument', 'Falta tipoId.');
  try {
    await eliminarTipoEquipo(db, tipoId);
    return { ok: true };
  } catch (e) {
    throw new HttpsError('internal', e instanceof Error ? e.message : 'No se pudo eliminar.');
  }
});

// Importa el seed de rutinas (solo superAdmin). Recibe el arreglo del JSON.
export const importarRutinasCallable = onCall({ region: REGION, memory: '512MiB' }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ['superAdmin']);
  const rutinas = Array.isArray(req.data?.rutinas) ? req.data.rutinas : [];
  if (!rutinas.length) throw new HttpsError('invalid-argument', 'No se recibieron rutinas.');
  return await importarRutinas(db, rutinas);
});

// Resuelve una bandera de "faltante de firma": el operador registra que ya se
// consiguió la firma (opcionalmente con la foto de la hoja) → estatus 'firmada'.
export const resolverFaltanteFirmaCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  const ejecucionId = String(req.data?.ejecucionId ?? '');
  if (!ejecucionId) throw new HttpsError('invalid-argument', 'Falta ejecucionId.');
  const fotoUrl = req.data?.fotoUrl ? String(req.data.fotoUrl) : null;
  const ref = db.doc(`rutinas_ejecucion/${ejecucionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No existe la ejecución.');
  if (snap.get('estatus') !== 'faltante_firma') {
    throw new HttpsError('failed-precondition', 'Esta rutina no está marcada como faltante de firma.');
  }
  await ref.update({
    estatus: 'firmada',
    faltanteFirmaRazon: null,
    ...(fotoUrl ? { evidenciaFirmaUrl: fotoUrl } : {}),
  });
  return { ok: true };
});

// Marca una oportunidad de negocio como atendida (ventas ya la trabajó).
export const atenderOportunidadCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_OPERADOR);
  const oportunidadId = String(req.data?.oportunidadId ?? '');
  if (!oportunidadId) throw new HttpsError('invalid-argument', 'Falta oportunidadId.');
  const estatus = req.data?.estatus === 'abierta' ? 'abierta' : 'atendida';
  await db.doc(`oportunidades/${oportunidadId}`).update({ estatus });
  return { ok: true };
});

// El operador valida una rutina completada: le asigna folio de reporte (en
// transacción) y devuelve el enlace firmado para ver/compartir el reporte.
export const validarEjecucionCallable = onCall(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req) => {
    const usuario = await usuarioDesdeAuth(req);
    exigirRol(usuario, ROLES_OPERADOR);
    const ejecucionId = String(req.data?.ejecucionId ?? '');
    if (!ejecucionId) throw new HttpsError('invalid-argument', 'Falta ejecucionId.');
    try {
      const { folio } = await validarYFoliar(db, ejecucionId, new Date());
      const secreto = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
      const enlace = `${BASE_FUNCIONES}/verReporte?token=${firmarEnlace(secreto, ejecucionId)}`;
      return { folio, enlace };
    } catch (e) {
      if (e instanceof ErrorReporte) throw new HttpsError('failed-precondition', e.message);
      throw e;
    }
  }
);

// Liga de SOLO LECTURA del reporte, sin validar ni foliar: sirve para ver el
// reporte "como se va generando" mientras la rutina sigue en proceso.
export const enlaceReporteCallable = onCall(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req) => {
    const usuario = await usuarioDesdeAuth(req);
    exigirRol(usuario, ROLES_OPERADOR);
    const ejecucionId = String(req.data?.ejecucionId ?? '');
    if (!ejecucionId) throw new HttpsError('invalid-argument', 'Falta ejecucionId.');
    const snap = await db.doc(`rutinas_ejecucion/${ejecucionId}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'No existe la ejecución.');
    return { enlace: enlaceReporte(ejecucionId) };
  }
);

// ---------- Configuración de Google Drive (Configuración → Drive) ----------
export const estadoConfigDriveCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  return await estadoConfigDrive(db);
});

export const guardarConfigDriveCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ['superAdmin']);
  try {
    await guardarConfigDrive(db, {
      clientId: req.data?.clientId !== undefined ? String(req.data.clientId) : undefined,
      clientSecret: req.data?.clientSecret !== undefined ? String(req.data.clientSecret) : undefined,
      folderNombre: req.data?.folderNombre !== undefined ? String(req.data.folderNombre) : undefined,
    });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo guardar.');
  }
});

// Devuelve la URL de consentimiento de Google para "Conectar Drive".
export const driveUrlConsentimientoCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ['superAdmin']);
  const cfg = await leerConfigDrive(db);
  if (!cfg.clientId) throw new HttpsError('failed-precondition', 'Primero captura y guarda el Client ID y el Client Secret.');
  return { url: urlConsentimientoDrive(cfg.clientId) };
});

// Callback de OAuth: Google redirige aquí con ?code=... Cambiamos el code por el
// refresh_token y lo guardamos. Devuelve una página simple de éxito/fallo.
export const driveOAuthCallback = onRequest({ region: REGION }, async (req, res) => {
  const pagina = (titulo: string, detalle: string) =>
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;max-width:520px;margin:60px auto;padding:0 20px;text-align:center;color:#10243f"><h2>${titulo}</h2><p style="color:#5b6b82">${detalle}</p><p><a href="${HOST_WEB}/config-drive">Volver al portal</a></p></body>`;
  try {
    const code = String(req.query.code ?? '');
    if (req.query.error) {
      res.status(400).send(pagina('No se conectó', `Google devolvió: ${String(req.query.error)}. Puedes cerrar esta pestaña e intentar de nuevo.`));
      return;
    }
    if (!code) {
      res.status(400).send(pagina('Falta el código', 'No llegó el código de autorización. Intenta conectar de nuevo.'));
      return;
    }
    const cfg = await leerConfigDrive(db);
    if (!cfg.clientId || !cfg.clientSecret) {
      res.status(400).send(pagina('Faltan credenciales', 'No hay Client ID / Secret guardados. Captúralos primero en Configuración → Drive.'));
      return;
    }
    const refreshToken = await intercambiarCodigoDrive(cfg.clientId, cfg.clientSecret, code);
    await guardarConfigDrive(db, { refreshToken });
    res.status(200).send(pagina('✅ Drive conectado', 'Ya puedes cerrar esta pestaña y volver al portal. Los documentos se guardarán en tu Drive.'));
  } catch (e) {
    res.status(500).send(pagina('Error al conectar', e instanceof Error ? e.message : 'Error desconocido.'));
  }
});

// Sube un archivo de prueba para verificar la conexión y la carpeta.
export const probarDriveCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  try {
    const contenido = Buffer.from(`Prueba de conexión de G-ener con Google Drive.\nSi ves este archivo, la configuración quedó lista. ✅`, 'utf8');
    const res = await subirADrive(db, { nombre: `Prueba G-ener.txt`, contenido, mimeType: 'text/plain' });
    return { ok: true, link: res.link };
  } catch (e) {
    throw new HttpsError('internal', e instanceof Error ? e.message : 'No se pudo subir a Drive.');
  }
});

// ---------- Configuración de Telegram (Configuración → Telegram) ----------
export const estadoConfigTelegramCallable = onCall(
  { region: REGION, secrets: ['TELEGRAM_BOT_TOKEN'] },
  async (req) => {
    const usuario = await usuarioDesdeAuth(req);
    exigirRol(usuario, ROLES_ADMIN);
    return await estadoConfigTelegram(db);
  }
);

export const guardarConfigTelegramCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ['superAdmin']);
  try {
    await guardarConfigTelegram(db, {
      botToken: req.data?.botToken !== undefined ? String(req.data.botToken) : undefined,
    });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo guardar.');
  }
});

// Registra el webhook en Telegram (usa el secret_token que validamos al recibir).
export const registrarWebhookTelegramCallable = onCall(
  { region: REGION, secrets: ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN'] },
  async (req) => {
    const usuario = await usuarioDesdeAuth(req);
    exigirRol(usuario, ['superAdmin']);
    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
    if (!secretToken) throw new HttpsError('failed-precondition', 'Falta el secreto TELEGRAM_WEBHOOK_SECRET en el servidor.');
    try {
      const res = await registrarWebhookTelegram(db, secretToken);
      return { ok: true, botUsername: res.botUsername };
    } catch (e) {
      throw new HttpsError('internal', e instanceof Error ? e.message : 'No se pudo registrar el webhook.');
    }
  }
);

// ---------- Guardado automático en Drive ----------
// Al APROBAR una cotización (se le asigna folio), renderizamos su PDF y lo subimos
// a la carpeta de Drive. Idempotente: la marca `driveGuardado` evita repetir. Si
// Drive no está conectado, no hace nada (no rompe la aprobación).
export const guardarCotizacionDrive = onDocumentUpdated(
  { region: REGION, document: 'cotizaciones/{id}', secrets: ['WHATSAPP_WEBHOOK_SECRET'], memory: '1GiB', timeoutSeconds: 120 },
  async (event) => {
    const antes = event.data?.before.data() ?? {};
    const despues = event.data?.after.data() ?? {};
    // Dispara solo cuando el folio ACABA de asignarse y aún no se guardó en Drive.
    if (despues.driveGuardado === true) return;
    if (!despues.folio || antes.folio) return;
    const cfg = await leerConfigDrive(db);
    if (!cfg.refreshToken) return; // Drive no conectado: se omite.

    const cotizacionId = event.params.id;
    try {
      const secreto = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
      const url = `${BASE_FUNCIONES}/verCotizacion?token=${firmarEnlace(secreto, cotizacionId)}`;
      const pdf = await urlAPdf(url);
      const nombre = `Cotizacion ${despues.folio}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
      await subirADrive(db, { nombre, contenido: pdf, mimeType: 'application/pdf' });
      await db.doc(`cotizaciones/${cotizacionId}`).set({ driveGuardado: true }, { merge: true });
      logger.info(`Cotización ${despues.folio} guardada en Drive.`);
    } catch (e) {
      logger.error(`No se pudo guardar la cotización ${cotizacionId} en Drive:`, e);
    }
  }
);

// Al APROBAR el reporte de una rutina (reporteAprobado), subimos su PDF a Drive.
export const guardarReporteDrive = onDocumentUpdated(
  { region: REGION, document: 'rutinas_ejecucion/{id}', secrets: ['WHATSAPP_WEBHOOK_SECRET'], memory: '1GiB', timeoutSeconds: 120 },
  async (event) => {
    const antes = event.data?.before.data() ?? {};
    const despues = event.data?.after.data() ?? {};
    if (despues.reporteDriveGuardado === true) return;
    if (despues.reporteAprobado !== true || antes.reporteAprobado === true) return;
    const cfg = await leerConfigDrive(db);
    if (!cfg.refreshToken) return;

    const ejecucionId = event.params.id;
    try {
      const secreto = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
      const url = `${BASE_FUNCIONES}/verReporte?token=${firmarEnlace(secreto, ejecucionId)}`;
      const pdf = await urlAPdf(url);
      const folio = (despues.folio as string) || ejecucionId;
      const nombre = `Reporte ${folio}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
      await subirADrive(db, { nombre, contenido: pdf, mimeType: 'application/pdf' });
      await db.doc(`rutinas_ejecucion/${ejecucionId}`).set({ reporteDriveGuardado: true }, { merge: true });
      logger.info(`Reporte ${folio} guardado en Drive.`);
    } catch (e) {
      logger.error(`No se pudo guardar el reporte ${ejecucionId} en Drive:`, e);
    }
  }
);

// El portal (admin) pide cerrar la sesión de WhatsApp. Deja el comando en
// sistema/whatsapp; el bot lo lee por colaSalientes, hace logout y vuelve a
// mostrar el QR. Idempotente: escribir dos veces no hace daño.
export const comandoWhatsappCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  const comando = String(req.data?.comando ?? '');
  if (comando !== 'desconectar') throw new HttpsError('invalid-argument', 'Comando no soportado.');
  await db.doc('sistema/whatsapp').set({ comando }, { merge: true });
  return { ok: true };
});

// El importador de histórico (servicios/etl.ts) se despliega como endpoint
// temporal protegido por token cuando hay que cargar el corpus. Ver
// docs/ETL_HISTORICO.md para reactivarlo y cargar el corpus completo.

// ---------- Webhooks del bot (fase 5: creación por WhatsApp) ----------

// México manda el número como 521XXXXXXXXXX (con el "1" tras la lada), pero el
// dueño puede haberlo guardado como 52XXXXXXXXXX (sin el "1"). Probamos ambas
// formas para que empate sin importar cómo se dio de alta.
function variantesTelefono(telefono: string): string[] {
  const set = new Set([telefono]);
  if (/^52\d{10}$/.test(telefono)) set.add('521' + telefono.slice(2));
  if (/^521\d{10}$/.test(telefono)) set.add('52' + telefono.slice(3));
  return [...set];
}

async function buscarUsuarioPorTelefono(telefono: string): Promise<Usuario | null> {
  const q = await db
    .collection('usuarios')
    .where('telefono', 'in', variantesTelefono(telefono))
    .limit(1)
    .get();
  if (q.empty) return null;
  // El correo es el id del documento (canónico). Algunas cuentas antiguas no
  // tienen el campo `correo`, así que lo tomamos del id para no perderlo.
  return { ...(q.docs[0].data() as Usuario), correo: q.docs[0].id };
}

// Identidad del canal de Telegram: el usuario se resuelve por su telegramChatId
// (que el dueño vincula en el portal). Telegram no expone el teléfono.
async function buscarUsuarioPorTelegramChatId(chatId: string): Promise<Usuario | null> {
  const q = await db.collection('usuarios').where('telegramChatId', '==', chatId).limit(1).get();
  if (q.empty) return null;
  return { ...(q.docs[0].data() as Usuario), correo: q.docs[0].id };
}

// El bot publica aquí su estado de conexión y el QR de vinculación, para que
// el portal lo muestre en vivo (colección sistema/whatsapp). Protegido con el
// mismo secreto del webhook.
export const estadoBot = onRequest(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req, res) => {
    if (req.get('x-webhook-secret') !== process.env.WHATSAPP_WEBHOOK_SECRET) {
      res.status(401).send('No autorizado');
      return;
    }
    const { estado, qr, numero } = req.body ?? {};
    await db.doc('sistema/whatsapp').set(
      {
        estado: estado ?? null,
        qr: qr ?? null,
        numero: numero ?? null,
        actualizadoEn: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    res.status(200).json({ ok: true });
  }
);

// Portteo por WhatsApp: modo consulta. Puede buscar precios en el histórico,
// consultar cotizaciones pasadas, listar plantillas y guardar recordatorios.
// NO arma ni aprueba cotizaciones por aquí (eso es en Porttea-Gener, la web).
const HERRAMIENTAS_WHATSAPP = new Set([
  'buscarHistorico',
  'consultarCotizacion',
  'consultarSeguimiento',
  'listarPlantillas',
  'listarClientes',
  'buscarCliente',
  'crearRecordatorio',
  'misRecordatorios',
  'marcarRecordatorioHecho',
]);

const SYSTEM_WHATSAPP = [
  'Eres Portteo, el asistente de cotizaciones de G-ener (Gener Power & Control), respondiendo por WhatsApp.',
  'Sé breve y claro (es un chat de teléfono). Responde en español, con calidez pero al grano.',
  'Puedes: buscar precios en el histórico; consultar cotizaciones pasadas (por folio o cliente);',
  'ver el seguimiento (cotizaciones enviadas sin cerrar) con consultarSeguimiento; listar plantillas;',
  'y sobre recordatorios: crearlos, listarlos (misRecordatorios) y marcarlos como hechos',
  '(marcarRecordatorioHecho — primero lístalos para ubicar el id, no lo adivines).',
  'NUNCA le muestres al usuario los IDs internos (recordatorioId, etc.): son solo para tus herramientas.',
  'NO inventas precios: solo los del histórico. Si no hay dato, dilo y sugiere revisarlo en la web.',
  'Para ARMAR o APROBAR una cotización, indícale al usuario que lo haga en Porttea-Gener (la plataforma web),',
  'porque ahí ve el documento en vivo; por WhatsApp solo consultas y recordatorios.',
].join(' ');

// Corre a Portteo para un mensaje de WhatsApp, guardando el historial por
// teléfono para que tenga memoria de la conversación.
const FALLBACK_WHATSAPP = 'Uy, se me complicó procesar eso 😅. Intenta de nuevo en un momento, por favor.';

async function conversarPortteoWhatsApp(usuario: Usuario, mensaje: MensajeEntrante): Promise<string> {
  const telefono = mensaje.telefono;
  try {
    const historialPrevio = await leerHistorialWA(db, telefono, 12);
    await guardarMensajeWA(db, telefono, { rol: 'usuario', texto: mensaje.texto });

    const historial: Anthropic.MessageParam[] = [
      ...historialPrevio.map((m) => ({
        role: m.rol === 'usuario' ? ('user' as const) : ('assistant' as const),
        content: m.texto,
      })),
      { role: 'user' as const, content: mensaje.texto },
    ];

    const respuesta = await conversarConPortteoGemini({
      apiKey: GEMINI_API_KEY.value(),
      ejecutor: crearEjecutor(db),
      contexto: { correo: usuario.correo, rol: usuario.rol },
      historial,
      herramientas: HERRAMIENTAS.filter((h) => HERRAMIENTAS_WHATSAPP.has(h.name)),
      sistema: SYSTEM_WHATSAPP,
    });

    await guardarMensajeWA(db, telefono, { rol: 'portteo', texto: respuesta.texto });
    return respuesta.texto;
  } catch (e) {
    // Si Portteo/Gemini o Firestore fallan, el usuario NO se queda mudo.
    logger.error('Portteo por WhatsApp falló:', e);
    return FALLBACK_WHATSAPP;
  }
}

export const webhookWhatsapp = onRequest(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET', GEMINI_API_KEY], timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Método no permitido');
      return;
    }
    const secreto = process.env.WHATSAPP_WEBHOOK_SECRET;
    if (secreto && req.get('x-webhook-secret') !== secreto) {
      res.status(401).send('No autorizado');
      return;
    }

    const mensaje = normalizarWebhookWhatsapp(req.body);
    if (!mensaje) {
      res.status(200).send('ignorado');
      return;
    }

    try {
      logger.info(`WhatsApp entra de ${mensaje.telefono}: "${mensaje.texto.slice(0, 60)}"`);
      const respuesta = await procesarMensaje(
        {
          buscarUsuario: buscarUsuarioPorTelefono,
          conversar: conversarPortteoWhatsApp,
          flujoRutina: (usuario, m) =>
            manejarTextoRutina(
              db,
              usuario,
              m.telefono,
              m.texto,
              new Date(),
              (t) => clasificarIntencionRutina(GEMINI_API_KEY.value(), t),
              (paso, msg) => interpretarMensajeAlta(GEMINI_API_KEY.value(), paso, msg),
              enlaceReporte
            ),
        },
        mensaje
      );
      if (!respuesta) {
        logger.info(`Número ${mensaje.telefono} ignorado (no está en la lista blanca o inactivo).`);
      }
      res.status(200).json(respuesta ?? { ignorado: true });
    } catch (e) {
      // Ante cualquier fallo (p. ej. resolver el usuario), no respondemos para no
      // contestarle a un número que quizá no esté en la lista blanca. Se registra.
      logger.error('webhookWhatsapp falló:', e);
      res.status(200).json({ ignorado: true });
    }
  }
);

// Cola de salientes: el bot pregunta (GET) qué mensajes tiene que entregar y
// avisa (POST) cuáles ya envió. Protegido con el mismo secreto del webhook.
// Recibe una foto que llegó por WhatsApp (Rutinas, Fase 1). El bot descarga el
// binario y lo reenvía aquí crudo (content-type = mimetype); el número y el
// caption van en cabeceras para no pelear con el parser del cuerpo. Valida la
// lista blanca, sube a Storage y registra la metadata.
export const recibirMediaWhatsapp = onRequest(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req, res) => {
    if (req.get('x-webhook-secret') !== process.env.WHATSAPP_WEBHOOK_SECRET) {
      res.status(401).send('No autorizado');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).send('Método no permitido');
      return;
    }
    const telefono = String(req.get('x-telefono') ?? '').replace(/\D/g, '');
    const mimetype = req.get('content-type') || 'image/jpeg';
    const captionRaw = req.get('x-caption');
    const caption = captionRaw ? decodeURIComponent(captionRaw) : undefined;
    const buffer = req.rawBody;
    if (!telefono || !buffer || buffer.length === 0) {
      res.status(400).json({ error: 'Falta x-telefono o cuerpo de imagen' });
      return;
    }
    const usuario = await buscarUsuarioPorTelefono(telefono);
    if (!usuario || usuario.activo === false) {
      res.status(200).json({ ignorado: true });
      return;
    }
    try {
      // ¿El técnico tiene una rutina en curso? Si sí, la foto se guarda bajo la
      // ruta del equipo (equipo→reporte→paso) y avanza el flujo guiado.
      const ctx = await contextoEjecucionActiva(db, telefono);
      const guardada = await guardarFotoEntrante(db, {
        telefono,
        nombre: usuario.nombre ?? '',
        buffer,
        mimetype,
        caption,
        equipoId: ctx?.equipoId,
        reporteId: ctx?.reporteId,
        paso: ctx?.paso,
      });
      logger.info(`📷 Foto de ${telefono} guardada en ${guardada.storagePath}`);
      // Si hay rutina activa, la foto avanza el flujo; devolvemos ese texto para
      // que el bot conteste con la guía del paso en vez del acuse genérico.
      let respuesta: string | undefined;
      if (ctx) {
        const r = await manejarFotoRutina(db, telefono, guardada.url, new Date(), enlaceReporte);
        respuesta = r?.respuesta;
      }
      res.status(200).json({ ok: true, ...guardada, respuesta: respuesta ?? null });
    } catch (e) {
      logger.error('Error guardando foto entrante', e);
      res.status(500).json({ error: 'No se pudo guardar la foto' });
    }
  }
);

export const colaSalientes = onRequest(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req, res) => {
    if (req.get('x-webhook-secret') !== process.env.WHATSAPP_WEBHOOK_SECRET) {
      res.status(401).send('No autorizado');
      return;
    }
    if (req.method === 'GET') {
      const mensajes = await salientesPendientes(db, 20);
      // El portal puede pedir desconectar la sesión: lo leemos aquí y el bot lo ejecuta.
      const estadoSnap = await db.doc('sistema/whatsapp').get();
      const comando = estadoSnap.exists ? (estadoSnap.get('comando') ?? null) : null;
      res.status(200).json({ mensajes, comando });
      return;
    }
    if (req.method === 'POST') {
      // El bot avisa que ya ejecutó el comando (p. ej. 'desconectar') → lo limpiamos.
      if (req.body?.comandoHecho) {
        await db.doc('sistema/whatsapp').set({ comando: null }, { merge: true });
        res.status(200).json({ ok: true });
        return;
      }
      const id = String(req.body?.id ?? '');
      if (!id) {
        res.status(400).json({ error: 'Falta id' });
        return;
      }
      const crudo = String(req.body?.estatus ?? 'enviado');
      const estatus = (['enviado', 'entregado', 'sin_confirmar', 'error'] as const).includes(
        crudo as 'enviado'
      )
        ? (crudo as 'enviado' | 'entregado' | 'sin_confirmar' | 'error')
        : 'enviado';
      await marcarSaliente(db, id, estatus, req.body?.motivo);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).send('Método no permitido');
  }
);

// Página pública que ve el CLIENTE con su cotización (enlace firmado). No pide
// cuenta: la autorización es el token (firmado + con expiración).
// Arma el enlace firmado del reporte de una ejecución (para el auto-envío al
// técnico y para el botón de aprobar). Lee el secreto del entorno de la función.
function enlaceReporte(ejecucionId: string): string {
  const secreto = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
  return `${BASE_FUNCIONES}/verReporte?token=${firmarEnlace(secreto, ejecucionId)}`;
}

// Reporte de rutina público (enlace firmado). Renderiza el HTML del reporte;
// el bot lo puede convertir a PDF. El id firmado es el de la ejecución.
export const verReporte = onRequest(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    const secreto = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
    const token = String(req.query.token ?? '');
    const val = verificarEnlace(secreto, token);
    if (!val) {
      res.status(403).send(paginaError('Este enlace no es válido o ya venció. Pídele a G-ener uno nuevo.'));
      return;
    }
    const datos = await datosReporte(db, val.cotizacionId);
    if (!datos) {
      res.status(404).send(paginaError('No encontramos este reporte.'));
      return;
    }
    const aprobarUrl = `${BASE_FUNCIONES}/aprobarReporteWhatsapp?token=${encodeURIComponent(token)}`;
    const editarUrl = `${BASE_FUNCIONES}/editarReporteEjecucion?token=${encodeURIComponent(token)}`;
    res.status(200).send(paginaReporteHtml(datos, { aprobarUrl, editarUrl }));
  }
);

// Guarda ediciones (comentarios / lecturas) hechas desde el HTML del reporte,
// mientras NO esté aprobado. POST { cambios: [{orden, campo, valor}] }.
export const editarReporteEjecucion = onRequest(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.status(204).send('');
    if (req.method !== 'POST') return void res.status(405).json({ error: 'Método no permitido' });
    const secreto = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
    const val = verificarEnlace(secreto, String(req.query.token ?? ''));
    if (!val) return void res.status(403).json({ error: 'Enlace inválido o vencido' });
    const ref = db.doc(`rutinas_ejecucion/${val.cotizacionId}`);
    const snap = await ref.get();
    if (!snap.exists) return void res.status(404).json({ error: 'No existe la ejecución' });
    if (snap.get('reporteAprobado') === true) return void res.status(409).json({ error: 'El reporte ya fue aprobado; no se puede editar.' });

    const cambios: { orden: number; campo: string; valor: string }[] = Array.isArray(req.body?.cambios) ? req.body.cambios : [];
    const pasos = (snap.get('pasos') as Record<string, unknown>[] | undefined) ?? [];
    for (const c of cambios) {
      const p = pasos.find((x) => Number(x.orden) === Number(c.orden));
      if (!p) continue;
      if (c.campo === 'comentario') {
        p.comentario = String(c.valor ?? '').trim() || null;
      } else if (c.campo === 'lectura') {
        const n = Number(String(c.valor ?? '').replace(',', '.'));
        p.lectura = Number.isFinite(n) ? n : null;
        // Recalcula cumple si el paso tiene rango en la plantilla.
        const rutinaId = snap.get('rutinaId') as string;
        const plSnap = await db.doc(`rutinas_plantilla/${rutinaId}`).get();
        const ev = (plSnap.get('pasos') as { orden: number; evidencia?: { rangoDefinido?: boolean; rangoMin?: number; rangoMax?: number } }[] | undefined)?.find((pp) => pp.orden === Number(c.orden))?.evidencia;
        if (ev?.rangoDefinido && typeof ev.rangoMin === 'number' && typeof ev.rangoMax === 'number' && p.lectura != null) {
          p.cumple = (p.lectura as number) >= ev.rangoMin && (p.lectura as number) <= ev.rangoMax;
        }
      }
    }
    await ref.update({ pasos, actualizadoEn: FieldValue.serverTimestamp() });
    res.status(200).json({ ok: true });
  }
);

// El botón "Aprobar" del reporte pega aquí (POST). Verifica el token firmado,
// marca el reporte como aprobado y encola el envío del PDF por WhatsApp al
// técnico (el bot renderiza la URL a PDF y lo adjunta).
export const aprobarReporteWhatsapp = onRequest(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método no permitido' });
      return;
    }
    const secreto = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
    const val = verificarEnlace(secreto, String(req.query.token ?? ''));
    if (!val) {
      res.status(403).json({ error: 'Enlace inválido o vencido' });
      return;
    }
    const ejecucionId = val.cotizacionId;
    const snap = await db.doc(`rutinas_ejecucion/${ejecucionId}`).get();
    if (!snap.exists) {
      res.status(404).json({ error: 'No existe la ejecución' });
      return;
    }
    const telefono = String(snap.get('tecnicoTelefono') ?? '');
    if (!telefono) {
      res.status(400).json({ error: 'Sin teléfono destino' });
      return;
    }
    const folio = (snap.get('folio') as string) ?? 'de rutina';
    const fileName = `Reporte ${folio}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
    // Enviamos el PDF y, en el mismo mensaje, pedimos la firma para cerrar. La
    // rutina se queda en proceso (etapa de firma) hasta que llegue esa foto.
    await encolarSaliente(db, {
      telefono,
      texto:
        `✅ Reporte de rutina ${folio} aprobado — aquí va en PDF.\n\n` +
        `Listo, ahora imprímelo y fírmalo, y mándame una *foto de la hoja firmada* para *cerrar el reporte*. 📸`,
      motivo: 'reporte_rutina',
      documentoUrl: enlaceReporte(ejecucionId),
      fileName,
    });
    await db.doc(`rutinas_ejecucion/${ejecucionId}`).set(
      { reporteAprobado: true, reporteAprobadoEn: FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.status(200).json({ ok: true });
  }
);

export const verCotizacion = onRequest(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    const secreto = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
    const val = verificarEnlace(secreto, String(req.query.token ?? ''));
    if (!val) {
      res.status(403).send(paginaError('Este enlace no es válido o ya venció. Pídele a G-ener uno nuevo.'));
      return;
    }
    const cotSnap = await db.doc(`cotizaciones/${val.cotizacionId}`).get();
    if (!cotSnap.exists) {
      res.status(404).send(paginaError('No encontramos esta cotización.'));
      return;
    }
    const cot = cotSnap.data()!;
    const verSnap = await db.doc(`cotizaciones/${val.cotizacionId}/versiones/${cot.versionActualId}`).get();
    if (!verSnap.exists) {
      res.status(404).send(paginaError('No encontramos el contenido de esta cotización.'));
      return;
    }
    const ver = verSnap.data()!;
    res.status(200).send(
      paginaCotizacionHtml({
        folio: cot.folio ?? null,
        rev: ver.rev ?? 'A',
        fecha: ver.fecha?.toDate?.() ?? new Date(),
        cliente: cot.cliente ?? {},
        asunto: cot.titulo ?? '',
        partidas: ver.partidas ?? [],
        formaPago: ver.formaPago,
        tiempoEntrega: ver.tiempoEntrega,
        notas: ver.notas,
      })
    );
  }
);

// México: normaliza a 521XXXXXXXXXX (con lada y el "1" de móvil) para WhatsApp.
function normalizarTelefonoMx(crudo: string): string {
  const d = crudo.replace(/\D/g, '');
  if (d.length === 10) return '521' + d;
  if (/^52\d{10}$/.test(d)) return '521' + d.slice(2);
  return d;
}

// Manda al CLIENTE (por WhatsApp) el enlace a su cotización. Encola el mensaje;
// el bot lo entrega. El número del cliente puede venir en la cotización o darse.
export const enviarCotizacionCliente = onCall(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req) => {
    const usuario = await usuarioDesdeAuth(req);
    exigirRol(usuario, ROLES_OPERADOR);

    const cotizacionId = String(req.data?.cotizacionId ?? '');
    if (!cotizacionId) throw new HttpsError('invalid-argument', 'Falta cotizacionId.');

    const cotSnap = await db.doc(`cotizaciones/${cotizacionId}`).get();
    if (!cotSnap.exists) throw new HttpsError('not-found', 'No existe la cotización.');
    const cot = cotSnap.data()!;
    if (!cot.folio) {
      throw new HttpsError('failed-precondition', 'Aprueba la cotización antes de enviarla al cliente.');
    }

    // Acepta varios teléfonos (telefonos: string[]) o uno solo (telefono).
    const crudos: string[] = Array.isArray(req.data?.telefonos)
      ? req.data.telefonos.map((t: unknown) => String(t))
      : [String(req.data?.telefono ?? cot.cliente?.telefono ?? '')];
    const telefonos = [...new Set(crudos.map((t) => t.trim()).filter(Boolean).map(normalizarTelefonoMx))];
    if (!telefonos.length) throw new HttpsError('invalid-argument', 'No hay teléfono destino. Elige o escribe al menos uno.');

    const secreto = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
    const enlace = `${BASE_FUNCIONES}/verCotizacion?token=${firmarEnlace(secreto, cotizacionId)}`;
    const saludo = cot.cliente?.atencion ? `Hola ${cot.cliente.atencion}` : 'Hola';
    const texto = `${saludo}, le compartimos su cotización ${cot.folio} de Gener Power & Control. Quedamos atentos.`;
    const fileName = `Cotizacion ${cot.folio}.pdf`.replace(/[\\/:*?"<>|]/g, '-');

    // Encola un saliente POR TELÉFONO. El bot renderiza `documentoUrl` a PDF y
    // lo manda adjunto; si el PDF falla, cae al enlace como texto.
    const envios: { telefono: string; mensajeId: string }[] = [];
    for (const telefono of telefonos) {
      const { mensajeId } = await encolarSaliente(db, { telefono, texto, motivo: 'cotizacion_cliente', documentoUrl: enlace, fileName });
      envios.push({ telefono, mensajeId });
    }

    // Directorio del cliente: guarda los números NUEVOS que no sean de nuestro
    // equipo (los de usuarios no contaminan el directorio del cliente).
    if (cot.clienteId) {
      const delCliente: string[] = [];
      for (const t of telefonos) {
        const esDelEquipo = await buscarUsuarioPorTelefono(t);
        if (!esDelEquipo) delCliente.push(t);
      }
      if (delCliente.length) {
        await db.doc(`clientes/${cot.clienteId}`).set(
          { telefono: delCliente[0], telefonos: FieldValue.arrayUnion(...delCliente) },
          { merge: true }
        );
      }
    }
    return { ok: true, envios };
  }
);

// Envía la cotización aprobada por CORREO, con el PDF adjunto. El PDF viaja en
// base64 desde el portal (que ya lo genera para la descarga). Las credenciales
// del remitente se leen de config/correo (capturadas en Configuración → Correo).
export const enviarCotizacionCorreo = onCall(
  { region: REGION },
  async (req) => {
    const usuario = await usuarioDesdeAuth(req);
    exigirRol(usuario, ROLES_OPERADOR);

    const cotizacionId = String(req.data?.cotizacionId ?? '');
    if (!cotizacionId) throw new HttpsError('invalid-argument', 'Falta cotizacionId.');
    const correos = (Array.isArray(req.data?.correos) ? req.data.correos : [])
      .map((c: unknown) => String(c).trim())
      .filter(Boolean);
    if (!correos.length) throw new HttpsError('invalid-argument', 'Elige o escribe al menos un correo.');
    const invalido = correos.find((c: string) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c));
    if (invalido) throw new HttpsError('invalid-argument', `Correo inválido: ${invalido}`);
    const pdfBase64 = String(req.data?.pdfBase64 ?? '');
    if (!pdfBase64) throw new HttpsError('invalid-argument', 'Falta el PDF de la cotización.');

    const cotSnap = await db.doc(`cotizaciones/${cotizacionId}`).get();
    if (!cotSnap.exists) throw new HttpsError('not-found', 'No existe la cotización.');
    const cot = cotSnap.data()!;
    if (!cot.folio) throw new HttpsError('failed-precondition', 'Aprueba la cotización antes de enviarla.');

    const saludo = cot.cliente?.atencion ? `Estimado(a) ${cot.cliente.atencion}` : 'Estimados';
    const asunto = `Cotización ${cot.folio} — Gener Power & Control`;
    const cuerpo =
      `${saludo},\n\n` +
      `Adjunto encontrará la cotización ${cot.folio} de Gener Power & Control. ` +
      `Quedamos atentos a sus comentarios.\n\n` +
      `Saludos cordiales,\nGener Power & Control`;
    const nombreArchivo = `Cotizacion ${cot.folio}.pdf`.replace(/[\\/:*?"<>|]/g, '-');

    try {
      const cfg = await leerConfigCorreo(db);
      await enviarCorreoConAdjuntoPdf(cfg, { para: correos, asunto, cuerpo, pdfBase64, nombreArchivo });
    } catch (e) {
      throw new HttpsError('internal', e instanceof Error ? e.message : 'No se pudo enviar el correo.');
    }
    return { ok: true, enviados: correos };
  }
);

// ---------- Configuración de correo (Configuración → Correo) ----------
// Solo superAdmin captura las credenciales. Nunca se devuelve la contraseña.
export const estadoConfigCorreoCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  return await estadoConfigCorreo(db);
});

export const guardarConfigCorreoCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ['superAdmin']);
  try {
    await guardarConfigCorreo(db, {
      remitente: req.data?.remitente !== undefined ? String(req.data.remitente) : undefined,
      appPassword: req.data?.appPassword !== undefined ? String(req.data.appPassword) : undefined,
    });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo guardar.');
  }
});

// Envía un correo de prueba a la dirección indicada para validar la config.
export const probarCorreoCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ROLES_ADMIN);
  const para = String(req.data?.para ?? usuario.correo ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) {
    throw new HttpsError('invalid-argument', 'Correo de destino inválido.');
  }
  try {
    const cfg = await leerConfigCorreo(db);
    await enviarCorreoPrueba(cfg, para);
    return { ok: true, para };
  } catch (e) {
    throw new HttpsError('internal', e instanceof Error ? e.message : 'No se pudo enviar el correo de prueba.');
  }
});

// ---------- Canal de respaldo: Telegram ----------
// Mismo Portteo, misma base de datos; solo otra "puerta". La identidad se resuelve
// por telegramChatId (el dueño lo vincula en el portal → Usuarios). Responde por
// la Bot API (texto) y acepta fotos (evidencia de rutinas) igual que WhatsApp.
export const webhookTelegram = onRequest(
  { region: REGION, secrets: ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'WHATSAPP_WEBHOOK_SECRET', GEMINI_API_KEY], timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Método no permitido');
      return;
    }
    const secreto = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secreto && req.get('x-telegram-bot-api-secret-token') !== secreto) {
      res.status(401).send('No autorizado');
      return;
    }
    // Token desde config/telegram (capturado en el portal) o el secreto de entorno.
    const token = await tokenTelegram(db);
    // OJO gen2/Cloud Run: el CPU solo está garantizado mientras la petición está
    // abierta. Por eso hacemos TODO el trabajo (incluido el sendMessage) ANTES de
    // responder 200; si respondiéramos antes, el contenedor podría congelarse y el
    // mensaje no saldría. Telegram no reintenta dentro de su ventana (~60s).
    try {
      const msg = (req.body as { message?: Record<string, unknown> })?.message;
      const chat = msg?.chat as { id?: number | string } | undefined;
      const chatId = chat?.id != null ? String(chat.id) : '';
      if (!chatId) return;

      const usuario = await buscarUsuarioPorTelegramChatId(chatId);
      if (!usuario || usuario.activo === false) {
        // Auto-vinculación por teléfono: la persona comparte su número con el botón
        // nativo; si empata con un usuario registrado, guardamos su chat id solo —
        // sin que nadie tenga que pasar IDs al admin.
        const contact = msg?.contact as { phone_number?: string; user_id?: number } | undefined;
        if (contact?.phone_number) {
          // Seguridad: el botón "compartir" trae el número PROPIO (contact.user_id ==
          // quien escribe). Si comparte el contacto de un tercero, no lo aceptamos.
          const from = msg?.from as { id?: number } | undefined;
          if (contact.user_id != null && from?.id != null && contact.user_id !== from.id) {
            await enviarTelegram(token, chatId, 'Por seguridad, comparte *tu propio* número con el botón, no el de otra persona.');
            return;
          }
          const tel = contact.phone_number.replace(/\D/g, '');
          const encontrado = await buscarUsuarioPorTelefono(tel);
          if (!encontrado || encontrado.activo === false) {
            await enviarTelegram(
              token,
              chatId,
              `El número *${tel}* no está registrado (o está inactivo). Pídele a tu administrador que te dé de alta con ese teléfono y vuelve a intentar.`,
              { reply_markup: { remove_keyboard: true } }
            );
            return;
          }
          await actualizarUsuario(db, encontrado.correo, { telegramChatId: chatId });
          await enviarTelegram(
            token,
            chatId,
            `✅ ¡Listo, ${encontrado.nombre}! Quedaste vinculado a Telegram. Escríbeme *hola* para empezar.`,
            { reply_markup: { remove_keyboard: true } }
          );
          return;
        }
        // Aún sin vincular: pide el teléfono con el botón (celular) e incluye el
        // chat id como respaldo (Telegram web/escritorio no muestra ese botón).
        await enviarTelegram(
          token,
          chatId,
          'Hola 👋 Soy Portteo. Para darte acceso necesito identificarte.\n\n' +
            '📱 *Desde el celular:* toca el botón de abajo para compartir tu teléfono y quedas vinculado al instante.\n\n' +
            `💻 *Desde Telegram web/escritorio* (si no ves el botón): tu ID es *${chatId}* — pásaselo a tu administrador (Porttea-Gener → Usuarios → Telegram Chat ID).`,
          {
            reply_markup: {
              keyboard: [[{ text: '📱 Compartir mi teléfono', request_contact: true }]],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          }
        );
        return;
      }
      const telefono = usuario.telefono ?? '';

      // ¿Llegó una foto? (evidencia de rutinas) Telegram manda varios tamaños;
      // tomamos el mayor (el último del arreglo).
      const fotos = msg?.photo as Array<{ file_id?: string }> | undefined;
      const fileId = Array.isArray(fotos) && fotos.length ? fotos[fotos.length - 1]?.file_id : undefined;
      if (fileId) {
        const url = await urlArchivoTelegram(token, fileId);
        if (!url) {
          await enviarTelegram(token, chatId, 'No pude descargar la foto. Reenvíala, por favor.');
          return;
        }
        const bin = await fetch(url);
        const buffer = Buffer.from(await bin.arrayBuffer());
        const caption = typeof msg?.caption === 'string' ? (msg.caption as string) : undefined;
        const ctx = await contextoEjecucionActiva(db, telefono);
        const guardada = await guardarFotoEntrante(db, {
          telefono,
          nombre: usuario.nombre ?? '',
          buffer,
          mimetype: 'image/jpeg',
          caption,
          equipoId: ctx?.equipoId,
          reporteId: ctx?.reporteId,
          paso: ctx?.paso,
        });
        let respuesta = '📷 Foto recibida.';
        if (ctx) {
          const r = await manejarFotoRutina(db, telefono, guardada.url, new Date());
          respuesta = r?.respuesta ?? respuesta;
        }
        await enviarTelegram(token, chatId, respuesta);
        return;
      }

      // Texto.
      const texto = typeof msg?.text === 'string' ? (msg.text as string).trim() : '';
      if (!texto) return;
      const entrante: MensajeEntrante = {
        canal: 'telegram',
        telefono,
        texto,
        nombre: usuario.nombre,
        fecha: new Date(),
      };
      const respuesta = await procesarMensaje(
        {
          buscarUsuario: async () => usuario, // ya resuelto por chat id
          conversar: conversarPortteoWhatsApp,
          flujoRutina: (u, m) =>
            manejarTextoRutina(
              db,
              u,
              m.telefono,
              m.texto,
              new Date(),
              (t) => clasificarIntencionRutina(GEMINI_API_KEY.value(), t),
              (paso, msg) => interpretarMensajeAlta(GEMINI_API_KEY.value(), paso, msg),
              enlaceReporte
            ),
        },
        entrante
      );
      if (respuesta?.texto) await enviarTelegram(token, chatId, respuesta.texto);
    } catch (e) {
      logger.error('webhookTelegram falló:', e);
    } finally {
      // Siempre 200 (ya hicimos el trabajo): evita que Telegram reintente.
      if (!res.headersSent) res.status(200).send('ok');
    }
  }
);

