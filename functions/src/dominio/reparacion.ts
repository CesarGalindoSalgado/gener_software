import { EstatusReparacion } from './tipos';

// Máquina de estados de una Orden de Reparación (taller):
//   recibido → en_diagnostico → cotizado → aprobado → en_reparacion → listo → entregado
// Ramas alternas (el equipo no procede):
//   en_diagnostico → rechazado   (se revisó y NO se puede/quiere reparar)
//   cotizado       → rechazado   (el cliente no acepta la cotización)
//   rechazado      → devuelto     (se devuelve el equipo al cliente)
// 'entregado' y 'devuelto' son terminales.
const TRANSICIONES: Record<EstatusReparacion, EstatusReparacion[]> = {
  recibido: ['en_diagnostico'],
  en_diagnostico: ['cotizado', 'rechazado'],
  cotizado: ['aprobado', 'rechazado'],
  aprobado: ['en_reparacion'],
  en_reparacion: ['listo'],
  listo: ['entregado'],
  entregado: [],
  rechazado: ['devuelto'],
  devuelto: [],
};

export function puedeTransicionarReparacion(de: EstatusReparacion, a: EstatusReparacion): boolean {
  return TRANSICIONES[de]?.includes(a) ?? false;
}

export function validarTransicionReparacion(de: EstatusReparacion, a: EstatusReparacion): void {
  if (!puedeTransicionarReparacion(de, a)) {
    throw new Error(`Transición de reparación inválida: ${de} → ${a}`);
  }
}

// Etiquetas legibles para el portal (una sola fuente de verdad).
export const ETIQUETA_ESTATUS_REPARACION: Record<EstatusReparacion, string> = {
  recibido: 'Recibido',
  en_diagnostico: 'En diagnóstico',
  cotizado: 'Cotizado',
  aprobado: 'Aprobado',
  en_reparacion: 'En reparación',
  listo: 'Listo',
  entregado: 'Entregado',
  rechazado: 'Rechazado',
  devuelto: 'Devuelto',
};

// Orden de las etapas (para el tablero tipo kanban del portal).
export const ETAPAS_REPARACION: EstatusReparacion[] = [
  'recibido',
  'en_diagnostico',
  'cotizado',
  'aprobado',
  'en_reparacion',
  'listo',
  'entregado',
];
