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
