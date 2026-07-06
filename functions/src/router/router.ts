import { MensajeEntrante, RespuestaSaliente } from '../canal/tipos';
import { Rol, Usuario } from '../dominio/tipos';

// Router de intención — fase 1: lista blanca + saludo con menú por rol.
// El enrutamiento fino de intención lo hace el agente Portteo (fase 2);
// este router decide QUIÉN es y si se le atiende.

export interface ContextoRouter {
  buscarUsuario(telefono: string): Promise<Usuario | null>;
  // Corre a Portteo (LLM) para el mensaje. Lo inyecta el canal (webhook) para
  // que el router no dependa del proveedor de IA. Si no se pasa, solo hay menú.
  conversar?(usuario: Usuario, mensaje: MensajeEntrante): Promise<string>;
}

// Un saludo / petición de menú se responde con el menú por rol (determinista);
// cualquier otra cosa se manda a Portteo.
const RE_SALUDO = /^\s*(hola|holi|menu|menú|buenas|buenos|hey|hi|inicio|start|ayuda|help|\?)\b/i;
export function esSaludo(texto: string): boolean {
  return !texto.trim() || RE_SALUDO.test(texto);
}

// Por WhatsApp Portteo trabaja en modo CONSULTA. Armar y aprobar cotizaciones
// es en Porttea-Gener (la web), donde se ve el documento en vivo. El menú lo
// dice honestamente para no prometer lo que este canal aún no hace (Forma 2).
const MENU_DUENO = [
  'Por aquí te ayudo a consultar (para armar y aprobar, entra a Porttea-Gener en la web):',
  '• Buscar un precio del histórico',
  '• Consultar una cotización pasada (por folio o cliente)',
  '• Ver el seguimiento (enviadas sin cerrar)',
  '• Ver las plantillas de servicios',
  '• Recordatorios: crear, ver los pendientes y marcarlos hechos',
  '',
  'Escríbeme lo que necesitas 🙂',
].join('\n');

const MENU_SECRETARIA = [
  'Por aquí te ayudo a consultar (para armar un borrador, entra a Porttea-Gener en la web):',
  '• Buscar un precio del histórico',
  '• Consultar una cotización pasada (por folio o cliente)',
  '• Ver el seguimiento (enviadas sin cerrar)',
  '• Ver las plantillas de servicios',
  '',
  'Escríbeme lo que necesitas 🙂',
].join('\n');

export function menuPorRol(rol: Rol, nombre: string): string {
  nombre = (nombre ?? '').trim() || 'que tal'; // por si el usuario no tiene nombre
  switch (rol) {
    case 'superAdmin':
    case 'dueno':
      return `Hola ${nombre} 👋\n${MENU_DUENO}`;
    case 'secretaria':
      return `Hola ${nombre} 👋\n${MENU_SECRETARIA}`;
    case 'trabajador':
      return `Hola ${nombre} 👋 Por ahora no tengo opciones para tu rol en este módulo.`;
  }
}

// Devuelve null cuando el número NO está en la lista blanca: se ignora sin
// responder (regla del brief: un número desconocido no recibe respuesta).
export async function procesarMensaje(
  ctx: ContextoRouter,
  mensaje: MensajeEntrante
): Promise<RespuestaSaliente | null> {
  if (!mensaje.telefono) return null;
  const usuario = await ctx.buscarUsuario(mensaje.telefono);
  if (!usuario || !usuario.activo) return null;

  // El trabajador no tiene capacidades en este módulo: siempre el menú.
  // Para los demás, si no es un saludo y hay motor de conversación, va a Portteo.
  if (ctx.conversar && usuario.rol !== 'trabajador' && !esSaludo(mensaje.texto)) {
    return { texto: await ctx.conversar(usuario, mensaje) };
  }
  return { texto: menuPorRol(usuario.rol, usuario.nombre) };
}
