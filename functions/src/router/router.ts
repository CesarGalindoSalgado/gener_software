import { MensajeEntrante, RespuestaSaliente } from '../canal/tipos';
import { Rol, Usuario } from '../dominio/tipos';

// Router de intención — fase 1: lista blanca + saludo con menú por rol.
// El enrutamiento fino de intención lo hace el agente Portteo (fase 2);
// este router decide QUIÉN es y si se le atiende.

export interface ContextoRouter {
  buscarUsuario(telefono: string): Promise<Usuario | null>;
}

const MENU_DUENO = [
  '1. Crear una cotización',
  '2. Consultar una cotización pasada',
  '3. Buscar un precio en el histórico',
  '4. Mis recordatorios',
  '5. Plantillas de servicios',
].join('\n');

const MENU_SECRETARIA = [
  '1. Armar un borrador de cotización',
  '2. Consultar una cotización pasada',
  '3. Buscar un precio en el histórico',
].join('\n');

export function menuPorRol(rol: Rol, nombre: string): string {
  switch (rol) {
    case 'superAdmin':
    case 'dueno':
      return `Hola ${nombre} 👋 ¿en qué te puedo ayudar?\n${MENU_DUENO}`;
    case 'secretaria':
      return `Hola ${nombre} 👋 ¿en qué te puedo ayudar?\n${MENU_SECRETARIA}`;
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
  return { texto: menuPorRol(usuario.rol, usuario.nombre) };
}
