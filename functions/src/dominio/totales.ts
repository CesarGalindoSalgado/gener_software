import { Partida } from './tipos';

// IVA fijo del negocio (configurable a futuro; hoy siempre 16%).
export const TASA_IVA = 0.16;

// Tolerancia al reconciliar importes históricos (redondeos de PDFs viejos).
export const TOLERANCIA = 0.01;

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

export interface Reconciliacion {
  sumaPartidasOk: boolean;
  iva16Ok: boolean;
  totalOk: boolean;
  ok: boolean;
}

// Filtro de calidad del ETL: una cotización histórica solo se acepta si sus
// totales reconcilian dentro de la tolerancia.
export function reconciliarTotales(
  partidas: Partida[],
  declarado: Totales,
  tolerancia: number = TOLERANCIA
): Reconciliacion {
  const calculado = calcularTotales(partidas);
  // La diferencia se redondea a centavos antes de comparar: en flotante,
  // 2629.92 - 2629.91 da 0.010000000000218, que reventaría la tolerancia.
  const dentro = (a: number, b: number) => round2(Math.abs(a - b)) <= tolerancia;
  const sumaPartidasOk = dentro(calculado.subtotal, declarado.subtotal);
  const iva16Ok = dentro(round2(declarado.subtotal * TASA_IVA), declarado.iva);
  const totalOk = dentro(round2(declarado.subtotal + declarado.iva), declarado.total);
  return { sumaPartidasOk, iva16Ok, totalOk, ok: sumaPartidasOk && iva16Ok && totalOk };
}
