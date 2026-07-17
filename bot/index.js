import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
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
// Endpoint que recibe fotos (evidencia de Rutinas) para subir a Storage.
const MEDIA_URL = WEBHOOK_URL ? WEBHOOK_URL.replace(/webhookWhatsapp$/, 'recibirMediaWhatsapp') : '';
// Carpeta de la sesión de WhatsApp. Configurable para poder correr una instancia
// de PRUEBAS en paralelo (AUTH_DIR=auth-pruebas) sin pisar la de producción.
const AUTH_DIR = process.env.AUTH_DIR || 'auth';
const INTERVALO_COLA_MS = 15000;
const logger = pino({ level: 'silent' });
console.log('🟢 gener-bot arrancó — build ANTIBAN-v4');

// Socket activo (se setea al conectar). El poller de la cola lo usa para enviar.
let socketActivo = null;

// Seguimiento de acuses: msgId de WhatsApp → id del saliente en la cola.
// Al recibir el acuse ✓✓ (status 3) se marca 'entregado'; si en ACK_TIMEOUT_MS
// no llega ningún acuse, se marca 'sin_confirmar' (típico filtro anti-spam
// hacia números que nunca han chateado con el bot).
const ACK_TIMEOUT_MS = 45000;
const esperandoAcuse = new Map(); // msgId → { colaId, timer }

// Anti-ban: pausas con jitter para imitar a un humano (WhatsApp banea números
// que mandan ráfagas instantáneas con cliente no oficial).
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const entre = (min, max) => min + Math.floor(Math.random() * (max - min));

function vigilarAcuse(msgId, colaId, telefono) {
  if (!msgId) return;
  const timer = setTimeout(async () => {
    if (!esperandoAcuse.has(msgId)) return;
    esperandoAcuse.delete(msgId);
    console.error(`⚠️ Sin acuse de entrega para ${telefono} (msg ${msgId}); marco sin_confirmar.`);
    await marcarSaliente(colaId, 'sin_confirmar', 'WhatsApp no confirmó la entrega. Pide al destinatario que guarde el número del bot o le escriba "hola" primero.');
  }, ACK_TIMEOUT_MS);
  esperandoAcuse.set(msgId, { colaId, timer });
}

async function acuseRecibido(msgId, status) {
  const pend = esperandoAcuse.get(msgId);
  if (!pend || status < 3) return; // 3 = entregado al teléfono, 4 = leído
  clearTimeout(pend.timer);
  esperandoAcuse.delete(msgId);
  await marcarSaliente(pend.colaId, 'entregado');
}

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

// Sube una foto (evidencia de Rutinas) al backend: binario crudo en el cuerpo,
// número y caption en cabeceras. Devuelve true si la función la guardó.
async function enviarFotoAlBackend({ telefono, buffer, mimetype, caption }) {
  if (!MEDIA_URL) return false;
  const headers = {
    'content-type': mimetype || 'image/jpeg',
    'x-webhook-secret': WEBHOOK_SECRET,
    'x-telefono': telefono,
  };
  if (caption) headers['x-caption'] = encodeURIComponent(caption);
  const res = await fetch(MEDIA_URL, { method: 'POST', headers, body: buffer });
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

  let primero = true;
  for (const m of mensajes) {
    if (!m?.id || !m?.telefono || !m?.texto) continue;
    // Pausa aleatoria ENTRE destinatarios (8-15 s): nada de ráfagas.
    if (!primero) {
      const espera = entre(8000, 15000);
      console.log(`⏳ Pausa anti-ban de ${Math.round(espera / 1000)}s antes del siguiente envío…`);
      await pausa(espera);
      if (!socketActivo) return; // se cayó la conexión durante la pausa
    }
    primero = false;
    const num = String(m.telefono).replace(/\D/g, '');
    // Pregúntale a WhatsApp el JID CORRECTO del número. Esto resuelve el lío
    // 521/52 de México y confirma que el número realmente tiene WhatsApp. Sin
    // esto, mandábamos a un JID inexistente y WhatsApp lo tragaba en silencio.
    let jid;
    try {
      const [info] = (await socketActivo.onWhatsApp(num)) ?? [];
      if (!info?.exists) {
        console.error(`⚠️ ${num} no está en WhatsApp; no se entrega ${m.id}.`);
        await marcarSaliente(m.id, 'error', 'El número no tiene WhatsApp.');
        continue;
      }
      jid = info.jid;
      console.log(`🔎 ${num} → JID ${jid}`);
    } catch (e) {
      console.error(`No se pudo verificar ${num} en WhatsApp:`, e?.message ?? e);
      jid = `${num}@s.whatsapp.net`; // último recurso
    }
    try {
      // Simula a un humano: "escribiendo…" 2-5 s antes de mandar.
      try {
        await socketActivo.sendPresenceUpdate('composing', jid);
        await pausa(entre(2000, 5000));
        await socketActivo.sendPresenceUpdate('paused', jid);
      } catch { /* la presencia es cosmética; si falla, se envía igual */ }

      if (m.documentoUrl) {
        // Renderiza la cotización a PDF y la manda como documento adjunto.
        try {
          const pdf = await urlAPdf(m.documentoUrl);
          const enviado = await socketActivo.sendMessage(jid, {
            document: pdf,
            mimetype: 'application/pdf',
            fileName: m.fileName || 'Cotizacion.pdf',
            caption: m.texto,
          });
          console.log(`📄 PDF enviado a ${m.telefono} (msgId ${enviado?.key?.id ?? '?'}); esperando acuse…`);
          vigilarAcuse(enviado?.key?.id, m.id, m.telefono);
        } catch (errPdf) {
          // Si el PDF falla, no dejamos al cliente sin nada: mandamos el enlace.
          console.error(`Falló el PDF (${m.id}), envío el enlace:`, errPdf?.message ?? errPdf);
          await socketActivo.sendMessage(jid, { text: `${m.texto}\n${m.documentoUrl}` });
        }
      } else {
        const enviado = await socketActivo.sendMessage(jid, { text: m.texto });
        console.log(`📤 Texto enviado a ${m.telefono} (msgId ${enviado?.key?.id ?? '?'}); esperando acuse…`);
        vigilarAcuse(enviado?.key?.id, m.id, m.telefono);
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
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, AUTH_DIR));
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

  // Acuses de los mensajes que ENVIAMOS (diagnóstico de entrega):
  // 1=pendiente · 2=✓ llegó al servidor · 3=✓✓ entregado al teléfono · 4=leído.
  // Si un mensaje se queda en 2, WhatsApp lo aceptó pero el teléfono destino
  // nunca lo recibió (bloqueo, filtro anti-spam o número inactivo).
  const NOMBRE_ACK = { 0: 'ERROR', 1: 'pendiente', 2: '✓ servidor', 3: '✓✓ ENTREGADO', 4: 'LEÍDO', 5: 'reproducido' };
  sock.ev.on('messages.update', (updates) => {
    for (const u of updates) {
      const st = u.update?.status;
      if (u.key?.fromMe && st != null) {
        console.log(`📬 Acuse ${u.key.id} → ${st} (${NOMBRE_ACK[st] ?? st}) [${u.key.remoteJid}]`);
        acuseRecibido(u.key.id, st).catch((e) => console.error('Error reportando acuse:', e?.message ?? e));
      }
    }
  });

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
        console.log(`Sesión cerrada. Limpio bot/${AUTH_DIR} y reinicio para mostrar un QR nuevo…`);
        rm(path.join(__dirname, AUTH_DIR), { recursive: true, force: true })
          .catch((e) => console.error(`No se pudo borrar bot/${AUTH_DIR}:`, e?.message ?? e))
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

      const pn = telefonoReal(m);
      const telefono = pn ?? telefonoDeJid(jid);
      // El @lid en Baileys 6.7.x entrega mal (el mensaje llega y WhatsApp lo
      // borra). Con sesión limpia, respondemos al JID canónico del número real
      // (@s.whatsapp.net), que es el direccionamiento más estable.
      const jidRespuesta = pn ? `${pn}@s.whatsapp.net` : jid;

      // ¿Trae foto? (Rutinas Fase 1: evidencia fotográfica). La descargamos y
      // la reenviamos al backend; no pasa por Portteo.
      const imagen = m.message.imageMessage;
      if (imagen) {
        console.log(`📷 Foto de ${telefono} (jid ${jid})…`);
        try {
          const buffer = await downloadMediaMessage(m, 'buffer', {}, {
            logger,
            reuploadRequest: sock.updateMediaMessage,
          });
          const data = await enviarFotoAlBackend({
            telefono,
            buffer,
            mimetype: imagen.mimetype,
            caption: imagen.caption,
          });
          if (data?.ok) {
            // Si hay rutina en curso, el backend devuelve la guía del paso.
            await sock.sendMessage(jidRespuesta, { text: data.respuesta || '📷 Foto recibida, gracias.' });
            console.log(`✅ Foto de ${telefono} guardada.`);
          } else {
            console.log(`↪️ Foto no guardada (número fuera de lista o error): ${telefono}.`);
          }
        } catch (e) {
          console.error('Error con la foto:', e?.message ?? e);
        }
        continue;
      }

      const texto = textoDeMensaje(m);
      if (!texto) continue;

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
// entrega cuando hay socket abierto. El candado evita corridas encimadas: con
// las pausas anti-ban un lote puede tardar más que el intervalo, y sin candado
// la siguiente corrida releería los mismos pendientes (envíos dobles).
let procesandoCola = false;
setInterval(() => {
  if (procesandoCola) return;
  procesandoCola = true;
  procesarColaSalientes()
    .catch((e) => console.error('Error en la cola de salientes:', e?.message ?? e))
    .finally(() => { procesandoCola = false; });
}, INTERVALO_COLA_MS);

iniciar().catch((e) => {
  console.error('Fallo al iniciar el bot:', e);
  process.exit(1);
});
