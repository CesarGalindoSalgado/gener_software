// Tipos del dominio de cotizaciones. Espejo del modelo Firestore del brief
// (docs/Brief_Construccion_Cotizaciones.md, sección 3).

export type Rol = 'dueno' | 'secretaria' | 'trabajador';

export type EstatusCotizacion =
  | 'borrador'
  | 'enviada'
  | 'autorizada'
  | 'realizada'
  | 'rechazada'
  | 'importada'; // solo para históricos cargados por el ETL

export interface Usuario {
  nombre: string;
  rol: Rol;
  activo: boolean;
}

export interface Cliente {
  nombre: string;
  atencion?: string;
  telefono?: string;
  correo?: string;
  ultimaFormaPago?: string;
  driveFolderId?: string;
}

// El precio vive en la partida (bloque); las líneas son alcance sin precio.
export interface Partida {
  titulo: string;
  descripcion?: string;
  lineas: string[];
  cantidad: number;
  importe: number;
}

export interface Version {
  rev: string; // "A", "B", ...
  estatus: EstatusCotizacion;
  partidas: Partida[];
  subtotal: number;
  iva: number;
  total: number;
  formaPago: string;
  tiempoEntrega: string;
  fecha: Date;
  pdfUrl?: string;
}

export interface Cotizacion {
  folio: string | null; // null hasta la aprobación
  clienteId: string;
  titulo: string;
  estatus: EstatusCotizacion;
  revActual: string;
  fechaCreacion: Date;
  fechaEnvio?: Date; // se sella al aprobar
  fechaEntregaCliente?: Date; // cuándo se mandó realmente al cliente
}

export interface Plantilla {
  nombre: string;
  activa: boolean;
  descripcion?: string;
  lineas: string[];
  precioSugerido?: number;
}

export interface PrecioHistorico {
  clienteId?: string;
  clienteNombre: string;
  concepto: string;
  precio: number;
  equipo?: string;
  marca?: string;
  modelo?: string;
  capacidad?: string;
  fecha?: Date;
  origen: 'import' | 'version';
  versionId?: string;
}

export interface Recordatorio {
  duenoTelefono: string;
  descripcion: string;
  clienteTexto?: string;
  estatus: 'pendiente' | 'hecho';
  fechaCreacion: Date;
}
