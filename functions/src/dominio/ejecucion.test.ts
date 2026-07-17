import { describe, expect, it } from 'vitest';
import { avanzarEjecucion, iniciarEjecucion, pasoCompleto } from './ejecucion';
import { EvidenciaPaso, RutinaPlantilla } from './tipos';

const ahora = new Date('2026-07-06T12:00:00Z');

function ev(parcial: Partial<EvidenciaPaso> & Pick<EvidenciaPaso, 'tipo'>): EvidenciaPaso {
  return {
    requiereFoto: false,
    fotosAntesDespues: false,
    requiereLectura: false,
    ...parcial,
  };
}

const PLANTILLA: RutinaPlantilla = {
  partida: 'Equipo electromecánico',
  nombre: 'Rutina de prueba',
  activa: true,
  equiposIncluidos: [],
  refaccionesReferenciales: [],
  pasos: [
    { orden: 1, instruccion: 'Inspección visual', evidencia: ev({ tipo: 'foto_comentario', requiereFoto: true }) },
    { orden: 2, instruccion: 'Limpieza', evidencia: ev({ tipo: 'antes_despues', fotosAntesDespues: true }) },
    {
      orden: 3,
      instruccion: 'Medir temperatura',
      evidencia: ev({ tipo: 'medicion', requiereLectura: true, unidadSugerida: '°C', rangoDefinido: true, rangoMin: 2, rangoMax: 8 }),
    },
  ],
};

const datos = { rutinaId: 'RUT-001', sedeId: 's1', equipoId: 'e1', tecnicoTelefono: '521', tecnicoNombre: 'Juan' };

describe('iniciarEjecucion', () => {
  it('arranca en_proceso, en el primer paso, con los pasos copiados', () => {
    const e = iniciarEjecucion(PLANTILLA, datos, ahora);
    expect(e.estatus).toBe('en_proceso');
    expect(e.pasoActual).toBe(1);
    expect(e.pasos).toHaveLength(3);
    expect(e.pasos[0].tipo).toBe('foto_comentario');
  });
});

describe('flujo completo', () => {
  it('recorre los tres pasos hasta completar', () => {
    let e = iniciarEjecucion(PLANTILLA, datos, ahora);

    // Paso 1: foto_comentario. "siguiente" abre la puerta de comentario; con
    // "sin comentario" avanza.
    let r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: 'siguiente' }, ahora);
    expect(r.ejec.pasoActual).toBe(1);
    expect(r.respuesta).toMatch(/coment/i);
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: 'sin comentario' }, ahora);
    expect(r.ejec.pasoActual).toBe(2);

    // Paso 2: antes_despues necesita las dos fotos. La 2ª completa la evidencia y
    // abre la puerta de comentario; "sin comentario" avanza.
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'foto', url: 'http://f/antes.jpg' }, ahora);
    expect(r.ejec.pasos[1].fotoAntes).toBe('http://f/antes.jpg');
    expect(r.respuesta).toMatch(/DESPU[EÉ]S/i); // aún falta la de después
    expect(r.ejec.pasoActual).toBe(2);
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'foto', url: 'http://f/despues.jpg' }, ahora);
    expect(r.ejec.pasoActual).toBe(2); // abre puerta de comentario
    expect(r.respuesta).toMatch(/coment/i);
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: 'sin comentario' }, ahora);
    expect(r.ejec.pasoActual).toBe(3);

    // Paso 3: medición. La lectura completa y abre la puerta; "sin comentario"
    // avanza a firma.
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: '5' }, ahora);
    expect(r.ejec.pasos[2].lectura).toBe(5);
    expect(r.ejec.pasos[2].cumple).toBe(true);
    expect(r.respuesta).toMatch(/coment/i);
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: 'sin comentario' }, ahora);
    expect(r.terminada).toBe(false);
    expect(r.ejec.etapa).toBe('recibe'); // pide quién recibe
    expect(r.respuesta).toMatch(/recibe/i);

    // Nombre de quien recibe → pasa a la etapa de firma.
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: 'Ing. Laura Medina' }, ahora);
    expect(r.ejec.recibeNombre).toBe('Ing. Laura Medina');
    expect(r.ejec.etapa).toBe('firma');
    expect(r.ejec.estatus).toBe('en_proceso');

    // Manda la hoja firmada → firmada.
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'foto', url: 'http://f/firma.jpg' }, ahora);
    expect(r.terminada).toBe(true);
    expect(r.ejec.estatus).toBe('firmada');
    expect(r.ejec.evidenciaFirmaUrl).toBe('http://f/firma.jpg');
  });

  it('marca faltante de firma con su razón', () => {
    const e = iniciarEjecucion(PLANTILLA, datos, ahora);
    e.etapa = 'firma';
    e.pasoActual = undefined;
    const r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: 'sin firma: no estaba el responsable' }, ahora);
    expect(r.terminada).toBe(true);
    expect(r.ejec.estatus).toBe('faltante_firma');
    expect(r.ejec.faltanteFirmaRazon).toBe('no estaba el responsable');
  });

  it('marca fuera de rango una medición fuera de límites', () => {
    const e = iniciarEjecucion(PLANTILLA, datos, ahora);
    e.pasoActual = 3;
    const r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: '15 grados' }, ahora);
    expect(r.ejec.pasos[2].lectura).toBe(15);
    expect(r.ejec.pasos[2].cumple).toBe(false);
    expect(r.respuesta).toMatch(/fuera de rango/i);
  });
});

describe('puerta de comentario', () => {
  it('una foto abre la puerta de comentario; "sin comentario" avanza', () => {
    const e = iniciarEjecucion(PLANTILLA, datos, ahora);
    let r = avanzarEjecucion(e, PLANTILLA, { clase: 'foto', url: 'http://f/1.jpg' }, ahora);
    expect(r.ejec.pasos[0].fotos).toContain('http://f/1.jpg');
    expect(r.ejec.pasoActual).toBe(1); // no avanza aún: pide comentario
    expect(r.respuesta).toMatch(/coment/i);
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: 'sin comentario' }, ahora);
    expect(r.ejec.pasoActual).toBe(2);
  });

  it('el comentario de la puerta se guarda y avanza', () => {
    const e = iniciarEjecucion(PLANTILLA, datos, ahora);
    let r = avanzarEjecucion(e, PLANTILLA, { clase: 'foto', url: 'http://f/1.jpg' }, ahora);
    expect(r.respuesta).toMatch(/coment/i);
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: 'no hay novedad, todo bien' }, ahora);
    expect(r.ejec.pasos[0].comentario).toMatch(/no hay novedad/i); // "no hay..." NO es "sin comentario"
    expect(r.ejec.pasoActual).toBe(2);
  });

  it('una medición abre la puerta antes de avanzar', () => {
    const e = iniciarEjecucion(PLANTILLA, datos, ahora);
    e.pasoActual = 3;
    let r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: '5' }, ahora);
    expect(r.ejec.pasos[2].lectura).toBe(5);
    expect(r.ejec.etapa).toBe('pasos'); // aún no avanza: pide comentario
    expect(r.respuesta).toMatch(/coment/i);
    r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: 'sin comentario' }, ahora);
    expect(r.ejec.etapa).toBe('recibe'); // terminó pasos → pide quién recibe
  });
});

describe('cancelar', () => {
  it('cancela desde cualquier paso', () => {
    const e = iniciarEjecucion(PLANTILLA, datos, ahora);
    const r = avanzarEjecucion(e, PLANTILLA, { clase: 'texto', texto: 'cancelar' }, ahora);
    expect(r.terminada).toBe(true);
    expect(r.ejec.estatus).toBe('cancelada');
  });
});

describe('pasoCompleto', () => {
  it('foto_comentario es opcional: se completa con o sin foto', () => {
    const evf = ev({ tipo: 'foto_comentario', requiereFoto: true });
    expect(pasoCompleto({ orden: 1, instruccion: '', tipo: 'foto_comentario' }, evf)).toBe(true);
    expect(pasoCompleto({ orden: 1, instruccion: '', tipo: 'foto_comentario', fotos: ['x'] }, evf)).toBe(true);
  });

  it('antes_despues sí requiere ambas fotos', () => {
    const evf = ev({ tipo: 'antes_despues', fotosAntesDespues: true });
    expect(pasoCompleto({ orden: 1, instruccion: '', tipo: 'antes_despues', fotoAntes: 'a' }, evf)).toBe(false);
    expect(pasoCompleto({ orden: 1, instruccion: '', tipo: 'antes_despues', fotoAntes: 'a', fotoDespues: 'b' }, evf)).toBe(true);
  });
});
