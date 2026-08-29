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
  telefono?: string; // identidad del bot de WhatsApp, solo dígitos con lada
  telegramChatId?: string; // identidad del bot de Telegram (respaldo); chat id
}

// Un contacto del cliente (encargado, compras, etc.). Un cliente puede tener varios.
export interface ContactoCliente {
  nombre: string;
  puesto?: string | null; // rol: "Encargado", "Compras", "Almacén"…
  correo?: string | null;
  telefono?: string | null;
}

export interface Cliente {
  nombre: string;
  atencion?: string;
  telefono?: string;
  correo?: string;
  contactos?: ContactoCliente[];
  ultimaFormaPago?: string;
  driveFolderId?: string;
}

// ---- Módulo de Reparaciones (Taller) ----
// Un equipo llega a reparación; se le abre una Orden de Reparación con folio
// OR-… y se le sigue por etapas hasta entregarlo. Ver dominio/reparacion.ts.
export type EstatusReparacion =
  | 'recibido'
  | 'en_diagnostico'
  | 'cotizado'
  | 'aprobado'
  | 'en_reparacion'
  | 'listo'
  | 'entregado'
  | 'rechazado'
  | 'devuelto';

// Equipo que ingresa al taller. Puede o no estar registrado en `equipos` (a
// veces es un equipo que traen una sola vez), por eso los datos van embebidos.
export interface EquipoReparacion {
  descripcion: string; // "Radiador de subestación", "Motor 5 HP"…
  marca?: string | null;
  modelo?: string | null;
  numeroSerie?: string | null; // "s/n" si no tiene
  accesorios?: string | null; // lo que entregan junto con el equipo
}

export interface DiagnosticoReparacion {
  hallazgos: string; // qué encontró el técnico
  refacciones?: string | null; // refacciones/trabajos necesarios (texto)
  tecnico?: string | null;
}

export interface OrdenReparacion {
  folio: string; // OR-MMYY-NNN, asignado AL RECIBIR (número de rastreo)
  estatus: EstatusReparacion;
  // Cliente denormalizado; opcionalmente ligado a la colección `clientes`.
  clienteId?: string | null;
  clienteNombre: string;
  contacto?: ContactoCliente | null;
  equipo: EquipoReparacion;
  fallaReportada: string; // lo que el cliente dice que falla
  fotosRecepcion?: string[]; // URLs en Storage (estado de llegada)
  recibidoPor?: string | null; // correo del operador que lo recibió
  diagnostico?: DiagnosticoReparacion | null;
  cotizacionId?: string | null; // enlace al módulo de cotizaciones
  reparacion?: { tecnico?: string | null; notas?: string | null } | null;
  entrega?: { recibeNombre: string; firmaUrl?: string | null } | null;
  rechazoRazon?: string | null;
  // Reservado para v2 (sin lógica por ahora): garantía sobre la reparación.
  garantia?: { hasta?: Date | null; nota?: string | null } | null;
  // Rastreo: fecha de recepción + sello de cada cambio de etapa. Base de las
  // alertas de "equipos atorados" en el tablero.
  fechaRecepcion: Date;
  fechas?: Partial<Record<EstatusReparacion, Date>>;
}

// El precio vive en la partida (bloque); las líneas son alcance sin precio.
export interface Partida {
  titulo: string;
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
  notas?: string; // notas libres del documento (vacías en una cotización nueva)
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

// Un subtipo de plantilla: mismo alcance (líneas), distinto nombre y precio.
export interface SubtipoPlantilla {
  nombre: string;
  precio: number;
}

export interface Plantilla {
  nombre: string;
  activa: boolean;
  lineas: string[];
  precioSugerido?: number; // cuando NO tiene subtipos (precio único)
  // Con subtipos, el precio deja de ser único: cada subtipo trae su nombre y su
  // precio. Al usar la plantilla se elige uno y el concepto queda "nombre — subtipo".
  tieneSubtipos?: boolean;
  subtipos?: SubtipoPlantilla[];
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
  // La rutina NO pertenece al equipo: un mismo equipo puede recibir distintas
  // rutinas. Se elige al arrancar cada ejecución (ver servicios/ejecucion.ts).
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

// Antes era una lista fija; ahora es texto libre alimentado por el catálogo
// editable `tipos_equipo`. Estos dos son los tipos base del negocio de G-ener.
export type PartidaRutina = string;
export const TIPOS_EQUIPO_BASE = ['Equipo médico', 'Equipo electromecánico'] as const;

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
  esperaComentario?: boolean; // evidencia lista; se pidió el comentario del paso
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
  // 'recibe': terminó pasos, se pide el nombre de quien recibe; 'firma': falta la hoja firmada
  etapa?: 'pasos' | 'recibe' | 'firma';
  inicio: Date;
  fin?: Date;
  pasoActual?: number; // para retomar tras pérdida de señal
  pasos: PasoEjecucion[];
  comentarios: ComentarioEjecucion[];
  recibeNombre?: string; // nombre de quien recibe el servicio (capturado al cierre)
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
