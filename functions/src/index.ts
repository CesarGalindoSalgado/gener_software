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
import { crearRecordatorioPortal, marcarRecordatorio, pendientesPorDueno } from './servicios/recordatorios';
import {
  encolarSalienteUnico,
  guardarMensajeWA,
  leerHistorialWA,
  marcarSaliente,
  salientesPendientes,
} from './servicios/whatsapp';
import { MensajeEntrante } from './canal/tipos';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();
const db = getFirestore();

// LLM de Portteo: Gemini (capa gratuita de Google AI Studio). El adaptador de
// Claude (agente/portteo.ts) queda disponible por si se cambia de proveedor.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const REGION = 'us-central1';

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

    const respuesta = await conversarConPortteoGemini({
      apiKey: GEMINI_API_KEY.value(),
      ejecutor: crearEjecutor(db),
      contexto: { correo: usuario.correo, rol: usuario.rol, cotizacionId, versionId },
      historial,
    });

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

async function buscarUsuarioPorTelefono(telefono: string): Promise<Usuario | null> {
  const q = await db.collection('usuarios').where('telefono', '==', telefono).limit(1).get();
  return q.empty ? null : (q.docs[0].data() as Usuario);
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
  'listarPlantillas',
  'crearRecordatorio',
]);

const SYSTEM_WHATSAPP = [
  'Eres Portteo, el asistente de cotizaciones de G-ener (Gener Power & Control), respondiendo por WhatsApp.',
  'Sé breve y claro (es un chat de teléfono). Responde en español, con calidez pero al grano.',
  'Puedes: buscar precios en el histórico, consultar cotizaciones pasadas (por folio o cliente),',
  'listar las plantillas de servicios y guardar recordatorios ("recuérdame cotizar a X").',
  'NO inventas precios: solo los del histórico. Si no hay dato, dilo y sugiere revisarlo en la web.',
  'Para ARMAR o APROBAR una cotización, indícale al usuario que lo haga en Porttea-Gener (la plataforma web),',
  'porque ahí ve el documento en vivo; por WhatsApp solo consultas y recordatorios.',
].join(' ');

// Corre a Portteo para un mensaje de WhatsApp, guardando el historial por
// teléfono para que tenga memoria de la conversación.
async function conversarPortteoWhatsApp(usuario: Usuario, mensaje: MensajeEntrante): Promise<string> {
  const telefono = mensaje.telefono;
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

    const respuesta = await procesarMensaje(
      { buscarUsuario: buscarUsuarioPorTelefono, conversar: conversarPortteoWhatsApp },
      mensaje
    );
    res.status(200).json(respuesta ?? { ignorado: true });
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
