import { describe, expect, it } from 'vitest';
import { aprobarCotizacion, ErrorAprobacion } from './aprobar';

// Fake mínimo de Firestore: solo lo que usa aprobarCotizacion
// (doc().get(), runTransaction con get/set/update). Suficiente para probar la
// lógica de folio y permisos sin emulador.
function fakeFirestore(datos: Record<string, Record<string, unknown>>) {
  const docs = new Map(Object.entries(datos));
  const ref = (path: string) => ({
    path,
    get: async () => snap(path),
  });
  const snap = (path: string) => ({
    exists: docs.has(path),
    data: () => docs.get(path),
  });
  return {
    docs,
    doc: ref,
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async (r: { path: string }) => snap(r.path),
        set: (r: { path: string }, data: Record<string, unknown>) => {
          docs.set(r.path, data);
        },
        update: (r: { path: string }, data: Record<string, unknown>) => {
          docs.set(r.path, { ...docs.get(r.path), ...data });
        },
      }),
  } as never;
}

const DUENO = '5217771112233';
const SECRETARIA = '5217774445566';

const base = () =>
  fakeFirestore({
    [`usuarios/${DUENO}`]: { nombre: 'Gabriel', rol: 'dueno', activo: true },
    [`usuarios/${SECRETARIA}`]: { nombre: 'Secretaria', rol: 'secretaria', activo: true },
    'cotizaciones/cot1': { folio: null, estatus: 'borrador', clienteId: 'c1' },
  });

// Julio 2026 en Morelos
const AHORA = new Date('2026-07-02T18:00:00Z');

describe('aprobarCotizacion', () => {
  it('asigna folio GPC-MMYY-NNN, cambia a enviada y sella fechaEnvio', async () => {
    const db = base();
    const r = await aprobarCotizacion(db, {
      cotizacionId: 'cot1',
      telefonoAprobador: DUENO,
      ahora: AHORA,
      semilla: 41,
    });
    expect(r.folio).toBe('GPC-0726-042');
    const cot = (db as never as { docs: Map<string, Record<string, unknown>> }).docs.get('cotizaciones/cot1')!;
    expect(cot.estatus).toBe('enviada');
    expect(cot.folio).toBe('GPC-0726-042');
    expect(cot.fechaEnvio).toBeDefined();
  });

  it('el contador incrementa: dos aprobaciones consumen folios consecutivos', async () => {
    const db = base();
    (db as never as { docs: Map<string, unknown> }).docs.set('cotizaciones/cot2', {
      folio: null,
      estatus: 'borrador',
      clienteId: 'c2',
    });
    const r1 = await aprobarCotizacion(db, { cotizacionId: 'cot1', telefonoAprobador: DUENO, ahora: AHORA });
    const r2 = await aprobarCotizacion(db, { cotizacionId: 'cot2', telefonoAprobador: DUENO, ahora: AHORA });
    expect(r1.consecutivo + 1).toBe(r2.consecutivo);
    expect(r1.folio).not.toBe(r2.folio);
  });

  it('la secretaria NO puede aprobar (gate en backend)', async () => {
    const db = base();
    await expect(
      aprobarCotizacion(db, { cotizacionId: 'cot1', telefonoAprobador: SECRETARIA, ahora: AHORA })
    ).rejects.toThrowError(ErrorAprobacion);
  });

  it('un número fuera de la lista blanca no puede aprobar', async () => {
    const db = base();
    await expect(
      aprobarCotizacion(db, { cotizacionId: 'cot1', telefonoAprobador: '000', ahora: AHORA })
    ).rejects.toThrowError('Solo el dueño');
  });

  it('no re-aprueba: una cotización con folio no consume folio nuevo', async () => {
    const db = base();
    await aprobarCotizacion(db, { cotizacionId: 'cot1', telefonoAprobador: DUENO, ahora: AHORA });
    await expect(
      aprobarCotizacion(db, { cotizacionId: 'cot1', telefonoAprobador: DUENO, ahora: AHORA })
    ).rejects.toThrowError('ya tiene folio');
  });

  it('solo un borrador puede aprobarse', async () => {
    const db = base();
    (db as never as { docs: Map<string, unknown> }).docs.set('cotizaciones/cot1', {
      folio: null,
      estatus: 'rechazada',
    });
    await expect(
      aprobarCotizacion(db, { cotizacionId: 'cot1', telefonoAprobador: DUENO, ahora: AHORA })
    ).rejects.toThrowError('Transición de estatus inválida');
  });
});
