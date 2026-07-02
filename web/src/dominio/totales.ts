import type { Partida } from './tipos';

// Espejo de functions/src/dominio/totales.ts — mantener en sincronía.
export const TASA_IVA = 0.16;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface Totales {
  subtotal: number;
  iva: number;
  total: number;
}

export function calcularTotales(partidas: Partida[]): Totales {
  const subtotal = round2(
    partidas.reduce((suma, p) => suma + p.importe * (p.cantidad || 1), 0)
  );
  const iva = round2(subtotal * TASA_IVA);
  const total = round2(subtotal + iva);
  return { subtotal, iva, total };
}

export function formatearMoneda(n: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(n);
}
