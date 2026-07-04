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
  for (let vuelta = 0; vuelta < 12; vuelta++) {
    const res = await ai.models.generateContent({
      model: MODELO,
      contents,
      config: {
        systemInstruction: SYSTEM,
        tools: [{ functionDeclarations: DECLARACIONES }],
      },
    });

    const llamadas = res.functionCalls ?? [];
    if (llamadas.length === 0) {
      return { texto: (res.text ?? '').trim() || 'Listo.' };
    }

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
