import { partesFechaNegocio } from './folio';

// Folio de ORDEN DE REPARACIÓN: OR-MMYY-NNN. Consecutivo MENSUAL propio, aparte
// del de cotizaciones (GPC-…) y del de reportes (GPC-R-…). Se asigna al RECIBIR
// el equipo (es el número de rastreo desde que entra al taller). El consecutivo
// vive en counters/reparacion_{anio}_{mm} y se incrementa en transacción.

export { partesFechaNegocio };

export function formatearFolioReparacion(anio: number, mes: number, consecutivo: number): string {
  const mm = String(mes).padStart(2, '0');
  const yy = String(anio % 100).padStart(2, '0');
  const nnn = String(consecutivo).padStart(3, '0');
  return `OR-${mm}${yy}-${nnn}`;
}

export function nombreContadorReparacion(anio: number, mes: number): string {
  return `reparacion_${anio}_${String(mes).padStart(2, '0')}`;
}

// Extrae {anio (20YY), mes, consecutivo} de un folio OR válido; null si no cuadra.
export function parsearFolioReparacion(
  folio: string
): { anio: number; mes: number; consecutivo: number } | null {
  const m = /^OR-(\d{2})(\d{2})-(\d{3})$/.exec(folio.trim().toUpperCase());
  if (!m) return null;
  return { mes: Number(m[1]), anio: 2000 + Number(m[2]), consecutivo: Number(m[3]) };
}
