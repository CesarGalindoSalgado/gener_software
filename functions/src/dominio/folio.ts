// Folio GPC-MMYY-NNN: MM/YY del mes de aprobación, NNN consecutivo anual.
// El consecutivo vive en counters/folio_{anio} y se incrementa en transacción
// (ver servicios/aprobar.ts). Aquí solo la lógica pura.

export const ZONA_NEGOCIO = 'America/Mexico_City'; // Morelos

// Año y mes en la zona del negocio: una aprobación del 31/dic a las 6pm en
// Morelos NO debe tomar el año/mes del reloj UTC del servidor.
export function partesFechaNegocio(
  fecha: Date,
  zona: string = ZONA_NEGOCIO
): { anio: number; mes: number } {
  const partes = new Intl.DateTimeFormat('es-MX', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(fecha);
  const anio = Number(partes.find((p) => p.type === 'year')?.value);
  const mes = Number(partes.find((p) => p.type === 'month')?.value);
  return { anio, mes };
}

export function formatearFolio(anio: number, mes: number, consecutivo: number): string {
  const mm = String(mes).padStart(2, '0');
  const yy = String(anio % 100).padStart(2, '0');
  const nnn = String(consecutivo).padStart(3, '0');
  return `GPC-${mm}${yy}-${nnn}`;
}

export function nombreContador(anio: number): string {
  return `folio_${anio}`;
}

// Rev. A → B → … → Z → AA (el caso multi-letra es teórico, pero no truena).
export function siguienteRev(rev: string): string {
  const letras = rev.toUpperCase().split('');
  for (let i = letras.length - 1; i >= 0; i--) {
    if (letras[i] !== 'Z') {
      letras[i] = String.fromCharCode(letras[i].charCodeAt(0) + 1);
      return letras.join('');
    }
    letras[i] = 'A';
  }
  return 'A' + letras.join('');
}

// Para derivar la semilla del contador desde el corpus importado:
// extrae {anio (4 dígitos asumiendo 20YY), consecutivo} de un folio válido.
export function parsearFolio(folio: string): { anio: number; mes: number; consecutivo: number } | null {
  const m = /^GPC-(\d{2})(\d{2})-(\d{3})$/.exec(folio.trim().toUpperCase());
  if (!m) return null;
  return { mes: Number(m[1]), anio: 2000 + Number(m[2]), consecutivo: Number(m[3]) };
}
