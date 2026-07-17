<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Plus, Trash2, MessageSquare, Send, LoaderCircle, FileDown, GitBranch, MessageCircle, Mail, ZoomIn, ZoomOut } from 'lucide-vue-next';
import html2pdf from 'html2pdf.js';
import DocumentoCotizacion from '../components/DocumentoCotizacion.vue';
import { confirmar } from '../components/confirmar';
import { suscribirUsuarios } from '../servicios/usuarios';
import { suscribirClientes, type ClienteDoc } from '../servicios/rutinas';
import type { BorradorCotizacion } from '../dominio/tipos';
import { ROLES_ADMIN } from '../dominio/tipos';
import { sesion } from '../sesion';
import {
  crearRevision,
  enviarCotizacionCliente,
  enviarCotizacionCorreo,
  editarCampoCotizacion,
  enviarMensajePortteo,
  iniciarCotizacion,
  type PreviewCotizacion,
  suscribirSaliente,
  type EstatusSaliente,
  suscribirChat,
  suscribirCotizacion,
  suscribirVersion,
  suscribirVersiones,
  type CotizacionDoc,
  type MensajeChat,
  type VersionDoc,
} from '../servicios/cotizaciones';

const route = useRoute();
const router = useRouter();

// Regresar a la lista: confirma antes de salir para no perder el trabajo.
async function volver() {
  if (!(await confirmar({
    titulo: '¿Salir del taller?',
    mensaje: 'Regresarás a la lista de cotizaciones.',
    confirmar: 'Aceptar',
    cancelar: 'Cancelar',
  }))) return;
  router.push({ name: 'cotizaciones' });
}
const cotizacionId = computed(() => (route.params.id as string | undefined) ?? null);
const esAdmin = computed(() => ROLES_ADMIN.includes(sesion.usuario?.rol ?? 'trabajador'));

// ================= MODO EN VIVO (con :id — Firestore + chat) =================

const cot = ref<CotizacionDoc | null>(null);
const ver = ref<VersionDoc | null>(null);
const versiones = ref<({ id: string } & VersionDoc)[]>([]);
// Revisión que se está VISUALIZANDO. null = la actual (editable). Un id de una
// revisión anterior = solo lectura (histórica).
const revVerId = ref<string | null>(null);
const chat = ref<MensajeChat[]>([]);
const mensaje = ref('');
const enviando = ref(false);
const error = ref('');
const chatBox = ref<HTMLElement | null>(null);

let offCot: (() => void) | null = null;
let offVer: (() => void) | null = null;
let offChat: (() => void) | null = null;
let offVers: (() => void) | null = null;

function limpiarSubs() {
  offCot?.(); offVer?.(); offChat?.(); offVers?.();
  offCot = offVer = offChat = offVers = null;
}

watch(
  cotizacionId,
  (id) => {
    limpiarSubs();
    cot.value = null; ver.value = null; chat.value = []; versiones.value = []; revVerId.value = null;
    if (!id) return;
    offCot = suscribirCotizacion(id, (c) => {
      const versionAnterior = cot.value?.versionActualId;
      cot.value = c;
      if (c && c.versionActualId && c.versionActualId !== versionAnterior) {
        offVer?.();
        offVer = suscribirVersion(id, c.versionActualId, (v) => (ver.value = v));
      }
    });
    offVers = suscribirVersiones(id, (l) => (versiones.value = l));
    offChat = suscribirChat(id, async (msgs) => {
      chat.value = msgs;
      await nextTick();
      chatBox.value?.scrollTo({ top: chatBox.value.scrollHeight, behavior: 'smooth' });
    });
  },
  { immediate: true }
);
onUnmounted(limpiarSubs);

// ¿Estamos viendo una revisión histórica (no la actual)?
const esHistorica = computed(() => !!revVerId.value && revVerId.value !== cot.value?.versionActualId);
// La versión que se muestra: la histórica seleccionada, o la actual en vivo.
const verMostrada = computed<VersionDoc | null>(() =>
  esHistorica.value ? (versiones.value.find((v) => v.id === revVerId.value) ?? null) : ver.value
);

const borradorVivo = computed<BorradorCotizacion | null>(() => {
  const v = verMostrada.value;
  if (!cot.value || !v) return null;
  return {
    cliente: {
      nombre: cot.value.cliente?.nombre ?? '',
      atencion: cot.value.cliente?.atencion ?? undefined,
      telefono: cot.value.cliente?.telefono ?? undefined,
      correo: cot.value.cliente?.correo ?? undefined,
    },
    asunto: cot.value.titulo,
    folio: cot.value.folio,
    rev: v.rev,
    fecha: (v.fecha?.toDate() ?? new Date()).toISOString(),
    partidas: v.partidas ?? [],
    formaPago: v.formaPago,
    tiempoEntrega: v.tiempoEntrega,
    notas: v.notas ?? '',
  };
});

// Edición inline en el documento: solo borradores y en la versión actual (no
// en revisiones históricas ni en cotizaciones ya enviadas/autorizadas).
const puedeEditar = computed(() => cot.value?.estatus === 'borrador' && !esHistorica.value);

// Etiqueta amigable del estatus para el indicador de la barra superior. La
// aprobación se hace desde el chat con Portteo (ya no hay botón).
const ESTATUS_LABEL: Record<string, string> = {
  borrador: 'En edición',
  enviada: 'Aprobada',
  autorizada: 'Autorizada',
  realizada: 'Realizada',
  rechazada: 'Rechazada',
  importada: 'Importada',
};
const estatusTexto = computed(() => (cot.value ? ESTATUS_LABEL[cot.value.estatus] ?? cot.value.estatus : ''));
async function guardarEdicion(p: { campo: string; valor: string; partidaIndex?: number; lineaIndex?: number }) {
  if (!cotizacionId.value) return;
  try {
    await editarCampoCotizacion(cotizacionId.value, p.campo, p.valor, p.partidaIndex, p.lineaIndex);
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo guardar el cambio.';
  }
}

// Modo intake: aún no hay cotización. El chat vive local hasta que Portteo
// junta cliente/asunto/dirigida a y crea el borrador.
const esNuevo = computed(() => !cotizacionId.value);
const chatNuevo = ref<{ rol: 'usuario' | 'portteo'; texto: string }[]>([]);
// Hilo unificado para el template: intake local o chat vivo de Firestore.
const hilo = computed<{ rol: 'usuario' | 'portteo'; texto: string }[]>(() =>
  esNuevo.value ? chatNuevo.value : chat.value.map((m) => ({ rol: m.rol, texto: m.texto }))
);

// Vista PREVIA (solo lectura, sin guardar) de una cotización que Portteo mostró.
const preview = ref<PreviewCotizacion | null>(null);
const previewBorrador = computed<BorradorCotizacion | null>(() => {
  const p = preview.value;
  if (!p) return null;
  return {
    cliente: {
      nombre: p.cliente.nombre,
      atencion: p.cliente.atencion ?? undefined,
      telefono: p.cliente.telefono ?? undefined,
      correo: p.cliente.correo ?? undefined,
    },
    asunto: p.titulo,
    folio: p.folio,
    rev: p.rev,
    fecha: p.fecha,
    partidas: (p.partidas ?? []) as BorradorCotizacion['partidas'],
    formaPago: p.formaPago ?? '',
    tiempoEntrega: p.tiempoEntrega ?? '',
    notas: p.notas ?? '',
  };
});
async function enviar() {
  const texto = mensaje.value.trim();
  if (!texto || enviando.value) return;
  mensaje.value = '';
  error.value = '';
  enviando.value = true;
  try {
    if (esNuevo.value) {
      const historial = chatNuevo.value.map((m) => ({ rol: m.rol, texto: m.texto }));
      chatNuevo.value.push({ rol: 'usuario', texto });
      await nextTick();
      chatBox.value?.scrollTo({ top: chatBox.value.scrollHeight, behavior: 'smooth' });
      const res = await iniciarCotizacion(historial, texto, preview.value?.cotizacionId);
      preview.value = res.preview ?? null;
      if (res.cotizacionId) {
        // Ya se creó (clonó/confirmó): el taller cambia a modo vivo.
        preview.value = null;
        router.replace({ name: 'taller', params: { id: res.cotizacionId } });
      } else {
        chatNuevo.value.push({ rol: 'portteo', texto: res.texto });
      }
    } else {
      const res = await enviarMensajePortteo(cotizacionId.value!, texto, preview.value?.cotizacionId);
      preview.value = res?.preview ?? null;
      // Si Portteo clonó/abrió otra cotización, navegamos a esa copia editable.
      if (res?.cotizacionId && res.cotizacionId !== cotizacionId.value) {
        preview.value = null;
        router.replace({ name: 'taller', params: { id: res.cotizacionId } });
      }
    }
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'Error al hablar con Portteo.';
  } finally {
    enviando.value = false;
  }
}

const docRef = ref<HTMLElement | null>(null);
const generandoPdf = ref(false);

function nombrePdf(): string {
  const folio = cot.value?.folio || borradorVivo.value?.cliente?.nombre || 'cotizacion';
  return `Cotizacion ${folio}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
}

// Construye un html2pdf worker sobre un CLON aislado del documento. En pantalla el
// documento está escalado (transform) y dentro de un contenedor con overflow:hidden
// más angosto que la hoja; capturarlo así corta el PDF a la derecha. El clon, a
// 800px sin transform ni recortes, garantiza la hoja completa. Devuelve el worker y
// una función de limpieza (quitar el clon del DOM).
async function construirPdf() {
  const el = docRef.value!;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;background:#ffffff;z-index:-1;';
  const clon = el.cloneNode(true) as HTMLElement;
  clon.style.transform = 'none';
  clon.style.width = `${PAGINA_PX}px`;
  holder.appendChild(clon);
  document.body.appendChild(holder);
  await nextTick();
  const worker = html2pdf()
    .set({
      margin: 8,
      filename: nombrePdf(),
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', width: PAGINA_PX, windowWidth: PAGINA_PX },
      jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
    })
    .from(clon);
  return { worker, limpiar: () => document.body.removeChild(holder) };
}

async function descargarPdf() {
  if (!docRef.value || generandoPdf.value) return;
  generandoPdf.value = true;
  error.value = '';
  const { worker, limpiar } = await construirPdf();
  try {
    await worker.save();
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo generar el PDF.';
  } finally {
    limpiar();
    generandoPdf.value = false;
  }
}

// Genera el PDF y lo devuelve en base64 (sin el prefijo data:) para adjuntarlo al correo.
async function pdfEnBase64(): Promise<string> {
  const { worker, limpiar } = await construirPdf();
  try {
    // .outputPdf('blob') devuelve el PDF como Blob (los tipos de html2pdf no lo
    // declaran, por eso el cast).
    const blob = (await (worker as unknown as { outputPdf: (t: string) => Promise<Blob> }).outputPdf('blob'));
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } finally {
    limpiar();
  }
}

// --- Ajuste a ancho: el documento tiene ancho FIJO (800px = hoja) y lo escalamos
// como bloque para que quepa en el panel sin reacomodar el texto (igual que el PDF).
const PAGINA_PX = 800;
const docViewport = ref<HTMLElement | null>(null);
const docScale = ref(1);
const fitAltura = ref<string>('auto');
const fitAncho = ref<string>('800px');
// zoomManual: null = "Ajustar al ancho" (auto). Un número = escala fija del usuario.
const zoomManual = ref<number | null>(null);
const porcentajeZoom = computed(() => Math.round(docScale.value * 100));
function recomputeFit() {
  const vp = docViewport.value;
  const inner = docRef.value;
  if (!vp || !inner) return;
  const cs = getComputedStyle(vp);
  const padX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
  const disp = Math.max(0, vp.clientWidth - padX);
  const ajuste = Math.min(1, disp / PAGINA_PX); // escala que encaja al ancho
  const s = zoomManual.value ?? ajuste;
  docScale.value = s;
  fitAncho.value = PAGINA_PX * s + 'px'; // el bloque ocupa su tamaño escalado (permite scroll)
  fitAltura.value = inner.offsetHeight * s + 'px'; // offsetHeight = alto natural (sin transform)
  // ¿El documento desborda el panel? → activa la manita para desplazarse.
  nextTick(() => {
    const v = docViewport.value;
    if (v) hayDesborde.value = v.scrollWidth > v.clientWidth + 1 || v.scrollHeight > v.clientHeight + 1;
  });
}
function fijarZoom(v: number | null) {
  zoomManual.value = v;
  nextTick(recomputeFit);
}
function acercar() { fijarZoom(Math.min(3, +(( zoomManual.value ?? docScale.value) + 0.1).toFixed(2))); }
function alejar() { fijarZoom(Math.max(0.25, +(( zoomManual.value ?? docScale.value) - 0.1).toFixed(2))); }
function ajustarZoom() { fijarZoom(null); } // vuelve al ajuste automático al ancho

// Herramienta "manita": arrastrar para desplazarse por el documento cuando está
// ampliado y desborda el panel (como en un lector de PDF).
const arrastrando = ref(false);
const hayDesborde = ref(false);
let panIni = { x: 0, y: 0, sl: 0, st: 0 };
function panDown(e: MouseEvent) {
  const vp = docViewport.value;
  if (!vp || !hayDesborde.value) return;
  // No arrastrar si el clic es sobre un botón o un campo editable: dejar que
  // reciba el foco para editar (si no, preventDefault impide editar el texto).
  if ((e.target as HTMLElement).closest('button, [contenteditable="true"]')) return;
  arrastrando.value = true;
  panIni = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
  e.preventDefault();
}
function panMove(e: MouseEvent) {
  if (!arrastrando.value || !docViewport.value) return;
  docViewport.value.scrollLeft = panIni.sl - (e.clientX - panIni.x);
  docViewport.value.scrollTop = panIni.st - (e.clientY - panIni.y);
}
function panUp() {
  arrastrando.value = false;
}
let roFit: ResizeObserver | null = null;
onMounted(() => {
  roFit = new ResizeObserver(() => recomputeFit());
  if (docViewport.value) roFit.observe(docViewport.value);
  if (docRef.value) roFit.observe(docRef.value); // recalcula alto cuando cambia el contenido
  nextTick(recomputeFit);
  window.addEventListener('mousemove', panMove);
  window.addEventListener('mouseup', panUp);
});
onUnmounted(() => {
  roFit?.disconnect();
  window.removeEventListener('mousemove', panMove);
  window.removeEventListener('mouseup', panUp);
});
// Recalcula al cambiar el documento (partidas, cliente, etc.).
watch(() => borradorVivo.value, () => nextTick(recomputeFit), { deep: true });
watch(() => previewBorrador.value, () => nextTick(recomputeFit), { deep: true });

const puedeRevisar = computed(
  () => cot.value && (cot.value.estatus === 'enviada' || cot.value.estatus === 'rechazada')
);
const revisando = ref(false);
async function nuevaRevision() {
  if (!cotizacionId.value || revisando.value) return;
  if (!(await confirmar({
    titulo: 'Nueva revisión',
    mensaje: 'Se copia el contenido a una versión nueva (mismo folio) y vuelve a borrador para editar.',
    confirmar: 'Crear revisión',
  }))) return;
  revisando.value = true;
  error.value = '';
  try {
    await crearRevision(cotizacionId.value);
    // El documento y el estatus se actualizan solos por los listeners.
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo crear la revisión.';
  } finally {
    revisando.value = false;
  }
}

// Diálogo post-aprobación: enviar al cliente por WhatsApp o por correo (o solo descargar).
const mostrarEnvio = ref(false);
const folioAprobado = ref('');
const enviandoCliente = ref(false);
const envioOk = ref(false);
const modoEnvio = ref<'whatsapp' | 'correo'>('whatsapp');

// Un destinatario posible: nombre + puesto, con teléfono y/o correo. Origen indica
// si viene del CLIENTE (sus contactos) o de MI EQUIPO (usuarios).
interface Destinatario {
  nombre: string;
  puesto?: string;
  telefono?: string;
  correo?: string;
  origen: 'cliente' | 'equipo';
}

// Fuentes: contactos del cliente (directorio) + usuarios del equipo (solo admin
// lee usuarios; y solo admin aprueba/envía).
const usuariosTodos = ref<Destinatario[]>([]);
const clientesTodos = ref<ClienteDoc[]>([]);
const offTels: (() => void)[] = [suscribirClientes((l) => (clientesTodos.value = l))];
if (esAdmin.value) {
  offTels.push(
    suscribirUsuarios((l) =>
      (usuariosTodos.value = l.map((u) => ({
        nombre: u.nombre || u.correo,
        telefono: u.telefono ? String(u.telefono) : undefined,
        correo: u.correo || undefined,
        origen: 'equipo' as const,
      })))
    )
  );
}
onUnmounted(() => offTels.forEach((o) => o()));

// Destinatarios del cliente = sus contactos (encargado, compras…) + datos sueltos.
const contactosCliente = computed<Destinatario[]>(() => {
  const c = clientesTodos.value.find((x) => x.id === cot.value?.clienteId);
  const out: Destinatario[] = [];
  const cli = cot.value?.cliente;
  if (cli?.telefono || cli?.correo) {
    out.push({ nombre: cli.atencion || cli.nombre || 'Cliente', telefono: cli.telefono ?? undefined, correo: cli.correo ?? undefined, origen: 'cliente' });
  }
  (c?.contactos ?? []).forEach((ct) =>
    out.push({ nombre: ct.nombre || '(sin nombre)', puesto: ct.puesto ?? undefined, telefono: ct.telefono ?? undefined, correo: ct.correo ?? undefined, origen: 'cliente' })
  );
  (c?.telefonos ?? []).forEach((t) => {
    if (!out.some((o) => o.telefono === t)) out.push({ nombre: 'Teléfono del cliente', telefono: t, origen: 'cliente' });
  });
  return out;
});
const contactosEquipo = computed<Destinatario[]>(() => usuariosTodos.value);

// Candidatos por canal: los que tienen teléfono (WhatsApp) o correo (correo).
const waCliente = computed(() => contactosCliente.value.filter((d) => d.telefono));
const waEquipo = computed(() => contactosEquipo.value.filter((d) => d.telefono));
const mailCliente = computed(() => contactosCliente.value.filter((d) => d.correo));
const mailEquipo = computed(() => contactosEquipo.value.filter((d) => d.correo));

// Selección MÚLTIPLE por canal.
const telsSel = ref<string[]>([]);
const telOtro = ref('');
function alternarTel(t: string) {
  telsSel.value = telsSel.value.includes(t) ? telsSel.value.filter((x) => x !== t) : [...telsSel.value, t];
}
function agregarOtro() {
  const t = telOtro.value.trim();
  if (t && !telsSel.value.includes(t)) telsSel.value.push(t);
  telOtro.value = '';
}
const correosSel = ref<string[]>([]);
const correoOtro = ref('');
function alternarCorreo(c: string) {
  correosSel.value = correosSel.value.includes(c) ? correosSel.value.filter((x) => x !== c) : [...correosSel.value, c];
}
function agregarOtroCorreo() {
  const c = correoOtro.value.trim();
  if (c && !correosSel.value.includes(c)) correosSel.value.push(c);
  correoOtro.value = '';
}

// Al abrir el diálogo, preselecciona el primer teléfono/correo del cliente si existe.
watch(mostrarEnvio, (abierto) => {
  if (abierto) {
    modoEnvio.value = 'whatsapp';
    telsSel.value = waCliente.value[0]?.telefono ? [waCliente.value[0].telefono!] : [];
    correosSel.value = mailCliente.value[0]?.correo ? [mailCliente.value[0].correo!] : [];
    telOtro.value = '';
    correoOtro.value = '';
    estatusEnvios.value = [];
    correoOk.value = false;
  }
});

// La aprobación se hace desde el chat con Portteo. Aquí solo abrimos el diálogo
// para ENVIAR al cliente una cotización ya aprobada (con folio).
function abrirEnvio() {
  if (!cot.value?.folio) return;
  folioAprobado.value = cot.value.folio;
  envioOk.value = false;
  mostrarEnvio.value = true;
}

// Estatus de entrega en vivo POR DESTINATARIO (acuse real de WhatsApp).
const estatusEnvios = ref<{ telefono: string; estatus: EstatusSaliente; error?: string | null }[]>([]);
let offSalientes: (() => void)[] = [];
onUnmounted(() => offSalientes.forEach((o) => o()));

async function enviarAlCliente() {
  if (!cotizacionId.value || enviandoCliente.value) return;
  // Incluye lo tecleado en "otro número" aunque no le hayan dado Agregar.
  const lista = [...telsSel.value];
  const pendiente = telOtro.value.trim();
  if (pendiente && !lista.includes(pendiente)) lista.push(pendiente);
  if (!lista.length) {
    error.value = 'Elige o escribe al menos un número de WhatsApp.';
    return;
  }
  enviandoCliente.value = true;
  error.value = '';
  try {
    const res = await enviarCotizacionCliente(cotizacionId.value, lista);
    envioOk.value = true;
    // Sigue el acuse de cada destinatario: enviado → entregado / sin_confirmar.
    offSalientes.forEach((o) => o());
    offSalientes = [];
    estatusEnvios.value = res.envios.map((e) => ({ telefono: e.telefono, estatus: 'pendiente' as EstatusSaliente }));
    for (const e of res.envios) {
      offSalientes.push(
        suscribirSaliente(e.mensajeId, (st, err) => {
          const item = estatusEnvios.value.find((x) => x.telefono === e.telefono);
          if (item) {
            item.estatus = st;
            item.error = err ?? null;
          }
        })
      );
    }
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo enviar al cliente.';
  } finally {
    enviandoCliente.value = false;
  }
}

// Envío por CORREO: genera el PDF en el navegador, lo manda en base64 al backend,
// que lo adjunta y lo envía por Gmail de la empresa.
const enviandoCorreo = ref(false);
const correoOk = ref(false);
const correosEnviados = ref<string[]>([]);
async function enviarPorCorreo() {
  if (!cotizacionId.value || enviandoCorreo.value) return;
  const lista = [...correosSel.value];
  const pendiente = correoOtro.value.trim();
  if (pendiente && !lista.includes(pendiente)) lista.push(pendiente);
  if (!lista.length) {
    error.value = 'Elige o escribe al menos un correo.';
    return;
  }
  enviandoCorreo.value = true;
  error.value = '';
  try {
    const pdf = await pdfEnBase64();
    const res = await enviarCotizacionCorreo(cotizacionId.value, lista, pdf);
    correosEnviados.value = res.enviados;
    correoOk.value = true;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo enviar el correo.';
  } finally {
    enviandoCorreo.value = false;
  }
}

async function descargarYCerrar() {
  await descargarPdf();
  mostrarEnvio.value = false;
}

// ================= MODO LOCAL (sin :id — playground de prueba) =================

const borradorLocal = reactive<BorradorCotizacion>({
  cliente: { nombre: 'Cliente de prueba' },
  asunto: 'Cotización de prueba',
  folio: null,
  rev: 'A',
  fecha: new Date().toISOString(),
  partidas: [],
  formaPago: '70% anticipo / 30% entrega',
  tiempoEntrega: 'Por definir',
  notas: '',
});

function agregarPartida() {
  borradorLocal.partidas.push({ titulo: 'Nuevo concepto', lineas: [], cantidad: 1, importe: 0 });
}
function eliminarPartida(i: number) {
  borradorLocal.partidas.splice(i, 1);
}
function editarLineas(i: number, texto: string) {
  borradorLocal.partidas[i].lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
}
</script>

<template>
  <div class="flex flex-col h-screen">
    <!-- Barra superior -->
    <div class="flex items-center gap-3 px-6 py-3 border-b border-line bg-card shrink-0">
      <button @click="volver" title="Volver a cotizaciones" class="text-muted-ink hover:text-accent">
        <ArrowLeft :size="18" />
      </button>
      <div>
        <p class="eyebrow eyebrow--marca">Taller de cotización</p>
        <p class="text-sm text-ink-2">
          {{ cotizacionId ? (cot?.cliente?.nombre ?? 'Cargando…') : 'Nueva cotización — dime los datos en el chat' }}
          <span v-if="cot?.folio" class="font-mono text-brand-text ml-2">{{ cot.folio }}</span>
          <span v-if="ver?.rev" class="font-mono text-muted-ink ml-1">Rev. {{ ver.rev }}</span>
        </p>
      </div>
      <div class="ml-auto flex items-center gap-3">
        <!-- Indicador de estatus (la aprobación se hace desde el chat) -->
        <span
          v-if="cot"
          class="text-xs font-semibold px-3 py-1.5 rounded-full inline-flex items-center gap-1.5"
          :class="{
            'bg-[#fef7c3] text-[#a16207]': cot.estatus === 'borrador',
            'bg-accent-ui text-accent': cot.estatus === 'enviada',
            'bg-[#e0f0ec] text-success': cot.estatus === 'autorizada' || cot.estatus === 'realizada',
            'bg-[#f9e6ea] text-danger': cot.estatus === 'rechazada',
            'bg-secondary text-ink-2': cot.estatus === 'importada',
          }"
          :title="`Estatus: ${estatusTexto}`"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-current opacity-80"></span>{{ estatusTexto }}
        </span>

        <!-- Selector de revisión: ver versiones anteriores (solo lectura) -->
        <select
          v-if="cotizacionId && versiones.length > 1"
          :value="revVerId ?? cot?.versionActualId ?? ''"
          @change="revVerId = ($event.target as HTMLSelectElement).value === (cot?.versionActualId ?? '') ? null : ($event.target as HTMLSelectElement).value"
          class="h-9 px-2 rounded-md border border-line-strong text-sm text-ink-2 bg-white"
          title="Ver una revisión anterior"
        >
          <option v-for="v in versiones" :key="v.id" :value="v.id">
            Rev. {{ v.rev }}{{ v.id === cot?.versionActualId ? ' (actual)' : '' }}
          </option>
        </select>

        <button
          v-if="puedeRevisar && !esHistorica"
          @click="nuevaRevision"
          :disabled="revisando"
          class="h-9 px-3 rounded-md border border-line-strong text-sm font-medium text-ink-2 hover:border-accent hover:text-accent flex items-center gap-1.5 disabled:opacity-50"
          title="Crear una revisión (Rev. siguiente) con el mismo folio"
        >
          <GitBranch :size="15" /> {{ revisando ? 'Creando…' : 'Nueva revisión' }}
        </button>
        <button
          v-if="cotizacionId && cot"
          @click="descargarPdf"
          :disabled="generandoPdf"
          class="h-9 px-3 rounded-md border border-line-strong text-sm font-medium text-ink-2 hover:border-accent hover:text-accent flex items-center gap-1.5 disabled:opacity-50"
          title="Descargar la cotización en PDF"
        >
          <LoaderCircle v-if="generandoPdf" :size="15" class="animate-spin" />
          <FileDown v-else :size="15" />
          {{ generandoPdf ? 'Generando…' : 'PDF' }}
        </button>
        <button
          v-if="cotizacionId && cot?.folio && cot.estatus !== 'borrador'"
          @click="abrirEnvio"
          class="h-9 px-3 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright flex items-center gap-1.5"
          title="Enviar la cotización al cliente por WhatsApp"
        >
          <MessageCircle :size="15" /> Enviar PDF
        </button>
      </div>
    </div>

    <p v-if="error" class="px-6 py-2 text-sm text-danger bg-[#f9e6ea] shrink-0">{{ error }}</p>

    <div class="flex flex-1 min-h-0">
      <!-- ===== Panel izquierdo ===== -->
      <div class="w-[42%] border-r border-line flex flex-col bg-secondary/40 min-h-0">
        <!-- Chat de Portteo (intake sin cotización o taller en vivo) -->
        <template v-if="cotizacionId || esNuevo">
          <div class="px-5 py-3 border-b border-line flex items-center gap-2 shrink-0">
            <MessageSquare :size="16" class="text-brand-text" />
            <span class="eyebrow eyebrow--marca">Chat con Portteo</span>
          </div>

          <div ref="chatBox" class="flex-1 overflow-auto p-4 space-y-3">
            <div
              v-if="hilo.length === 0 && (esNuevo || !cot?.cliente?.nombre)"
              class="mr-auto max-w-[85%] rounded-lg px-3 py-2 text-sm bg-white border border-line text-ink whitespace-pre-wrap"
            >¡Nueva cotización! 👋 Para empezar, dime:
• el <b>cliente</b> (empresa)
• el <b>asunto</b>
• la <b>Atención</b> (persona a cuyo nombre va, opcional)

Puedes dármelos de golpe o uno por uno.</div>
            <p v-else-if="hilo.length === 0" class="text-sm text-muted-ink">
              Dile a Portteo qué cotizar. Por ejemplo: «Agrega un bloque de mantenimiento
              preventivo a grupo electrógeno por $16,437» o «cambia el tiempo de entrega a 3 días».
            </p>
            <div
              v-for="(m, i) in hilo"
              :key="i"
              class="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
              :class="m.rol === 'usuario'
                ? 'ml-auto bg-accent text-white'
                : 'mr-auto bg-white border border-line text-ink'"
            >{{ m.texto }}</div>
            <div v-if="enviando" class="mr-auto flex items-center gap-2 text-muted-ink text-sm">
              <LoaderCircle :size="14" class="animate-spin" /> Portteo está trabajando…
            </div>
          </div>

          <p v-if="esHistorica" class="p-3 border-t border-line text-xs text-center text-muted-ink shrink-0">
            Viendo una revisión anterior. <button @click="revVerId = null" class="text-accent hover:underline">Vuelve a la actual</button> para editar.
          </p>
          <form v-else @submit.prevent="enviar" class="p-3 border-t border-line flex gap-2 shrink-0">
            <input
              v-model="mensaje"
              :disabled="enviando"
              placeholder="Escribe a Portteo…"
              class="flex-1 h-10 px-3 rounded-md border border-line bg-white text-sm focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              :disabled="enviando || !mensaje.trim()"
              class="h-10 w-10 rounded-md bg-accent text-white flex items-center justify-center hover:bg-accent-bright disabled:opacity-50"
            >
              <Send :size="16" />
            </button>
          </form>
        </template>

        <!-- MODO LOCAL: editor de prueba -->
        <template v-else>
          <div class="flex-1 overflow-auto p-5 space-y-4">
            <p class="eyebrow">Editor de prueba (no guarda — abre una cotización real desde el listado)</p>
            <div class="space-y-2">
              <label class="eyebrow block">Cliente</label>
              <input v-model="borradorLocal.cliente.nombre" class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
              <label class="eyebrow block">Asunto</label>
              <input v-model="borradorLocal.asunto" class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
            </div>
            <div v-for="(p, i) in borradorLocal.partidas" :key="i" class="bg-white border border-line rounded-md p-3 space-y-2">
              <div class="flex items-center justify-between">
                <span class="eyebrow">Bloque {{ i + 1 }}</span>
                <button @click="eliminarPartida(i)" class="text-danger hover:opacity-70"><Trash2 :size="15" /></button>
              </div>
              <input v-model="p.titulo" placeholder="Título" class="w-full h-9 px-3 rounded-md border border-line text-sm" />
              <textarea
                :value="p.lineas.join('\n')"
                @input="editarLineas(i, ($event.target as HTMLTextAreaElement).value)"
                placeholder="Líneas de alcance (una por renglón)"
                rows="3"
                class="w-full px-3 py-2 rounded-md border border-line text-sm"
              ></textarea>
              <div class="flex gap-2">
                <div class="flex-1">
                  <label class="eyebrow block mb-1">Cantidad</label>
                  <input v-model.number="p.cantidad" type="number" min="1" class="w-full h-9 px-3 rounded-md border border-line text-sm" />
                </div>
                <div class="flex-1">
                  <label class="eyebrow block mb-1">Importe (MXN)</label>
                  <input v-model.number="p.importe" type="number" min="0" step="0.01" class="w-full h-9 px-3 rounded-md border border-line text-sm" />
                </div>
              </div>
            </div>
            <button @click="agregarPartida" class="flex items-center gap-2 text-sm text-accent hover:text-accent-bright font-medium">
              <Plus :size="16" /> Agregar bloque
            </button>
          </div>
        </template>
      </div>

      <!-- ===== Panel derecho: documento en vivo ===== -->
      <div
        ref="docViewport"
        class="flex-1 overflow-auto bg-paper p-8"
        :style="{ cursor: arrastrando ? 'grabbing' : hayDesborde ? 'grab' : undefined, userSelect: arrastrando ? 'none' : undefined }"
        @mousedown="panDown"
      >
        <div v-if="esHistorica" class="max-w-[800px] mx-auto mb-3 flex items-center justify-between gap-3 bg-[#fef7c3] border border-[#e6d27a] rounded-md px-4 py-2 text-sm text-[#8a6d1a]">
          <span>👁️ Estás viendo la <b>Rev. {{ verMostrada?.rev }}</b> (histórica, solo lectura).</span>
          <button @click="revVerId = null" class="shrink-0 h-8 px-3 rounded-md bg-[#8a6d1a] text-white text-xs font-medium hover:opacity-90">Volver a la actual</button>
        </div>
        <!-- VISTA PREVIA (solo lectura, sin guardar): Portteo la mostró, falta confirmar -->
        <template v-if="previewBorrador">
          <div class="max-w-[800px] mx-auto mb-3 bg-[#eef4ff] border border-[#b8ccf0] rounded-md px-4 py-3 text-sm text-[#274690]">
            <div class="flex items-center gap-2 font-medium">👁️ Vista previa <span class="text-[#5b78b8]">— aún no se guarda nada</span></div>
            <div class="mt-0.5 text-[#3a4a63]">{{ preview?.folio ?? 'borrador' }} · {{ preview?.titulo }} — <b>{{ preview?.cliente?.nombre }}</b>. Dime en el chat si <b>la usamos</b> de base o <b>buscamos otra</b>.</div>
          </div>
          <div :style="{ width: fitAncho, height: fitAltura, margin: '0 auto', overflow: 'hidden' }">
            <div ref="docRef" :style="{ width: '800px', transform: `scale(${docScale})`, transformOrigin: 'top left' }">
              <DocumentoCotizacion :borrador="previewBorrador" />
            </div>
          </div>
        </template>
        <template v-else>
          <!-- Barra de zoom (flotante, pegada arriba) -->
          <div v-if="cotizacionId && borradorVivo" class="sticky top-0 z-10 flex justify-end mb-1 pointer-events-none">
            <div class="pointer-events-auto flex items-center gap-0.5 bg-card border border-line rounded-lg shadow-sm px-1 py-1">
              <button @click="alejar" title="Alejar" class="h-7 w-7 grid place-items-center rounded-md text-muted-ink hover:bg-secondary hover:text-ink"><ZoomOut :size="15" /></button>
              <button @click="ajustarZoom" title="Ajustar al ancho" class="h-7 min-w-12 px-2 rounded-md text-xs font-medium text-ink-2 hover:bg-secondary tabular-nums">{{ porcentajeZoom }}%</button>
              <button @click="acercar" title="Acercar" class="h-7 w-7 grid place-items-center rounded-md text-muted-ink hover:bg-secondary hover:text-ink"><ZoomIn :size="15" /></button>
            </div>
          </div>
          <!-- Documento a ancho fijo (hoja) escalado como bloque: no reflowa el texto -->
          <div v-if="cotizacionId && borradorVivo" :style="{ width: fitAncho, height: fitAltura, margin: '0 auto', overflow: 'hidden' }">
            <div ref="docRef" :style="{ width: '800px', transform: `scale(${docScale})`, transformOrigin: 'top left' }">
              <DocumentoCotizacion :borrador="borradorVivo" :editable="puedeEditar" @editar="guardarEdicion" />
            </div>
          </div>
          <div v-else-if="cotizacionId" class="text-center text-muted-ink mt-20">
            <LoaderCircle :size="22" class="animate-spin mx-auto mb-3" />
            Cargando cotización…
          </div>
          <div v-else class="text-center text-muted-ink mt-24 px-6">
            <MessageSquare :size="40" class="mx-auto mb-3 opacity-40" />
            <p class="text-sm">El documento aparecerá aquí en cuanto le des a Portteo el <b>cliente</b>, el <b>asunto</b> y la <b>Atención</b>.</p>
          </div>
        </template>
      </div>
    </div>

    <!-- ===== Diálogo post-aprobación: enviar al cliente o descargar ===== -->
    <div v-if="mostrarEnvio" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div class="bg-card rounded-xl shadow-xl w-full max-w-md p-6">
        <p class="eyebrow eyebrow--marca">Cotización aprobada</p>
        <h2 class="text-2xl mb-1">Folio <span class="font-mono text-brand-text">{{ folioAprobado }}</span></h2>
        <p class="text-sm text-muted-ink mb-3">Mándasela al cliente por WhatsApp o por correo — o solo descárgala.</p>

        <!-- Pestañas de canal -->
        <div class="flex gap-1 mb-4 bg-secondary/60 rounded-lg p-1">
          <button @click="modoEnvio = 'whatsapp'" class="flex-1 h-8 rounded-md text-sm font-medium flex items-center justify-center gap-1.5"
            :class="modoEnvio === 'whatsapp' ? 'bg-card text-ink shadow-sm' : 'text-muted-ink hover:text-ink'">
            <MessageCircle :size="14" /> WhatsApp
          </button>
          <button @click="modoEnvio = 'correo'" class="flex-1 h-8 rounded-md text-sm font-medium flex items-center justify-center gap-1.5"
            :class="modoEnvio === 'correo' ? 'bg-card text-ink shadow-sm' : 'text-muted-ink hover:text-ink'">
            <Mail :size="14" /> Correo
          </button>
        </div>

        <!-- ===== Canal WhatsApp ===== -->
        <template v-if="modoEnvio === 'whatsapp'">
          <div v-if="envioOk" class="rounded-lg border border-line divide-y divide-line">
            <div v-for="e in estatusEnvios" :key="e.telefono" class="px-4 py-3">
              <template v-if="e.estatus === 'entregado'">
                <p class="text-sm text-success font-medium">✓✓ Entregada — <span class="font-mono text-xs">{{ e.telefono }}</span></p>
              </template>
              <template v-else-if="e.estatus === 'sin_confirmar'">
                <p class="text-sm text-danger font-medium">⚠️ Sin confirmación — <span class="font-mono text-xs">{{ e.telefono }}</span></p>
                <p class="text-xs text-ink-2 mt-0.5">
                  WhatsApp no confirmó la entrega. Pide al destinatario que <b>guarde el número del bot</b> o le mande un <b>"hola"</b> primero, y reenvía.
                </p>
              </template>
              <template v-else-if="e.estatus === 'error'">
                <p class="text-sm text-danger font-medium">❌ Falló — <span class="font-mono text-xs">{{ e.telefono }}</span></p>
                <p class="text-xs text-ink-2 mt-0.5">{{ e.error || 'Revisa el número e intenta de nuevo.' }}</p>
              </template>
              <template v-else>
                <p class="text-sm text-ink-2 flex items-center gap-2">
                  <LoaderCircle :size="13" class="animate-spin" /> Enviando — <span class="font-mono text-xs">{{ e.telefono }}</span>
                </p>
              </template>
            </div>
            <p v-if="estatusEnvios.some((e) => e.estatus === 'pendiente' || e.estatus === 'enviado')" class="px-4 py-2 text-xs text-muted-ink">
              Esperando la confirmación de entrega de WhatsApp (hasta ~1 min).
            </p>
          </div>

          <template v-else>
            <label class="eyebrow block mb-1">Enviar a WhatsApp (uno o varios)</label>
            <div v-if="waCliente.length || waEquipo.length" class="border border-line rounded-md divide-y divide-line mb-2 max-h-44 overflow-auto">
              <template v-if="waCliente.length">
                <p class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-ink">Contactos del cliente</p>
                <label v-for="d in waCliente" :key="'wac-' + d.telefono" class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/40">
                  <input type="checkbox" :checked="telsSel.includes(d.telefono!)" @change="alternarTel(d.telefono!)" class="accent-[var(--color-accent)]" />
                  📇 {{ d.nombre }}<span v-if="d.puesto" class="text-muted-ink"> · {{ d.puesto }}</span> — <span class="font-mono text-xs">{{ d.telefono }}</span>
                </label>
              </template>
              <template v-if="waEquipo.length">
                <p class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-ink">Mi equipo</p>
                <label v-for="d in waEquipo" :key="'wae-' + d.telefono" class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/40">
                  <input type="checkbox" :checked="telsSel.includes(d.telefono!)" @change="alternarTel(d.telefono!)" class="accent-[var(--color-accent)]" />
                  👤 {{ d.nombre }} — <span class="font-mono text-xs">{{ d.telefono }}</span>
                </label>
              </template>
            </div>
            <p v-else class="text-xs text-muted-ink mb-2">Este cliente no tiene contactos con teléfono. Agrégalos en <b>Clientes</b> o escribe un número abajo.</p>
            <div class="flex gap-2 mb-2">
              <input
                v-model="telOtro"
                placeholder="Otro número (ej. 777 123 4567)"
                class="flex-1 h-10 px-3 rounded-md border border-line bg-white text-sm"
                @keyup.enter.prevent="agregarOtro"
              />
              <button type="button" @click="agregarOtro" :disabled="!telOtro.trim()"
                class="h-10 px-3 rounded-md border border-line-strong text-sm text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50">
                + Agregar
              </button>
            </div>
            <div v-if="telsSel.length" class="flex flex-wrap gap-1.5 mb-2">
              <span v-for="t in telsSel" :key="t" class="inline-flex items-center gap-1 text-xs bg-secondary text-ink-2 rounded-md px-2 py-1 font-mono">
                {{ t }}
                <button type="button" @click="alternarTel(t)" class="text-muted-ink hover:text-danger">×</button>
              </span>
            </div>
            <p class="text-xs text-muted-ink mb-4">Con lada. Si es de México, le agregamos el 52 automáticamente.</p>

            <button
              @click="enviarAlCliente"
              :disabled="enviandoCliente"
              class="w-full h-10 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <LoaderCircle v-if="enviandoCliente" :size="16" class="animate-spin" />
              <MessageCircle v-else :size="16" />
              {{ enviandoCliente ? 'Enviando…' : telsSel.length > 1 ? `Enviar por WhatsApp (${telsSel.length})` : 'Enviar por WhatsApp' }}
            </button>
          </template>
        </template>

        <!-- ===== Canal Correo ===== -->
        <template v-else>
          <div v-if="correoOk" class="rounded-lg border border-success/40 bg-success/5 p-4 text-sm">
            <p class="text-success font-medium">✓ Cotización enviada por correo</p>
            <p class="text-ink-2 mt-1">Se envió a: {{ correosEnviados.join(', ') }}</p>
          </div>

          <template v-else>
            <label class="eyebrow block mb-1">Enviar por correo (uno o varios)</label>
            <div v-if="mailCliente.length || mailEquipo.length" class="border border-line rounded-md divide-y divide-line mb-2 max-h-44 overflow-auto">
              <template v-if="mailCliente.length">
                <p class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-ink">Contactos del cliente</p>
                <label v-for="d in mailCliente" :key="'mc-' + d.correo" class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/40">
                  <input type="checkbox" :checked="correosSel.includes(d.correo!)" @change="alternarCorreo(d.correo!)" class="accent-[var(--color-accent)]" />
                  📇 {{ d.nombre }}<span v-if="d.puesto" class="text-muted-ink"> · {{ d.puesto }}</span> — <span class="text-xs text-ink-2">{{ d.correo }}</span>
                </label>
              </template>
              <template v-if="mailEquipo.length">
                <p class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-ink">Mi equipo</p>
                <label v-for="d in mailEquipo" :key="'me-' + d.correo" class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/40">
                  <input type="checkbox" :checked="correosSel.includes(d.correo!)" @change="alternarCorreo(d.correo!)" class="accent-[var(--color-accent)]" />
                  👤 {{ d.nombre }} — <span class="text-xs text-ink-2">{{ d.correo }}</span>
                </label>
              </template>
            </div>
            <p v-else class="text-xs text-muted-ink mb-2">Este cliente no tiene contactos con correo. Agrégalos en <b>Clientes</b> o escribe uno abajo.</p>
            <div class="flex gap-2 mb-2">
              <input
                v-model="correoOtro"
                type="email"
                placeholder="Otro correo (ej. compras@empresa.com)"
                class="flex-1 h-10 px-3 rounded-md border border-line bg-white text-sm"
                @keyup.enter.prevent="agregarOtroCorreo"
              />
              <button type="button" @click="agregarOtroCorreo" :disabled="!correoOtro.trim()"
                class="h-10 px-3 rounded-md border border-line-strong text-sm text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50">
                + Agregar
              </button>
            </div>
            <div v-if="correosSel.length" class="flex flex-wrap gap-1.5 mb-2">
              <span v-for="c in correosSel" :key="c" class="inline-flex items-center gap-1 text-xs bg-secondary text-ink-2 rounded-md px-2 py-1">
                {{ c }}
                <button type="button" @click="alternarCorreo(c)" class="text-muted-ink hover:text-danger">×</button>
              </span>
            </div>
            <p class="text-xs text-muted-ink mb-4">Se envía desde el correo de la empresa con el PDF adjunto.</p>

            <button
              @click="enviarPorCorreo"
              :disabled="enviandoCorreo"
              class="w-full h-10 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <LoaderCircle v-if="enviandoCorreo" :size="16" class="animate-spin" />
              <Mail v-else :size="16" />
              {{ enviandoCorreo ? 'Enviando…' : correosSel.length > 1 ? `Enviar por correo (${correosSel.length})` : 'Enviar por correo' }}
            </button>
          </template>
        </template>

        <div class="flex gap-2 mt-3">
          <button
            @click="descargarYCerrar"
            :disabled="generandoPdf"
            class="flex-1 h-10 rounded-md border border-line-strong text-sm font-medium text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <FileDown :size="15" /> {{ generandoPdf ? 'Generando…' : 'Descargar PDF' }}
          </button>
          <button
            @click="mostrarEnvio = false"
            class="flex-1 h-10 rounded-md text-sm font-medium text-muted-ink hover:text-ink"
          >
            {{ envioOk || correoOk ? 'Listo' : 'Cerrar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
