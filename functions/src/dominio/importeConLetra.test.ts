import { describe, expect, it } from 'vitest';
import { importeConLetra, numeroALetra } from './importeConLetra';

describe('numeroALetra', () => {
  it('unidades y especiales', () => {
    expect(numeroALetra(0)).toBe('CERO');
    expect(numeroALetra(1)).toBe('UNO');
    expect(numeroALetra(16)).toBe('DIECISÉIS');
    expect(numeroALetra(21)).toBe('VEINTIUNO');
    expect(numeroALetra(29)).toBe('VEINTINUEVE');
  });

  it('decenas y centenas', () => {
    expect(numeroALetra(31)).toBe('TREINTA Y UNO');
    expect(numeroALetra(66)).toBe('SESENTA Y SEIS');
    expect(numeroALetra(100)).toBe('CIEN');
    expect(numeroALetra(121)).toBe('CIENTO VEINTIUNO');
    expect(numeroALetra(555)).toBe('QUINIENTOS CINCUENTA Y CINCO');
    expect(numeroALetra(999)).toBe('NOVECIENTOS NOVENTA Y NUEVE');
  });

  it('miles con apócope', () => {
    expect(numeroALetra(1000)).toBe('MIL');
    expect(numeroALetra(1001)).toBe('MIL UNO');
    expect(numeroALetra(21000)).toBe('VEINTIÚN MIL');
    expect(numeroALetra(31000)).toBe('TREINTA Y UN MIL');
    expect(numeroALetra(19066)).toBe('DIECINUEVE MIL SESENTA Y SEIS');
    expect(numeroALetra(44555)).toBe('CUARENTA Y CUATRO MIL QUINIENTOS CINCUENTA Y CINCO');
  });

  it('millones', () => {
    expect(numeroALetra(1_000_000)).toBe('UN MILLÓN');
    expect(numeroALetra(2_500_000)).toBe('DOS MILLONES QUINIENTOS MIL');
    expect(numeroALetra(21_000_000)).toBe('VEINTIÚN MILLONES');
  });
});

describe('importeConLetra (formato del PDF)', () => {
  it('coincide con las cotizaciones de muestra', () => {
    // GPC-0326-005
    expect(importeConLetra(19066.92)).toBe('SON: (DIECINUEVE MIL SESENTA Y SEIS PESOS 92/100 M.N.)');
    // GPC-0326-007
    expect(importeConLetra(4408)).toBe('SON: (CUATRO MIL CUATROCIENTOS OCHO PESOS 00/100 M.N.)');
    // GPC-0725-016
    expect(importeConLetra(5568)).toBe('SON: (CINCO MIL QUINIENTOS SESENTA Y OCHO PESOS 00/100 M.N.)');
    // GPC-0725-019
    expect(importeConLetra(4466)).toBe('SON: (CUATRO MIL CUATROCIENTOS SESENTA Y SEIS PESOS 00/100 M.N.)');
    // GPC-0126-003 — decimales .60
    expect(importeConLetra(44555.6)).toBe('SON: (CUARENTA Y CUATRO MIL QUINIENTOS CINCUENTA Y CINCO PESOS 60/100 M.N.)');
  });

  it('singular, apócope y millón exacto', () => {
    expect(importeConLetra(1)).toBe('SON: (UN PESO 00/100 M.N.)');
    expect(importeConLetra(121)).toBe('SON: (CIENTO VEINTIÚN PESOS 00/100 M.N.)');
    expect(importeConLetra(0.5)).toBe('SON: (CERO PESOS 50/100 M.N.)');
    expect(importeConLetra(1_000_000)).toBe('SON: (UN MILLÓN DE PESOS 00/100 M.N.)');
  });

  it('redondeo de centavos no desborda a 100', () => {
    expect(importeConLetra(9.999)).toBe('SON: (DIEZ PESOS 00/100 M.N.)');
  });
});
