import { describe, expect, it } from 'vitest';
import { EstatusReparacion } from './tipos';
import { puedeTransicionarReparacion, validarTransicionReparacion } from './reparacion';

describe('estados de reparación', () => {
  it('recorre el flujo feliz completo', () => {
    const flujo: EstatusReparacion[] = [
      'recibido',
      'en_diagnostico',
      'cotizado',
      'aprobado',
      'en_reparacion',
      'listo',
      'entregado',
    ];
    for (let i = 0; i < flujo.length - 1; i++) {
      expect(puedeTransicionarReparacion(flujo[i], flujo[i + 1])).toBe(true);
    }
  });

  it('en diagnóstico se puede rechazar (no se puede/quiere reparar)', () => {
    expect(puedeTransicionarReparacion('en_diagnostico', 'rechazado')).toBe(true);
  });

  it('cotizado puede rechazarse (cliente no acepta) y rechazado se devuelve', () => {
    expect(puedeTransicionarReparacion('cotizado', 'rechazado')).toBe(true);
    expect(puedeTransicionarReparacion('rechazado', 'devuelto')).toBe(true);
  });

  it('no permite saltarse etapas', () => {
    expect(puedeTransicionarReparacion('recibido', 'cotizado')).toBe(false);
    expect(() => validarTransicionReparacion('recibido', 'entregado')).toThrowError('inválida');
  });

  it('los estados terminales no transicionan', () => {
    expect(puedeTransicionarReparacion('entregado', 'recibido')).toBe(false);
    expect(puedeTransicionarReparacion('devuelto', 'recibido')).toBe(false);
  });
});
