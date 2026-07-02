// Tipos del dominio compartidos con el backend (functions/src/dominio/tipos.ts).
// Mantener en sincronía manual por ahora; a futuro se puede extraer a un paquete.

export type Rol = 'dueno' | 'secretaria' | 'trabajador';

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
