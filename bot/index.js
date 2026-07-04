import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Bot de WhatsApp para Portteo. Es SOLO transporte: reenvía los mensajes de los
// números en la lista blanca al webhook de las Cloud Functions (donde vive la
// lógica y la IA) y devuelve la respuesta por WhatsApp.
//
// Config por variables de entorno (ver ecosystem.config.cjs / .env):
//   WEBHOOK_URL              → URL del Cloud Function webhookWhatsapp
//   WHATSAPP_WEBHOOK_SECRET  → secreto compartido con la función
//
// La sesión de WhatsApp se guarda en bot/auth (NO subir al repo).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET ?? '';
// Endpoint donde publicamos el QR/estado para que el portal lo muestre.
const ESTADO_URL = WEBHOOK_URL ? WEBHOOK_URL.replace(/webhookWhatsapp$/, 'estadoBot') : '';
// Endpoint de la cola de salientes (avisos L/M/V que debemos entregar).
const COLA_URL = WEBHOOK_URL ? WEBHOOK_URL.replace(/webhookWhatsapp$/, 'colaSalientes') : '';
const INTERVALO_COLA_MS = 15000;
const logger = pino({ level: 'silent' });

// Socket activo (se setea al conectar). El poller de la cola lo usa para enviar.
let socketActivo = null;

async function publicarEstado(datos) {
  if (!ESTADO_URL) return;
  try {
    await fetch(ESTADO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
      body: JSON.stringify(datos),
    });
  } catch (e) {
    console.error('No se pudo publicar el estado:', e?.message ?? e);
  }
}

if (!WEBHOOK_URL) {
  console.error('Falta WEBHOOK_URL en el entorno.');
  process.exit(1);
}

function textoDeMensaje(m) {
  const msg = m.message ?? {};
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    ''
  ).trim();
}

function telefonoDeJid(jid) {
  // "5217771234567:12@s.whatsapp.net" → "5217771234567"
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

async function enviarAlWebhook(payload) {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({}));
}

// Pregunta a la Cloud Function qué avisos hay pendientes, los entrega por
// WhatsApp y marca cada uno como enviado. Corre solo si el socket está abierto.
async function procesarColaSalientes() {
  if (!COLA_URL || !socketActivo) return;
  let mensajes = [];
  try {
    const res = await fetch(COLA_URL, {
      method: 'GET',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    });
    const data = await res.json().catch(() => ({}));
    mensajes = Array.isArray(data?.mensajes) ? data.mensajes : [];
  } catch (e) {
    console.error('No se pudo leer la cola de salientes:', e?.message ?? e);
    return;
  }

  for (const m of mensajes) {
    if (!m?.id || !m?.telefono || !m?.texto) continue;
    const jid = `${String(m.telefono).replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      await socketActivo.sendMessage(jid, { text: m.texto });
      await marcarSaliente(m.id, 'enviado');
      console.log(`📤 Aviso entregado a ${m.telefono}.`);
    } catch (e) {
      console.error(`No se pudo entregar el aviso ${m.id}:`, e?.message ?? e);
      await marcarSaliente(m.id, 'error', e?.message);
    }
  }
}

async function marcarSaliente(id, estatus, motivo) {
  try {
    await fetch(COLA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
      body: JSON.stringify({ id, estatus, motivo: motivo ?? null }),
    });
  } catch (e) {
    console.error('No se pudo marcar el saliente:', e?.message ?? e);
  }
}

async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth'));
  const sock = makeWASocket({ auth: state, logger, printQRInTerminal: false });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      console.log('\n📲 Escanea este QR (o desde el portal → WhatsApp):\n');
      qrcode.generate(qr, { small: true });
      publicarEstado({ estado: 'esperando_qr', qr });
    }
    if (connection === 'open') {
      socketActivo = sock;
      console.log('✅ WhatsApp conectado. El bot está en línea.');
      publicarEstado({ estado: 'conectado', qr: null, numero: sock.user?.id?.split(':')[0] ?? null });
    }
    if (connection === 'close') {
      socketActivo = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      const cerroSesion = code === DisconnectReason.loggedOut;
      console.log(`Conexión cerrada (código ${code}).`);
      publicarEstado({ estado: cerroSesion ? 'desvinculado' : 'desconectado', qr: null });
      if (cerroSesion) {
        console.log('Sesión cerrada desde el teléfono. Borra la carpeta bot/auth y vuelve a vincular.');
      } else {
        console.log('Reconectando…');
        iniciar();
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (m.key.fromMe || !m.message) continue;
      const jid = m.key.remoteJid;
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue; // ignora grupos/estados

      const texto = textoDeMensaje(m);
      if (!texto) continue;
      const telefono = telefonoDeJid(jid);

      try {
        await sock.sendPresenceUpdate('composing', jid);
        const data = await enviarAlWebhook({ from: telefono, body: texto, pushName: m.pushName });
        if (data?.texto) {
          await sock.sendMessage(jid, { text: data.texto });
        }
        // Si el número no está en la lista blanca, el webhook responde
        // { ignorado: true } y no contestamos (regla del brief).
      } catch (e) {
        console.error('Error procesando mensaje:', e?.message ?? e);
      } finally {
        await sock.sendPresenceUpdate('paused', jid);
      }
    }
  });
}

// Poller de la cola de salientes (avisos L/M/V). Corre en segundo plano; solo
// entrega cuando hay socket abierto.
setInterval(() => {
  procesarColaSalientes().catch((e) => console.error('Error en la cola de salientes:', e?.message ?? e));
}, INTERVALO_COLA_MS);

iniciar().catch((e) => {
  console.error('Fallo al iniciar el bot:', e);
  process.exit(1);
});
