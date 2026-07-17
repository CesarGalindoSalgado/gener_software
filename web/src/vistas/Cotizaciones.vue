<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, LoaderCircle, FileText, Search, X } from 'lucide-vue-next';
import { sesion } from '../sesion';
import { suscribirListado, type CotizacionDoc } from '../servicios/cotizaciones';

const router = useRouter();

// Nueva cotización: solo abre el taller (sin crear nada). Portteo pide en el
// chat cliente/asunto/dirigida a, y la cotización se crea hasta que los tengas.
function crear() {
  router.push({ name: 'taller' });
}

// --- Carga con límite creciente ("cargar más") ---
const items = ref<({ id: string } & CotizacionDoc)[]>([]);
const cargando = ref(true);
const limite = ref(60);
let off: (() => void) | null = null;
function suscribir() {
  off?.();
  cargando.value = true;
  off = suscribirListado(limite.value, (lista) => {
    items.value = lista;
    cargando.value = false;
  });
}
watch(limite, suscribir);
suscribir();
onUnmounted(() => off?.());
const hayMas = computed(() => items.value.length >= limite.value);
function cargarMas() {
  limite.value += 60;
}

// --- Filtros (en el cliente, sobre lo cargado) ---
const busca = ref('');
const statusSel = ref<'' | 'borrador' | 'enviada' | 'autorizada' | 'rechazada'>('');

// El rango de fechas arranca en los últimos DIAS_DEFECTO días: así, por default,
// solo se ven las cerradas (autorizadas/rechazadas) recientes; las abiertas
// siempre. Amplía o limpia el rango para ver cerradas más viejas.
const DIAS_DEFECTO = 7;
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const hoy = new Date();
const desde = new Date();
desde.setDate(desde.getDate() - DIAS_DEFECTO);
// La BASE por defecto: últimos 7 días. "Limpiar" vuelve aquí (no a vacío) y solo
// aparece cuando el usuario cambió algo respecto de esta base.
const INI_DEFECTO = ymd(desde);
const FIN_DEFECTO = ymd(hoy);
const fechaIni = ref(INI_DEFECTO);
const fechaFin = ref(FIN_DEFECTO);

// Estados "cerrados" a los que aplica el rango de fechas (tu regla). Los abiertos
// (borrador, enviada) se muestran siempre, sin importar la fecha.
const CERRADAS = new Set(['autorizada', 'rechazada']);

function pasaFecha(c: CotizacionDoc): boolean {
  if (!fechaIni.value && !fechaFin.value) return true; // sin rango → no filtra
  if (!CERRADAS.has(c.estatus)) return true; // abiertas ignoran el rango
  const d = c.fechaCreacion?.toDate();
  if (!d) return false;
  if (fechaIni.value && d < new Date(fechaIni.value + 'T00:00:00')) return false;
  if (fechaFin.value && d > new Date(fechaFin.value + 'T23:59:59')) return false;
  return true;
}

const visibles = computed(() => {
  const t = busca.value.trim().toLowerCase();
  return items.value.filter((c) => {
    if (statusSel.value && c.estatus !== statusSel.value) return false;
    if (!pasaFecha(c)) return false;
    if (t) {
      const heno = `${c.folio ?? ''} ${c.cliente?.nombre ?? ''} ${c.titulo ?? ''}`.toLowerCase();
      if (!heno.includes(t)) return false;
    }
    return true;
  });
});

// "Con filtros" = el usuario se movió de la base (7 días + sin texto/status).
const hayFiltros = computed(
  () => !!busca.value || !!statusSel.value || fechaIni.value !== INI_DEFECTO || fechaFin.value !== FIN_DEFECTO
);
function limpiarFiltros() {
  busca.value = '';
  statusSel.value = '';
  fechaIni.value = INI_DEFECTO;
  fechaFin.value = FIN_DEFECTO;
}

const STATUS = [
  { v: '', t: 'Todas' },
  { v: 'borrador', t: 'Borrador' },
  { v: 'enviada', t: 'Enviada' },
  { v: 'autorizada', t: 'Autorizada' },
  { v: 'rechazada', t: 'Rechazada' },
] as const;

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
        @click="crear"
        class="flex items-center gap-2 h-10 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright"
      >
        <Plus :size="16" /> Nueva cotización
      </button>
    </div>

    <!-- Filtros -->
    <div class="mt-6 flex flex-wrap items-end gap-3">
      <div class="relative flex-1 min-w-56">
        <Search :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
        <input v-model="busca" placeholder="Buscar por folio, cliente o asunto…" class="h-10 w-full pl-9 pr-3 rounded-md border border-line bg-white text-sm" />
      </div>
      <div>
        <label class="eyebrow block mb-1">Desde</label>
        <input v-model="fechaIni" type="date" class="h-10 px-2 rounded-md border border-line bg-white text-sm" />
      </div>
      <div>
        <label class="eyebrow block mb-1">Hasta</label>
        <input v-model="fechaFin" type="date" class="h-10 px-2 rounded-md border border-line bg-white text-sm" />
      </div>
      <button v-if="hayFiltros" @click="limpiarFiltros" class="h-10 px-3 rounded-md border border-line text-sm text-muted-ink hover:text-ink flex items-center gap-1">
        <X :size="14" /> Limpiar
      </button>
    </div>
    <div class="flex flex-wrap gap-2 mt-3">
      <button v-for="s in STATUS" :key="s.v" @click="statusSel = s.v"
        class="text-xs px-3 py-1.5 rounded-md border"
        :class="statusSel === s.v ? 'bg-accent text-white border-accent' : 'border-line text-ink-2 hover:border-accent'">
        {{ s.t }}
      </button>
    </div>
    <p v-if="fechaIni || fechaFin" class="text-xs text-muted-ink mt-2">
      El rango de fechas aplica solo a <b>autorizadas</b> y <b>rechazadas</b>; borradores y enviadas se muestran siempre.
    </p>

    <!-- Listado -->
    <div class="bg-card border border-line rounded-lg shadow-sm mt-4 overflow-hidden">
      <div class="px-5 py-3 border-b border-line flex items-center justify-between">
        <p class="eyebrow">Cotizaciones</p>
        <p class="text-xs text-muted-ink">{{ visibles.length }}{{ hayFiltros ? ' filtradas' : '' }}</p>
      </div>

      <div v-if="cargando" class="p-8 text-center text-muted-ink">
        <LoaderCircle :size="20" class="animate-spin mx-auto" />
      </div>

      <div v-else-if="visibles.length === 0" class="p-10 text-center">
        <div class="border border-dashed border-line-strong rounded-lg p-8">
          <FileText :size="28" class="mx-auto text-muted-ink mb-3" />
          <p class="text-muted-ink text-sm">
            {{ hayFiltros ? 'Ninguna cotización coincide con los filtros.' : 'Aún no hay cotizaciones. Crea la primera con «Nueva cotización».' }}
          </p>
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
            v-for="c in visibles"
            :key="c.id"
            @click="router.push({ name: 'taller', params: { id: c.id } })"
            class="border-b border-line last:border-0 hover:bg-secondary cursor-pointer"
          >
            <td class="px-5 py-3 font-mono text-xs">{{ c.folio ?? '—' }}</td>
            <td class="px-5 py-3" :class="{ 'text-muted-ink italic': !c.cliente?.nombre }">{{ c.cliente?.nombre || 'sin cliente' }}</td>
            <td class="px-5 py-3 text-ink-2 max-w-80 truncate" :class="{ 'text-muted-ink italic': !c.titulo }">{{ c.titulo || 'sin asunto' }}</td>
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

      <!-- Cargar más -->
      <div v-if="!cargando && hayMas" class="p-3 border-t border-line text-center">
        <button @click="cargarMas" class="h-9 px-4 rounded-md border border-line-strong text-sm text-ink-2 hover:border-accent hover:text-accent">
          Cargar más
        </button>
        <p v-if="hayFiltros" class="text-[11px] text-muted-ink mt-1">¿No encuentras una vieja? Carga más para buscar más atrás.</p>
      </div>
    </div>
  </div>
</template>
