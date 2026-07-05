import { createHmac, timingSafeEqual } from 'node:crypto';

// Enlaces públicos firmados para que el CLIENTE vea su cotización sin cuenta.
// Un token es `base64url(payload).firmaHMAC`, con payload `cotizacionId.expira`.
// La firma (HMAC-SHA256 con un secreto del servidor) evita que se falsifiquen o
// se adivinen; la expiración limita la ventana de acceso.

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

export function firmarEnlace(secreto: string, cotizacionId: string, ahora = Date.now()): string {
  const payload = `${cotizacionId}.${ahora + TTL_MS}`;
  const p = Buffer.from(payload).toString('base64url');
  const firma = createHmac('sha256', secreto).update(p).digest('base64url');
  return `${p}.${firma}`;
}

export function verificarEnlace(secreto: string, token: string, ahora = Date.now()): { cotizacionId: string } | null {
  const partes = String(token).split('.');
  if (partes.length !== 2) return null;
  const [p, firma] = partes;

  const esperada = createHmac('sha256', secreto).update(p).digest('base64url');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: string;
  try {
    payload = Buffer.from(p, 'base64url').toString();
  } catch {
    return null;
  }
  const [cotizacionId, expStr] = payload.split('.');
  const expira = Number(expStr);
  if (!cotizacionId || !Number.isFinite(expira) || ahora > expira) return null;
  return { cotizacionId };
}
