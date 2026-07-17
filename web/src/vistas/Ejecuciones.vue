<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { LoaderCircle, ClipboardList, X, Search, ExternalLink, Check, PenLine } from 'lucide-vue-next';
import { suscribirEjecuciones, validarEjecucion, enlaceReporte, resolverFaltanteFirma, type EjecucionDoc, type EstatusEjecucion } from '../servicios/ejecuciones';
import { suscribirEquipos, suscribirSedes, suscribirRutinas, type EquipoDoc, type SedeDoc, type RutinaDoc } from '../servicios/rutinas';

const ejecuciones = ref<EjecucionDoc[]>([]);
const equipos = ref<EquipoDoc[]>([]);
const sedes = ref<SedeDoc[]>([]);
const rutinas = ref<RutinaDoc[]>([]);
const cargando = ref(true);
const offs = [
  suscribirEjecuciones((l) => { ejecuciones.value = l; cargando.value = false; }),
  suscribirEquipos((l) => (equipos.value = l)),
  suscribirSedes((l) => (sedes.value = l)),
  suscribirRutinas((l) => (rutinas.value = l)),
];
onUnmounted(() => offs.forEach((o) => o()));

const nEquipo = (id: string) => equipos.value.find((e) => e.id === id)?.noInventario ?? '—';
const nSede = (id: string) => sedes.value.find((s) => s.id === id)?.nombre ?? '—';
const nRutina = (id: string) => rutinas.value.find((r) => r.id === id)?.nombre ?? id;

const ETIQUETA: Record<EstatusEjecucion, string> = {
  en_proceso: 'En proceso', cancelada: 'Cancelada', completada: 'Completada',
  validada: 'Validada', aprobada: 'Aprobada', firmada: 'Firmada', faltante_firma: 'Falta firma',
};
const COLOR: Record<EstatusEjecucion, string> = {
  en_proceso: 'bg-[#fef3d6] text-[#8a6d1a]', cancelada: 'bg-[#f9e6ea] text-danger',
  completada: 'bg-[#e0f0ec] text-success', validada: 'bg-[#e0f0ec] text-success',
  aprobada: 'bg-[#e0f0ec] text-success', firmada: 'bg-[#e0f0ec] text-success',
  faltante_firma: 'bg-[#fef3d6] text-[#8a6d1a]',
};

const filtro = ref<'todas' | 'en_proceso' | 'firmada' | 'faltante_firma'>('todas');

// Filtros adicionales (Ficha §9): búsqueda, sede y rango de fechas (por inicio).
const busca = ref('');
const sedeSel = ref('');
const fechaIni = ref('');
const fechaFin = ref('');

const sedesOrden = computed(() => [...sedes.value].sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? '')));

function pasaFecha(e: EjecucionDoc): boolean {
  if (!fechaIni.value && !fechaFin.value) return true;
  const d = e.inicio?.toDate?.();
  if (!d) return false;
  if (fechaIni.value && d < new Date(fechaIni.value + 'T00:00:00')) return false;
  if (fechaFin.value && d > new Date(fechaFin.value + 'T23:59:59')) return false;
  return true;
}

const visibles = computed(() => {
  const t = busca.value.trim().toLowerCase();
  return ejecuciones.value.filter((e) => {
    if (filtro.value !== 'todas' && e.estatus !== filtro.value) return false;
    if (sedeSel.value && e.sedeId !== sedeSel.value) return false;
    if (!pasaFecha(e)) return false;
    if (t) {
      const heno = `${e.folio ?? ''} ${nEquipo(e.equipoId)} ${nSede(e.sedeId)} ${e.tecnicoNombre ?? ''} ${e.tecnicoTelefono ?? ''} ${nRutina(e.rutinaId)}`.toLowerCase();
      if (!heno.includes(t)) return false;
    }
    return true;
  });
});
const nFaltantes = computed(() => ejecuciones.value.filter((e) => e.estatus === 'faltante_firma').length);
const hayFiltros = computed(() => !!busca.value || !!sedeSel.value || !!fechaIni.value || !!fechaFin.value);
function limpiarFiltros() {
  busca.value = '';
  sedeSel.value = '';
  fechaIni.value = '';
  fechaFin.value = '';
}

function avance(e: EjecucionDoc): string {
  const total = e.pasos?.length ?? 0;
  const terminada = ['completada', 'firmada', 'faltante_firma', 'validada', 'aprobada'].includes(e.estatus);
  const hechos = terminada ? total : Math.max(0, (e.pasoActual ?? 1) - 1);
  return `${hechos}/${total}`;
}
function fecha(t?: { toDate?: () => Date } | null): string {
  const d = t?.toDate?.();
  return d ? d.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}

// Una ejecución terminada se PUEDE foliar (validar); las de en proceso solo se ven.
const puedeReporte = (e: EjecucionDoc) =>
  ['completada', 'validada', 'firmada', 'faltante_firma'].includes(e.estatus) || !!e.folio;

const errorRep = ref('');
const abriendo = ref<string | null>(null);
// Evidencia de la firma (foto de la hoja firmada): ya no va en el reporte; se ve
// aquí en un visor al hacer clic en su icono.
const firmaVista = ref<string | null>(null);
// Abre la liga del reporte en una pestaña nueva. Si la rutina ya terminó, valida
// (asigna folio la 1ª vez) y abre; si sigue en proceso, abre la liga en vivo para
// verla generarse sin cambiar su estado.
async function abrirReporte(e: EjecucionDoc) {
  abriendo.value = e.id;
  errorRep.value = '';
  try {
    const { enlace } = puedeReporte(e) ? await validarEjecucion(e.id) : await enlaceReporte(e.id);
    window.open(enlace, '_blank');
  } catch (err: unknown) {
    errorRep.value = (err as { message?: string })?.message ?? 'No se pudo abrir el reporte.';
  } finally {
    abriendo.value = null;
  }
}

// Quitar bandera de faltante de firma (opcionalmente con foto de la hoja firmada).
const resolviendo = ref<string | null>(null);
async function resolverFirma(e: EjecucionDoc) {
  const url = prompt('Pega el enlace de la foto de la hoja firmada (opcional; déjalo vacío si solo quieres quitar la bandera):') ?? '';
  resolviendo.value = e.id;
  errorRep.value = '';
  try {
    await resolverFaltanteFirma(e.id, url.trim() || undefined);
  } catch (err: unknown) {
    errorRep.value = (err as { message?: string })?.message ?? 'No se pudo resolver.';
  } finally {
    resolviendo.value = null;
  }
}
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Rutinas</p>
    <h1 class="text-4xl mb-1">Ejecuciones</h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>
    <p class="text-sm text-muted-ink mt-3">Rutinas que los técnicos ejecutan por WhatsApp, con su avance y evidencia.</p>

    <!-- Búsqueda + sede + rango de fechas -->
    <div class="mt-6 flex flex-wrap items-end gap-3">
      <div class="relative flex-1 min-w-56">
        <Search :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
        <input v-model="busca" placeholder="Buscar por folio, equipo, sede o técnico…" class="h-10 w-full pl-9 pr-3 rounded-md border border-line bg-white text-sm" />
      </div>
      <div>
        <label class="eyebrow block mb-1">Sede</label>
        <select v-model="sedeSel" class="h-10 px-2 rounded-md border border-line bg-white text-sm max-w-52">
          <option value="">Todas las sedes</option>
          <option v-for="s in sedesOrden" :key="s.id" :value="s.id">{{ s.nombre }}</option>
        </select>
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

    <!-- Chips de estatus -->
    <div class="flex gap-2 mt-3 flex-wrap">
      <button v-for="f in (['todas','en_proceso','firmada','faltante_firma'] as const)" :key="f" @click="filtro = f"
        class="text-xs px-3 py-1.5 rounded-md border"
        :class="filtro === f
          ? (f === 'faltante_firma' ? 'bg-danger text-white border-danger' : 'bg-accent text-white border-accent')
          : (f === 'faltante_firma' && nFaltantes ? 'border-danger/50 text-danger hover:border-danger' : 'border-line text-ink-2 hover:border-accent')">
        {{ f === 'todas' ? 'Todas' : f === 'en_proceso' ? 'En proceso' : f === 'firmada' ? 'Firmadas' : `Faltante de firma${nFaltantes ? ' (' + nFaltantes + ')' : ''}` }}
      </button>
      <span class="text-xs text-muted-ink self-center ml-1">{{ visibles.length }} resultado{{ visibles.length === 1 ? '' : 's' }}</span>
    </div>

    <p v-if="errorRep" class="text-danger text-sm mt-3">{{ errorRep }}</p>

    <div v-if="cargando" class="p-10 text-center text-muted-ink"><LoaderCircle :size="20" class="animate-spin mx-auto" /></div>
    <div v-else-if="visibles.length === 0" class="p-10 text-center mt-6">
      <div class="border border-dashed border-line-strong rounded-lg p-8">
        <ClipboardList :size="28" class="mx-auto text-muted-ink mb-3" />
        <p class="text-muted-ink text-sm">Aún no hay ejecuciones. Cuando un técnico inicie una rutina por WhatsApp, aparecerá aquí.</p>
      </div>
    </div>

    <div v-else class="bg-card border border-line rounded-lg shadow-sm mt-6 overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left border-b border-line">
          <th class="px-4 py-2 eyebrow font-normal text-center w-24">Acciones</th>
          <th class="px-5 py-2 eyebrow font-normal">Rutina</th>
          <th class="px-5 py-2 eyebrow font-normal">Equipo / Sede</th>
          <th class="px-5 py-2 eyebrow font-normal">Técnico</th>
          <th class="px-5 py-2 eyebrow font-normal text-center">Avance</th>
          <th class="px-5 py-2 eyebrow font-normal text-center">Estado</th>
          <th class="px-5 py-2 eyebrow font-normal">Inicio</th>
        </tr></thead>
        <tbody>
          <tr v-for="e in visibles" :key="e.id" class="border-b border-line last:border-0 hover:bg-secondary/40">
            <td class="px-4 py-3">
              <div class="flex items-center justify-center gap-1.5">
                <button @click="abrirReporte(e)" :disabled="abriendo === e.id"
                  :title="puedeReporte(e) ? 'Ver reporte' : 'Ver reporte en vivo (en proceso)'"
                  class="h-8 w-8 grid place-items-center rounded-md border border-line text-accent hover:bg-accent hover:text-white transition-colors disabled:opacity-50">
                  <LoaderCircle v-if="abriendo === e.id" :size="15" class="animate-spin" />
                  <ExternalLink v-else :size="15" />
                </button>
                <button v-if="e.evidenciaFirmaUrl" @click="firmaVista = e.evidenciaFirmaUrl"
                  title="Ver evidencia de la firma"
                  class="h-8 w-8 grid place-items-center rounded-md border border-line text-success hover:bg-success hover:text-white transition-colors">
                  <PenLine :size="15" />
                </button>
                <button v-if="e.estatus === 'faltante_firma'" @click="resolverFirma(e)" :disabled="resolviendo === e.id"
                  title="Marcar firma recibida"
                  class="h-8 w-8 grid place-items-center rounded-md border border-danger/50 text-danger hover:bg-danger hover:text-white transition-colors disabled:opacity-50">
                  <LoaderCircle v-if="resolviendo === e.id" :size="15" class="animate-spin" />
                  <Check v-else :size="15" />
                </button>
              </div>
            </td>
            <td class="px-5 py-3 font-medium text-ink">{{ nRutina(e.rutinaId) }}</td>
            <td class="px-5 py-3 text-ink-2"><span class="font-mono text-xs text-accent">{{ nEquipo(e.equipoId) }}</span> · {{ nSede(e.sedeId) }}</td>
            <td class="px-5 py-3 text-ink-2">{{ e.tecnicoNombre || e.tecnicoTelefono }}</td>
            <td class="px-5 py-3 text-center">{{ avance(e) }}</td>
            <td class="px-5 py-3 text-center"><span class="text-xs px-2 py-0.5 rounded-md" :class="COLOR[e.estatus]">{{ ETIQUETA[e.estatus] }}</span></td>
            <td class="px-5 py-3 text-muted-ink text-xs">{{ fecha(e.inicio) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Visor de la evidencia de firma -->
    <div v-if="firmaVista" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" @click.self="firmaVista = null">
      <div class="relative">
        <button @click="firmaVista = null" class="absolute -top-9 right-0 text-white/80 hover:text-white flex items-center gap-1 text-sm">
          <X :size="18" /> Cerrar
        </button>
        <img :src="firmaVista" alt="Hoja firmada" class="max-w-full max-h-[85vh] object-contain rounded-lg" />
      </div>
    </div>
  </div>
</template>
