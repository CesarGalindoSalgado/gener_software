// Tipos del dominio de cotizaciones. Espejo del modelo Firestore del brief
// (docs/Brief_Construccion_Cotizaciones.md, sección 3).

// superAdmin: administrador técnico de la plataforma, por encima del dueño;
// tiene todos los permisos del dueño y los reservados a administración.
export type Rol = 'superAdmin' | 'dueno' | 'secretaria' | 'trabajador';

// Roles con permiso de aprobar y de administración (usuarios, recordatorios).
export const ROLES_ADMIN: Rol[] = ['superAdmin', 'dueno'];
// Roles que pueden operar el dominio de cotizaciones (leer/armar).
export const ROLES_OPERADOR: Rol[] = ['superAdmin', 'dueno', 'secretaria'];

export type EstatusCotizacion =
  | 'borrador'
  | 'enviada'
  | 'autorizada'
  | 'realizada'
  | 'rechazada'
  | 'importada'; // solo para históricos cargados por el ETL

export interface Usuario {
  nombre: string;
  correo: string; // identidad web (login con Google/Gmail); es el id del doc
  rol: Rol;
  activo: boolean;
  telefono?: string; // identidad del bot (WhatsApp/Telegram), solo dígitos con lada
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

// ============================================================================
// Módulo de Rutinas (docs/Brief_ClaudeCode_Rutinas_Gener.md).
// Principio: todo cuelga de cliente → sede → equipo (por número de inventario),
// nunca de "Gener" hardcodeado (habilita la renta multi-inquilino futura).
// ============================================================================

export interface Sede {
  clienteId: string;
  nombre: string;
  direccion?: string;
  responsable?: string;
}

export interface Equipo {
  sedeId: string;
  noInventario: string; // Servicios de Salud rastrea por inventario
  descripcion?: string;
  rutinaTipoId?: string; // rutina_plantilla sugerida para este equipo
}

export type EvidenciaTipo = 'foto_comentario' | 'antes_despues' | 'medicion';

export interface EvidenciaPaso {
  tipo: EvidenciaTipo;
  requiereFoto: boolean;
  fotosAntesDespues: boolean;
  requiereLectura: boolean;
  unidadSugerida?: string | null;
  graficoSugerido?: boolean;
  rangoMin?: number;
  rangoMax?: number;
  rangoDefinido?: boolean;
}

export interface PasoRutina {
  orden: number;
  instruccion: string;
  evidencia: EvidenciaPaso;
}

export type PartidaRutina = 'Equipo médico' | 'Equipo electromecánico';

export interface RutinaPlantilla {
  partida: PartidaRutina;
  nombre: string;
  activa: boolean;
  equiposIncluidos: string[];
  refaccionesReferenciales: string[];
  pasos: PasoRutina[];
}

// en_proceso → completada → validada → aprobada → (firmada | faltante_firma)
// Rama alterna desde en_proceso: cancelada.
export type EstatusEjecucion =
  | 'en_proceso'
  | 'cancelada'
  | 'completada'
  | 'validada'
  | 'aprobada'
  | 'firmada'
  | 'faltante_firma';

export interface PasoEjecucion {
  orden: number;
  instruccion: string;
  tipo: EvidenciaTipo;
  comentario?: string;
  fotos?: string[]; // URLs en Firebase Storage
  fotoAntes?: string;
  fotoDespues?: string;
  lectura?: number;
  unidad?: string;
  cumple?: boolean; // lo decide el técnico salvo rango definido
  fecha?: Date; // sello de tiempo del paso
}

export interface ComentarioEjecucion {
  texto: string;
  fotoUrl?: string;
}

export interface RutinaEjecucion {
  folio: string | null; // null hasta aprobar (counters/reporte_{anio})
  rutinaId: string;
  sedeId: string;
  equipoId: string;
  tecnicoTelefono: string;
  tecnicoNombre: string;
  estatus: EstatusEjecucion;
  inicio: Date;
  fin?: Date;
  pasoActual?: number; // para retomar tras pérdida de señal
  pasos: PasoEjecucion[];
  comentarios: ComentarioEjecucion[];
  oportunidad?: string;
  cancelacionRazon?: string;
  reportePdfUrl?: string; // Drive
  evidenciaFirmaUrl?: string; // Storage
  faltanteFirmaRazon?: string;
}

export interface Oportunidad {
  ejecucionId: string;
  sedeId: string;
  texto: string;
  estatus: 'abierta' | 'atendida';
  fecha: Date;
}
