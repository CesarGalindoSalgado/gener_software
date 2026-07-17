import { partesFechaNegocio } from './folio';

// Folio de REPORTE de rutina: GPC-R-MMYY-NNN. Consecutivo anual propio, aparte
// del de cotizaciones (counters/reporte_{anio}). La "R" lo distingue a simple
// vista de un folio de cotización (GPC-MMYY-NNN).

export { partesFechaNegocio };

export function formatearFolioReporte(anio: number, mes: number, consecutivo: number): string {
  const mm = String(mes).padStart(2, '0');
  const yy = String(anio % 100).padStart(2, '0');
  const nnn = String(consecutivo).padStart(3, '0');
  return `GPC-R-${mm}${yy}-${nnn}`;
}

export function nombreContadorReporte(anio: number): string {
  return `reporte_${anio}`;
}
