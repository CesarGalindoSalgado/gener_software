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
  // Flujo guiado de Rutinas (Fase 2). Devuelve el texto a responder, o null si
  // no hay nada de rutinas que atender (ejecución activa o arranque del técnico).
  flujoRutina?(usuario: Usuario, mensaje: MensajeEntrante): Promise<string | null>;
}

// Un saludo / petición de menú PURO se responde con el menú por rol; cualquier
// otra cosa (incluido "buenas, hay que revisar un refri...") se manda a Portteo /
// al flujo de rutinas. Es saludo solo si tras quitar los saludos y los signos NO
// queda contenido: "hola" sí, "hola cotiza para X" no.
const PALABRAS_SALUDO =
  /\b(hola+|holi|buen(as|os)|d[ií]as|tardes|noches|hey|hi|inicio|start|ayuda|help|men[uú])\b/gi;
export function esSaludo(texto: string): boolean {
  const t = texto.trim().toLowerCase();
  if (!t) return true;
  const resto = t.replace(PALABRAS_SALUDO, ' ').replace(/[^a-záéíóúñ0-9]/gi, '').trim();
  return resto.length === 0;
}

// Por WhatsApp Portteo trabaja en modo CONSULTA. Armar y aprobar cotizaciones
// es en Porttea-Gener (la web), donde se ve el documento en vivo. El menú lo
// dice honestamente para no prometer lo que este canal aún no hace (Forma 2).
const MENU_DUENO = [
  'Por aquí te ayudo a consultar (para armar y aprobar cotizaciones, entra a Porttea-Gener en la web):',
  '• Buscar un precio del histórico',
  '• Consultar una cotización pasada (por folio o cliente)',
  '• Ver el seguimiento (enviadas sin cerrar)',
  '• Ver las plantillas de servicios',
  '• Recordatorios: crear, ver los pendientes y marcarlos hechos',
  '• Hacer una *rutina* de mantenimiento (escríbeme *rutina* y te guío: cliente → sede → equipo)',
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
      return (
        `Hola ${nombre} 👋 Soy Portteo, tu asistente de rutinas.\n` +
        'Para arrancar una rutina escríbeme *"iniciar"* (o el nombre del cliente) y te voy guiando: ' +
        'cliente → sede → equipo.'
      );
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

  // Rutinas (Fase 2) tiene prioridad: si hay una ejecución activa o el técnico
  // arranca una, el flujo guiado responde. Un saludo suelto igual muestra el
  // menú (no queremos que "hola" arranque nada).
  if (ctx.flujoRutina && !esSaludo(mensaje.texto)) {
    const r = await ctx.flujoRutina(usuario, mensaje);
    if (r != null) return { texto: r };
  }

  // El trabajador no tiene más capacidades en este módulo: menú (que lo guía a
  // mandar el nº de inventario). Para los demás, si no es saludo, va a Portteo.
  if (ctx.conversar && usuario.rol !== 'trabajador' && !esSaludo(mensaje.texto)) {
    return { texto: await ctx.conversar(usuario, mensaje) };
  }
  return { texto: menuPorRol(usuario.rol, usuario.nombre) };
}
