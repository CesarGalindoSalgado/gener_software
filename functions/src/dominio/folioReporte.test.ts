import { describe, expect, it } from 'vitest';
import { formatearFolioReporte, nombreContadorReporte } from './folioReporte';

describe('folioReporte', () => {
  it('formato GPC-R-MMYY-NNN con ceros a la izquierda', () => {
    expect(formatearFolioReporte(2026, 3, 5)).toBe('GPC-R-0326-005');
    expect(formatearFolioReporte(2025, 12, 123)).toBe('GPC-R-1225-123');
  });
  it('contador anual propio', () => {
    expect(nombreContadorReporte(2026)).toBe('reporte_2026');
  });
});
