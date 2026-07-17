// Cliente mínimo de la Bot API de Telegram (canal de respaldo).
// Node 22 trae fetch/Buffer globales, así que no hace falta dependencia extra.

const BASE = 'https://api.telegram.org';

// Envía un mensaje de texto al chat. Sin parse_mode: Portteo usa *asteriscos*
// estilo WhatsApp; en texto plano se ven literales pero nunca rompen (Telegram
// devuelve 400 si el Markdown viene desbalanceado, por eso lo evitamos).
export async function enviarTelegram(
  token: string,
  chatId: string,
  texto: string,
  extra?: Record<string, unknown>
): Promise<void> {
  const r = await fetch(`${BASE}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, disable_web_page_preview: true, ...extra }),
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    throw new Error(`Telegram sendMessage ${r.status}: ${detalle.slice(0, 200)}`);
  }
}

// Valida el token y devuelve datos del bot (nombre de usuario, etc.).
export async function getMeTelegram(token: string): Promise<{ ok: boolean; username?: string; nombre?: string }> {
  try {
    const r = await fetch(`${BASE}/bot${token}/getMe`);
    const j = (await r.json()) as { ok?: boolean; result?: { username?: string; first_name?: string } };
    if (!j.ok) return { ok: false };
    return { ok: true, username: j.result?.username, nombre: j.result?.first_name };
  } catch {
    return { ok: false };
  }
}

// Registra (o re-registra) el webhook en Telegram apuntando a nuestra función,
// con el secret_token que validamos en cada actualización entrante.
export async function setWebhookTelegram(token: string, url: string, secretToken: string): Promise<void> {
  const r = await fetch(`${BASE}/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ['message'], drop_pending_updates: false }),
  });
  const j = (await r.json()) as { ok?: boolean; description?: string };
  if (!j.ok) throw new Error(`Telegram setWebhook: ${j.description || 'error'}`);
}

// Estado del webhook actual (a qué URL apunta, si hay errores).
export async function getWebhookInfoTelegram(token: string): Promise<{ url?: string; lastError?: string }> {
  try {
    const r = await fetch(`${BASE}/bot${token}/getWebhookInfo`);
    const j = (await r.json()) as { ok?: boolean; result?: { url?: string; last_error_message?: string } };
    if (!j.ok) return {};
    return { url: j.result?.url, lastError: j.result?.last_error_message };
  } catch {
    return {};
  }
}

// Dado un file_id (de una foto entrante), resuelve la URL descargable temporal.
export async function urlArchivoTelegram(token: string, fileId: string): Promise<string | null> {
  const r = await fetch(`${BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!r.ok) return null;
  const j = (await r.json()) as { ok?: boolean; result?: { file_path?: string } };
  if (!j.ok || !j.result?.file_path) return null;
  return `${BASE}/file/bot${token}/${j.result.file_path}`;
}
