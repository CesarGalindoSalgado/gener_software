import { EstatusCotizacion } from './tipos';

// Máquina de estados: borrador → enviada → autorizada → realizada.
// Rama alterna: enviada → rechazada. 'importada' es terminal (solo ETL).
const TRANSICIONES: Record<EstatusCotizacion, EstatusCotizacion[]> = {
  borrador: ['enviada'],
  enviada: ['autorizada', 'rechazada'],
  autorizada: ['realizada'],
  realizada: [],
  rechazada: [],
  importada: [],
};

export function puedeTransicionar(de: EstatusCotizacion, a: EstatusCotizacion): boolean {
  return TRANSICIONES[de]?.includes(a) ?? false;
}

export function validarTransicion(de: EstatusCotizacion, a: EstatusCotizacion): void {
  if (!puedeTransicionar(de, a)) {
    throw new Error(`Transición de estatus inválida: ${de} → ${a}`);
  }
}
