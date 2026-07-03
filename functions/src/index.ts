import Anthropic from '@anthropic-ai/sdk';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall, onRequest, CallableRequest } from 'firebase-functions/v2/https';
import { crearEjecutor } from './agente/ejecutor';
import { conversarConPortteoGemini } from './agente/portteoGemini';
import { normalizarWebhookTelegram } from './canal/telegram';
import { normalizarWebhookWhatsapp } from './canal/whatsapp';
import { ROLES_ADMIN, ROLES_OPERADOR, Rol, Usuario } from './dominio/tipos';
import { procesarMensaje } from './router/router';
import { aprobarCotizacion, ErrorAprobacion } from './servicios/aprobar';
import { escribirBitacora } from './servicios/bitacora';
import {
  crearBorrador,
  guardarMensajeChat,
  leerHistorialChat,
} from './servicios/cotizaciones';

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

// ---------- Webhooks del bot (fase 5: creación por WhatsApp) ----------

async function buscarUsuarioPorTelefono(telefono: string): Promise<Usuario | null> {
  const q = await db.collection('usuarios').where('telefono', '==', telefono).limit(1).get();
  return q.empty ? null : (q.docs[0].data() as Usuario);
}

export const webhookWhatsapp = onRequest(
  { region: REGION, secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
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

    const respuesta = await procesarMensaje({ buscarUsuario: buscarUsuarioPorTelefono }, mensaje);
    res.status(200).json(respuesta ?? { ignorado: true });
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
