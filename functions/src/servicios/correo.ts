import * as nodemailer from 'nodemailer';
import { Firestore } from 'firebase-admin/firestore';

// Envío de correo por Gmail SMTP (cuenta de la empresa). La contraseña es una
// "contraseña de aplicación" de Google (no la normal). Se captura desde el portal
// (Configuración → Correo) y se guarda en config/correo — así no hace falta la
// terminal. El acceso a ese doc está bloqueado para los clientes (reglas); solo
// el Admin SDK (estas funciones) lo lee.
const REMITENTE_DEFECTO = 'generpowercontrol@gmail.com';

export interface ConfigCorreo {
  remitente: string;
  appPassword: string;
}

export async function leerConfigCorreo(db: Firestore): Promise<ConfigCorreo> {
  const snap = await db.doc('config/correo').get();
  const d = snap.data() ?? {};
  const remitente = ((d.remitente as string) || REMITENTE_DEFECTO).trim();
  // Fallback al secreto de entorno si alguna vez se configuró por ahí.
  const appPassword = (((d.appPassword as string) ?? '') || (process.env.GMAIL_APP_PASSWORD ?? '')).replace(/\s+/g, '');
  return { remitente, appPassword };
}

// ¿Ya está configurado el correo? (sin exponer la contraseña).
export async function estadoConfigCorreo(db: Firestore): Promise<{ configurado: boolean; remitente: string }> {
  const cfg = await leerConfigCorreo(db);
  return { configurado: !!cfg.appPassword, remitente: cfg.remitente };
}

export async function guardarConfigCorreo(
  db: Firestore,
  datos: { remitente?: string; appPassword?: string }
): Promise<void> {
  const upd: Record<string, unknown> = {};
  if (datos.remitente !== undefined) upd.remitente = datos.remitente.trim() || REMITENTE_DEFECTO;
  // Solo se pisa la contraseña si mandan una nueva (el portal la deja vacía para "no cambiar").
  if (datos.appPassword) upd.appPassword = datos.appPassword.replace(/\s+/g, '');
  if (Object.keys(upd).length) await db.doc('config/correo').set(upd, { merge: true });
}

function transportador(cfg: ConfigCorreo) {
  if (!cfg.appPassword) {
    throw new Error('Falta configurar el correo: captura la contraseña de aplicación de Gmail en Configuración → Correo.');
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: cfg.remitente, pass: cfg.appPassword },
  });
}

// Envía un correo con el PDF adjunto (el PDF llega en base64 desde el portal, que
// ya lo genera para la descarga; así no duplicamos el render en el servidor).
export async function enviarCorreoConAdjuntoPdf(
  cfg: ConfigCorreo,
  params: { para: string[]; asunto: string; cuerpo: string; pdfBase64: string; nombreArchivo: string }
): Promise<void> {
  const t = transportador(cfg);
  await t.sendMail({
    from: `Gener Power & Control <${cfg.remitente}>`,
    to: params.para.join(', '),
    subject: params.asunto,
    text: params.cuerpo,
    attachments: [
      { filename: params.nombreArchivo, content: Buffer.from(params.pdfBase64, 'base64'), contentType: 'application/pdf' },
    ],
  });
}

// Correo simple (sin adjunto) para probar la configuración.
export async function enviarCorreoPrueba(cfg: ConfigCorreo, para: string): Promise<void> {
  const t = transportador(cfg);
  await t.sendMail({
    from: `Gener Power & Control <${cfg.remitente}>`,
    to: para,
    subject: 'Prueba de configuración de correo — Gener Power & Control',
    text: 'Este es un correo de prueba. Si lo recibes, la configuración de correo del portal quedó lista. ✅',
  });
}
