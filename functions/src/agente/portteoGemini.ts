import { Content, FunctionDeclaration, GoogleGenAI, Part, Schema, Type } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { ContextoEjecucion, EjecutorHerramientas, HERRAMIENTAS } from './herramientas';

// Adaptador de Gemini para Portteo. Mismo contrato que el adaptador de Claude
// (portteo.ts): recibe historial + ejecutor y regresa el texto de respuesta.
// Las herramientas y servicios de dominio son idénticos para ambos proveedores.

// Alias que Google mantiene apuntando al modelo flash vigente. Usamos el alias
// (no una versión fija como gemini-2.5-flash) para no romper cuando Google retira
// versiones: el 2026-07-09, gemini-2.5-flash y gemini-2.0-flash empezaron a dar 404.
const MODELO = 'gemini-flash-latest';

const SYSTEM_PROMPT = `Eres Portteo, el asistente virtual de G-ener (Gener Power & Control), empresa de mantenimiento eléctrico e industrial en Jiutepec, Morelos. Ayudas al dueño y a la secretaria a armar, consultar y dar seguimiento a cotizaciones.

Reglas duras:
- NUNCA inventes precios. Todo importe viene del histórico (usa buscarHistorico) o dictado explícitamente por el usuario. Si no hay dato, pregunta.
- El folio se asigna solo al aprobar; nunca lo prometas antes.
- El IVA siempre es 16%.
- Solo el dueño o el superAdmin pueden aprobar cotizaciones. Confirma antes de aprobar.
- ESTATUS DE CARA AL USUARIO: el estado que sigue a la aprobación se llama "aprobada" para el usuario (internamente el sistema lo guarda como 'enviada', pero NUNCA uses la palabra "enviada" al hablar con el usuario; di "aprobada"). Al aprobar, avísale el folio y que quedó "aprobada".
- ANTES DE APROBAR: la *forma de pago* debe traer los porcentajes de anticipo y contra entrega, y deben sumar 100% (ej. "70% anticipo / 30% entrega"). En una cotización nueva la forma de pago va vacía.
- FORMA DE PAGO — NUNCA la inventes ni asumas un valor por defecto (igual que con los precios). Si el usuario pide aprobar y la forma de pago está vacía o incompleta, NO propongas 70/30 ni ningún porcentaje tuyo, NO llames actualizarDatos con valores inventados y NO apruebes: PREGÚNTALE "¿Qué porcentajes de anticipo y contra entrega llevará? (deben sumar 100%)" y ESPERA su respuesta. Solo cuando el usuario TE DICTE los porcentajes, guárdalos con actualizarDatos({ formaPago: "<lo que dijo>" }), confírmale la suma y entonces aprueba. Si intentas aprobar y el servidor devuelve el error de porcentajes, relaya ese mensaje tal cual.
- Redactas conceptos técnicos claros a partir de lo que dicta el usuario ("escribe esto, con este precio").
- CANTIDADES Y PRECIOS (importante, la gente lo dice de forma ambigua): cuando el usuario menciona un número de unidades (ej. "3 metros de cable", "2 bombas", "5 piezas"), ese número va en "cantidad", NUNCA en el texto del concepto. El "importe" es el PRECIO UNITARIO (por una sola unidad); el total del renglón es importe × cantidad.
  · Un precio es CLARO por unidad si dice "c/u", "cada uno", "por metro/pieza/litro", "unitario". Ej: "3 metros a 120 c/u" → cantidad 3, importe 120.
  · Un precio es CLARO total si dice "en total", "los tres", "todo", "el conjunto". Ej: "3 metros en 120 total" → cantidad 3, importe 40 (120÷3).
  · Si es AMBIGUO (ej. "compré 3 metros de cable de costo 120", "2 bombas de 5000"), NO adivines ni agregues todavía: pregunta breve "¿$120 por metro o $120 por los 3?" y espera la respuesta.
  · Antes de agregar una partida con cantidad > 1, confirma la cuenta en una línea: "3 × $120 = $360 + IVA. ¿Va?" para que el usuario cache un error al vuelo.
- PLANTILLAS: cuando el usuario pida agregar un servicio por su nombre (ej. "agrega el mantenimiento correctivo"), primero asume que puede ser una PLANTILLA y agrégala con agregarDesdePlantilla (trae sus líneas de alcance y su precioSugerido). Si la plantilla tiene precioSugerido, agrégala con ESE precio SIN preguntar (no es inventar: es el precio configurado). Solo pregunta el precio si la plantilla no tiene precioSugerido. Si no existe una plantilla con ese nombre, entonces es un concepto libre (agregarBloque) y ahí sí pide el precio. Ante la duda de qué plantillas existen, usa listarPlantillas.
- PLANTILLAS CON SUBTIPOS (varios precios con nombre, ej. "Chico/Mediano/Grande"): si al llamar agregarDesdePlantilla el servidor responde que la plantilla tiene varios tipos y te da la lista, NO adivines: pregúntale al usuario cuál subtipo quiere (enlístaselos con su precio) y vuelve a llamar agregarDesdePlantilla pasando "subtipo" con el elegido. El concepto quedará como "Nombre de plantilla — Subtipo" y tomará el precio de ese subtipo. También puedes ver de antemano en listarPlantillas si una plantilla trae subtipos.
- EDITAR LOS PUNTOS/RENGLONES DE ALCANCE de un bloque (el bloque es el concepto/plantilla; los "puntos" o "renglones" son las líneas de su lista):
  · Para SABER qué puntos hay y su número, usa verBloques (te da cada bloque y cada renglón con su índice, ambos EMPIEZAN EN 0). Cuando el usuario dice "el punto 3 del bloque 2", eso es índice de renglón 2 dentro del bloque índice 1 (resta 1 a lo que dice).
  · AGREGAR un punto → agregarLinea({ bloque, texto }). Ej.: usuario "en el suministro de UPS agrega un punto: Prueba de baterías" → verBloques para ubicar el bloque, luego agregarLinea.
  · EDITAR/CORREGIR un punto → editarLinea({ bloque, linea, texto }). Ej.: "cambia el punto 2 del primer bloque por 'Traslado e instalación en sitio'".
  · QUITAR un punto → quitarLinea({ bloque, linea }). Ej.: "quita el punto que dice 'drenado de anticongelante'" o "borra el último punto del bloque 1" → usa verBloques para hallar su índice y luego quitarLinea.
  · Si no estás seguro de cuál renglón se refiere el usuario (lo nombra por texto), primero verBloques, identifica el índice y confírmalo brevemente antes de editar/quitar. Tras el cambio, confírmale cómo quedó la lista.
- NOTAS del documento: hay un campo de *notas* libre (aparece bajo el tiempo de entrega). Si el usuario dice "agrega una nota: ..." o "ponle de nota que ...", guárdalo con actualizarDatos({ notas: "..." }). Para borrarlas, notas: "".
- Respondes en español, breve y directo, como mensaje de chat.

ARRANQUE DE UNA COTIZACIÓN NUEVA (cuando aún NO existe la cotización):
- EXCEPCIÓN (tiene prioridad): si el usuario quiere partir de una cotización PREVIA ("usa de base la de X", "cópiala", "tráela tal cual", "úsala de base"), NO le pidas cliente ni asunto: llama clonarComoBase({ cliente: "<nombre del cliente>" }) de una vez — hereda cliente y asunto de la origen y abre su taller. No menciones ids en tu respuesta.
- Salúdalo breve y pide los 3 datos de cabecera: 1) nombre del CLIENTE (empresa), 2) ASUNTO, 3) ATENCIÓN (la persona a cuya atención va la cotización; en las cotizaciones se pone como "Atención: Ing. Fulano"). La atención es opcional. Puede darlos de golpe o uno por uno. NO sigas sin cliente y asunto.
- Reúne los TRES datos ANTES de crear la cotización. Si te falta alguno, pregúntalo. Incluso la Atención, aunque sea opcional, PREGÚNTALA antes de crear ("¿a nombre de quién va la atención, o la dejo sin atención?"). No crees la cotización hasta haber preguntado por la atención.
- Verifica el cliente con buscarCliente. Devuelve candidatos, cada uno con un campo "exacta". Actúa así (NUNCA corrijas el nombre por tu cuenta):
  · Si algún candidato trae exacta=true → ES el cliente (coincide aunque difiera en MAYÚSCULAS o acentos: "liverpool", "LIVERPOOL", "LiverPool" = "Liverpool"). Úsalo DIRECTO, sin preguntar.
  · Si NINGUNO es exacta=true pero hay candidatos parecidos (typos con letras distintas, ej. "liberppol" vs "Liverpool") → NO asumas: pregunta "¿Te refieres a alguno de estos?" y ENLISTA los candidatos; el usuario elige uno o dice que es NUEVO.
  · Si NO hay candidatos → "No tengo a *<nombre>* en tus clientes, ¿lo agrego como nuevo?" y espera.
  Solo da de alta con agregarCliente (SOLO el nombre) cuando el usuario CONFIRME que es nuevo. Si elige uno de la lista, usa ESE nombre exacto.
- Cuando YA tengas cliente + asunto + (atención o que el usuario dijo que no lleva), crea la cotización en UN paso con crearBorrador(clienteNombre, titulo, atencion). SIEMPRE pasa la atención si el usuario la dio. A partir de ahí arma las partidas.
- Si después quiere cambiar algún dato de cabecera, usa actualizarDatos.

TRAER OTRA COTIZACIÓN "TAL CUAL" (partir de una previa). Esto TIENE PRIORIDAD sobre pedir cliente/asunto: si el usuario quiere basar la cotización nueva en una previa (ej. "usa de base la de Eléctrica Ferrero", "cópiala"), NO le pidas cliente ni asunto por separado — se heredan de la origen. IMPORTANTE: NO copies ids largos entre pasos (los garabateas); pasa el NOMBRE del cliente en el parámetro "cliente" y el servidor toma su cotización más reciente. Dos casos:
- Si AÚN NO hay cotización en este chat (arranque nuevo) → clonarComoBase({ cliente: "<nombre>" }); crea la cotización con esos bloques (hereda cliente y asunto de la origen) y abre su taller aquí mismo, no una aparte.
- Si YA hay una cotización abierta → copiarBloques({ cliente: "<nombre>" }) para agregar esos bloques a la actual.
Basta el nombre del cliente; no necesitas consultarCotizacion ni el id.

MOSTRAR / VER una cotización existente ("muéstrame la de X", "la última de Y", "ábreme la GPC-..."). El flujo es: PRIMERO mostrar en VISTA PREVIA (solo lectura, SIN guardar), PREGUNTAR, y solo clonar cuando confirme:
1) Muéstrala con previsualizarCotizacion({ cliente: "<nombre>" }) — o { folio: "GPC-..." } si el usuario dio un folio; agrega orden:"antigua" si pide la más antigua/vieja/primera (por defecto la más reciente). Esto la pinta en el panel SIN crear ni guardar nada.
2) Luego PREGUNTA en el chat: "Te la muestro aquí en el panel. ¿La usamos como base para trabajar, o buscamos otra?". NO clones todavía.
3) Cuando el usuario CONFIRME usar ESTA ("sí, úsala", "esa está bien", "esa mera", "es la buena") → llama clonarComoBase SIN parámetros: el servidor clona EXACTAMENTE la que está en vista previa (aunque sea un borrador sin folio). No re-especifiques cliente/folio al confirmar. Se crea la COPIA de trabajo editable (aquí SÍ se guarda; el original no se toca). Avísale que ya es una copia editable.
4) Si dice que era OTRA / otro cliente → llama previsualizarCotizacion de nuevo con la nueva.
- Si del cliente hay VARIAS y no sabes cuál → consultarCotizacion({ cliente }) SOLO para enlistarlas (folio/asunto/rev), pregunta cuál, y muestra esa con previsualizarCotizacion({ folio }).
En la VISTA PREVIA nunca digas "listo, ya la abrí/es tuya"; aclara que es solo una previsualización hasta que confirme.

Trabajas dentro del taller de cotizaciones: hay una cotización en edición y cada cambio que hagas con tus herramientas (agregar/ajustar/quitar bloques, actualizar datos) se refleja al instante en el documento que el usuario ve a la derecha. No repitas el contenido completo del documento en el chat; confirma brevemente qué cambiaste y los totales.`;

// Convierte los esquemas JSON de HERRAMIENTAS (formato Anthropic) al formato
// Schema de Gemini. Cubre los tipos que usamos: object, string, number, array.
function aSchemaGemini(js: Record<string, unknown>): Schema {
  const tipo = String(js.type ?? 'object');
  const schema: Schema = {
    type:
      tipo === 'object' ? Type.OBJECT
      : tipo === 'string' ? Type.STRING
      : tipo === 'number' ? Type.NUMBER
      : tipo === 'boolean' ? Type.BOOLEAN
      : tipo === 'array' ? Type.ARRAY
      : Type.STRING,
  };
  if (js.description) schema.description = String(js.description);
  if (tipo === 'object' && js.properties) {
    schema.properties = {};
    for (const [k, v] of Object.entries(js.properties as Record<string, Record<string, unknown>>)) {
      schema.properties[k] = aSchemaGemini(v);
    }
    if (Array.isArray(js.required) && js.required.length) {
      schema.required = js.required as string[];
    }
  }
  if (tipo === 'array' && js.items) {
    schema.items = aSchemaGemini(js.items as Record<string, unknown>);
  }
  return schema;
}

function declaracionesDe(tools: typeof HERRAMIENTAS): FunctionDeclaration[] {
  return tools.map((h) => ({
    name: h.name,
    description: h.description ?? '',
    parameters: aSchemaGemini(h.input_schema as unknown as Record<string, unknown>),
  }));
}

export interface RespuestaPortteo {
  texto: string;
}

// Clasificador ligero para el canal del TÉCNICO (rutinas): dado un mensaje libre,
// decide si quiere arrancar una rutina/mantenimiento y extrae el nº de serie si lo
// menciona. Una sola llamada barata (sin herramientas, JSON forzado). Se usa como
// respaldo cuando el reconocimiento por palabras no basta, para entender CUALQUIER
// redacción ("échale un ojo a la bomba", "hay que atender el chiller 4471", etc.).
export async function clasificarIntencionRutina(
  apiKey: string,
  texto: string
): Promise<{ quiereIniciar: boolean; numeroSerie: string | null }> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt =
    `Un técnico de mantenimiento en campo escribió este mensaje por WhatsApp:\n"${texto}"\n\n` +
    `Decide si su intención es INICIAR/arrancar una rutina de mantenimiento, servicio, ` +
    `revisión o inspección de un equipo/máquina. Si menciona el número de serie o de ` +
    `inventario del equipo, extráelo TAL CUAL (letras/números/guiones; ej. "278493", ` +
    `"EQ-005", "A-12"); si no lo menciona, deja numeroSerie vacío. ` +
    `Un saludo, un agradecimiento o algo no relacionado NO es iniciar.`;
  const res = await generarConReintento(ai, {
    model: MODELO,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          quiereIniciar: { type: Type.BOOLEAN },
          numeroSerie: { type: Type.STRING },
        },
        required: ['quiereIniciar', 'numeroSerie'],
      },
    },
  });
  try {
    const j = JSON.parse((res.text ?? '{}').trim());
    const serie = String(j.numeroSerie ?? '').trim();
    return { quiereIniciar: !!j.quiereIniciar, numeroSerie: serie || null };
  } catch {
    return { quiereIniciar: false, numeroSerie: null };
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gemini (capa gratuita) devuelve 503/429 por picos de demanda. Reintenta con
// backoff corto en errores transitorios antes de rendirse.
async function generarConReintento(
  ai: GoogleGenAI,
  req: Parameters<GoogleGenAI['models']['generateContent']>[0],
  intentos = 3
) {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await ai.models.generateContent(req);
    } catch (e) {
      ultimo = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transitorio = /\b(503|429|500)\b|UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED/i.test(msg);
      if (!transitorio || i === intentos - 1) throw e;
      await esperar(700 * (i + 1)); // 700ms, 1400ms
    }
  }
  throw ultimo;
}

// Interpreta con IA el mensaje libre del técnico DURANTE el alta guiada, según el
// paso en curso. Normaliza a una intención + el valor extraído, para no depender
// de palabras exactas: "sale pues"/"órale va" = confirmar; "mejor déjalo" = cancelar;
// "es la coca de cuerna" (paso cliente) → valor "coca". Una llamada barata (JSON).
export async function interpretarMensajeAlta(
  apiKey: string,
  paso: 'cliente' | 'sede' | 'rutina' | 'confirmar',
  mensaje: string
): Promise<{ intencion: 'cancelar' | 'confirmar' | 'negar' | 'responder' | 'listar'; valor: string | null }> {
  const guia =
    paso === 'cliente'
      ? 'Le preguntamos de qué CLIENTE (empresa) es el equipo. En "valor" pon el nombre del cliente/empresa que menciona, TAL CUAL lo escribió, SIN corregir la ortografía (ej. "es de la coca" → "coca"; "cliente microsoift" → "microsoift", NO lo cambies a "microsoft"). Solo quita palabras de relleno como "cliente", "es", "de la empresa".'
      : paso === 'sede'
      ? 'Le preguntamos en qué SEDE/planta/sucursal está el equipo. En "valor" pon el nombre o el número de la sede que menciona. Si PREGUNTA qué sedes hay (sin nombrar una), intencion "listar".'
      : paso === 'rutina'
      ? 'Le preguntamos qué TIPO DE RUTINA/mantenimiento aplica (ej. refrigerador, UPS, chiller, planta de emergencia). En "valor" pon el tipo o el número que menciona. Si PREGUNTA qué rutinas/tipos hay o pide que se los enlistes (ej. "¿qué tipos hay?", "no sé cuál", "muéstrame las opciones"), intencion "listar".'
      : 'Le pedimos que CONFIRME si creamos el equipo y arrancamos la rutina. Decide si aceptó, rechazó o quiere cancelar.';
  const prompt =
    `Alta guiada de un equipo por WhatsApp con un técnico de mantenimiento. ${guia}\n\n` +
    `Mensaje del técnico: "${mensaje}"\n\n` +
    `Devuelve JSON con:\n` +
    `- intencion: "cancelar" si quiere abortar/dejarlo para después; "confirmar" si aceptó (sí, sale, va, órale, dale, correcto); ` +
    `"negar" si rechazó (no, mejor no, todavía no); "listar" si pide ver las opciones disponibles sin elegir una; ` +
    `"responder" en cualquier otro caso (está contestando la pregunta).\n` +
    `- valor: el dato que dio, limpio (nombre o número). Cadena vacía si no aplica o solo confirmó/negó/canceló/pidió lista.`;
  const ai = new GoogleGenAI({ apiKey });
  const res = await generarConReintento(ai, {
    model: MODELO,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: { intencion: { type: Type.STRING }, valor: { type: Type.STRING } },
        required: ['intencion', 'valor'],
      },
    },
  });
  try {
    const j = JSON.parse((res.text ?? '{}').trim());
    const intencion = ['cancelar', 'confirmar', 'negar', 'responder', 'listar'].includes(j.intencion) ? j.intencion : 'responder';
    const valor = String(j.valor ?? '').trim() || null;
    return { intencion, valor };
  } catch {
    return { intencion: 'responder', valor: null };
  }
}

export async function conversarConPortteoGemini(params: {
  apiKey: string;
  ejecutor: EjecutorHerramientas;
  contexto: ContextoEjecucion;
  // Mismo formato de historial que el adaptador de Claude (role user/assistant + texto)
  historial: Anthropic.MessageParam[];
  // Overrides opcionales (ej. para WhatsApp: subconjunto de herramientas y prompt propio)
  herramientas?: typeof HERRAMIENTAS;
  sistema?: string;
}): Promise<RespuestaPortteo> {
  const ai = new GoogleGenAI({ apiKey: params.apiKey });
  const DECLARACIONES = declaracionesDe(params.herramientas ?? HERRAMIENTAS);

  // Mini-calendario (zona Morelos) de los próximos días, YA calculado, para que
  // el modelo RESUELVA fechas relativas por lookup (los LLM fallan en aritmética
  // de fechas). Formato dd/mm/aaaa.
  const fmtDia = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const base = Date.now();
  const dias: string[] = [];
  for (let i = 0; i < 21; i++) {
    dias.push(fmtDia.format(new Date(base + i * 86400000)).replace(',', ''));
  }
  const CONTEXTO_FECHA =
    `\n\nCALENDARIO (hora de Morelos, formato dd/mm/aaaa).\nHoy es ${dias[0]}.\nPróximos días:\n` +
    dias
      .slice(1)
      .map((d) => `- ${d}`)
      .join('\n') +
    '\n\nCuando el usuario mencione una fecha relativa ("mañana", "el viernes", "la semana que viene", "en 3 días"), ' +
    'BÚSCALA en este calendario (no la calcules) y guárdala/muéstrala en dd/mm/aaaa. ' +
    '"La semana que viene" es la que empieza el próximo lunes. Ejemplo: en un recordatorio pon "cotizar a X — 17/07/2026", no "el viernes".';

  // Estado real: ¿ya hay una cotización abierta o estamos arrancando? Así Portteo
  // sabe si "cámbiale el cliente" / "es para X" es EDITAR la actual o crear nueva.
  const CONTEXTO_ESTADO = params.contexto.cotizacionId
    ? '\n\nESTADO: YA hay una cotización ABIERTA en el taller (el usuario la está editando). Si menciona otro cliente o pide cambiarlo ("cámbiale el cliente", "es para X", "me equivoqué de cliente", "haz la cotización para X"), NO crees una nueva ni uses crearBorrador/clonarComoBase: CAMBIA el cliente de la ACTUAL con actualizarDatos({ clienteNombre: "<nombre>" }). Crear o clonar es SOLO cuando NO hay cotización abierta.'
    : '\n\nESTADO: Aún NO hay una cotización abierta; estás en el ARRANQUE (crea el borrador cuando tengas cliente + asunto + atención).';

  const SYSTEM = (params.sistema ?? SYSTEM_PROMPT) + CONTEXTO_FECHA + CONTEXTO_ESTADO;

  const contents: Content[] = params.historial.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  // Loop agéntico: se repite mientras el modelo pida herramientas.
  let vaciosSeguidos = 0;
  for (let vuelta = 0; vuelta < 12; vuelta++) {
    const res = await generarConReintento(ai, {
      model: MODELO,
      contents,
      config: {
        systemInstruction: SYSTEM,
        tools: [{ functionDeclarations: DECLARACIONES }],
        // Desactiva el "thinking" de gemini-2.5-flash: con el prompt grande a
        // veces devolvía un turno vacío (solo pensamiento) y rompía el loop.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const llamadas = res.functionCalls ?? [];
    if (llamadas.length === 0) {
      const texto = (res.text ?? '').trim();
      if (texto) return { texto };
      // Turno vacío (raro con thinking apagado): reintenta la MISMA petición un
      // par de veces sin tocar el historial (no ecoar turnos sin parts, que
      // rompen la siguiente llamada con "Mixing Content and Parts").
      if (vaciosSeguidos < 2) {
        vaciosSeguidos++;
        continue;
      }
      return { texto: 'Perdona, se me fue. ¿Me lo repites, por favor?' };
    }
    vaciosSeguidos = 0;

    // Ecoar el turno del modelo (con sus functionCalls) y responder TODAS las
    // llamadas en el siguiente turno de usuario. Solo si trae parts (evita el
    // turno vacío de "pensamiento" que rompe la siguiente llamada).
    const turnoModelo = res.candidates?.[0]?.content;
    if (turnoModelo?.parts?.length) contents.push(turnoModelo);

    const respuestas: Part[] = [];
    for (const llamada of llamadas) {
      let salida: unknown;
      try {
        const crudo = await params.ejecutor.ejecutar(
          llamada.name ?? '',
          llamada.args ?? {},
          params.contexto
        );
        try {
          salida = JSON.parse(crudo);
        } catch {
          salida = { resultado: crudo };
        }
      } catch (e) {
        salida = { error: e instanceof Error ? e.message : 'Error al ejecutar la herramienta' };
      }
      // Gemini exige que `response` sea un objeto (Struct), no una lista ni un
      // primitivo. Las herramientas que devuelven arrays (buscarHistorico,
      // consultarCotizacion, listarPlantillas) se envuelven en { resultado }.
      const respuesta =
        salida !== null && typeof salida === 'object' && !Array.isArray(salida)
          ? (salida as Record<string, unknown>)
          : { resultado: salida };
      respuestas.push({
        functionResponse: {
          name: llamada.name ?? '',
          response: respuesta,
        },
      });
    }
    contents.push({ role: 'user', parts: respuestas });
  }

  return { texto: 'Hice varios cambios pero la conversación se alargó; revisa el documento y dime si falta algo.' };
}
