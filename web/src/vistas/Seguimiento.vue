<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { LoaderCircle, CheckCircle2, XCircle, ExternalLink, Inbox } from 'lucide-vue-next';
import {
  cambiarEstatus,
  suscribirSeguimiento,
  type CotizacionDoc,
} from '../servicios/cotizaciones';
import { confirmar } from '../components/confirmar';

const router = useRouter();
const items = ref<({ id: string } & CotizacionDoc)[]>([]);
const cargando = ref(true);
const error = ref('');
const procesando = ref<string | null>(null);

const off = suscribirSeguimiento((lista) => {
  items.value = lista;
  cargando.value = false;
});
onUnmounted(off);

function diasDesde(c: CotizacionDoc): number {
  const d = c.fechaEnvio?.toDate();
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function etiquetaAging(dias: number): string {
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'hace 1 día';
  return `hace ${dias} días`;
}

// Color de urgencia por antigüedad (semánticos del design system).
function claseAging(dias: number): string {
  if (dias >= 14) return 'text-danger';
  if (dias >= 7) return 'text-[#a16207]';
  return 'text-muted-ink';
}

const totalUrgentes = computed(() => items.value.filter((c) => diasDesde(c) >= 7).length);

async function marcar(id: string, estatus: 'autorizada' | 'rechazada') {
  const esAutorizar = estatus === 'autorizada';
  if (!(await confirmar({
    titulo: esAutorizar ? 'Marcar como autorizada' : 'Marcar como rechazada',
    mensaje: esAutorizar
      ? 'Confirma que el cliente aceptó esta cotización.'
      : 'La cotización quedará marcada como rechazada.',
    confirmar: esAutorizar ? 'Autorizar' : 'Rechazar',
    peligro: !esAutorizar,
  }))) return;
  procesando.value = id;
  error.value = '';
  try {
    await cambiarEstatus(id, estatus);
    // Sale sola de la lista (ya no está "enviada") por el listener.
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo actualizar.';
  } finally {
    procesando.value = null;
  }
}
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Seguimiento</p>
    <h1 class="text-4xl mb-1">Cotizaciones <span class="italic text-brand-text">enviadas</span></h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>

    <p class="text-sm text-muted-ink mt-3">
      Cotizaciones que mandaste y aún no cierran. Da seguimiento a las más antiguas y márcalas como
      autorizadas cuando el cliente acepte.
    </p>

    <!-- KPI -->
    <div class="flex gap-4 mt-6">
      <div class="bg-card border border-line rounded-lg shadow-sm px-5 py-4" style="border-left: 3px solid var(--color-brand); border-top-left-radius: 0; border-bottom-left-radius: 0;">
        <p class="eyebrow eyebrow--marca">Sin cerrar</p>
        <p class="font-serif text-3xl text-ink mt-1">{{ items.length }}</p>
      </div>
      <div class="bg-card border border-line rounded-lg shadow-sm px-5 py-4" :style="{ borderLeft: '3px solid ' + (totalUrgentes ? 'var(--color-danger)' : 'var(--color-line-strong)'), borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }">
        <p class="eyebrow">7+ días</p>
        <p class="font-serif text-3xl mt-1" :class="totalUrgentes ? 'text-danger' : 'text-muted-ink'">{{ totalUrgentes }}</p>
      </div>
    </div>

    <p v-if="error" class="text-sm text-danger mt-4">{{ error }}</p>

    <div class="bg-card border border-line rounded-lg shadow-sm mt-6 overflow-hidden">
      <div v-if="cargando" class="p-8 text-center text-muted-ink">
        <LoaderCircle :size="20" class="animate-spin mx-auto" />
      </div>

      <div v-else-if="items.length === 0" class="p-10 text-center">
        <div class="border border-dashed border-line-strong rounded-lg p-8">
          <Inbox :size="28" class="mx-auto text-muted-ink mb-3" />
          <p class="text-muted-ink text-sm">Nada pendiente de seguimiento. Todo cerrado. 🎉</p>
        </div>
      </div>

      <table v-else class="w-full text-sm">
        <thead>
          <tr class="text-left border-b border-line">
            <th class="px-5 py-2 eyebrow font-normal">Folio</th>
            <th class="px-5 py-2 eyebrow font-normal">Cliente</th>
            <th class="px-5 py-2 eyebrow font-normal">Asunto</th>
            <th class="px-5 py-2 eyebrow font-normal">Enviada</th>
            <th class="px-5 py-2 eyebrow font-normal text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in items" :key="c.id" class="border-b border-line last:border-0 hover:bg-secondary/50">
            <td class="px-5 py-3 font-mono text-xs">{{ c.folio ?? '—' }}</td>
            <td class="px-5 py-3 font-medium">{{ c.cliente?.nombre }}</td>
            <td class="px-5 py-3 text-ink-2 max-w-72 truncate">{{ c.titulo }}</td>
            <td class="px-5 py-3">
              <span :class="claseAging(diasDesde(c))" class="font-medium">{{ etiquetaAging(diasDesde(c)) }}</span>
            </td>
            <td class="px-5 py-3">
              <div class="flex items-center justify-end gap-2">
                <button
                  @click="router.push({ name: 'taller', params: { id: c.id } })"
                  class="text-muted-ink hover:text-accent"
                  title="Abrir en el taller"
                >
                  <ExternalLink :size="16" />
                </button>
                <button
                  @click="marcar(c.id, 'autorizada')"
                  :disabled="procesando === c.id"
                  class="flex items-center gap-1 text-xs text-success hover:opacity-80 disabled:opacity-50"
                  title="El cliente la aceptó"
                >
                  <CheckCircle2 :size="15" /> Autorizada
                </button>
                <button
                  @click="marcar(c.id, 'rechazada')"
                  :disabled="procesando === c.id"
                  class="flex items-center gap-1 text-xs text-danger hover:opacity-80 disabled:opacity-50"
                >
                  <XCircle :size="15" /> Rechazada
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
