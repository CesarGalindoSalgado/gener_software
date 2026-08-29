import { describe, expect, it } from 'vitest';
import {
  formatearFolioReparacion,
  nombreContadorReparacion,
  parsearFolioReparacion,
} from './folioReparacion';

describe('folioReparacion', () => {
  it('formatea OR-MMYY-NNN con ceros a la izquierda', () => {
    expect(formatearFolioReparacion(2026, 8, 1)).toBe('OR-0826-001');
    expect(formatearFolioReparacion(2026, 12, 42)).toBe('OR-1226-042');
  });

  it('el contador es mensual (reparacion_AAAA_MM)', () => {
    expect(nombreContadorReparacion(2026, 8)).toBe('reparacion_2026_08');
    expect(nombreContadorReparacion(2026, 12)).toBe('reparacion_2026_12');
  });

  it('parsea un folio OR válido', () => {
    expect(parsearFolioReparacion('OR-0826-001')).toEqual({ anio: 2026, mes: 8, consecutivo: 1 });
    expect(parsearFolioReparacion(' or-1226-042 ')).toEqual({ anio: 2026, mes: 12, consecutivo: 42 });
  });

  it('rechaza folios que no son de reparación', () => {
    expect(parsearFolioReparacion('GPC-0826-001')).toBeNull();
    expect(parsearFolioReparacion('OR-826-1')).toBeNull();
    expect(parsearFolioReparacion('basura')).toBeNull();
  });
});
