<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch, nextTick } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ArrowLeft, Plus, Trash2, MessageSquare, Send, LoaderCircle, FileDown } from 'lucide-vue-next';
import DocumentoCotizacion from '../components/DocumentoCotizacion.vue';
import type { BorradorCotizacion } from '../dominio/tipos';
import { ROLES_ADMIN } from '../dominio/tipos';
import { sesion } from '../sesion';
import {
  aprobarCotizacion,
  enviarMensajePortteo,
  suscribirChat,
  suscribirCotizacion,
  suscribirVersion,
  type CotizacionDoc,
  type MensajeChat,
  type VersionDoc,
} from '../servicios/cotizaciones';

const route = useRoute();
const cotizacionId = computed(() => (route.params.id as string | undefined) ?? null);
const esAdmin = computed(() => ROLES_ADMIN.includes(sesion.usuario?.rol ?? 'trabajador'));

// ================= MODO EN VIVO (con :id — Firestore + chat) =================

const cot = ref<CotizacionDoc | null>(null);
const ver = ref<VersionDoc | null>(null);
const chat = ref<MensajeChat[]>([]);
const mensaje = ref('');
const enviando = ref(false);
const aprobando = ref(false);
const error = ref('');
const chatBox = ref<HTMLElement | null>(null);

let offCot: (() => void) | null = null;
let offVer: (() => void) | null = null;
let offChat: (() => void) | null = null;

function limpiarSubs() {
  offCot?.(); offVer?.(); offChat?.();
  offCot = offVer = offChat = null;
}

watch(
  cotizacionId,
  (id) => {
    limpiarSubs();
    cot.value = null; ver.value = null; chat.value = [];
    if (!id) return;
    offCot = suscribirCotizacion(id, (c) => {
      const versionAnterior = cot.value?.versionActualId;
      cot.value = c;
      if (c && c.versionActualId && c.versionActualId !== versionAnterior) {
        offVer?.();
        offVer = suscribirVersion(id, c.versionActualId, (v) => (ver.value = v));
      }
    });
    offChat = suscribirChat(id, async (msgs) => {
      chat.value = msgs;
      await nextTick();
      chatBox.value?.scrollTo({ top: chatBox.value.scrollHeight, behavior: 'smooth' });
    });
  },
  { immediate: true }
);
onUnmounted(limpiarSubs);

const borradorVivo = computed<BorradorCotizacion | null>(() => {
  if (!cot.value || !ver.value) return null;
  return {
    cliente: {
      nombre: cot.value.cliente?.nombre ?? '',
      atencion: cot.value.cliente?.atencion ?? undefined,
      telefono: cot.value.cliente?.telefono ?? undefined,
      correo: cot.value.cliente?.correo ?? undefined,
    },
    asunto: cot.value.titulo,
    folio: cot.value.folio,
    rev: ver.value.rev,
    fecha: (ver.value.fecha?.toDate() ?? new Date()).toISOString(),
    partidas: ver.value.partidas ?? [],
    formaPago: ver.value.formaPago,
    tiempoEntrega: ver.value.tiempoEntrega,
  };
});

async function enviar() {
  const texto = mensaje.value.trim();
  if (!texto || !cotizacionId.value || enviando.value) return;
  mensaje.value = '';
  error.value = '';
  enviando.value = true;
  try {
    await enviarMensajePortteo(cotizacionId.value, texto);
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'Error al hablar con Portteo.';
  } finally {
    enviando.value = false;
  }
}

function descargarPdf() {
  if (!cotizacionId.value) return;
  // Abre la vista de impresión limpia en pestaña nueva (auto-lanza el diálogo).
  window.open(`/imprimir/${cotizacionId.value}`, '_blank');
}

async function aprobar() {
  if (!cotizacionId.value || aprobando.value) return;
  if (!confirm('¿Aprobar esta cotización? Se asignará el folio definitivo.')) return;
  error.value = '';
  aprobando.value = true;
  try {
    await aprobarCotizacion(cotizacionId.value);
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo aprobar.';
  } finally {
    aprobando.value = false;
  }
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
});

function agregarPartida() {
  borradorLocal.partidas.push({ titulo: 'Nuevo concepto', descripcion: '', lineas: [], cantidad: 1, importe: 0 });
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
      <RouterLink :to="{ name: 'cotizaciones' }" class="text-muted-ink hover:text-accent">
        <ArrowLeft :size="18" />
      </RouterLink>
      <div>
        <p class="eyebrow eyebrow--marca">Taller de cotización</p>
        <p class="text-sm text-ink-2">
          {{ cotizacionId ? (cot?.cliente?.nombre ?? 'Cargando…') : 'Modo de prueba (sin guardar)' }}
          <span v-if="cot?.folio" class="font-mono text-brand-text ml-2">{{ cot.folio }}</span>
        </p>
      </div>
      <div class="ml-auto flex items-center gap-3">
        <span
          v-if="cot"
          class="text-xs px-2 py-1 rounded-md"
          :class="{
            'bg-[#fef7c3] text-[#a16207]': cot.estatus === 'borrador',
            'bg-accent-ui text-accent': cot.estatus === 'enviada',
            'bg-[#e0f0ec] text-success': cot.estatus === 'autorizada' || cot.estatus === 'realizada',
            'bg-[#f9e6ea] text-danger': cot.estatus === 'rechazada',
          }"
        >{{ cot.estatus }}</span>
        <button
          v-if="cotizacionId && cot"
          @click="descargarPdf"
          class="h-9 px-3 rounded-md border border-line-strong text-sm font-medium text-ink-2 hover:border-accent hover:text-accent flex items-center gap-1.5"
          title="Abrir la vista de impresión para guardar como PDF"
        >
          <FileDown :size="15" /> PDF
        </button>
        <button
          v-if="cotizacionId && esAdmin"
          @click="aprobar"
          :disabled="aprobando || cot?.estatus !== 'borrador'"
          class="h-9 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50"
        >
          {{ aprobando ? 'Aprobando…' : cot?.estatus === 'borrador' ? 'Aprobar' : 'Aprobada' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="px-6 py-2 text-sm text-danger bg-[#f9e6ea] shrink-0">{{ error }}</p>

    <div class="flex flex-1 min-h-0">
      <!-- ===== Panel izquierdo ===== -->
      <div class="w-[42%] border-r border-line flex flex-col bg-secondary/40 min-h-0">
        <!-- MODO EN VIVO: chat de Portteo -->
        <template v-if="cotizacionId">
          <div class="px-5 py-3 border-b border-line flex items-center gap-2 shrink-0">
            <MessageSquare :size="16" class="text-brand-text" />
            <span class="eyebrow eyebrow--marca">Chat con Portteo</span>
          </div>

          <div ref="chatBox" class="flex-1 overflow-auto p-4 space-y-3">
            <p v-if="chat.length === 0" class="text-sm text-muted-ink">
              Dile a Portteo qué cotizar. Por ejemplo: «Agrega un bloque de mantenimiento
              preventivo a grupo electrógeno por $16,437» o «cambia el tiempo de entrega a 3 días».
            </p>
            <div
              v-for="m in chat"
              :key="m.id"
              class="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
              :class="m.rol === 'usuario'
                ? 'ml-auto bg-accent text-white'
                : 'mr-auto bg-white border border-line text-ink'"
            >{{ m.texto }}</div>
            <div v-if="enviando" class="mr-auto flex items-center gap-2 text-muted-ink text-sm">
              <LoaderCircle :size="14" class="animate-spin" /> Portteo está trabajando…
            </div>
          </div>

          <form @submit.prevent="enviar" class="p-3 border-t border-line flex gap-2 shrink-0">
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
              <input v-model="p.descripcion" placeholder="Descripción" class="w-full h-9 px-3 rounded-md border border-line text-sm" />
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
      <div class="flex-1 overflow-auto bg-paper p-8">
        <DocumentoCotizacion v-if="cotizacionId && borradorVivo" :borrador="borradorVivo" />
        <div v-else-if="cotizacionId" class="text-center text-muted-ink mt-20">
          <LoaderCircle :size="22" class="animate-spin mx-auto mb-3" />
          Cargando cotización…
        </div>
        <DocumentoCotizacion v-else :borrador="borradorLocal" />
      </div>
    </div>
  </div>
</template>
