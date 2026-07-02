import { round2 } from './totales';

// Espejo de functions/src/dominio/importeConLetra.ts — mantener en sincronía.
// "Importe con letra" del PDF: número → texto en español, pesos M.N.
// Formato oficial: SON: (DIECINUEVE MIL SESENTA Y SEIS PESOS 92/100 M.N.)

const UNIDADES = [
  'CERO', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
  'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO',
  'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
];

const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];

const CENTENAS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
];

function apocopar(texto: string): string {
  if (texto === 'UNO') return 'UN';
  if (texto === 'VEINTIUNO') return 'VEINTIÚN';
  if (texto.endsWith(' UNO')) return texto.slice(0, -4) + ' UN';
  if (texto.endsWith(' VEINTIUNO')) return texto.slice(0, -10) + ' VEINTIÚN';
  return texto;
}

function menorAMil(n: number): string {
  if (n < 30) return UNIDADES[n];
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return DECENAS[d] + (u ? ' Y ' + UNIDADES[u] : '');
  }
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  return CENTENAS[c] + (resto ? ' ' + menorAMil(resto) : '');
}

export function numeroALetra(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) {
    throw new Error(`Número fuera de rango para letra: ${n}`);
  }
  if (n === 0) return 'CERO';

  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const partes: string[] = [];
  if (millones) {
    partes.push(millones === 1 ? 'UN MILLÓN' : apocopar(menorAMil(millones)) + ' MILLONES');
  }
  if (miles) {
    partes.push(miles === 1 ? 'MIL' : apocopar(menorAMil(miles)) + ' MIL');
  }
  if (resto) {
    partes.push(menorAMil(resto));
  }
  return partes.join(' ');
}

export function importeConLetra(total: number): string {
  const totalR = round2(total);
  let entero = Math.floor(totalR);
  let centavos = Math.round((totalR - entero) * 100);
  if (centavos === 100) {
    entero += 1;
    centavos = 0;
  }

  const letra = apocopar(numeroALetra(entero));
  const sustantivo = entero === 1 ? 'PESO' : 'PESOS';
  const de = entero > 0 && entero % 1_000_000 === 0 ? ' DE' : '';
  const cc = String(centavos).padStart(2, '0');
  return `SON: (${letra}${de} ${sustantivo} ${cc}/100 M.N.)`;
}
