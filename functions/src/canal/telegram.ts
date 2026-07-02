import { MensajeEntrante } from './tipos';

// Adaptador de Telegram (Bot API) — canal de respaldo.
// Telegram no expone el número de teléfono: la identidad es el chat id.
// En usuarios/{telefono} se guardará un campo telegramChatId para mapear
// (se implementa en la fase 5; este adaptador ya normaliza el payload).

interface UpdateTelegram {
  message?: {
    message_id?: number;
    date?: number; // epoch en segundos
    text?: string;
    from?: { id?: number; first_name?: string };
    chat?: { id?: number };
  };
}

export interface MensajeTelegram extends MensajeEntrante {
  telegramChatId: string;
}

export function normalizarWebhookTelegram(payload: unknown): MensajeTelegram | null {
  const m = (payload as UpdateTelegram)?.message;
  if (!m?.chat?.id || typeof m.text !== 'string' || m.text.trim() === '') return null;
  return {
    canal: 'telegram',
    // TODO fase 5: resolver el teléfono real vía usuarios.telegramChatId.
    telefono: '',
    telegramChatId: String(m.chat.id),
    texto: m.text.trim(),
    nombre: m.from?.first_name,
    idMensaje: m.message_id ? String(m.message_id) : undefined,
    fecha: m.date ? new Date(m.date * 1000) : new Date(),
  };
}
