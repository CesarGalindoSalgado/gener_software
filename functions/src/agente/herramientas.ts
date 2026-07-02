import Anthropic from '@anthropic-ai/sdk';

// Herramientas expuestas al LLM (brief 5.2). Los esquemas viven aquí; las
// implementaciones reales (Firestore) se conectan vía EjecutorHerramientas
// en la fase 2 — este archivo no debe importar firebase-admin.

export const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: 'buscarHistorico',
    description:
      'Busca en la bitácora de precios lo último cobrado a un cliente por un concepto o bloque. Úsala SIEMPRE antes de sugerir un precio; nunca inventes precios.',
    input_schema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nombre del cliente' },
        concepto: { type: 'string', description: 'Concepto, bloque o equipo a buscar' },
      },
      required: ['concepto'],
    },
  },
  {
    name: 'crearBorrador',
    description:
      'Crea una cotización nueva en estatus borrador (Rev. A, sin folio) para un cliente.',
    input_schema: {
      type: 'object',
      properties: {
        clienteId: { type: 'string', description: 'Id del cliente en Firestore' },
        titulo: { type: 'string', description: 'Título o asunto de la cotización' },
      },
      required: ['clienteId', 'titulo'],
    },
  },
  {
    name: 'agregarBloque',
    description:
      'Agrega una partida (bloque) a la versión en edición. El precio vive en el bloque; las líneas son alcance sin precio.',
    input_schema: {
      type: 'object',
      properties: {
        versionId: { type: 'string' },
        titulo: { type: 'string' },
        descripcion: { type: 'string' },
        lineas: { type: 'array', items: { type: 'string' } },
        cantidad: { type: 'number', description: 'Default 1' },
        importe: {
          type: 'number',
          description:
            'Precio del bloque. Debe venir del histórico o dictado por el dueño — nunca inventado.',
        },
      },
      required: ['versionId', 'titulo', 'importe'],
    },
  },
  {
    name: 'ajustarPrecioBloque',
    description: 'Cambia el importe de un bloque y recalcula subtotal, IVA (16%) y total.',
    input_schema: {
      type: 'object',
      properties: {
        versionId: { type: 'string' },
        bloque: { type: 'number', description: 'Índice del bloque (empezando en 0)' },
        nuevoImporte: { type: 'number' },
      },
      required: ['versionId', 'bloque', 'nuevoImporte'],
    },
  },
  {
    name: 'aprobarCotizacion',
    description:
      'Aprueba una cotización: asigna folio transaccional, cambia a enviada y dispara PDF/Drive/bitácora. SOLO el rol dueño puede aprobar; el backend rechaza a cualquier otro.',
    input_schema: {
      type: 'object',
      properties: {
        cotizacionId: { type: 'string' },
      },
      required: ['cotizacionId'],
    },
  },
  {
    name: 'consultarCotizacion',
    description:
      'Recupera una cotización pasada por folio o por cliente para renderizarla. Si la búsqueda por cliente devuelve varias, regresa las últimas con folio/fecha/asunto para que el usuario elija.',
    input_schema: {
      type: 'object',
      properties: {
        folio: { type: 'string', description: 'Folio exacto, ej. GPC-0326-005' },
        cliente: { type: 'string', description: 'Nombre del cliente' },
      },
    },
  },
  {
    name: 'clonarComoBase',
    description:
      'Crea un borrador nuevo copiando los bloques y precios de una cotización existente, para el cliente destino, sin folio. La forma de pago NO se arrastra: se sugiere la última del cliente destino (fallback 70% anticipo / 30% entrega).',
    input_schema: {
      type: 'object',
      properties: {
        cotizacionId: { type: 'string', description: 'Cotización origen' },
        clienteId: { type: 'string', description: 'Cliente destino del nuevo borrador' },
      },
      required: ['cotizacionId', 'clienteId'],
    },
  },
  {
    name: 'crearRecordatorio',
    description: 'Guarda un pendiente del dueño ("recuérdame crear una cotización para...").',
    input_schema: {
      type: 'object',
      properties: {
        descripcion: { type: 'string' },
        clienteTexto: { type: 'string', description: 'Cliente mencionado, texto libre' },
      },
      required: ['descripcion'],
    },
  },
];

// Contrato que la fase 2 implementa con Firestore. Cada método regresa un
// resultado serializable que se le devuelve al LLM como tool_result.
export interface EjecutorHerramientas {
  ejecutar(nombre: string, entrada: unknown, contexto: ContextoEjecucion): Promise<string>;
}

export interface ContextoEjecucion {
  telefono: string;
  rol: 'dueno' | 'secretaria' | 'trabajador';
}

// Stub de fase 1: responde que la herramienta aún no está conectada.
export const ejecutorPendiente: EjecutorHerramientas = {
  async ejecutar(nombre: string): Promise<string> {
    return JSON.stringify({
      error: `La herramienta ${nombre} aún no está conectada (fase 2).`,
    });
  },
};
