import { describe, expect, it } from 'vitest';
import { puedeTransicionar, validarTransicion } from './estados';

describe('máquina de estados', () => {
  it('camino feliz: borrador → enviada → autorizada → realizada', () => {
    expect(puedeTransicionar('borrador', 'enviada')).toBe(true);
    expect(puedeTransicionar('enviada', 'autorizada')).toBe(true);
    expect(puedeTransicionar('autorizada', 'realizada')).toBe(true);
  });

  it('rama alterna: enviada → rechazada', () => {
    expect(puedeTransicionar('enviada', 'rechazada')).toBe(true);
  });

  it('no hay saltos ni retrocesos', () => {
    expect(puedeTransicionar('borrador', 'autorizada')).toBe(false);
    expect(puedeTransicionar('borrador', 'realizada')).toBe(false);
    expect(puedeTransicionar('enviada', 'borrador')).toBe(false);
    expect(puedeTransicionar('realizada', 'enviada')).toBe(false);
    expect(puedeTransicionar('rechazada', 'enviada')).toBe(false);
  });

  it('importada es terminal (solo ETL)', () => {
    expect(puedeTransicionar('importada', 'enviada')).toBe(false);
    expect(puedeTransicionar('importada', 'autorizada')).toBe(false);
  });

  it('validarTransicion truena con mensaje claro', () => {
    expect(() => validarTransicion('borrador', 'realizada')).toThrow('borrador → realizada');
  });
});
