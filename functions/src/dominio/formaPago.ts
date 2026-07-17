// Los porcentajes de anticipo y contra entrega NO son campos aparte: viven
// dentro del texto de "Forma de pago" (ej. "70% anticipo / 30% entrega").
// Aquí solo lógica pura para leerlos y validar que sumen 100% antes de aprobar.

// Extrae los porcentajes (NN% o NN.NN%) que aparezcan en el texto, en orden.
export function porcentajesFormaPago(texto: string): number[] {
  const encontrados = texto.match(/\d+(?:[.,]\d+)?\s*%/g) ?? [];
  return encontrados.map((s) => parseFloat(s.replace(',', '.').replace('%', '').trim()));
}

// Valida que la forma de pago traiga porcentajes y que sumen 100%. Devuelve un
// mensaje listo para mostrar al usuario cuando no cumple.
export function validarPorcentajesPago(texto: string | null | undefined): { ok: boolean; mensaje?: string } {
  const t = (texto ?? '').trim();
  const pcts = porcentajesFormaPago(t);
  if (pcts.length === 0) {
    return {
      ok: false,
      mensaje:
        'Antes de aprobar, captura la *forma de pago* con los porcentajes de anticipo y contra entrega (ej. "70% anticipo / 30% entrega").',
    };
  }
  const suma = Math.round(pcts.reduce((a, b) => a + b, 0) * 100) / 100;
  if (suma !== 100) {
    return {
      ok: false,
      mensaje: `Los porcentajes de la forma de pago deben sumar 100% — ahora suman ${suma}%. Ajústalos antes de aprobar.`,
    };
  }
  return { ok: true };
}
