<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  AlarmClock, Hourglass, XCircle, CheckCircle2, FileEdit, TrendingUp,
  ExternalLink, LoaderCircle, Inbox,
} from 'lucide-vue-next';
import { suscribirPanel, type CotizacionDoc } from '../servicios/cotizaciones';

const router = useRouter();
type Coti = { id: string } & CotizacionDoc;

const items = ref<Coti[]>([]);
const cargando = ref(true);
const off = suscribirPanel((lista) => {
  items.value = lista;
  cargando.value = false;
});
onUnmounted(off);

// ---------- Rango de fechas (filtra por fecha de creación) ----------
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const hoy = new Date();
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

const fechaIni = ref(haceDias(90));
const fechaFin = ref(ymd(hoy));
const presetActivo = ref<number>(90);

function aplicarPreset(dias: number) {
  presetActivo.value = dias;
  fechaFin.value = ymd(new Date());
  fechaIni.value = dias === 0 ? '' : haceDias(dias);
}
function alCambiarFecha() {
  presetActivo.value = -1; // rango manual
}

function enRango(c: CotizacionDoc): boolean {
  const d = c.fechaCreacion?.toDate();
  if (!d) return false;
  if (fechaIni.value && d < new Date(fechaIni.value + 'T00:00:00')) return false;
  if (fechaFin.value && d > new Date(fechaFin.value + 'T23:59:59')) return false;
  return true;
}

const enPeriodo = computed(() => items.value.filter(enRango));

// ---------- Aging ----------
function diasEnvio(c: CotizacionDoc): number {
  const d = c.fechaEnvio?.toDate();
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function claseAging(dias: number): string {
  if (dias >= 14) return 'text-danger';
  if (dias >= 7) return 'text-[#a16207]';
  return 'text-muted-ink';
}

// ---------- Métricas (sobre el periodo) ----------
const esEnviada = (c: Coti) => c.estatus === 'enviada';
const esAtrasada = (c: Coti) => esEnviada(c) && diasEnvio(c) > 7;

const atrasadas = computed(() => enPeriodo.value.filter(esAtrasada).sort((a, b) => diasEnvio(b) - diasEnvio(a)));
const pendientes = computed(() => enPeriodo.value.filter(esEnviada));
const rechazadas = computed(() => enPeriodo.value.filter((c) => c.estatus === 'rechazada'));
const autorizadas = computed(() => enPeriodo.value.filter((c) => c.estatus === 'autorizada' || c.estatus === 'realizada'));
const borradores = computed(() => enPeriodo.value.filter((c) => c.estatus === 'borrador'));

const total = computed(() => enPeriodo.value.length);
// Tasa de conversión: de las cerradas (autorizadas + rechazadas), cuántas ganaste.
const cerradas = computed(() => autorizadas.value.length + rechazadas.value.length);
const conversion = computed(() => (cerradas.value ? Math.round((autorizadas.value.length / cerradas.value) * 100) : 0));

// Desglose por estatus para el embudo.
const desglose = computed(() => {
  const t = total.value || 1;
  const filas = [
    { k: 'borrador', t: 'Borrador', n: borradores.value.length, c: 'bg-[#e5b800]' },
    { k: 'enviada', t: 'Enviada (por autorizar)', n: pendientes.value.length, c: 'bg-accent' },
    { k: 'autorizada', t: 'Autorizada', n: autorizadas.value.length, c: 'bg-success' },
    { k: 'rechazada', t: 'Rechazada', n: rechazadas.value.length, c: 'bg-danger' },
  ];
  return filas.map((f) => ({ ...f, pct: Math.round((f.n / t) * 100) }));
});

// ---------- Montos en $ (denormalizados en la cotización) ----------
const monto = (c: Coti) => (typeof c.total === 'number' ? c.total : 0);
const suma = (arr: Coti[]) => arr.reduce((a, c) => a + monto(c), 0);
const montoGanado = computed(() => suma(autorizadas.value));
const montoPipeline = computed(() => suma(pendientes.value)); // enviadas por autorizar
const montoPerdido = computed(() => suma(rechazadas.value));
const ticketProm = computed(() => (autorizadas.value.length ? montoGanado.value / autorizadas.value.length : 0));
const fmtMoneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const money = (n: number) => fmtMoneda.format(n);

// Top clientes por número de cotizaciones en el periodo.
const topClientes = computed(() => {
  const m = new Map<string, number>();
  for (const c of enPeriodo.value) {
    const n = c.cliente?.nombre?.trim() || 'Sin cliente';
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
});

function abrir(id: string) {
  router.push({ name: 'taller', params: { id } });
}
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Dashboard</p>
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-4xl mb-1">Resumen <span class="italic text-brand-text">del negocio</span></h1>
        <div class="h-0.5 w-[90px] bg-brand"></div>
      </div>

      <!-- Filtro de rango de fechas -->
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex gap-1.5">
          <button
            v-for="p in PRESETS"
            :key="p.t"
            @click="aplicarPreset(p.dias)"
            class="text-xs px-3 py-1.5 rounded-md border transition-colors"
            :class="presetActivo === p.dias ? 'bg-accent text-white border-accent' : 'border-line text-ink-2 hover:border-accent'"
          >
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
      <!-- Tarjetas KPI -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <div class="flex items-center gap-2 text-danger mb-2">
            <AlarmClock :size="18" /><span class="eyebrow" style="color: var(--color-danger)">Atrasadas</span>
          </div>
          <p class="text-3xl font-semibold text-danger">{{ atrasadas.length }}</p>
          <p class="text-xs text-muted-ink mt-1">Enviadas hace más de 7 días sin cerrar</p>
        </div>

        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <div class="flex items-center gap-2 text-accent mb-2">
            <Hourglass :size="18" /><span class="eyebrow" style="color: var(--color-accent)">Por autorizar</span>
          </div>
          <p class="text-3xl font-semibold text-accent">{{ pendientes.length }}</p>
          <p class="text-xs text-muted-ink mt-1">Enviadas esperando respuesta del cliente</p>
        </div>

        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <div class="flex items-center gap-2 text-danger mb-2">
            <XCircle :size="18" /><span class="eyebrow" style="color: var(--color-danger)">Rechazadas</span>
          </div>
          <p class="text-3xl font-semibold text-ink">{{ rechazadas.length }}</p>
          <p class="text-xs text-muted-ink mt-1">Cotizaciones no aceptadas en el periodo</p>
        </div>

        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <div class="flex items-center gap-2 text-success mb-2">
            <CheckCircle2 :size="18" /><span class="eyebrow" style="color: var(--color-success)">Autorizadas</span>
          </div>
          <p class="text-3xl font-semibold text-success">{{ autorizadas.length }}</p>
          <p class="text-xs text-muted-ink mt-1">Cerradas ganadas en el periodo</p>
        </div>
      </div>

      <!-- Montos en $ -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <span class="eyebrow" style="color: var(--color-success)">Monto ganado</span>
          <p class="text-2xl font-semibold text-success mt-1">{{ money(montoGanado) }}</p>
          <p class="text-xs text-muted-ink mt-1">Autorizadas en el periodo</p>
        </div>
        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <span class="eyebrow" style="color: var(--color-accent)">Pipeline abierto</span>
          <p class="text-2xl font-semibold text-accent mt-1">{{ money(montoPipeline) }}</p>
          <p class="text-xs text-muted-ink mt-1">Enviadas esperando respuesta</p>
        </div>
        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <span class="eyebrow">Ticket promedio</span>
          <p class="text-2xl font-semibold text-ink mt-1">{{ money(ticketProm) }}</p>
          <p class="text-xs text-muted-ink mt-1">Por cotización ganada</p>
        </div>
        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <span class="eyebrow" style="color: var(--color-danger)">Monto perdido</span>
          <p class="text-2xl font-semibold text-ink mt-1">{{ money(montoPerdido) }}</p>
          <p class="text-xs text-muted-ink mt-1">Rechazadas en el periodo</p>
        </div>
      </div>

      <!-- Segunda fila: conversión + borradores + embudo -->
      <div class="grid lg:grid-cols-3 gap-4 mt-4">
        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <div class="flex items-center gap-2 text-brand-text mb-2">
            <TrendingUp :size="18" /><span class="eyebrow">Tasa de conversión</span>
          </div>
          <p class="text-3xl font-semibold text-ink">{{ conversion }}%</p>
          <p class="text-xs text-muted-ink mt-1">{{ autorizadas.length }} ganadas de {{ cerradas }} cerradas</p>
        </div>

        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <div class="flex items-center gap-2 text-muted-ink mb-2">
            <FileEdit :size="18" /><span class="eyebrow">En borrador</span>
          </div>
          <p class="text-3xl font-semibold text-ink">{{ borradores.length }}</p>
          <p class="text-xs text-muted-ink mt-1">Sin enviar todavía · {{ total }} totales en el periodo</p>
        </div>

        <div class="bg-card border border-line rounded-lg p-5 shadow-sm">
          <span class="eyebrow">Embudo por estatus</span>
          <div class="mt-3 space-y-2">
            <div v-for="f in desglose" :key="f.k">
              <div class="flex justify-between text-xs mb-0.5">
                <span class="text-ink-2">{{ f.t }}</span>
                <span class="text-muted-ink">{{ f.n }} · {{ f.pct }}%</span>
              </div>
              <div class="h-2 rounded-full bg-secondary overflow-hidden">
                <div class="h-full rounded-full" :class="f.c" :style="{ width: f.pct + '%' }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Atrasadas (accionable) + Top clientes -->
      <div class="grid lg:grid-cols-3 gap-4 mt-4">
        <div class="lg:col-span-2 bg-card border border-line rounded-lg shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-line flex items-center justify-between">
            <p class="eyebrow">Atrasadas — dales seguimiento</p>
            <p class="text-xs text-muted-ink">{{ atrasadas.length }}</p>
          </div>
          <div v-if="atrasadas.length === 0" class="p-10 text-center">
            <Inbox :size="26" class="mx-auto text-muted-ink mb-2" />
            <p class="text-sm text-muted-ink">Ninguna atrasada. Todo al día. 🎉</p>
          </div>
          <table v-else class="w-full text-sm">
            <tbody>
              <tr
                v-for="c in atrasadas.slice(0, 8)"
                :key="c.id"
                @click="abrir(c.id)"
                class="border-b border-line last:border-0 hover:bg-secondary/50 cursor-pointer"
              >
                <td class="px-5 py-3 font-mono text-xs w-32">{{ c.folio ?? '—' }}</td>
                <td class="px-5 py-3 font-medium">{{ c.cliente?.nombre }}</td>
                <td class="px-5 py-3 text-ink-2 max-w-56 truncate">{{ c.titulo }}</td>
                <td class="px-5 py-3 text-right whitespace-nowrap">
                  <span :class="claseAging(diasEnvio(c))" class="font-semibold">{{ diasEnvio(c) }}</span>
                  <span class="text-muted-ink text-xs"> días</span>
                </td>
                <td class="px-4 py-3 text-right w-10"><ExternalLink :size="15" class="text-muted-ink inline" /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="bg-card border border-line rounded-lg shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-line">
            <p class="eyebrow">Top clientes del periodo</p>
          </div>
          <div v-if="topClientes.length === 0" class="p-8 text-center text-sm text-muted-ink">Sin datos.</div>
          <ul v-else class="divide-y divide-line">
            <li v-for="[nombre, n] in topClientes" :key="nombre" class="px-5 py-3 flex items-center justify-between">
              <span class="text-sm font-medium truncate">{{ nombre }}</span>
              <span class="text-xs text-muted-ink shrink-0 ml-2">{{ n }} cot.</span>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>
