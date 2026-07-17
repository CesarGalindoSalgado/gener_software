import { Firestore } from 'firebase-admin/firestore';
import { getMeTelegram, getWebhookInfoTelegram, setWebhookTelegram } from './telegramApi';
import { BASE_FUNCIONES } from '../dominio/entorno';

// Configuración del canal Telegram (respaldo). El token del bot (de BotFather) se
// guarda en config/telegram (bloqueado para clientes; solo el Admin SDK lo lee),
// para poder configurarlo desde el portal sin terminal. Fallback al secreto de
// entorno TELEGRAM_BOT_TOKEN si aún no se capturó por el portal.
const URL_WEBHOOK = `${BASE_FUNCIONES}/webhookTelegram`;

export interface ConfigTelegram {
  botToken?: string;
}

export async function leerConfigTelegram(db: Firestore): Promise<ConfigTelegram> {
  const snap = await db.doc('config/telegram').get();
  return (snap.data() ?? {}) as ConfigTelegram;
}

// Token efectivo: el capturado en el portal o, si no, el secreto de entorno.
export async function tokenTelegram(db: Firestore): Promise<string> {
  const cfg = await leerConfigTelegram(db);
  return (cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

export async function guardarConfigTelegram(db: Firestore, datos: { botToken?: string }): Promise<void> {
  const upd: Record<string, unknown> = {};
  if (datos.botToken !== undefined) upd.botToken = datos.botToken.trim();
  if (Object.keys(upd).length) await db.doc('config/telegram').set(upd, { merge: true });
}

// Estado para el portal: ¿hay token válido?, nombre del bot, ¿webhook apuntando bien?
export async function estadoConfigTelegram(
  db: Firestore
): Promise<{ tieneToken: boolean; botUsername: string | null; webhookOk: boolean; webhookUrl: string | null; ultimoError: string | null }> {
  const token = await tokenTelegram(db);
  if (!token) return { tieneToken: false, botUsername: null, webhookOk: false, webhookUrl: null, ultimoError: null };
  const [me, info] = await Promise.all([getMeTelegram(token), getWebhookInfoTelegram(token)]);
  return {
    tieneToken: me.ok,
    botUsername: me.username ?? null,
    webhookOk: (info.url ?? '') === URL_WEBHOOK,
    webhookUrl: info.url ?? null,
    ultimoError: info.lastError ?? null,
  };
}

// Registra el webhook en Telegram apuntando a nuestra función, con el secret_token.
export async function registrarWebhookTelegram(db: Firestore, secretToken: string): Promise<{ botUsername: string | null }> {
  const token = await tokenTelegram(db);
  if (!token) throw new Error('Primero captura y guarda el token del bot.');
  const me = await getMeTelegram(token);
  if (!me.ok) throw new Error('El token no es válido (Telegram no reconoció el bot). Revísalo con BotFather.');
  await setWebhookTelegram(token, URL_WEBHOOK, secretToken);
  return { botUsername: me.username ?? null };
}
