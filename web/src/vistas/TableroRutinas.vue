<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { LoaderCircle, PlayCircle, CheckCircle2, Flag, XCircle, Clock, Wrench, Building2, HardHat } from 'lucide-vue-next';
import { suscribirEjecucionesPanel, type EjecucionDoc } from '../servicios/ejecuciones';
import { suscribirSedes, suscribirRutinas, type SedeDoc, type RutinaDoc } from '../servicios/rutinas';

const ejecuciones = ref<EjecucionDoc[]>([]);
const sedes = ref<SedeDoc[]>([]);
const rutinas = ref<RutinaDoc[]>([]);
const cargando = ref(true);
const offs = [
  suscribirEjecucionesPanel((l) => { ejecuciones.value = l; cargando.value = false; }),
  suscribirSedes((l) => (sedes.value = l)),
  suscribirRutinas((l) => (rutinas.value = l)),
];
onUnmounted(() => offs.forEach((o) => o()));

const nSede = (id: string) => sedes.value.find((s) => s.id === id)?.nombre ?? '—';
const nRutina = (id: string) => rutinas.value.find((r) => r.id === id)?.nombre ?? id;

// ---------- Rango de fechas (por inicio) ----------
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function haceDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}
const PRESETS = [
  { t: '7 días', dias: 7 },
  { t: '30 días', dias: 30 },
  { t: '90 días', dias: 90 },
  { t: 'Todo', dias: 0 },
] as const;
const presetActivo = ref(90);
const fechaIni = ref(haceDias(90));
const fechaFin = ref(ymd(new Date()));
function aplicarPreset(dias: number) {
  presetActivo.value = dias;
  fechaFin.value = ymd(new Date());
  fechaIni.value = dias === 0 ? '' : haceDias(dias);
}
function alCambiarFecha() {
  presetActivo.value = -1;
}

function enRango(e: EjecucionDoc): boolean {
  const d = e.inicio?.toDate?.();
  if (!d) return false;
  if (fechaIni.value && d < new Date(fechaIni.value + 'T00:00:00')) return false;
  if (fechaFin.value && d > new Date(fechaFin.value + 'T23:59:59')) return false;
  return true;
}
const enPeriodo = computed(() => ejecuciones.value.filter(enRango));

// ---------- KPIs ----------
const total = computed(() => enPeriodo.value.length);
const enProceso = computed(() => enPeriodo.value.filter((e) => e.estatus === 'en_proceso').length);
const firmadas = computed(() => enPeriodo.value.filter((e) => e.estatus === 'firmada').length);
const faltantes = computed(() => enPeriodo.value.filter((e) => e.estatus === 'faltante_firma').length);
const canceladas = computed(() => enPeriodo.value.filter((e) => e.estatus === 'cancelada').length);
const cerradas = computed(() =>
  enPeriodo.value.filter((e) => ['completada', 'validada', 'aprobada', 'firmada'].includes(e.estatus)).length
);

// ---------- Tiempos (inicio → fin) ----------
function minutos(e: EjecucionDoc): number | null {
  const i = e.inicio?.toDate?.();
  const f = e.fin?.toDate?.();
  if (!i || !f) return null;
  const m = (f.getTime() - i.getTime()) / 60000;
  return m > 0 && m < 60 * 24 ? m : null; // descarta outliers (>24 h = quedó abierta)
}
function fmtDur(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
const duraciones = computed(() => enPeriodo.value.map(minutos).filter((m): m is number => m != null));
const duracionProm = computed(() =>
  duraciones.value.length ? fmtDur(duraciones.value.reduce((a, b) => a + b, 0) / duraciones.value.length) : '—'
);

// ---------- Agrupaciones ----------
interface Fila { clave: string; n: number; tiempo: number | null }
function agrupar(clave: (e: EjecucionDoc) => string): Fila[] {
  const m = new Map<string, { n: number; sum: number; cnt: number }>();
  for (const e of enPeriodo.value) {
    const k = clave(e) || '—';
    const cur = m.get(k) ?? { n: 0, sum: 0, cnt: 0 };
    cur.n += 1;
    const min = minutos(e);
    if (min != null) { cur.sum += min; cur.cnt += 1; }
    m.set(k, cur);
  }
  return [...m.entries()]
    .map(([clave, v]) => ({ clave, n: v.n, tiempo: v.cnt ? v.sum / v.cnt : null }))
    .sort((a, b) => b.n - a.n);
}
const porTecnico = computed(() => agrupar((e) => e.tecnicoNombre || e.tecnicoTelefono));
const porSede = computed(() => agrupar((e) => nSede(e.sedeId)));
const porRutina = computed(() => agrupar((e) => nRutina(e.rutinaId)).slice(0, 6));
const maxTec = computed(() => Math.max(1, ...porTecnico.value.map((f) => f.n)));
const maxSede = computed(() => Math.max(1, ...porSede.value.map((f) => f.n)));
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Rutinas</p>
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-4xl mb-1">Tablero de <span class="italic text-brand-text">rutinas</span></h1>
        <div class="h-0.5 w-[90px] bg-brand"></div>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex gap-1.5">
          <button v-for="p in PRESETS" :key="p.t" @click="aplicarPreset(p.dias)"
            class="text-xs px-3 py-1.5 rounded-md border transition-colors"
            :class="presetActivo === p.dias ? 'bg-accent text-white border-accent' : 'border-line text-ink-2 hover:border-accent'">
            {{ p.t }}
          </button>
        </div>
        <div>
          <label class="eyebrow block mb-1">Desde</label>
          <input v-model="fechaIni" @change="alCambiarFecha" type="date" class="h-9 px-2 rounded-md border border-line bg-white text-sm" />
        </div>
        <div>
          <label class="eyebrow block mb-1">Hasta</label>
          <input v-model="fechaFin" @change="alCambiarFecha" type="date" class="h-9 px-2 rounded-md border border-line bg-white text-sm" />
        </div>
      </div>
    </div>

    <div v-if="cargando" class="p-16 text-center text-muted-ink">
      <LoaderCircle :size="24" class="animate-spin mx-auto" />
    </div>

    <template v-else>
      <!-- KPIs -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <div class="flex items-center gap-2 text-accent mb-2"><PlayCircle :size="18" /><span class="eyebrow" style="color: var(--color-accent)">En proceso</span></div>
          <p class="text-3xl font-semibold text-accent">{{ enProceso }}</p>
          <p class="text-xs text-muted-ink mt-1">Rutinas abiertas ahora mismo</p>
        </div>
        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <div class="flex items-center gap-2 text-success mb-2"><CheckCircle2 :size="18" /><span class="eyebrow" style="color: var(--color-success)">Firmadas</span></div>
          <p class="text-3xl font-semibold text-success">{{ firmadas }}</p>
          <p class="text-xs text-muted-ink mt-1">Cerradas con hoja firmada</p>
        </div>
        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <div class="flex items-center gap-2 text-danger mb-2"><Flag :size="18" /><span class="eyebrow" style="color: var(--color-danger)">Falta firma</span></div>
          <p class="text-3xl font-semibold text-danger">{{ faltantes }}</p>
          <p class="text-xs text-muted-ink mt-1">Bandera roja pendiente</p>
        </div>
        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <div class="flex items-center gap-2 text-brand-text mb-2"><Clock :size="18" /><span class="eyebrow">Duración prom.</span></div>
          <p class="text-3xl font-semibold text-ink">{{ duracionProm }}</p>
          <p class="text-xs text-muted-ink mt-1">Promedio inicio → fin</p>
        </div>
      </div>

      <!-- Segunda fila: totales -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <div class="bg-card border border-line rounded-lg p-4 shadow-sm">
          <p class="eyebrow">Total en el periodo</p>
          <p class="text-2xl font-semibold text-ink mt-1">{{ total }}</p>
        </div>
        <div class="bg-card border border-line rounded-lg p-4 shadow-sm">
          <p class="eyebrow">Cerradas</p>
          <p class="text-2xl font-semibold text-ink mt-1">{{ cerradas }}</p>
        </div>
        <div class="bg-card border border-line rounded-lg p-4 shadow-sm">
          <div class="flex items-center gap-1 text-muted-ink"><XCircle :size="13" /><p class="eyebrow">Canceladas</p></div>
          <p class="text-2xl font-semibold text-ink mt-1">{{ canceladas }}</p>
        </div>
        <div class="bg-card border border-line rounded-lg p-4 shadow-sm">
          <p class="eyebrow">Técnicos activos</p>
          <p class="text-2xl font-semibold text-ink mt-1">{{ porTecnico.length }}</p>
        </div>
      </div>

      <!-- Por técnico + por sede -->
      <div class="grid lg:grid-cols-2 gap-4 mt-4">
        <div class="bg-card border border-line rounded-lg shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-line flex items-center gap-2"><HardHat :size="15" class="text-muted-ink" /><p class="eyebrow">Por técnico</p></div>
          <div v-if="porTecnico.length === 0" class="p-8 text-center text-sm text-muted-ink">Sin datos en el periodo.</div>
          <ul v-else class="divide-y divide-line">
            <li v-for="f in porTecnico" :key="f.clave" class="px-5 py-3">
              <div class="flex items-center justify-between text-sm mb-1">
                <span class="font-medium truncate">{{ f.clave }}</span>
                <span class="text-muted-ink shrink-0 ml-2">{{ f.n }}<span v-if="f.tiempo != null" class="text-xs"> · {{ fmtDur(f.tiempo) }}</span></span>
              </div>
              <div class="h-1.5 rounded-full bg-secondary overflow-hidden"><div class="h-full rounded-full bg-accent" :style="{ width: (f.n / maxTec * 100) + '%' }"></div></div>
            </li>
          </ul>
        </div>

        <div class="bg-card border border-line rounded-lg shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-line flex items-center gap-2"><Building2 :size="15" class="text-muted-ink" /><p class="eyebrow">Por sede</p></div>
          <div v-if="porSede.length === 0" class="p-8 text-center text-sm text-muted-ink">Sin datos en el periodo.</div>
          <ul v-else class="divide-y divide-line">
            <li v-for="f in porSede" :key="f.clave" class="px-5 py-3">
              <div class="flex items-center justify-between text-sm mb-1">
                <span class="font-medium truncate">{{ f.clave }}</span>
                <span class="text-muted-ink shrink-0 ml-2">{{ f.n }}</span>
              </div>
              <div class="h-1.5 rounded-full bg-secondary overflow-hidden"><div class="h-full rounded-full bg-brand" :style="{ width: (f.n / maxSede * 100) + '%' }"></div></div>
            </li>
          </ul>
        </div>
      </div>

      <!-- Top rutinas -->
      <div class="bg-card border border-line rounded-lg shadow-sm overflow-hidden mt-4">
        <div class="px-5 py-3 border-b border-line flex items-center gap-2"><Wrench :size="15" class="text-muted-ink" /><p class="eyebrow">Rutinas más ejecutadas</p></div>
        <div v-if="porRutina.length === 0" class="p-8 text-center text-sm text-muted-ink">Sin datos en el periodo.</div>
        <ul v-else class="divide-y divide-line">
          <li v-for="f in porRutina" :key="f.clave" class="px-5 py-2.5 flex items-center justify-between">
            <span class="text-sm truncate">{{ f.clave }}</span>
            <span class="text-xs text-muted-ink shrink-0 ml-2">{{ f.n }} ejec.</span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
