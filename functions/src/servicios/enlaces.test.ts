import { describe, expect, it } from 'vitest';
import { firmarEnlace, verificarEnlace } from './enlaces';

const SECRETO = 'secreto-de-prueba-1234567890';

describe('enlaces firmados', () => {
  it('firma y verifica de ida y vuelta', () => {
    const token = firmarEnlace(SECRETO, 'cot123');
    expect(verificarEnlace(SECRETO, token)).toEqual({ cotizacionId: 'cot123' });
  });

  it('rechaza un token alterado', () => {
    const token = firmarEnlace(SECRETO, 'cot123');
    const alterado = token.slice(0, -2) + (token.endsWith('a') ? 'b' : 'a');
    expect(verificarEnlace(SECRETO, alterado)).toBeNull();
  });

  it('rechaza con otro secreto', () => {
    const token = firmarEnlace(SECRETO, 'cot123');
    expect(verificarEnlace('otro-secreto', token)).toBeNull();
  });

  it('rechaza un token vencido', () => {
    const hace40dias = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const token = firmarEnlace(SECRETO, 'cot123', hace40dias);
    expect(verificarEnlace(SECRETO, token)).toBeNull();
  });

  it('rechaza basura', () => {
    expect(verificarEnlace(SECRETO, 'no-es-un-token')).toBeNull();
    expect(verificarEnlace(SECRETO, '')).toBeNull();
  });
});
