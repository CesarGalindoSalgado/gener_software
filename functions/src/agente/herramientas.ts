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
      'Crea la cotización nueva en estatus borrador (Rev. A, sin folio) con sus datos de cabecera. Úsala UNA vez que tengas el cliente y el asunto (la persona "dirigida a" es opcional). Si el cliente no existe, se registra (pide confirmación antes con buscarCliente).',
    input_schema: {
      type: 'object',
      properties: {
        clienteNombre: { type: 'string', description: 'Nombre del cliente' },
        titulo: { type: 'string', description: 'Asunto de la cotización' },
        atencion: { type: 'string', description: 'Atención (At\'n): persona a cuya atención va la cotización (opcional)' },
      },
      required: ['clienteNombre', 'titulo'],
    },
  },
  {
    name: 'agregarBloque',
    description:
      'Agrega una partida (bloque) a la versión en edición. El precio vive en el bloque; las líneas son alcance sin precio.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        lineas: { type: 'array', items: { type: 'string' } },
        cantidad: {
          type: 'number',
          description:
            'Número de unidades de la partida (ej. "3 metros de cable" → 3, "2 piezas" → 2). Default 1. El total de la partida es importe × cantidad.',
        },
        importe: {
          type: 'number',
          description:
            'PRECIO UNITARIO (por una sola unidad), no el total. El total del renglón se calcula como importe × cantidad. Debe venir del histórico o dictado por el usuario — nunca inventado. Si el usuario da un precio TOTAL por varias unidades, pon cantidad 1 con ese total, o divídelo entre la cantidad; ante la duda, pregúntale.',
        },
      },
      required: ['titulo', 'importe'],
    },
  },
  {
    name: 'ajustarPrecioBloque',
    description: 'Cambia el importe de un bloque y recalcula subtotal, IVA (16%) y total.',
    input_schema: {
      type: 'object',
      properties: {
        bloque: { type: 'number', description: 'Índice del bloque (empezando en 0)' },
        nuevoImporte: { type: 'number' },
      },
      required: ['bloque', 'nuevoImporte'],
    },
  },
  {
    name: 'aprobarCotizacion',
    description:
      'Aprueba la cotización en edición (o la indicada): asigna folio transaccional y cambia a enviada. SOLO dueño o superAdmin pueden aprobar; el backend rechaza a cualquier otro. Confirma con el usuario antes de aprobar.',
    input_schema: {
      type: 'object',
      properties: {
        cotizacionId: { type: 'string', description: 'Opcional; por defecto la cotización en edición' },
      },
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
        orden: { type: 'string', enum: ['reciente', 'antigua'], description: 'Criterio si hay varias del cliente: "reciente" (la última, por defecto) o "antigua" (la más vieja/primera).' },
      },
    },
  },
  {
    name: 'copiarBloques',
    description:
      'AGREGA todas las partidas de una cotización existente a la cotización que se está editando AHORA (la actual, en este chat). Úsala cuando el usuario quiera "traer/agregar/copiar TAL CUAL" otra cotización a la que ya está armando, SIN crear otra. PREFIERE pasar "cliente" con el nombre (ej. "Eléctrica Ferrero") y el servidor toma la MÁS RECIENTE de ese cliente; usa cotizacionId solo si lo tienes exacto.',
    input_schema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nombre del cliente cuya última cotización copiar (recomendado)' },
        cotizacionId: { type: 'string', description: 'Id exacto de la cotización origen (opcional)' },
      },
    },
  },
  {
    name: 'previsualizarCotizacion',
    description:
      'Muestra en el panel una cotización existente en VISTA PREVIA (solo lectura, SIN guardar ni crear nada). Úsala cuando el usuario pida MOSTRAR/VER una cotización ("muéstrame la de X", "la última de Y"). Después de mostrarla, PREGUNTA al usuario si quiere usar ESTA como base o buscar otra; NO la clones hasta que confirme. PREFIERE pasar "cliente"; usa "folio" si eligió una específica; "orden" antigua/reciente si lo pide.',
    input_schema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nombre del cliente cuya cotización mostrar' },
        folio: { type: 'string', description: 'Folio de una cotización específica, ej. "GPC-0726-061"' },
        cotizacionId: { type: 'string', description: 'Id exacto (opcional)' },
        orden: { type: 'string', enum: ['reciente', 'antigua'], description: 'Cuál del cliente: "reciente" (por defecto) o "antigua".' },
      },
    },
  },
  {
    name: 'clonarComoBase',
    description:
      'Crea un borrador NUEVO copiando los bloques y precios de una cotización existente, sin folio. Úsala también cuando el usuario pida MOSTRAR/ABRIR/TRABAJAR una cotización previa ("muéstrame la de X", "ábreme la GPC-...") — así trabaja sobre una COPIA sin tocar el original. PREFIERE pasar "cliente" (toma su más reciente) o "folio" si el usuario eligió una específica. Usa cotizacionId solo si lo tienes exacto. clienteNombre = cliente destino (por defecto, el mismo de la origen).',
    input_schema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nombre del cliente cuya cotización usar de base (recomendado)' },
        folio: { type: 'string', description: 'Folio de la cotización específica a clonar, ej. "GPC-0726-027" (cuando el usuario eligió una entre varias)' },
        cotizacionId: { type: 'string', description: 'Id exacto de la cotización origen (opcional)' },
        clienteNombre: { type: 'string', description: 'Cliente destino del nuevo borrador (opcional; por defecto el de la origen)' },
        orden: { type: 'string', enum: ['reciente', 'antigua'], description: 'Cuál del cliente tomar cuando NO se da folio: "reciente" (la última, por defecto) o "antigua" (la más vieja/primera). Usa "antigua" si el usuario pide la más antigua/vieja/primera.' },
      },
    },
  },
  {
    name: 'listarPlantillas',
    description:
      'Lista las plantillas de servicio guardadas (nombre, descripción, precio sugerido y líneas de alcance). Úsala cuando el usuario pida un servicio con nombre de plantilla (ej. "mantenimiento preventivo", "reparación de radiador").',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'agregarDesdePlantilla',
    description:
      'Inserta una plantilla como bloque en la cotización en edición, con todas sus líneas de alcance. Da el precio si el usuario lo dictó o si la plantilla tiene precioSugerido; si no hay precio, pregúntalo al usuario (no inventes). Si la plantilla tiene SUBTIPOS (varios precios con nombre), pasa "subtipo" con el que eligió el usuario; si no lo pasas, el servidor responde con la lista de subtipos para que preguntes cuál.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la plantilla (ej. "Mantenimiento preventivo")' },
        subtipo: { type: 'string', description: 'Nombre del subtipo elegido, si la plantilla tiene subtipos (ej. "Chico", "Grande")' },
        importe: { type: 'number', description: 'Precio del bloque, si el usuario lo dictó (normalmente NO hace falta: viene del subtipo o del precioSugerido)' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'quitarBloque',
    description: 'Elimina una partida (bloque) de la versión en edición y recalcula los totales.',
    input_schema: {
      type: 'object',
      properties: {
        bloque: { type: 'number', description: 'Índice del bloque (empezando en 0)' },
      },
      required: ['bloque'],
    },
  },
  {
    name: 'verBloques',
    description:
      'Devuelve las partidas (bloques) de la cotización en edición con sus renglones/puntos de alcance numerados. Úsala ANTES de editar o quitar un renglón para saber el índice del bloque y del renglón (ambos empiezan en 0).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'agregarLinea',
    description:
      'Agrega un renglón/punto de alcance al FINAL de un bloque de la cotización en edición. El precio no cambia (las líneas son alcance sin precio).',
    input_schema: {
      type: 'object',
      properties: {
        bloque: { type: 'number', description: 'Índice del bloque (empezando en 0)' },
        texto: { type: 'string', description: 'Texto del nuevo renglón/punto' },
      },
      required: ['bloque', 'texto'],
    },
  },
  {
    name: 'editarLinea',
    description:
      'Reemplaza el texto de un renglón/punto de alcance existente dentro de un bloque. Usa verBloques primero si no conoces el índice del renglón.',
    input_schema: {
      type: 'object',
      properties: {
        bloque: { type: 'number', description: 'Índice del bloque (empezando en 0)' },
        linea: { type: 'number', description: 'Índice del renglón dentro del bloque (empezando en 0)' },
        texto: { type: 'string', description: 'Nuevo texto del renglón' },
      },
      required: ['bloque', 'linea', 'texto'],
    },
  },
  {
    name: 'quitarLinea',
    description:
      'Elimina un renglón/punto de alcance de un bloque. Usa verBloques primero si no conoces el índice del renglón.',
    input_schema: {
      type: 'object',
      properties: {
        bloque: { type: 'number', description: 'Índice del bloque (empezando en 0)' },
        linea: { type: 'number', description: 'Índice del renglón dentro del bloque (empezando en 0)' },
      },
      required: ['bloque', 'linea'],
    },
  },
  {
    name: 'listarClientes',
    description:
      'Devuelve la lista COMPLETA de clientes registrados (nombres). Úsala cuando el usuario pida "mis clientes", "lista de clientes", "qué clientes tengo", etc.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'agregarCliente',
    description:
      'Da de alta un cliente NUEVO (solo el nombre) en la lista de clientes. Úsala en cuanto el usuario confirme que quiere agregarlo. NO requiere asunto ni cotización. Es idempotente (si ya existía, no duplica).',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del cliente a registrar' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'buscarCliente',
    description:
      'Busca si un cliente ya existe en la lista de clientes (por nombre, coincidencia parcial). Úsala ANTES de fijar el cliente de una cotización nueva. Si no aparece, pregúntale al usuario si quiere que lo agregues; solo créalo (con actualizarDatos) tras su confirmación.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre o parte del nombre del cliente a buscar' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'actualizarDatos',
    description:
      'Actualiza datos generales de la cotización en edición: cliente, título/asunto, "dirigida a" (persona de atención), forma de pago, tiempo de entrega o notas del documento. Al fijar un clienteNombre que no existía, se registra en la lista de clientes.',
    input_schema: {
      type: 'object',
      properties: {
        clienteNombre: { type: 'string', description: 'Nombre del cliente (se fija/registra)' },
        titulo: { type: 'string', description: 'Asunto de la cotización' },
        atencion: { type: 'string', description: 'Atención (At\'n): persona a cuya atención va la cotización' },
        formaPago: { type: 'string' },
        tiempoEntrega: { type: 'string' },
        notas: { type: 'string', description: 'Notas libres que aparecen en el documento (bajo el tiempo de entrega). Cadena vacía para borrarlas.' },
      },
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
  {
    name: 'misRecordatorios',
    description:
      'Lista los recordatorios PENDIENTES del usuario, numerados (1, 2, 3…). Úsala cuando pregunte "¿tengo recordatorios?", "¿qué tengo pendiente?", o antes de marcar uno como hecho. Preséntaselos numerados; no menciones ningún id.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'marcarRecordatorioHecho',
    description:
      'Marca un recordatorio como hecho por su NÚMERO (el que devolvió misRecordatorios). Si aún no los listaste en esta conversación, llama primero a misRecordatorios.',
    input_schema: {
      type: 'object',
      properties: { numero: { type: 'number', description: 'Número del recordatorio en la lista de misRecordatorios (empezando en 1)' } },
      required: ['numero'],
    },
  },
  {
    name: 'consultarSeguimiento',
    description:
      'Lista las cotizaciones ENVIADAS que siguen sin cerrar (esperando respuesta del cliente), con su antigüedad en días. Úsala para "¿qué está en seguimiento?", "¿qué cotizaciones tengo pendientes de que el cliente conteste?".',
    input_schema: { type: 'object', properties: {} },
  },
];

// Contrato que la fase 2 implementa con Firestore. Cada método regresa un
// resultado serializable que se le devuelve al LLM como tool_result.
export interface EjecutorHerramientas {
  ejecutar(nombre: string, entrada: unknown, contexto: ContextoEjecucion): Promise<string>;
}

export interface PreviewCotizacion {
  cotizacionId: string;
  folio: string | null;
  titulo: string;
  cliente: { nombre: string; atencion?: string | null; telefono?: string | null; correo?: string | null };
  rev: string;
  fecha: string; // ISO
  partidas: unknown[];
  formaPago?: string | null;
  tiempoEntrega?: string | null;
  notas?: string | null;
}

export interface ContextoEjecucion {
  correo: string; // identidad canónica del usuario (id de usuarios/{correo})
  rol: 'superAdmin' | 'dueno' | 'secretaria' | 'trabajador';
  // Cotización sobre la que trabaja el chat del taller (si aplica)
  cotizacionId?: string;
  versionId?: string;
  // Vista PREVIA (solo lectura, sin guardar) de una cotización existente: el
  // ejecutor la fija con previsualizarCotizacion y el callable la devuelve al
  // front para renderizarla; solo se clona cuando el usuario confirma.
  preview?: PreviewCotizacion;
  // Id de la cotización que el usuario está viendo en vista previa (lo pasa el
  // front en el turno de confirmación). clonarComoBase clona EXACTAMENTE esa.
  previewCotizacionId?: string;
}

// Stub de fase 1: responde que la herramienta aún no está conectada.
export const ejecutorPendiente: EjecutorHerramientas = {
  async ejecutar(nombre: string): Promise<string> {
    return JSON.stringify({
      error: `La herramienta ${nombre} aún no está conectada (fase 2).`,
    });
  },
};
