import {
  EvidenciaPaso,
  PasoEjecucion,
  RutinaEjecucion,
  RutinaPlantilla,
} from './tipos';

// Cerebro del flujo guiado de Rutinas (Fase 2). Lógica PURA y determinista:
// dado el estado de una ejecución + una entrada del técnico, calcula el nuevo
// estado y el texto de respuesta. Sin Firestore ni WhatsApp (eso lo hace el
// servicio). Así se puede testear a fondo.
//
// El técnico avanza paso por paso. Cada paso pide una evidencia según su tipo:
//   - foto_comentario: una foto (+ comentario opcional)
//   - antes_despues:   foto ANTES y foto DESPUÉS
//   - medicion:        una lectura numérica (+ foto opcional); si hay rango,
//                      se marca cumple/no cumple

export type EntradaEjecucion =
  | { clase: 'texto'; texto: string }
  | { clase: 'foto'; url: string };

export interface ResultadoAvance {
  ejec: RutinaEjecucion;
  respuesta: string;
  terminada: boolean; // true cuando pasó a 'completada' o 'cancelada'
}

const RE_SIGUIENTE = /\b(siguiente|listo|ok|okay|ya|continuar|next|sig)\b/i;
const RE_CANCELAR = /\b(cancelar|cancela|abortar|salir)\b/i;
// "Sin comentario" en la puerta de comentario: solo si el MENSAJE COMPLETO es una
// negativa/salto (para no perder comentarios que empiezan con "no", ej. "no hay novedad").
const RE_COMENTARIO_NO = /^\s*(sin\s*coment\w*|no|n[oó]|ning[uú]n\w*|nada|n\/?a|listo|ok+|okay|siguiente|sig|pasa|contin[uú]\w*|next|omitir|paso)\s*[.!]*$/i;
const PIDE_COMENTARIO = '📝 ¿Algún *comentario* de este paso? Escríbelo, o pon *sin comentario* para continuar.';
const RE_ESTADO = /\b(estado|d[oó]nde voy|en qu[eé] paso|paso actual|retomar)\b/i;
const RE_SIN_FIRMA = /\b(sin firma|no hay firma|no firm|faltante|no me firm|no pudo firm)\b/i;

// Al terminar los pasos, pedimos el nombre de quien recibe (antes del reporte).
const TEXTO_TERMINADO = '🎉 ¡Terminaste todos los pasos!\n\nPor último, ¿*quién recibe* el servicio? Escríbeme el *nombre* de la persona.';
// Recordatorio si el técnico manda algo más estando en la etapa de revisión.
const TEXTO_REVISAR = 'Ya terminaste esta rutina. Revisa tu reporte con el enlace que te compartí y, si todo está bien, apruébalo con el botón para recibir el PDF. _(o escribe *cancelar*)_';

// --- Construcción inicial ---

export function iniciarEjecucion(
  plantilla: RutinaPlantilla,
  datos: {
    rutinaId: string;
    sedeId: string;
    equipoId: string;
    tecnicoTelefono: string;
    tecnicoNombre: string;
  },
  ahora: Date
): RutinaEjecucion {
  const pasos: PasoEjecucion[] = plantilla.pasos
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((p) => ({
      orden: p.orden,
      instruccion: p.instruccion,
      tipo: p.evidencia.tipo,
    }));
  return {
    folio: null,
    rutinaId: datos.rutinaId,
    sedeId: datos.sedeId,
    equipoId: datos.equipoId,
    tecnicoTelefono: datos.tecnicoTelefono,
    tecnicoNombre: datos.tecnicoNombre,
    estatus: 'en_proceso',
    etapa: 'pasos',
    inicio: ahora,
    pasoActual: pasos.length ? pasos[0].orden : undefined,
    pasos,
    comentarios: [],
  };
}

// --- Helpers de presentación ---

function evidenciaDePlantilla(plantilla: RutinaPlantilla, orden: number): EvidenciaPaso | undefined {
  return plantilla.pasos.find((p) => p.orden === orden)?.evidencia;
}

function pideEvidencia(ev: EvidenciaPaso | undefined): string {
  if (!ev) return '';
  switch (ev.tipo) {
    case 'antes_despues':
      return '📸 Envía la foto de *ANTES* y luego la de *DESPUÉS*.';
    case 'medicion': {
      const u = ev.unidadSugerida ? ` (en ${ev.unidadSugerida})` : '';
      const rango = ev.rangoDefinido ? ` El rango esperado es ${ev.rangoMin}–${ev.rangoMax}.` : '';
      const foto = ev.requiereFoto ? ' Puedes adjuntar una foto también.' : '';
      return `🔢 Envía la lectura${u}.${rango}${foto}`;
    }
    case 'foto_comentario':
    default:
      return '📷 Envía una foto y/o un comentario (opcionales), o escribe *siguiente* para continuar.';
  }
}

export function textoPaso(ejec: RutinaEjecucion, plantilla: RutinaPlantilla, orden: number): string {
  const total = ejec.pasos.length;
  const paso = ejec.pasos.find((p) => p.orden === orden);
  if (!paso) return '';
  const ev = evidenciaDePlantilla(plantilla, orden);
  const idx = ejec.pasos.findIndex((p) => p.orden === orden) + 1;
  return [
    `*Paso ${idx} de ${total}*`,
    paso.instruccion,
    '',
    pideEvidencia(ev),
    '',
    '_Escribe *siguiente* cuando termines, o *cancelar* para salir._',
  ].join('\n');
}

// --- Lógica de completitud de un paso ---

export function pasoCompleto(paso: PasoEjecucion, ev: EvidenciaPaso | undefined): boolean {
  if (!ev) return true;
  switch (ev.tipo) {
    case 'antes_despues':
      // Una limpieza no se prueba con una sola foto (Ficha §5).
      return Boolean(paso.fotoAntes && paso.fotoDespues);
    case 'medicion':
      return typeof paso.lectura === 'number' && (!ev.requiereFoto || (paso.fotos?.length ?? 0) > 0);
    case 'foto_comentario':
    default:
      // Foto y comentario son OPCIONALES (Ficha §5): el paso puede cerrarse sin
      // evidencia; al final se da un empujón suave con el conteo de pendientes.
      return true;
  }
}

// ¿El paso quedó sin ninguna evidencia capturada? (para el empujón suave al cierre)
function sinEvidencia(paso: PasoEjecucion): boolean {
  return !(paso.fotos?.length) && !paso.fotoAntes && !paso.fotoDespues && typeof paso.lectura !== 'number';
}

function faltantePaso(paso: PasoEjecucion, ev: EvidenciaPaso | undefined): string {
  if (!ev) return '';
  switch (ev.tipo) {
    case 'antes_despues':
      if (!paso.fotoAntes) return 'Aún falta la foto de *ANTES*.';
      return 'Aún falta la foto de *DESPUÉS*.';
    case 'medicion':
      if (typeof paso.lectura !== 'number') return 'Aún falta la *lectura* numérica.';
      return 'Aún falta la *foto* de la medición.';
    case 'foto_comentario':
    default:
      return 'Aún falta la *foto* de este paso.';
  }
}

// --- Reducer principal ---

function extraerNumero(texto: string): number | null {
  const m = texto.replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function indiceActual(ejec: RutinaEjecucion): number {
  return Math.max(0, ejec.pasos.findIndex((p) => p.orden === ejec.pasoActual));
}

function avanzarAlSiguiente(ejec: RutinaEjecucion, plantilla: RutinaPlantilla, ahora: Date): ResultadoAvance {
  const idx = indiceActual(ejec);
  const siguiente = ejec.pasos[idx + 1];
  if (!siguiente) {
    // Terminó los pasos: primero pedimos el nombre de quien recibe (etapa
    // 'recibe'); con eso pasamos a 'firma' y mandamos el reporte.
    ejec.etapa = 'recibe';
    ejec.pasoActual = undefined;
    // Empujón suave (Ficha §5): avisa si quedaron pasos sin evidencia, sin bloquear.
    const nSin = ejec.pasos.filter(sinEvidencia).length;
    const nota =
      nSin > 0
        ? `⚠️ Terminaste con *${nSin}* paso${nSin === 1 ? '' : 's'} sin evidencia (foto o lectura). Quedan registrados así.\n\n`
        : '';
    return { ejec, terminada: false, respuesta: nota + TEXTO_TERMINADO };
  }
  ejec.pasoActual = siguiente.orden;
  return { ejec, terminada: false, respuesta: textoPaso(ejec, plantilla, siguiente.orden) };
}

// Etapa de firma: llegó una foto (la hoja firmada) o el técnico declara que no
// hubo firma (bandera roja de faltante).
// Etapa 'recibe': capturamos el NOMBRE de quien recibe el servicio y pasamos a
// la etapa de revisión/firma (donde el servicio añade el enlace del reporte).
function manejarRecibe(ejec: RutinaEjecucion, entrada: EntradaEjecucion, ahora: Date): ResultadoAvance {
  if (entrada.clase === 'foto') {
    return { ejec, terminada: false, respuesta: 'Primero dime el *nombre de quien recibe* el servicio.' };
  }
  const texto = entrada.texto.trim();
  if (RE_CANCELAR.test(texto)) {
    ejec.estatus = 'cancelada';
    ejec.fin = ahora;
    ejec.cancelacionRazon = texto;
    return { ejec, terminada: true, respuesta: '🚫 Rutina cancelada. Cuando quieras retomamos desde cero.' };
  }
  if (!texto) {
    return { ejec, terminada: false, respuesta: '¿*Quién recibe* el servicio? Escríbeme el *nombre* de la persona.' };
  }
  ejec.recibeNombre = texto;
  ejec.etapa = 'firma';
  return { ejec, terminada: false, respuesta: `👍 Anotado: recibe *${texto}*.` };
}

function manejarFirma(ejec: RutinaEjecucion, entrada: EntradaEjecucion, ahora: Date): ResultadoAvance {
  if (entrada.clase === 'foto') {
    ejec.evidenciaFirmaUrl = entrada.url;
    ejec.estatus = 'firmada';
    ejec.fin = ahora;
    return { ejec, terminada: true, respuesta: '✅ Recibí la hoja firmada. ¡Rutina cerrada! Ya puedes ver el reporte en el portal.' };
  }
  const texto = entrada.texto.trim();
  if (RE_CANCELAR.test(texto)) {
    ejec.estatus = 'cancelada';
    ejec.fin = ahora;
    ejec.cancelacionRazon = texto;
    return { ejec, terminada: true, respuesta: '🚫 Rutina cancelada.' };
  }
  if (RE_SIN_FIRMA.test(texto)) {
    ejec.estatus = 'faltante_firma';
    ejec.fin = ahora;
    ejec.faltanteFirmaRazon = texto.replace(RE_SIN_FIRMA, '').replace(/^[:\s-]+/, '').trim() || texto;
    return {
      ejec,
      terminada: true,
      respuesta: '🚩 Anotado como *faltante de firma*. Quedó marcado en el portal; cuando consigas la firma, envíame la foto y lo cerramos.',
    };
  }
  return { ejec, terminada: false, respuesta: TEXTO_REVISAR };
}

export function avanzarEjecucion(
  ejec: RutinaEjecucion,
  plantilla: RutinaPlantilla,
  entrada: EntradaEjecucion,
  ahora: Date
): ResultadoAvance {
  if (ejec.estatus !== 'en_proceso') {
    return { ejec, terminada: false, respuesta: 'Esta rutina ya no está en proceso.' };
  }
  // Etapa 'recibe': pedir el nombre de quien recibe (tras terminar los pasos).
  if (ejec.etapa === 'recibe') {
    return manejarRecibe(ejec, entrada, ahora);
  }
  // Etapa de firma (ya se capturó quién recibe).
  if (ejec.etapa === 'firma') {
    return manejarFirma(ejec, entrada, ahora);
  }
  const idx = indiceActual(ejec);
  const paso = ejec.pasos[idx];
  const ev = evidenciaDePlantilla(plantilla, paso.orden);

  // --- Comandos de texto ---
  if (entrada.clase === 'texto') {
    const texto = entrada.texto.trim();

    if (RE_CANCELAR.test(texto)) {
      ejec.estatus = 'cancelada';
      ejec.fin = ahora;
      ejec.cancelacionRazon = texto;
      return { ejec, terminada: true, respuesta: '🚫 Rutina cancelada. Cuando quieras retomamos desde cero.' };
    }

    if (RE_ESTADO.test(texto)) {
      return { ejec, terminada: false, respuesta: textoPaso(ejec, plantilla, paso.orden) };
    }

    // Puerta de comentario abierta: acabamos de recibir la evidencia y pedimos el
    // comentario del paso. El técnico responde con su comentario, o "sin comentario".
    if (paso.esperaComentario) {
      paso.esperaComentario = false;
      if (!RE_COMENTARIO_NO.test(texto)) {
        paso.comentario = paso.comentario ? `${paso.comentario}\n${texto}` : texto;
      }
      paso.fecha = ahora;
      return avanzarAlSiguiente(ejec, plantilla, ahora);
    }

    if (RE_SIGUIENTE.test(texto)) {
      if (pasoCompleto(paso, ev)) return abrirComentarioOAvanzar(ejec, plantilla, paso, ahora);
      return { ejec, terminada: false, respuesta: `${faltantePaso(paso, ev)}\n\n${pideEvidencia(ev)}` };
    }

    // Medición: si el paso pide lectura y el texto trae un número, lo tomamos.
    if (ev?.tipo === 'medicion') {
      const num = extraerNumero(texto);
      if (num !== null) {
        paso.lectura = num;
        paso.unidad = ev.unidadSugerida ?? undefined;
        if (ev.rangoDefinido && typeof ev.rangoMin === 'number' && typeof ev.rangoMax === 'number') {
          paso.cumple = num >= ev.rangoMin && num <= ev.rangoMax;
        }
        const veredicto =
          paso.cumple === undefined ? '' : paso.cumple ? ' ✅ dentro de rango.' : ' ⚠️ *fuera de rango*.';
        const encabezado = `Anoté ${num}${paso.unidad ? ' ' + paso.unidad : ''}.${veredicto}`;
        // Lectura completa → puerta de comentario antes de avanzar.
        if (pasoCompleto(paso, ev)) {
          paso.esperaComentario = true;
          return { ejec, terminada: false, respuesta: `${encabezado}\n\n${PIDE_COMENTARIO}` };
        }
        return { ejec, terminada: false, respuesta: `${encabezado}\n${faltantePaso(paso, ev)}` };
      }
    }

    // Cualquier otro texto = comentario del paso. Si con eso queda completo, avanza
    // (el técnico ya comentó, no volvemos a preguntar).
    paso.comentario = paso.comentario ? `${paso.comentario}\n${texto}` : texto;
    if (pasoCompleto(paso, ev)) {
      paso.fecha = ahora;
      const av = avanzarAlSiguiente(ejec, plantilla, ahora);
      return { ...av, respuesta: '📝 Anoté tu comentario.\n\n' + av.respuesta };
    }
    return { ejec, terminada: false, respuesta: '📝 Anoté tu comentario. ' + faltantePaso(paso, ev) };
  }

  // --- Llegó una foto ---
  // Con la puerta de comentario abierta, una foto extra se agrega y seguimos ahí.
  if (paso.esperaComentario) {
    paso.fotos = [...(paso.fotos ?? []), entrada.url];
    return { ejec, terminada: false, respuesta: `📷 Guardada.\n\n${PIDE_COMENTARIO}` };
  }
  if (ev?.tipo === 'antes_despues') {
    if (!paso.fotoAntes) {
      paso.fotoAntes = entrada.url;
      return { ejec, terminada: false, respuesta: '📸 Guardé la foto de *ANTES*. Ahora envía la de *DESPUÉS*.' };
    }
    paso.fotoDespues = entrada.url;
  } else {
    paso.fotos = [...(paso.fotos ?? []), entrada.url];
  }
  paso.fecha = ahora;
  // Foto completó la evidencia → puerta de comentario (o avanza si ya hay comentario).
  if (pasoCompleto(paso, ev)) {
    if (paso.comentario) {
      const av = avanzarAlSiguiente(ejec, plantilla, ahora);
      return { ...av, respuesta: '📷 Foto guardada. ✅\n\n' + av.respuesta };
    }
    paso.esperaComentario = true;
    return { ejec, terminada: false, respuesta: `📷 Foto guardada. ✅\n\n${PIDE_COMENTARIO}` };
  }
  return { ejec, terminada: false, respuesta: `📷 Foto guardada. ${faltantePaso(paso, ev)}` };
}

// "siguiente" en un paso completo: si no hay comentario, abre la puerta de
// comentario; si ya lo dejó, avanza.
function abrirComentarioOAvanzar(
  ejec: RutinaEjecucion,
  plantilla: RutinaPlantilla,
  paso: PasoEjecucion,
  ahora: Date
): ResultadoAvance {
  if (!paso.comentario) {
    paso.esperaComentario = true;
    return { ejec, terminada: false, respuesta: PIDE_COMENTARIO };
  }
  paso.fecha = ahora;
  return avanzarAlSiguiente(ejec, plantilla, ahora);
}
