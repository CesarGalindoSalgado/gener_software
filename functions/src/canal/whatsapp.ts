import { MensajeEntrante, normalizarTelefono } from './tipos';

// Adaptador del servicio de sesión de WhatsApp (número propio del equipo).
// TODO: ajustar los nombres de campos al payload real del servicio de sesión
// que opera el equipo (este esqueleto asume el formato común from/body).

interface WebhookWhatsapp {
  from?: string; // ej. "5217771112233@c.us"
  body?: string;
  pushName?: string;
  id?: string;
  timestamp?: number; // epoch en segundos
}

export function normalizarWebhookWhatsapp(payload: unknown): MensajeEntrante | null {
  const p = payload as WebhookWhatsapp;
  if (!p?.from || typeof p.body !== 'string' || p.body.trim() === '') return null;
  return {
    canal: 'whatsapp',
    telefono: normalizarTelefono(p.from),
    texto: p.body.trim(),
    nombre: p.pushName,
    idMensaje: p.id,
    fecha: p.timestamp ? new Date(p.timestamp * 1000) : new Date(),
  };
}
