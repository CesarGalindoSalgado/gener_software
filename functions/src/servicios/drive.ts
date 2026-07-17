import { Firestore } from 'firebase-admin/firestore';
import { BASE_FUNCIONES } from '../dominio/entorno';

// Integración con Google Drive por OAuth (cuenta personal de Gmail). Usamos el
// scope drive.file: la app solo ve/edita los archivos que ELLA crea, así que no
// requiere verificación de Google ni tokens que caduquen. La carpeta destino la
// CREA la app (para poder subir dentro sin permisos extra). Credenciales y token
// viven en config/drive (bloqueado para clientes; solo el Admin SDK lo lee).

const REDIRECT_URI = `${BASE_FUNCIONES}/driveOAuthCallback`;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface ConfigDrive {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  folderId?: string;
  folderNombre?: string;
}

export async function leerConfigDrive(db: Firestore): Promise<ConfigDrive> {
  const snap = await db.doc('config/drive').get();
  return (snap.data() ?? {}) as ConfigDrive;
}

export async function guardarConfigDrive(db: Firestore, datos: Partial<ConfigDrive>): Promise<void> {
  const upd: Record<string, unknown> = {};
  if (datos.clientId !== undefined) upd.clientId = datos.clientId.trim();
  if (datos.clientSecret !== undefined) upd.clientSecret = datos.clientSecret.trim();
  if (datos.folderNombre !== undefined) upd.folderNombre = datos.folderNombre.trim() || 'G-ener Documentos';
  if (datos.refreshToken !== undefined) upd.refreshToken = datos.refreshToken;
  if (datos.folderId !== undefined) upd.folderId = datos.folderId;
  if (Object.keys(upd).length) await db.doc('config/drive').set(upd, { merge: true });
}

// ¿Cómo está la configuración? (sin exponer secretos ni token).
export async function estadoConfigDrive(
  db: Firestore
): Promise<{ tieneCredenciales: boolean; conectado: boolean; folderNombre: string; folderId: string | null }> {
  const cfg = await leerConfigDrive(db);
  return {
    tieneCredenciales: !!(cfg.clientId && cfg.clientSecret),
    conectado: !!cfg.refreshToken,
    folderNombre: cfg.folderNombre || 'G-ener Documentos',
    folderId: cfg.folderId || null,
  };
}

// URL de consentimiento de Google (a donde se manda al usuario para "Conectar Drive").
export function urlConsentimientoDrive(clientId: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // para recibir refresh_token
    prompt: 'consent', // fuerza el refresh_token aunque ya haya consentido antes
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

// Cambia el "code" de la redirección por un refresh_token de larga vida.
export async function intercambiarCodigoDrive(clientId: string, clientSecret: string, code: string): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });
  const j = (await r.json()) as { refresh_token?: string; error?: string; error_description?: string };
  if (!j.refresh_token) {
    throw new Error(`Google no devolvió refresh_token (${j.error_description || j.error || 'sin detalle'}).`);
  }
  return j.refresh_token;
}

async function accessToken(cfg: ConfigDrive): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId!,
      client_secret: cfg.clientSecret!,
      refresh_token: cfg.refreshToken!,
      grant_type: 'refresh_token',
    }),
  });
  const j = (await r.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!j.access_token) {
    throw new Error(`No se pudo renovar el acceso a Drive (${j.error_description || j.error || 'sin detalle'}). Reconecta en Configuración → Drive.`);
  }
  return j.access_token;
}

// Asegura la carpeta destino (la crea la 1ª vez y guarda su id).
export async function asegurarCarpeta(db: Firestore, cfg: ConfigDrive): Promise<string> {
  if (cfg.folderId) return cfg.folderId;
  const token = await accessToken(cfg);
  const nombre = cfg.folderNombre || 'G-ener Documentos';
  const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const j = (await r.json()) as { id?: string };
  if (!j.id) throw new Error('No se pudo crear la carpeta en Drive.');
  await guardarConfigDrive(db, { folderId: j.id });
  return j.id;
}

// Sube un archivo (PDF u otro) a la carpeta de Drive. Devuelve id y enlace.
export async function subirADrive(
  db: Firestore,
  params: { nombre: string; contenido: Buffer; mimeType: string }
): Promise<{ id: string; link: string }> {
  const cfg = await leerConfigDrive(db);
  if (!cfg.refreshToken) throw new Error('Drive no está conectado. Ve a Configuración → Drive.');
  const folderId = await asegurarCarpeta(db, cfg);
  const token = await accessToken(cfg);

  const meta = { name: params.nombre, parents: [folderId] };
  const boundary = `gener-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`),
    params.contenido,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const j = (await r.json()) as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!j.id) throw new Error(`No se pudo subir a Drive: ${j.error?.message || 'error desconocido'}.`);
  return { id: j.id, link: j.webViewLink || `https://drive.google.com/file/d/${j.id}/view` };
}
