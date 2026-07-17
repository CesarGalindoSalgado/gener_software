import { describe, expect, it } from 'vitest';
import { formatearFolio, nombreContador, parsearFolio, partesFechaNegocio, siguienteRev } from './folio';

describe('formatearFolio', () => {
  it('formato GPC-MMYY-NNN con ceros a la izquierda', () => {
    expect(formatearFolio(2026, 3, 5)).toBe('GPC-0326-005');
    expect(formatearFolio(2025, 7, 19)).toBe('GPC-0725-019');
    expect(formatearFolio(2026, 12, 123)).toBe('GPC-1226-123');
  });
});

describe('parsearFolio (para derivar la semilla del corpus)', () => {
  it('extrae año, mes y consecutivo de los folios de muestra', () => {
    expect(parsearFolio('GPC-0326-005')).toEqual({ anio: 2026, mes: 3, consecutivo: 5 });
    expect(parsearFolio('GPC-0725-019')).toEqual({ anio: 2025, mes: 7, consecutivo: 19 });
  });

  it('rechaza formatos inválidos', () => {
    expect(parsearFolio('GPC-326-5')).toBeNull();
    expect(parsearFolio('ABC-0326-005')).toBeNull();
    expect(parsearFolio('')).toBeNull();
  });
});

describe('partesFechaNegocio (zona de Morelos)', () => {
  it('una madrugada UTC del 1 de enero sigue siendo 31 de diciembre en Morelos', () => {
    // 2027-01-01 03:00 UTC = 2026-12-31 21:00 en America/Mexico_City
    const fecha = new Date('2027-01-01T03:00:00Z');
    expect(partesFechaNegocio(fecha)).toEqual({ anio: 2026, mes: 12 });
  });

  it('fecha normal', () => {
    const fecha = new Date('2026-07-02T18:00:00Z');
    expect(partesFechaNegocio(fecha)).toEqual({ anio: 2026, mes: 7 });
  });
});

describe('nombreContador', () => {
  it('un contador por mes (mm con cero a la izquierda)', () => {
    expect(nombreContador(2026, 7)).toBe('folio_2026_07');
    expect(nombreContador(2026, 12)).toBe('folio_2026_12');
  });
});

describe('siguienteRev', () => {
  it('avanza la letra', () => {
    expect(siguienteRev('A')).toBe('B');
    expect(siguienteRev('B')).toBe('C');
  });

  it('Z desborda a AA sin tronar', () => {
    expect(siguienteRev('Z')).toBe('AA');
    expect(siguienteRev('AZ')).toBe('BA');
  });
});
