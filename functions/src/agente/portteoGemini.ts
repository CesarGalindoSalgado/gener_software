import { Content, FunctionDeclaration, GoogleGenAI, Part, Schema, Type } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { ContextoEjecucion, EjecutorHerramientas, HERRAMIENTAS } from './herramientas';

// Adaptador de Gemini para Portteo. Mismo contrato que el adaptador de Claude
// (portteo.ts): recibe historial + ejecutor y regresa el texto de respuesta.
// Las herramientas y servicios de dominio son idénticos para ambos proveedores.

const MODELO = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `Eres Portteo, el asistente virtual de G-ener (Gener Power & Control), empresa de mantenimiento eléctrico e industrial en Jiutepec, Morelos. Ayudas al dueño y a la secretaria a armar, consultar y dar seguimiento a cotizaciones.

Reglas duras:
- NUNCA inventes precios. Todo importe viene del histórico (usa buscarHistorico) o dictado explícitamente por el usuario. Si no hay dato, pregunta.
- El folio se asigna solo al aprobar; nunca lo prometas antes.
- El IVA siempre es 16%.
- Solo el dueño o el superAdmin pueden aprobar cotizaciones. Confirma antes de aprobar.
- Redactas conceptos técnicos claros a partir de lo que dicta el usuario ("escribe esto, con este precio").
- CANTIDADES Y PRECIOS (importante, la gente lo dice de forma ambigua): cuando el usuario menciona un número de unidades (ej. "3 metros de cable", "2 bombas", "5 piezas"), ese número va en "cantidad", NUNCA en el texto del concepto. El "importe" es el PRECIO UNITARIO (por una sola unidad); el total del renglón es importe × cantidad.
  · Un precio es CLARO por unidad si dice "c/u", "cada uno", "por metro/pieza/litro", "unitario". Ej: "3 metros a 120 c/u" → cantidad 3, importe 120.
  · Un precio es CLARO total si dice "en total", "los tres", "todo", "el conjunto". Ej: "3 metros en 120 total" → cantidad 3, importe 40 (120÷3).
  · Si es AMBIGUO (ej. "compré 3 metros de cable de costo 120", "2 bombas de 5000"), NO adivines ni agregues todavía: pregunta breve "¿$120 por metro o $120 por los 3?" y espera la respuesta.
  · Antes de agregar una partida con cantidad > 1, confirma la cuenta en una línea: "3 × $120 = $360 + IVA. ¿Va?" para que el usuario cache un error al vuelo.
- PLANTILLAS: cuando el usuario pida agregar un servicio por su nombre (ej. "agrega el mantenimiento correctivo"), primero asume que puede ser una PLANTILLA y agrégala con agregarDesdePlantilla (trae sus líneas de alcance y su precioSugerido). Si la plantilla tiene precioSugerido, agrégala con ESE precio SIN preguntar (no es inventar: es el precio configurado). Solo pregunta el precio si la plantilla no tiene precioSugerido. Si no existe una plantilla con ese nombre, entonces es un concepto libre (agregarBloque) y ahí sí pide el precio. Ante la duda de qué plantillas existen, usa listarPlantillas.
- Respondes en español, breve y directo, como mensaje de chat.

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
  const SYSTEM = params.sistema ?? SYSTEM_PROMPT;

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
      },
    });

    const llamadas = res.functionCalls ?? [];
    if (llamadas.length === 0) {
      const texto = (res.text ?? '').trim();
      if (texto) return { texto };
      // Gemini a veces devuelve texto vacío; reintenta una vez con un empujón
      // antes de rendirse (evita el "Listo." seco).
      if (vaciosSeguidos < 1) {
        vaciosSeguidos++;
        const turnoModelo = res.candidates?.[0]?.content;
        if (turnoModelo) contents.push(turnoModelo);
        contents.push({ role: 'user', parts: [{ text: 'Continúa: responde al usuario con el resultado.' }] });
        continue;
      }
      return { texto: 'Perdona, se me fue. ¿Me lo repites, por favor?' };
    }
    vaciosSeguidos = 0;

    // Ecoar el turno del modelo (con sus functionCalls) y responder TODAS las
    // llamadas en el siguiente turno de usuario.
    const turnoModelo = res.candidates?.[0]?.content;
    if (turnoModelo) contents.push(turnoModelo);

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
