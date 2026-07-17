<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { Lightbulb, LoaderCircle, Check, RotateCcw } from 'lucide-vue-next';
import { suscribirOportunidades, atenderOportunidad, type OportunidadDoc } from '../servicios/oportunidades';
import { suscribirEquipos, suscribirSedes, type EquipoDoc, type SedeDoc } from '../servicios/rutinas';

const oportunidades = ref<OportunidadDoc[]>([]);
const equipos = ref<EquipoDoc[]>([]);
const sedes = ref<SedeDoc[]>([]);
const cargando = ref(true);
const offs = [
  suscribirOportunidades((l) => { oportunidades.value = l; cargando.value = false; }),
  suscribirEquipos((l) => (equipos.value = l)),
  suscribirSedes((l) => (sedes.value = l)),
];
onUnmounted(() => offs.forEach((o) => o()));

const nEquipo = (id?: string | null) => equipos.value.find((e) => e.id === id)?.noInventario ?? null;
const nSede = (id: string) => sedes.value.find((s) => s.id === id)?.nombre ?? '—';

const filtro = ref<'abierta' | 'atendida'>('abierta');
const visibles = computed(() => oportunidades.value.filter((o) => o.estatus === filtro.value));
const nAbiertas = computed(() => oportunidades.value.filter((o) => o.estatus === 'abierta').length);

const error = ref('');
const procesando = ref<string | null>(null);
async function cambiar(o: OportunidadDoc, estatus: 'abierta' | 'atendida') {
  procesando.value = o.id;
  error.value = '';
  try {
    await atenderOportunidad(o.id, estatus);
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo actualizar.';
  } finally {
    procesando.value = null;
  }
}
function fecha(t?: { toDate?: () => Date } | null): string {
  const d = t?.toDate?.();
  return d ? d.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
}
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Rutinas</p>
    <h1 class="text-4xl mb-1">Oportunidades <span class="italic text-brand-text">de negocio</span></h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>
    <p class="text-sm text-muted-ink mt-3">Ventas potenciales que los técnicos detectan en sitio durante las rutinas.</p>
    <p v-if="error" class="text-sm text-danger mt-3">{{ error }}</p>

    <div class="flex gap-2 mt-6">
      <button v-for="f in (['abierta','atendida'] as const)" :key="f" @click="filtro = f"
        class="text-xs px-3 py-1.5 rounded-md border"
        :class="filtro === f ? 'bg-accent text-white border-accent' : 'border-line text-ink-2 hover:border-accent'">
        {{ f === 'abierta' ? `Abiertas${nAbiertas ? ' (' + nAbiertas + ')' : ''}` : 'Atendidas' }}
      </button>
    </div>

    <div v-if="cargando" class="p-10 text-center text-muted-ink"><LoaderCircle :size="20" class="animate-spin mx-auto" /></div>
    <div v-else-if="visibles.length === 0" class="p-10 text-center mt-6">
      <div class="border border-dashed border-line-strong rounded-lg p-8">
        <Lightbulb :size="28" class="mx-auto text-muted-ink mb-3" />
        <p class="text-muted-ink text-sm">
          {{ filtro === 'abierta' ? 'No hay oportunidades abiertas. Cuando un técnico anote una en campo, aparecerá aquí.' : 'No hay oportunidades atendidas todavía.' }}
        </p>
      </div>
    </div>

    <div v-else class="space-y-3 mt-6">
      <div v-for="o in visibles" :key="o.id" class="bg-card border border-line rounded-lg shadow-sm p-4 flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="text-ink flex items-start gap-2"><Lightbulb :size="16" class="text-brand shrink-0 mt-0.5" /> {{ o.texto }}</p>
          <p class="text-xs text-muted-ink mt-1">
            <span v-if="nEquipo(o.equipoId)" class="font-mono text-accent">{{ nEquipo(o.equipoId) }}</span>
            <span v-if="nEquipo(o.equipoId)"> · </span>{{ nSede(o.sedeId) }}
            <span v-if="o.tecnicoNombre"> · {{ o.tecnicoNombre }}</span> · {{ fecha(o.fecha) }}
          </p>
        </div>
        <button v-if="o.estatus === 'abierta'" @click="cambiar(o, 'atendida')" :disabled="procesando === o.id"
          class="shrink-0 h-9 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 inline-flex items-center gap-2">
          <LoaderCircle v-if="procesando === o.id" :size="14" class="animate-spin" /><Check v-else :size="14" /> Atendida
        </button>
        <button v-else @click="cambiar(o, 'abierta')" :disabled="procesando === o.id"
          class="shrink-0 h-9 px-3 rounded-md border border-line text-sm text-muted-ink hover:text-ink disabled:opacity-50 inline-flex items-center gap-2">
          <RotateCcw :size="14" /> Reabrir
        </button>
      </div>
    </div>
  </div>
</template>
