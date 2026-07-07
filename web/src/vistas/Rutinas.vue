<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { Wrench, LoaderCircle, Eye, Upload, Camera, Images, Gauge } from 'lucide-vue-next';
import { sesion } from '../sesion';
import {
  actualizarRutina,
  importarRutinas,
  suscribirRutinas,
  type RutinaDoc,
  type EvidenciaTipo,
} from '../servicios/rutinas';

const rutinas = ref<RutinaDoc[]>([]);
const cargando = ref(true);
const off = suscribirRutinas((lista) => {
  rutinas.value = lista;
  cargando.value = false;
});
onUnmounted(off);

const esSuperAdmin = computed(() => sesion.usuario?.rol === 'superAdmin');
const error = ref('');
const ok = ref('');

// --- Filtro por partida ---
const filtro = ref<'todas' | 'Equipo médico' | 'Equipo electromecánico'>('todas');
const visibles = computed(() =>
  filtro.value === 'todas' ? rutinas.value : rutinas.value.filter((r) => r.partida === filtro.value)
);
const totalMedico = computed(() => rutinas.value.filter((r) => r.partida === 'Equipo médico').length);
const totalElectro = computed(() => rutinas.value.filter((r) => r.partida === 'Equipo electromecánico').length);

// --- Ver pasos ---
const viendo = ref<RutinaDoc | null>(null);
const iconoEvidencia: Record<EvidenciaTipo, typeof Camera> = {
  foto_comentario: Camera,
  antes_despues: Images,
  medicion: Gauge,
};
const etiquetaEvidencia: Record<EvidenciaTipo, string> = {
  foto_comentario: 'Foto + comentario',
  antes_despues: 'Antes / después',
  medicion: 'Medición',
};

// --- Activar / desactivar ---
const procesando = ref<string | null>(null);
async function alternarActiva(r: RutinaDoc) {
  procesando.value = r.id;
  error.value = '';
  try {
    await actualizarRutina({ rutinaId: r.id, activa: !r.activa });
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo actualizar.';
  } finally {
    procesando.value = null;
  }
}

// --- Importar seed (JSON) ---
const importando = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
async function alSeleccionarArchivo(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  importando.value = true;
  error.value = '';
  ok.value = '';
  try {
    const texto = await file.text();
    const arr = JSON.parse(texto);
    if (!Array.isArray(arr)) throw new Error('El archivo no es un arreglo de rutinas.');
    const res = await importarRutinas(arr);
    ok.value = `Importadas ${res.importadas} rutinas.`;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo importar el archivo.';
  } finally {
    importando.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Rutinas</p>
    <div class="flex items-end justify-between">
      <div>
        <h1 class="text-4xl mb-1">Catálogo de <span class="italic text-brand-text">rutinas</span></h1>
        <div class="h-0.5 w-[90px] bg-brand"></div>
      </div>
      <div v-if="esSuperAdmin">
        <input ref="fileInput" type="file" accept="application/json" class="hidden" @change="alSeleccionarArchivo" />
        <button
          @click="fileInput?.click()"
          :disabled="importando"
          class="flex items-center gap-2 h-10 px-4 rounded-md border border-line-strong text-sm font-medium text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <LoaderCircle v-if="importando" :size="16" class="animate-spin" /><Upload v-else :size="16" />
          {{ importando ? 'Importando…' : 'Importar seed (JSON)' }}
        </button>
      </div>
    </div>

    <p class="text-sm text-muted-ink mt-3">
      Rutinas de mantenimiento por tipo de equipo. Cada una define sus pasos y el tipo de evidencia que pedirá Portteo en campo.
    </p>

    <p v-if="ok" class="text-sm text-success mt-4">{{ ok }}</p>
    <p v-if="error" class="text-sm text-danger mt-4">{{ error }}</p>

    <!-- Filtro -->
    <div class="flex gap-2 mt-6">
      <button
        v-for="f in (['todas', 'Equipo médico', 'Equipo electromecánico'] as const)"
        :key="f"
        @click="filtro = f"
        class="text-xs px-3 py-1.5 rounded-md border"
        :class="filtro === f ? 'bg-accent text-white border-accent' : 'border-line text-ink-2 hover:border-accent'"
      >
        {{ f === 'todas' ? `Todas (${rutinas.length})` : f === 'Equipo médico' ? `Médico (${totalMedico})` : `Electromecánico (${totalElectro})` }}
      </button>
    </div>

    <div v-if="cargando" class="p-10 text-center text-muted-ink">
      <LoaderCircle :size="20" class="animate-spin mx-auto" />
    </div>
    <div v-else-if="rutinas.length === 0" class="p-10 text-center mt-6">
      <div class="border border-dashed border-line-strong rounded-lg p-8">
        <Wrench :size="28" class="mx-auto text-muted-ink mb-3" />
        <p class="text-muted-ink text-sm">Aún no hay rutinas. {{ esSuperAdmin ? 'Importa el seed (JSON) para cargarlas.' : 'Pide a un superAdmin que cargue el seed.' }}</p>
      </div>
    </div>

    <div v-else class="bg-card border border-line rounded-lg shadow-sm mt-6 overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left border-b border-line">
            <th class="px-5 py-2 eyebrow font-normal">Rutina</th>
            <th class="px-5 py-2 eyebrow font-normal">Partida</th>
            <th class="px-5 py-2 eyebrow font-normal text-center">Pasos</th>
            <th class="px-5 py-2 eyebrow font-normal text-center">Estado</th>
            <th class="px-5 py-2 eyebrow font-normal text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in visibles" :key="r.id" class="border-b border-line last:border-0 hover:bg-secondary/40">
            <td class="px-5 py-3">
              <p class="font-medium text-ink leading-tight">{{ r.nombre }}</p>
              <p class="text-xs text-muted-ink font-mono">{{ r.id }}</p>
            </td>
            <td class="px-5 py-3">
              <span class="text-xs px-2 py-0.5 rounded-md bg-secondary text-ink-2">{{ r.partida }}</span>
            </td>
            <td class="px-5 py-3 text-center">{{ r.pasos?.length ?? 0 }}</td>
            <td class="px-5 py-3 text-center">
              <span class="text-xs" :class="r.activa ? 'text-success' : 'text-muted-ink'">{{ r.activa ? 'Activa' : 'Inactiva' }}</span>
            </td>
            <td class="px-5 py-3 text-right">
              <div class="flex items-center justify-end gap-3">
                <button @click="viendo = r" class="flex items-center gap-1 text-xs text-accent hover:text-accent-bright">
                  <Eye :size="14" /> Ver pasos
                </button>
                <button
                  @click="alternarActiva(r)"
                  :disabled="procesando === r.id"
                  class="text-xs text-muted-ink hover:text-ink disabled:opacity-50"
                >
                  {{ procesando === r.id ? '…' : r.activa ? 'Desactivar' : 'Activar' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal ver pasos -->
    <div v-if="viendo" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div class="bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div class="p-6 border-b border-line">
          <p class="eyebrow eyebrow--marca">{{ viendo.partida }}</p>
          <h2 class="text-xl leading-tight">{{ viendo.nombre }}</h2>
          <p v-if="viendo.equiposIncluidos?.length" class="text-xs text-muted-ink mt-1">
            Equipos: {{ viendo.equiposIncluidos.join(' · ') }}
          </p>
        </div>
        <div class="overflow-auto p-6 space-y-2">
          <div v-for="p in viendo.pasos" :key="p.orden" class="flex items-start gap-3 py-2 border-b border-line last:border-0">
            <span class="text-xs font-mono text-muted-ink w-6 shrink-0 text-right">{{ p.orden }}</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-ink">{{ p.instruccion }}</p>
              <p class="text-xs text-muted-ink mt-0.5 flex items-center gap-1">
                <component :is="iconoEvidencia[p.evidencia.tipo]" :size="12" />
                {{ etiquetaEvidencia[p.evidencia.tipo] }}
                <template v-if="p.evidencia.unidadSugerida"> · {{ p.evidencia.unidadSugerida }}</template>
                <template v-if="p.evidencia.rangoDefinido"> · rango {{ p.evidencia.rangoMin }}–{{ p.evidencia.rangoMax }}</template>
              </p>
            </div>
          </div>
        </div>
        <div class="p-4 border-t border-line text-right">
          <button @click="viendo = null" class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright">Cerrar</button>
        </div>
      </div>
    </div>
  </div>
</template>
