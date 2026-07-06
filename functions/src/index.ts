import Anthropic from '@anthropic-ai/sdk';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall, onRequest, CallableRequest } from 'firebase-functions/v2/https';
import { crearEjecutor } from './agente/ejecutor';
import { HERRAMIENTAS } from './agente/herramientas';
import { conversarConPortteoGemini } from './agente/portteoGemini';
import { normalizarWebhookTelegram } from './canal/telegram';
import { normalizarWebhookWhatsapp } from './canal/whatsapp';
import { ROLES_ADMIN, ROLES_OPERADOR, Rol, Usuario } from './dominio/tipos';
import { procesarMensaje } from './router/router';
import { aprobarCotizacion, ErrorAprobacion } from './servicios/aprobar';
import { validarTransicion } from './dominio/estados';
import { EstatusCotizacion } from './dominio/tipos';
import { escribirBitacora } from './servicios/bitacora';
import {
  crearBorrador,
  crearRevision,
  guardarMensajeChat,
  leerHistorialChat,
} from './servicios/cotizaciones';
import { actualizarUsuario, crearUsuario } from './servicios/usuarios';
import { actualizarPlantilla, crearPlantilla } from './servicios/plantillas';
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
import { MensajeEntrante } from './canal/tipos';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();
const db = getFirestore();

// LLM de Portteo: Gemini (capa gratuita de Google AI Studio). El adaptador de
// Claude (agente/portteo.ts) queda disponible por si se cambia de proveedor.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const REGION = 'us-central1';
// Base pública de las funciones HTTP (para armar el enlace que ve el cliente).
const BASE_FUNCIONES = 'https://us-central1-gener-3ecc1.cloudfunctions.net';

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

  const clienteNombre = String(req.data?.clienteNombre ?? '').trim();
  const titulo = String(req.data?.titulo ?? '').trim() || 'Cotización';
  if (!clienteNombre) {
    throw new HttpsError('invalid-argument', 'Falta el nombre del cliente.');
  }
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

    let respuesta: { texto: string };
    try {
      respuesta = await conversarConPortteoGemini({
        apiKey: GEMINI_API_KEY.value(),
        ejecutor: crearEjecutor(db),
        contexto: { correo: usuario.correo, rol: usuario.rol, cotizacionId, versionId },
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
    return { texto: respuesta.texto };
  }
);

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
      descripcion: req.data?.descripcion,
      precioSugerido: req.data?.precioSugerido ?? null,
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
      descripcion: req.data?.descripcion,
      precioSugerido: req.data?.precioSugerido,
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

// ---------- Gestión de usuarios (solo superAdmin) ----------

export const crearUsuarioCallable = onCall({ region: REGION }, async (req) => {
  const usuario = await usuarioDesdeAuth(req);
  exigirRol(usuario, ['superAdmin']);

  const correo = String(req.data?.correo ?? '').trim();
  const nombre = String(req.data?.nombre ?? '').trim();
  const rol = String(req.data?.rol ?? '') as Rol;
  const password = String(req.data?.password ?? '');
  const telefono = req.data?.telefono ? String(req.data.telefono) : undefined;

  if (!correo || !nombre || !rol) {
    throw new HttpsError('invalid-argument', 'Faltan correo, nombre o rol.');
  }
  try {
    await crearUsuario(db, { correo, nombre, rol, password, telefono });
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
  try {
    await actualizarUsuario(db, correo, {
      nombre: req.data?.nombre,
      rol: req.data?.rol as Rol | undefined,
      activo: req.data?.activo,
      telefono: req.data?.telefono,
      password: req.data?.password,
    });
    return { ok: true };
  } catch (e) {
    throw new HttpsError('invalid-argument', e instanceof Error ? e.message : 'No se pudo actualizar.');
  }
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
        { buscarUsuario: buscarUsuarioPorTelefono, conversar: conversarPortteoWhatsApp },
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
export const colaSalientes = onRequest(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
  async (req, res) => {
    if (req.get('x-webhook-secret') !== process.env.WHATSAPP_WEBHOOK_SECRET) {
      res.status(401).send('No autorizado');
      return;
    }
    if (req.method === 'GET') {
      const mensajes = await salientesPendientes(db, 20);
      res.status(200).json({ mensajes });
      return;
    }
    if (req.method === 'POST') {
      const id = String(req.body?.id ?? '');
      if (!id) {
        res.status(400).json({ error: 'Falta id' });
        return;
      }
      const estatus = req.body?.estatus === 'error' ? 'error' : 'enviado';
      await marcarSaliente(db, id, estatus, req.body?.motivo);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).send('Método no permitido');
  }
);

// Página pública que ve el CLIENTE con su cotización (enlace firmado). No pide
// cuenta: la autorización es el token (firmado + con expiración).
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

    const crudo = String(req.data?.telefono ?? cot.cliente?.telefono ?? '').trim();
    if (!crudo) throw new HttpsError('invalid-argument', 'No hay teléfono del cliente. Escríbelo para enviar.');
    const telefono = normalizarTelefonoMx(crudo);

    const secreto = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
    const enlace = `${BASE_FUNCIONES}/verCotizacion?token=${firmarEnlace(secreto, cotizacionId)}`;
    const saludo = cot.cliente?.atencion ? `Hola ${cot.cliente.atencion}` : 'Hola';
    const texto = `${saludo}, le compartimos su cotización ${cot.folio} de Gener Power & Control. Quedamos atentos.`;
    const fileName = `Cotizacion ${cot.folio}.pdf`.replace(/[\\/:*?"<>|]/g, '-');

    // El bot renderiza `documentoUrl` a PDF y lo manda como adjunto (con `texto`
    // de caption). Si el PDF fallara, el bot cae a enviar el enlace como texto.
    await encolarSaliente(db, { telefono, texto, motivo: 'cotizacion_cliente', documentoUrl: enlace, fileName });

    // Guarda el teléfono en el cliente para la próxima vez.
    if (cot.clienteId && !cot.cliente?.telefono) {
      await db.doc(`clientes/${cot.clienteId}`).set({ telefono }, { merge: true });
    }
    return { ok: true, telefono };
  }
);

export const webhookTelegram = onRequest(
  { region: REGION, secrets: ['TELEGRAM_WEBHOOK_SECRET'] },
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

    const mensaje = normalizarWebhookTelegram(req.body);
    if (!mensaje) {
      res.status(200).send('ignorado');
      return;
    }

    const respuesta = await procesarMensaje({ buscarUsuario: buscarUsuarioPorTelefono }, mensaje);
    res.status(200).json(respuesta ?? { ignorado: true });
  }
);
