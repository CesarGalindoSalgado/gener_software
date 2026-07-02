import Anthropic from '@anthropic-ai/sdk';
import { ContextoEjecucion, EjecutorHerramientas, HERRAMIENTAS } from './herramientas';

// Portteo: el agente conversacional. Loop manual de herramientas para poder
// interceptar/validar cada llamada (gate de rol en aprobar, logging).

const MODELO = 'claude-opus-4-8';

const SYSTEM_PROMPT = `Eres Portteo, el asistente virtual de G-ener (Gener Power & Control), empresa de mantenimiento eléctrico e industrial en Jiutepec, Morelos. Ayudas al dueño (Gabriel) y a la secretaria a armar, consultar y dar seguimiento a cotizaciones.

Reglas duras:
- NUNCA inventes precios. Todo importe viene del histórico (usa buscarHistorico) o dictado explícitamente por el usuario. Si no hay dato, pregunta.
- El folio se asigna solo al aprobar; nunca lo prometas antes.
- El IVA siempre es 16%.
- Solo el dueño puede aprobar cotizaciones. Si otra persona lo pide, explícalo con amabilidad.
- Redactas conceptos técnicos claros a partir de lo que dicta el usuario ("escribe esto, con este precio").
- Respondes en español, breve y directo, como mensaje de WhatsApp.`;

export interface RespuestaPortteo {
  texto: string;
}

export async function conversarConPortteo(params: {
  cliente: Anthropic;
  ejecutor: EjecutorHerramientas;
  contexto: ContextoEjecucion;
  historial: Anthropic.MessageParam[];
}): Promise<RespuestaPortteo> {
  const { cliente, ejecutor, contexto } = params;
  const mensajes: Anthropic.MessageParam[] = [...params.historial];

  // Loop agéntico: se repite mientras el modelo pida herramientas.
  for (;;) {
    const respuesta = await cliente.messages.create({
      model: MODELO,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: HERRAMIENTAS,
      messages: mensajes,
    });

    if (respuesta.stop_reason === 'refusal') {
      return { texto: 'No puedo ayudarte con eso. ¿Hay algo más de cotizaciones en que te apoye?' };
    }

    if (respuesta.stop_reason !== 'tool_use') {
      const texto = respuesta.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { texto };
    }

    // Ejecutar todas las herramientas pedidas y regresar TODOS los resultados
    // en un solo mensaje de usuario (requisito del API para llamadas paralelas).
    mensajes.push({ role: 'assistant', content: respuesta.content });
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const bloque of respuesta.content) {
      if (bloque.type !== 'tool_use') continue;
      let contenido: string;
      let esError = false;
      try {
        contenido = await ejecutor.ejecutar(bloque.name, bloque.input, contexto);
      } catch (e) {
        contenido = e instanceof Error ? e.message : 'Error al ejecutar la herramienta';
        esError = true;
      }
      resultados.push({
        type: 'tool_result',
        tool_use_id: bloque.id,
        content: contenido,
        is_error: esError || undefined,
      });
    }
    mensajes.push({ role: 'user', content: resultados });
  }
}
