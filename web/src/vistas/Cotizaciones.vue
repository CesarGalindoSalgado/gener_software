<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, LoaderCircle, FileText } from 'lucide-vue-next';
import { sesion } from '../sesion';
import {
  crearCotizacion,
  suscribirListado,
  type CotizacionDoc,
} from '../servicios/cotizaciones';

const router = useRouter();

// --- Nueva cotización ---
const mostrandoForma = ref(false);
const clienteNombre = ref('');
const titulo = ref('');
const creando = ref(false);
const error = ref('');

async function crear() {
  if (!clienteNombre.value.trim() || creando.value) return;
  creando.value = true;
  error.value = '';
  try {
    const { cotizacionId } = await crearCotizacion(
      clienteNombre.value.trim(),
      titulo.value.trim() || 'Cotización'
    );
    router.push({ name: 'taller', params: { id: cotizacionId } });
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message ?? '';
    error.value = msg.includes('internal') || msg.includes('not-found')
      ? 'El backend aún no está desplegado en Firebase. (Se habilita al desplegar las Cloud Functions.)'
      : msg || 'No se pudo crear la cotización.';
  } finally {
    creando.value = false;
  }
}

// --- Listado en vivo ---
const items = ref<({ id: string } & CotizacionDoc)[]>([]);
const cargando = ref(true);
const off = suscribirListado((lista) => {
  items.value = lista;
  cargando.value = false;
});
onUnmounted(off);

function fechaCorta(c: CotizacionDoc): string {
  const d = c.fechaCreacion?.toDate();
  return d ? new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }).format(d) : '—';
}
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Porttea-Gener</p>
    <div class="flex items-end justify-between">
      <div>
        <h1 class="text-4xl mb-1">
          Bienvenido, <span class="italic text-brand-text">{{ sesion.usuario?.nombre }}</span>
        </h1>
        <div class="h-0.5 w-[90px] bg-brand"></div>
      </div>
      <button
        @click="mostrandoForma = !mostrandoForma"
        class="flex items-center gap-2 h-10 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright"
      >
        <Plus :size="16" /> Nueva cotización
      </button>
    </div>

    <!-- Forma de creación -->
    <div v-if="mostrandoForma" class="bg-card border border-line rounded-lg shadow-sm p-5 mt-6">
      <p class="eyebrow mb-3">Nueva cotización</p>
      <form @submit.prevent="crear" class="flex flex-wrap gap-3 items-end">
        <div class="flex-1 min-w-48">
          <label class="eyebrow block mb-1">Cliente</label>
          <input
            v-model="clienteNombre"
            required
            placeholder="Nombre del cliente"
            class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm focus:outline-none focus:border-accent"
          />
        </div>
        <div class="flex-[2] min-w-64">
          <label class="eyebrow block mb-1">Asunto (opcional)</label>
          <input
            v-model="titulo"
            placeholder="Ej. Mantenimiento preventivo a grupo electrógeno"
            class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm focus:outline-none focus:border-accent"
          />
        </div>
        <button
          type="submit"
          :disabled="creando || !clienteNombre.trim()"
          class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center gap-2"
        >
          <LoaderCircle v-if="creando" :size="15" class="animate-spin" />
          {{ creando ? 'Creando…' : 'Crear y abrir taller' }}
        </button>
      </form>
      <p v-if="error" class="text-sm text-danger mt-3">{{ error }}</p>
    </div>

    <!-- Listado -->
    <div class="bg-card border border-line rounded-lg shadow-sm mt-6 overflow-hidden">
      <div class="px-5 py-3 border-b border-line">
        <p class="eyebrow">Cotizaciones</p>
      </div>

      <div v-if="cargando" class="p-8 text-center text-muted-ink">
        <LoaderCircle :size="20" class="animate-spin mx-auto" />
      </div>

      <div v-else-if="items.length === 0" class="p-10 text-center">
        <div class="border border-dashed border-line-strong rounded-lg p-8">
          <FileText :size="28" class="mx-auto text-muted-ink mb-3" />
          <p class="text-muted-ink text-sm">Aún no hay cotizaciones. Crea la primera con «Nueva cotización».</p>
        </div>
      </div>

      <table v-else class="w-full text-sm">
        <thead>
          <tr class="text-left border-b border-line">
            <th class="px-5 py-2 eyebrow font-normal">Folio</th>
            <th class="px-5 py-2 eyebrow font-normal">Cliente</th>
            <th class="px-5 py-2 eyebrow font-normal">Asunto</th>
            <th class="px-5 py-2 eyebrow font-normal">Estatus</th>
            <th class="px-5 py-2 eyebrow font-normal">Fecha</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in items"
            :key="c.id"
            @click="router.push({ name: 'taller', params: { id: c.id } })"
            class="border-b border-line last:border-0 hover:bg-secondary cursor-pointer"
          >
            <td class="px-5 py-3 font-mono text-xs">{{ c.folio ?? '—' }}</td>
            <td class="px-5 py-3">{{ c.cliente?.nombre }}</td>
            <td class="px-5 py-3 text-ink-2 max-w-80 truncate">{{ c.titulo }}</td>
            <td class="px-5 py-3">
              <span
                class="text-xs px-2 py-0.5 rounded-md"
                :class="{
                  'bg-[#fef7c3] text-[#a16207]': c.estatus === 'borrador',
                  'bg-accent-ui text-accent': c.estatus === 'enviada',
                  'bg-[#e0f0ec] text-success': c.estatus === 'autorizada' || c.estatus === 'realizada',
                  'bg-[#f9e6ea] text-danger': c.estatus === 'rechazada',
                  'bg-secondary text-muted-ink': c.estatus === 'importada',
                }"
              >{{ c.estatus }}</span>
            </td>
            <td class="px-5 py-3 text-muted-ink">{{ fechaCorta(c) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
