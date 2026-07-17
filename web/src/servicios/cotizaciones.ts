import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import type { EstatusCotizacion, Partida } from '../dominio/tipos';

// ---------- Tipos de los documentos en Firestore ----------

export interface CotizacionDoc {
  folio: string | null;
  clienteId: string;
  cliente: { nombre: string; atencion?: string | null; telefono?: string | null; correo?: string | null };
  titulo: string;
  estatus: EstatusCotizacion;
  revActual: string;
  versionActualId: string;
  total?: number; // denormalizado desde la versión vigente (para el Dashboard)
  subtotal?: number;
  iva?: number;
  fechaCreacion: Timestamp | null;
  fechaEnvio?: Timestamp | null;
}

export interface VersionDoc {
  rev: string;
  estatus: EstatusCotizacion;
  partidas: Partida[];
  subtotal: number;
  iva: number;
  total: number;
  formaPago: string;
  tiempoEntrega: string;
  notas?: string;
  fecha: Timestamp | null;
  pdfUrl?: string;
}

export interface MensajeChat {
  id: string;
  rol: 'usuario' | 'portteo';
  texto: string;
  fecha: Timestamp | null;
}

// ---------- Callables (escrituras: siempre vía backend) ----------

const callableCrear = httpsCallable<{ clienteNombre: string; titulo: string }, { cotizacionId: string; versionId: string }>(functions, 'crearCotizacion');
export interface PreviewCotizacion {
  cotizacionId: string;
  folio: string | null;
  titulo: string;
  cliente: { nombre: string; atencion?: string | null; telefono?: string | null; correo?: string | null };
  rev: string;
  fecha: string;
  partidas: unknown[];
  formaPago?: string | null;
  tiempoEntrega?: string | null;
  notas?: string | null;
}
const callablePortteo = httpsCallable<{ cotizacionId: string; mensaje: string; previewCotizacionId?: string }, { texto: string; cotizacionId: string | null; preview: PreviewCotizacion | null }>(functions, 'portteo');
const callablePortteoNuevo = httpsCallable<
  { historial: { rol: string; texto: string }[]; mensaje: string; previewCotizacionId?: string },
  { texto: string; cotizacionId: string | null; preview: PreviewCotizacion | null }
>(functions, 'portteoNuevo');
const callableAprobar = httpsCallable<{ cotizacionId: string }, { folio: string }>(functions, 'aprobar');
const callableCambiarEstatus = httpsCallable<{ cotizacionId: string; estatus: EstatusCotizacion }, { ok: boolean; estatus: string }>(functions, 'cambiarEstatus');
const callableCrearRevision = httpsCallable<{ cotizacionId: string }, { versionId: string; rev: string }>(functions, 'crearRevisionCallable');
const callableEnviarCliente = httpsCallable<
  { cotizacionId: string; telefonos?: string[]; telefono?: string },
  { ok: boolean; envios: { telefono: string; mensajeId: string }[] }
>(functions, 'enviarCotizacionCliente');
const callableEnviarCorreo = httpsCallable<
  { cotizacionId: string; correos: string[]; pdfBase64: string },
  { ok: boolean; enviados: string[] }
>(functions, 'enviarCotizacionCorreo');

export async function crearCotizacion(clienteNombre: string, titulo: string) {
  const res = await callableCrear({ clienteNombre, titulo });
  return res.data;
}

const callableEditarCampo = httpsCallable<
  { cotizacionId: string; campo: string; valor: string; partidaIndex?: number; lineaIndex?: number },
  { ok: boolean }
>(functions, 'editarCotizacionCampo');

// Guarda un campo editado directo en el documento (edición inline del taller).
export async function editarCampoCotizacion(
  cotizacionId: string,
  campo: string,
  valor: string,
  partidaIndex?: number,
  lineaIndex?: number
) {
  const res = await callableEditarCampo({ cotizacionId, campo, valor, partidaIndex, lineaIndex });
  return res.data;
}

export async function enviarMensajePortteo(cotizacionId: string, mensaje: string, previewCotizacionId?: string) {
  const res = await callablePortteo({ cotizacionId, mensaje, previewCotizacionId });
  return res.data;
}

// Chat de intake (sin cotización aún). Devuelve el texto y, si Portteo ya creó
// el borrador en este turno, el cotizacionId para navegar al taller.
export async function iniciarCotizacion(historial: { rol: string; texto: string }[], mensaje: string, previewCotizacionId?: string) {
  const res = await callablePortteoNuevo({ historial, mensaje, previewCotizacionId });
  return res.data;
}

export async function aprobarCotizacion(cotizacionId: string) {
  const res = await callableAprobar({ cotizacionId });
  return res.data;
}

export async function cambiarEstatus(cotizacionId: string, estatus: EstatusCotizacion) {
  return (await callableCambiarEstatus({ cotizacionId, estatus })).data;
}

export async function crearRevision(cotizacionId: string) {
  return (await callableCrearRevision({ cotizacionId })).data;
}

export async function enviarCotizacionCliente(cotizacionId: string, telefonos: string[]) {
  return (await callableEnviarCliente({ cotizacionId, telefonos })).data;
}

// Envía la cotización por correo con el PDF adjunto (el PDF se genera en el
// portal y viaja en base64).
export async function enviarCotizacionCorreo(cotizacionId: string, correos: string[], pdfBase64: string) {
  return (await callableEnviarCorreo({ cotizacionId, correos, pdfBase64 })).data;
}

// --- Configuración de correo (Configuración → Correo) ---
const cbEstadoCorreo = httpsCallable<Record<string, never>, { configurado: boolean; remitente: string }>(functions, 'estadoConfigCorreoCallable');
const cbGuardarCorreo = httpsCallable<{ remitente?: string; appPassword?: string }, { ok: boolean }>(functions, 'guardarConfigCorreoCallable');
const cbProbarCorreo = httpsCallable<{ para?: string }, { ok: boolean; para: string }>(functions, 'probarCorreoCallable');

export async function estadoConfigCorreo() {
  return (await cbEstadoCorreo({})).data;
}
export async function guardarConfigCorreo(datos: { remitente?: string; appPassword?: string }) {
  return (await cbGuardarCorreo(datos)).data;
}
export async function probarCorreo(para?: string) {
  return (await cbProbarCorreo({ para })).data;
}

// --- Configuración de Google Drive (Configuración → Drive) ---
const cbEstadoDrive = httpsCallable<Record<string, never>, { tieneCredenciales: boolean; conectado: boolean; folderNombre: string; folderId: string | null }>(functions, 'estadoConfigDriveCallable');
const cbGuardarDrive = httpsCallable<{ clientId?: string; clientSecret?: string; folderNombre?: string }, { ok: boolean }>(functions, 'guardarConfigDriveCallable');
const cbUrlConsentimiento = httpsCallable<Record<string, never>, { url: string }>(functions, 'driveUrlConsentimientoCallable');
const cbProbarDrive = httpsCallable<Record<string, never>, { ok: boolean; link: string }>(functions, 'probarDriveCallable');

export async function estadoConfigDrive() {
  return (await cbEstadoDrive({})).data;
}
export async function guardarConfigDrive(datos: { clientId?: string; clientSecret?: string; folderNombre?: string }) {
  return (await cbGuardarDrive(datos)).data;
}
export async function urlConsentimientoDrive() {
  return (await cbUrlConsentimiento({})).data;
}
export async function probarDrive() {
  return (await cbProbarDrive({})).data;
}

// --- Configuración de Telegram (Configuración → Telegram) ---
const cbEstadoTelegram = httpsCallable<Record<string, never>, { tieneToken: boolean; botUsername: string | null; webhookOk: boolean; webhookUrl: string | null; ultimoError: string | null }>(functions, 'estadoConfigTelegramCallable');
const cbGuardarTelegram = httpsCallable<{ botToken?: string }, { ok: boolean }>(functions, 'guardarConfigTelegramCallable');
const cbRegistrarWebhookTelegram = httpsCallable<Record<string, never>, { ok: boolean; botUsername: string | null }>(functions, 'registrarWebhookTelegramCallable');

export async function estadoConfigTelegram() {
  return (await cbEstadoTelegram({})).data;
}
export async function guardarConfigTelegram(datos: { botToken?: string }) {
  return (await cbGuardarTelegram(datos)).data;
}
export async function registrarWebhookTelegram() {
  return (await cbRegistrarWebhookTelegram({})).data;
}

// Estatus de entrega de un mensaje saliente de WhatsApp (en vivo):
// pendiente → enviado → entregado · sin_confirmar (WhatsApp no dio acuse) · error.
export type EstatusSaliente = 'pendiente' | 'enviado' | 'entregado' | 'sin_confirmar' | 'error';
export function suscribirSaliente(
  mensajeId: string,
  cb: (estatus: EstatusSaliente, error?: string | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'mensajes_salientes', mensajeId), (snap) => {
    if (!snap.exists()) return;
    cb((snap.get('estatus') as EstatusSaliente) ?? 'pendiente', snap.get('error') ?? null);
  });
}

// Cotizaciones enviadas sin cerrar (para seguimiento), más antiguas primero.
export function suscribirSeguimiento(
  cb: (items: ({ id: string } & CotizacionDoc)[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'cotizaciones'),
    where('estatus', '==', 'enviada'),
    orderBy('fechaEnvio', 'asc'),
    limit(100)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as CotizacionDoc) })));
  });
}

// Panel/Dashboard: trae una ventana amplia de cotizaciones (recientes primero)
// para calcular métricas en el cliente. El negocio es chico, 500 basta de sobra.
export function suscribirPanel(
  cb: (items: ({ id: string } & CotizacionDoc)[]) => void
): Unsubscribe {
  const q = query(collection(db, 'cotizaciones'), orderBy('fechaCreacion', 'desc'), limit(500));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as CotizacionDoc) })));
  });
}

// ---------- Suscripciones en vivo (lecturas permitidas por reglas) ----------

export function suscribirCotizacion(
  cotizacionId: string,
  cb: (c: CotizacionDoc | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'cotizaciones', cotizacionId), (snap) => {
    cb(snap.exists() ? (snap.data() as CotizacionDoc) : null);
  });
}

export function suscribirVersion(
  cotizacionId: string,
  versionId: string,
  cb: (v: VersionDoc | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'cotizaciones', cotizacionId, 'versiones', versionId), (snap) => {
    cb(snap.exists() ? (snap.data() as VersionDoc) : null);
  });
}

// Todas las revisiones de una cotización (para ver versiones anteriores),
// ordenadas por revisión (A, B, C…). Cada una trae su contenido completo.
export function suscribirVersiones(
  cotizacionId: string,
  cb: (items: ({ id: string } & VersionDoc)[]) => void
): Unsubscribe {
  return onSnapshot(collection(db, 'cotizaciones', cotizacionId, 'versiones'), (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as VersionDoc) }));
    items.sort((a, b) => (a.rev ?? '').localeCompare(b.rev ?? ''));
    cb(items);
  });
}

export function suscribirChat(
  cotizacionId: string,
  cb: (mensajes: MensajeChat[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'cotizaciones', cotizacionId, 'chat'),
    orderBy('fecha', 'asc'),
    limit(100)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MensajeChat, 'id'>) })));
  });
}

// Listado de cotizaciones (más recientes primero), limitado a `limite` para no
// traer todo el histórico de golpe. El "cargar más" crece el límite.
export function suscribirListado(
  limite: number,
  cb: (items: ({ id: string } & CotizacionDoc)[]) => void
): Unsubscribe {
  const q = query(collection(db, 'cotizaciones'), orderBy('fechaCreacion', 'desc'), limit(limite));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as CotizacionDoc) })));
  });
}
