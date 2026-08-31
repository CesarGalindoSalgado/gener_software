<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { LoaderCircle, Send, ArrowLeft, Hammer, FileText } from 'lucide-vue-next';
import DocumentoCotizacion from '../components/DocumentoCotizacion.vue';
import { enviarMensajeReparacion } from '../servicios/reparaciones';
import { suscribirCotizacion, suscribirVersion } from '../servicios/cotizaciones';
import type { BorradorCotizacion } from '../dominio/tipos';

const router = useRouter();

const chat = ref<{ rol: 'usuario' | 'portteo'; texto: string }[]>([]);
const mensaje = ref('');
const enviando = ref(false);
const error = ref('');
const chatBox = ref<HTMLElement | null>(null);
const cajaMensaje = ref<HTMLTextAreaElement | null>(null);

const ordenId = ref<string | null>(null);
const cotizacionId = ref<string | null>(null);

// Documento en vivo (una vez que Portteo crea la cotización).
const cot = ref<Record<string, any> | null>(null);
const ver = ref<Record<string, any> | null>(null);
let offCot: (() => void) | null = null;
let offVer: (() => void) | null = null;
function suscribir(id: string) {
  offCot?.();
  offVer?.();
  offCot = suscribirCotizacion(id, (c: any) => {
    cot.value = c;
    if (c?.versionActualId) {
      offVer?.();
      offVer = suscribirVersion(id, c.versionActualId, (v: any) => (ver.value = v));
    }
  });
}
onUnmounted(() => {
  offCot?.();
  offVer?.();
});

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
    fecha: (ver.value.fecha?.toDate?.() ?? new Date()).toISOString(),
    partidas: ver.value.partidas ?? [],
    formaPago: ver.value.formaPago,
    tiempoEntrega: ver.value.tiempoEntrega,
    notas: ver.value.notas ?? '',
  };
});

function ajustarAltoCaja() {
  const el = cajaMensaje.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}
function formatearChat(t: string): string {
  const esc = (t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

async function enviar() {
  const texto = mensaje.value.trim();
  if (!texto || enviando.value) return;
  mensaje.value = '';
  nextTick(() => ajustarAltoCaja());
  error.value = '';
  const historial = chat.value.map((m) => ({ rol: m.rol, texto: m.texto }));
  chat.value.push({ rol: 'usuario', texto });
  await nextTick();
  chatBox.value?.scrollTo({ top: chatBox.value.scrollHeight, behavior: 'smooth' });
  enviando.value = true;
  try {
    const res = await enviarMensajeReparacion({
      historial,
      mensaje: texto,
      ordenId: ordenId.value,
      cotizacionId: cotizacionId.value,
    });
    if (res.ordenId) ordenId.value = res.ordenId;
    if (res.cotizacionId && res.cotizacionId !== cotizacionId.value) {
      cotizacionId.value = res.cotizacionId;
      suscribir(res.cotizacionId);
    }
    chat.value.push({ rol: 'portteo', texto: res.texto });
    await nextTick();
    chatBox.value?.scrollTo({ top: chatBox.value.scrollHeight, behavior: 'smooth' });
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'Error al hablar con Portteo.';
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div class="h-screen flex flex-col">
    <!-- Barra superior -->
    <div class="h-14 shrink-0 border-b border-line flex items-center gap-3 px-5 bg-card">
      <button @click="router.push({ name: 'reparaciones' })" class="h-8 w-8 grid place-items-center rounded-md text-muted-ink hover:bg-black/5" title="Volver a Reparaciones">
        <ArrowLeft :size="18" />
      </button>
      <Hammer :size="16" class="text-accent" />
      <span class="font-medium">Nueva reparación</span>
      <span v-if="ordenId" class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">Registrada</span>
    </div>

    <div class="flex-1 grid lg:grid-cols-[minmax(360px,420px)_1fr] min-h-0">
      <!-- Panel del chat -->
      <div class="flex flex-col min-h-0 border-r border-line">
        <div class="px-4 py-2 border-b border-line shrink-0">
          <span class="eyebrow eyebrow--marca">Chat con Portteo · reparación</span>
        </div>
        <div ref="chatBox" class="flex-1 overflow-auto p-4 space-y-3">
          <div v-if="chat.length === 0" class="mr-auto max-w-[85%] rounded-lg px-3 py-2 text-sm bg-white border border-line text-ink whitespace-pre-wrap">¡Nueva reparación! 🔧 Cuéntame:
• el <b>cliente</b> (empresa)
• el <b>equipo</b> (qué es; marca/modelo/serie si tienes)
• la <b>falla</b> que reporta

Con eso registro la reparación y armamos su cotización aquí mismo.</div>
          <div
            v-for="(m, i) in chat"
            :key="i"
            class="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
            :class="m.rol === 'usuario' ? 'ml-auto bg-accent text-white' : 'mr-auto bg-white border border-line text-ink'"
            v-html="formatearChat(m.texto)"
          ></div>
          <div v-if="enviando" class="mr-auto flex items-center gap-2 text-muted-ink text-sm">
            <LoaderCircle :size="14" class="animate-spin" /> Portteo está trabajando…
          </div>
          <p v-if="error" class="text-sm text-danger">{{ error }}</p>
        </div>
        <form @submit.prevent="enviar" class="p-3 border-t border-line flex gap-2 items-end shrink-0">
          <textarea
            ref="cajaMensaje"
            v-model="mensaje"
            :disabled="enviando"
            rows="1"
            @input="ajustarAltoCaja"
            @keydown.enter.exact.prevent="enviar"
            placeholder="Escribe a Portteo…  (Shift+Enter para salto de línea)"
            class="flex-1 min-h-10 max-h-40 py-2 px-3 rounded-md border border-line bg-white text-sm leading-5 resize-none focus:outline-none focus:border-accent"
          ></textarea>
          <button
            type="submit"
            :disabled="enviando || !mensaje.trim()"
            class="h-10 w-10 shrink-0 rounded-md bg-accent text-white flex items-center justify-center hover:bg-accent-bright disabled:opacity-50"
          >
            <Send :size="16" />
          </button>
        </form>
      </div>

      <!-- Panel del documento (cotización en vivo) -->
      <div class="min-h-0 overflow-auto bg-secondary/30 p-5">
        <DocumentoCotizacion v-if="borradorVivo" :borrador="borradorVivo" />
        <div v-else class="h-full grid place-items-center text-center">
          <div class="max-w-xs">
            <FileText :size="32" class="mx-auto text-muted-ink mb-3" />
            <p class="text-sm text-muted-ink">Aquí verás la cotización de la reparación en cuanto Portteo tenga el cliente, el equipo y la falla.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
