import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import puppeteer from 'puppeteer';
import path from 'node:path';
import { rm } from 'node:fs/promises';
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

// WhatsApp puede identificar al remitente con un LID (@lid), que NO es el
// teléfono. El número real vive en un JID que termina en @s.whatsapp.net, que
// Baileys expone en remoteJidAlt/participantAlt cuando el principal es @lid.
function telefonoReal(m) {
  const k = m.key ?? {};
  const candidatos = [k.remoteJid, k.remoteJidAlt, k.participant, k.participantAlt, k.senderPn];
  const pn = candidatos.find((j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net'));
  return pn ? telefonoDeJid(pn) : null;
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
  let comando = null;
  try {
    const res = await fetch(COLA_URL, {
      method: 'GET',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    });
    const data = await res.json().catch(() => ({}));
    mensajes = Array.isArray(data?.mensajes) ? data.mensajes : [];
    comando = data?.comando ?? null;
  } catch (e) {
    console.error('No se pudo leer la cola de salientes:', e?.message ?? e);
    return;
  }

  // El portal pidió desconectar: limpiamos el comando (para no repetir) y
  // cerramos la sesión. El logout dispara connection.close 'loggedOut', que
  // borra bot/auth y reinicia para mostrar un QR nuevo.
  if (comando === 'desconectar') {
    console.log('🔌 Desconexión solicitada desde el portal.');
    await avisarComandoHecho();
    try {
      await socketActivo.logout();
    } catch (e) {
      console.error('No se pudo cerrar la sesión:', e?.message ?? e);
    }
    return;
  }

  for (const m of mensajes) {
    if (!m?.id || !m?.telefono || !m?.texto) continue;
    const jid = `${String(m.telefono).replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      if (m.documentoUrl) {
        // Renderiza la cotización a PDF y la manda como documento adjunto.
        try {
          const pdf = await urlAPdf(m.documentoUrl);
          await socketActivo.sendMessage(jid, {
            document: pdf,
            mimetype: 'application/pdf',
            fileName: m.fileName || 'Cotizacion.pdf',
            caption: m.texto,
          });
          console.log(`📄 PDF entregado a ${m.telefono}.`);
        } catch (errPdf) {
          // Si el PDF falla, no dejamos al cliente sin nada: mandamos el enlace.
          console.error(`Falló el PDF (${m.id}), envío el enlace:`, errPdf?.message ?? errPdf);
          await socketActivo.sendMessage(jid, { text: `${m.texto}\n${m.documentoUrl}` });
        }
      } else {
        await socketActivo.sendMessage(jid, { text: m.texto });
        console.log(`📤 Aviso entregado a ${m.telefono}.`);
      }
      await marcarSaliente(m.id, 'enviado');
    } catch (e) {
      console.error(`No se pudo entregar el aviso ${m.id}:`, e?.message ?? e);
      await marcarSaliente(m.id, 'error', e?.message);
    }
  }
}

// Navegador headless compartido para renderizar cotizaciones a PDF. Se lanza
// una sola vez (perezoso) y se reutiliza.
let navegador = null;
async function obtenerNavegador() {
  if (navegador && navegador.isConnected()) return navegador;
  navegador = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  return navegador;
}

// Renderiza una URL (el enlace de la cotización) a PDF tamaño carta y devuelve
// el Buffer. Texto vectorial (mejor calidad que el html2pdf del portal).
async function urlAPdf(url) {
  const browser = await obtenerNavegador();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdf = await page.pdf({
      format: 'letter',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

// Avisa a la Cloud Function que el comando pendiente ya se ejecutó (lo limpia).
async function avisarComandoHecho() {
  try {
    await fetch(COLA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
      body: JSON.stringify({ comandoHecho: true }),
    });
  } catch (e) {
    console.error('No se pudo limpiar el comando:', e?.message ?? e);
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
  // Fija la version actual de WhatsApp Web: sin esto, una version desfasada
  // provoca "código 405" en la conexión fresca.
  const { version } = await fetchLatestBaileysVersion();
  console.log(`Baileys usando WhatsApp Web v${version.join('.')}`);
  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
  });

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
        // Sesión cerrada (desde el teléfono o desde el portal): borramos las
        // credenciales y reiniciamos para emitir un QR nuevo automáticamente.
        console.log('Sesión cerrada. Limpio bot/auth y reinicio para mostrar un QR nuevo…');
        rm(path.join(__dirname, 'auth'), { recursive: true, force: true })
          .catch((e) => console.error('No se pudo borrar bot/auth:', e?.message ?? e))
          .finally(() => {
            setTimeout(() => iniciar().catch((e) => console.error('Fallo al reiniciar:', e?.message ?? e)), 2000);
          });
      } else {
        // Backoff para no martillar a WhatsApp (evita el loop rápido de 405).
        console.log('Reconectando en 3s…');
        setTimeout(() => iniciar().catch((e) => console.error('Fallo al reconectar:', e?.message ?? e)), 3000);
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

      const pn = telefonoReal(m);
      const telefono = pn ?? telefonoDeJid(jid);
      // El @lid en Baileys 6.7.x entrega mal (el mensaje llega y WhatsApp lo
      // borra). Con sesión limpia, respondemos al JID canónico del número real
      // (@s.whatsapp.net), que es el direccionamiento más estable.
      const jidRespuesta = pn ? `${pn}@s.whatsapp.net` : jid;
      console.log(`📩 Mensaje de ${telefono} (jid ${jid}) → respondo a ${jidRespuesta}: "${texto.slice(0, 40)}"`);

      try {
        await sock.sendPresenceUpdate('composing', jidRespuesta);
        const data = await enviarAlWebhook({ from: telefono, body: texto, pushName: m.pushName });
        if (data?.texto) {
          await sock.sendMessage(jidRespuesta, { text: data.texto });
          console.log(`✅ Respondido a ${telefono}.`);
        } else {
          console.log(`↪️ Sin respuesta (número fuera de lista o ignorado): ${telefono}.`);
        }
        // Si el número no está en la lista blanca, el webhook responde
        // { ignorado: true } y no contestamos (regla del brief).
      } catch (e) {
        console.error('Error procesando mensaje:', e?.message ?? e);
      } finally {
        await sock.sendPresenceUpdate('paused', jidRespuesta);
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
