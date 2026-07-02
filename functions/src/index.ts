import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { normalizarWebhookTelegram } from './canal/telegram';
import { normalizarWebhookWhatsapp } from './canal/whatsapp';
import { Usuario } from './dominio/tipos';
import { procesarMensaje } from './router/router';

initializeApp();
const db = getFirestore();

// El bot resuelve por número: el id del doc es el correo (identidad web),
// así que se busca por el campo `telefono`. Admin SDK ignora las reglas y
// puede consultar libremente.
async function buscarUsuario(telefono: string): Promise<Usuario | null> {
  const q = await db.collection('usuarios').where('telefono', '==', telefono).limit(1).get();
  return q.empty ? null : (q.docs[0].data() as Usuario);
}

// Webhook de WhatsApp (servicio de sesión del equipo).
// Verifica el secreto compartido antes de procesar.
export const webhookWhatsapp = onRequest(
  { region: 'us-central1', secrets: ['WHATSAPP_WEBHOOK_SECRET'] },
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
      res.status(200).send('ignorado'); // payload sin mensaje útil (acks, estados)
      return;
    }

    const respuesta = await procesarMensaje({ buscarUsuario }, mensaje);
    // Fase 1: la respuesta se regresa en el body; el envío activo por el
    // servicio de sesión (WHATSAPP_API_URL) se conecta al definir su API.
    res.status(200).json(respuesta ?? { ignorado: true });
  }
);

// Webhook de Telegram (respaldo). El mapeo chatId → usuario llega en fase 5;
// por ahora normaliza y responde solo a números ya mapeados.
export const webhookTelegram = onRequest(
  { region: 'us-central1', secrets: ['TELEGRAM_WEBHOOK_SECRET'] },
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

    const respuesta = await procesarMensaje({ buscarUsuario }, mensaje);
    res.status(200).json(respuesta ?? { ignorado: true });
  }
);
