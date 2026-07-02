// Tipos del dominio compartidos con el backend (functions/src/dominio/tipos.ts).
// Mantener en sincronía manual por ahora; a futuro se puede extraer a un paquete.

// superAdmin: administrador técnico de la plataforma, por encima del dueño.
export type Rol = 'superAdmin' | 'dueno' | 'secretaria' | 'trabajador';

export const ROLES_ADMIN: Rol[] = ['superAdmin', 'dueno'];
export const ROLES_OPERADOR: Rol[] = ['superAdmin', 'dueno', 'secretaria'];

export type EstatusCotizacion =
  | 'borrador'
  | 'enviada'
  | 'autorizada'
  | 'realizada'
  | 'rechazada'
  | 'importada';

export interface Usuario {
  nombre: string;
  correo: string;
  rol: Rol;
  activo: boolean;
  telefono?: string;
}

// El precio vive en la partida (bloque); las líneas son alcance sin precio.
export interface Partida {
  titulo: string;
  descripcion?: string;
  lineas: string[];
  cantidad: number;
  importe: number;
}

export interface DatosCliente {
  nombre: string;
  atencion?: string;
  telefono?: string;
  correo?: string;
}

// Borrador de una cotización tal como se edita/renderiza en el taller.
export interface BorradorCotizacion {
  cliente: DatosCliente;
  asunto: string;
  folio: string | null; // null hasta aprobar
  rev: string; // "A", "B", ...
  fecha: string; // ISO
  partidas: Partida[];
  formaPago: string;
  tiempoEntrega: string;
}
