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
const logger = pino({ level: 'silent' });

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

async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth'));
  const sock = makeWASocket({ auth: state, logger, printQRInTerminal: false });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      console.log('\n📲 Escanea este código QR con el WhatsApp del número del bot:\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log('✅ WhatsApp conectado. El bot está en línea.');
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const cerroSesion = code === DisconnectReason.loggedOut;
      console.log(`Conexión cerrada (código ${code}).`);
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

iniciar().catch((e) => {
  console.error('Fallo al iniciar el bot:', e);
  process.exit(1);
});
