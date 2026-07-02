// El canal es solo transporte; la fuente de verdad es Firestore.
// Ambos adaptadores (WhatsApp y Telegram) normalizan a este mismo payload,
// para que el router y el agente sean agnósticos al canal.

export type Canal = 'whatsapp' | 'telegram';

export interface MensajeEntrante {
  canal: Canal;
  // Identidad normalizada: solo dígitos, con lada de país (ej. 5217771112233).
  // Los ids de usuarios/{telefono} usan esta misma forma.
  telefono: string;
  texto: string;
  nombre?: string;
  idMensaje?: string;
  fecha: Date;
}

export interface RespuestaSaliente {
  texto: string;
}

export interface AdaptadorCanal {
  canal: Canal;
  enviar(telefono: string, respuesta: RespuestaSaliente): Promise<void>;
}

export function normalizarTelefono(crudo: string): string {
  // Quita '@c.us', '+', espacios, guiones — deja solo dígitos.
  return crudo.replace(/@.*$/, '').replace(/\D/g, '');
}
