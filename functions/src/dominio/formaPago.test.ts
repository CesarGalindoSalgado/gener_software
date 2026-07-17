import { describe, it, expect } from 'vitest';
import { porcentajesFormaPago, validarPorcentajesPago } from './formaPago';

describe('porcentajesFormaPago', () => {
  it('lee dos porcentajes del texto típico', () => {
    expect(porcentajesFormaPago('70% anticipo / 30% entrega')).toEqual([70, 30]);
  });
  it('tolera decimales con coma o punto', () => {
    expect(porcentajesFormaPago('33.5% anticipo, 66,5% contra entrega')).toEqual([33.5, 66.5]);
  });
  it('devuelve vacío si no hay porcentajes', () => {
    expect(porcentajesFormaPago('Contado')).toEqual([]);
  });
});

describe('validarPorcentajesPago', () => {
  it('ok cuando suman 100', () => {
    expect(validarPorcentajesPago('70% anticipo / 30% entrega').ok).toBe(true);
  });
  it('ok con un solo 100%', () => {
    expect(validarPorcentajesPago('100% contra entrega').ok).toBe(true);
  });
  it('falla si está vacío', () => {
    const r = validarPorcentajesPago('');
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/captura/i);
  });
  it('falla si no suman 100', () => {
    const r = validarPorcentajesPago('70% anticipo / 40% entrega');
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/110%/);
  });
});
