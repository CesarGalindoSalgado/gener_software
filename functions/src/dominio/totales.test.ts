import { describe, expect, it } from 'vitest';
import { calcularTotales, reconciliarTotales, round2 } from './totales';
import { Partida } from './tipos';

const partida = (importe: number, cantidad = 1): Partida => ({
  titulo: 'x',
  lineas: [],
  cantidad,
  importe,
});

describe('calcularTotales', () => {
  it('un bloque (GPC-0326-005)', () => {
    const t = calcularTotales([partida(16437)]);
    expect(t).toEqual({ subtotal: 16437, iva: 2629.92, total: 19066.92 });
  });

  it('cinco bloques (GPC-0725-019)', () => {
    const t = calcularTotales([partida(1200), partida(1200), partida(150), partida(800), partida(500)]);
    expect(t).toEqual({ subtotal: 3850, iva: 616, total: 4466 });
  });

  it('tres bloques (GPC-0126-003) con decimales en el IVA', () => {
    const t = calcularTotales([partida(6800), partida(13630), partida(17980)]);
    expect(t).toEqual({ subtotal: 38410, iva: 6145.6, total: 44555.6 });
  });

  it('respeta cantidad > 1', () => {
    const t = calcularTotales([partida(100, 3)]);
    expect(t.subtotal).toBe(300);
  });
});

describe('reconciliarTotales (filtro de calidad del ETL)', () => {
  it('acepta una cotización de muestra íntegra', () => {
    const r = reconciliarTotales([partida(3800)], { subtotal: 3800, iva: 608, total: 4408 });
    expect(r.ok).toBe(true);
  });

  it('tolera ±0.01 por redondeos históricos', () => {
    const r = reconciliarTotales([partida(16437)], { subtotal: 16437, iva: 2629.91, total: 19066.91 });
    expect(r.ok).toBe(true);
  });

  it('rechaza cuando las partidas no suman el subtotal', () => {
    const r = reconciliarTotales([partida(1000)], { subtotal: 3800, iva: 608, total: 4408 });
    expect(r.sumaPartidasOk).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('rechaza un IVA que no es 16%', () => {
    const r = reconciliarTotales([partida(1000)], { subtotal: 1000, iva: 80, total: 1080 });
    expect(r.iva16Ok).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe('round2', () => {
  it('redondea a 2 decimales', () => {
    expect(round2(6145.6000000001)).toBe(6145.6);
    expect(round2(2629.9199999)).toBe(2629.92);
    expect(round2(1.005)).toBe(1.01);
  });
});
