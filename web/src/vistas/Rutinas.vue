<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue';
import { Wrench, LoaderCircle, Eye, Plus, Camera, Images, Gauge, Trash2, X, Pencil, Settings2, Search } from 'lucide-vue-next';
import {
  actualizarRutina,
  crearRutina,
  crearTipoEquipo,
  eliminarRutina,
  eliminarTipoEquipo,
  suscribirRutinas,
  suscribirTiposEquipo,
  TIPOS_EQUIPO_BASE,
  type RutinaDoc,
  type EvidenciaTipo,
  type TipoEquipoDoc,
} from '../servicios/rutinas';
import { confirmar } from '../components/confirmar';

const rutinas = ref<RutinaDoc[]>([]);
const tipos = ref<TipoEquipoDoc[]>([]);
const cargando = ref(true);
const offs = [
  suscribirRutinas((lista) => {
    rutinas.value = lista;
    cargando.value = false;
  }),
  suscribirTiposEquipo((lista) => {
    tipos.value = lista;
  }),
];
onUnmounted(() => offs.forEach((o) => o()));

// Tipos disponibles = catálogo editable ∪ partidas ya en uso (∪ base si vacío).
const partidasDisponibles = computed(() => {
  const set = new Set<string>();
  tipos.value.forEach((t) => t.nombre && set.add(t.nombre));
  rutinas.value.forEach((r) => r.partida && set.add(r.partida));
  if (set.size === 0) TIPOS_EQUIPO_BASE.forEach((n) => set.add(n));
  return [...set].sort((a, b) => a.localeCompare(b));
});

const error = ref('');
const ok = ref('');

// --- Filtros: búsqueda general + tipo de equipo (partida) + estado ---
const busca = ref('');
const filtro = ref<string>('todas'); // por partida (tipo de equipo)
const estadoFiltro = ref<'todas' | 'activas' | 'inactivas'>('todas');

const visibles = computed(() => {
  const t = busca.value.trim().toLowerCase();
  return rutinas.value.filter((r) => {
    if (filtro.value !== 'todas' && r.partida !== filtro.value) return false;
    if (estadoFiltro.value === 'activas' && !r.activa) return false;
    if (estadoFiltro.value === 'inactivas' && r.activa) return false;
    if (t) {
      const heno = `${r.nombre ?? ''} ${r.partida ?? ''} ${r.id ?? ''}`.toLowerCase();
      if (!heno.includes(t)) return false;
    }
    return true;
  });
});
function cuenta(p: string): number {
  return rutinas.value.filter((r) => r.partida === p).length;
}
const hayFiltros = computed(() => !!busca.value || filtro.value !== 'todas' || estadoFiltro.value !== 'todas');
function limpiarFiltros() {
  busca.value = '';
  filtro.value = 'todas';
  estadoFiltro.value = 'todas';
}

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
const TIPOS: { v: EvidenciaTipo; t: string; ayuda: string }[] = [
  { v: 'foto_comentario', t: 'Foto + comentario', ayuda: 'Portteo pide una foto (y un comentario opcional).' },
  { v: 'antes_despues', t: 'Antes / después', ayuda: 'Portteo pide una foto de ANTES y otra de DESPUÉS.' },
  { v: 'medicion', t: 'Medición', ayuda: 'Portteo pide una lectura numérica (con unidad y rango opcional).' },
];

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

// --- Eliminar (con advertencia) ---
async function eliminar(r: RutinaDoc) {
  const n = r.pasos?.length ?? 0;
  if (
    !(await confirmar({
      titulo: 'Eliminar rutina',
      mensaje: `Se eliminará «${r.nombre}»${n ? ` y sus ${n} paso${n === 1 ? '' : 's'}` : ''}. Esta acción no se puede deshacer.`,
      confirmar: 'Eliminar',
      peligro: true,
    }))
  )
    return;
  procesando.value = r.id;
  error.value = '';
  ok.value = '';
  try {
    await eliminarRutina(r.id);
    ok.value = `Rutina «${r.nombre}» eliminada.`;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo eliminar.';
  } finally {
    procesando.value = null;
  }
}

// --- Gestionar tipos de equipo (catálogo editable) ---
const gestionando = ref(false);
const nuevoTipo = ref('');
const guardandoTipo = ref(false);
const errorTipo = ref('');
async function agregarTipo() {
  const n = nuevoTipo.value.trim();
  if (!n) return;
  guardandoTipo.value = true;
  errorTipo.value = '';
  try {
    await crearTipoEquipo(n);
    nuevoTipo.value = '';
  } catch (e: unknown) {
    errorTipo.value = (e as { message?: string })?.message ?? 'No se pudo agregar.';
  } finally {
    guardandoTipo.value = false;
  }
}
async function borrarTipo(t: TipoEquipoDoc) {
  const enUso = cuenta(t.nombre);
  if (
    !(await confirmar({
      titulo: 'Eliminar tipo de equipo',
      mensaje: `Se quitará «${t.nombre}» de la lista.${enUso ? ` ${enUso} rutina${enUso === 1 ? '' : 's'} lo usa${enUso === 1 ? '' : 'n'} y no cambiar${enUso === 1 ? 'á' : 'án'}.` : ''}`,
      confirmar: 'Eliminar',
      peligro: true,
    }))
  )
    return;
  errorTipo.value = '';
  try {
    await eliminarTipoEquipo(t.id);
  } catch (e: unknown) {
    errorTipo.value = (e as { message?: string })?.message ?? 'No se pudo eliminar.';
  }
}

// --- Nueva rutina (formulario amigable) ---
interface PasoForm {
  instruccion: string;
  tipo: EvidenciaTipo;
  unidad: string;
  rangoDefinido: boolean;
  rangoMin: number | null;
  rangoMax: number | null;
  requiereFoto: boolean;
}
function nuevoPaso(): PasoForm {
  return { instruccion: '', tipo: 'foto_comentario', unidad: '', rangoDefinido: false, rangoMin: null, rangoMax: null, requiereFoto: false };
}
function pasoAForm(p: RutinaDoc['pasos'][number]): PasoForm {
  const ev = p.evidencia;
  return {
    instruccion: p.instruccion,
    tipo: ev.tipo,
    unidad: ev.unidadSugerida ?? '',
    rangoDefinido: !!ev.rangoDefinido,
    rangoMin: ev.rangoMin ?? null,
    rangoMax: ev.rangoMax ?? null,
    requiereFoto: !!ev.requiereFoto,
  };
}

const creando = ref(false);
const editandoId = ref<string | null>(null); // null = alta nueva
const guardando = ref(false);
const form = reactive<{ nombre: string; partida: string; pasos: PasoForm[] }>({
  nombre: '',
  partida: 'Equipo electromecánico',
  pasos: [nuevoPaso()],
});

function abrirNueva() {
  editandoId.value = null;
  form.nombre = '';
  form.partida = partidasDisponibles.value[0] ?? 'Equipo electromecánico';
  form.pasos = [nuevoPaso()];
  error.value = '';
  ok.value = '';
  creando.value = true;
}

function abrirEditar(r: RutinaDoc) {
  editandoId.value = r.id;
  form.nombre = r.nombre;
  form.partida = r.partida;
  form.pasos = r.pasos?.length ? r.pasos.map(pasoAForm) : [nuevoPaso()];
  error.value = '';
  ok.value = '';
  creando.value = true;
}
function agregarPaso() {
  form.pasos.push(nuevoPaso());
}
function quitarPaso(i: number) {
  form.pasos.splice(i, 1);
}

async function guardarRutina() {
  const nombre = form.nombre.trim();
  if (!nombre) {
    error.value = 'Ponle un nombre a la rutina.';
    return;
  }
  const pasosLlenos = form.pasos.filter((p) => p.instruccion.trim());
  if (pasosLlenos.length === 0) {
    error.value = 'Agrega al menos un paso con su instrucción.';
    return;
  }
  const pasos = pasosLlenos.map((p, i) => {
    const evidencia: Record<string, unknown> = {
      tipo: p.tipo,
      requiereFoto: p.tipo === 'medicion' ? p.requiereFoto : true,
      fotosAntesDespues: p.tipo === 'antes_despues',
      requiereLectura: p.tipo === 'medicion',
    };
    if (p.tipo === 'medicion') {
      if (p.unidad.trim()) evidencia.unidadSugerida = p.unidad.trim();
      if (p.rangoDefinido && p.rangoMin != null && p.rangoMax != null) {
        evidencia.rangoDefinido = true;
        evidencia.rangoMin = Number(p.rangoMin);
        evidencia.rangoMax = Number(p.rangoMax);
        evidencia.graficoSugerido = true;
      }
    }
    return { orden: i + 1, instruccion: p.instruccion.trim(), evidencia };
  });

  guardando.value = true;
  error.value = '';
  try {
    if (editandoId.value) {
      await actualizarRutina({ rutinaId: editandoId.value, nombre, partida: form.partida, pasos });
      ok.value = `Rutina «${nombre}» actualizada (${pasos.length} paso${pasos.length === 1 ? '' : 's'}).`;
    } else {
      await crearRutina({ nombre, partida: form.partida, pasos, activa: true });
      ok.value = `Rutina «${nombre}» creada con ${pasos.length} paso${pasos.length === 1 ? '' : 's'}.`;
    }
    creando.value = false;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo guardar la rutina.';
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Rutinas</p>
    <div class="flex items-end justify-between gap-4">
      <div>
        <h1 class="text-4xl mb-1">Catálogo de <span class="italic text-brand-text">rutinas</span></h1>
        <div class="h-0.5 w-[90px] bg-brand"></div>
      </div>
      <button
        @click="abrirNueva"
        class="flex items-center gap-2 h-10 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright shrink-0"
      >
        <Plus :size="16" /> Nueva rutina
      </button>
    </div>

    <p class="text-sm text-muted-ink mt-3">
      Rutinas de mantenimiento por tipo de equipo. Cada una define sus pasos y el tipo de evidencia que pedirá Portteo en campo.
    </p>

    <p v-if="ok" class="text-sm text-success mt-4">{{ ok }}</p>
    <p v-if="error && !creando" class="text-sm text-danger mt-4">{{ error }}</p>

    <!-- Búsqueda general + estado -->
    <div class="mt-6 flex flex-wrap items-center gap-3">
      <div class="relative flex-1 min-w-56">
        <Search :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
        <input v-model="busca" placeholder="Buscar rutina por nombre o tipo de equipo…" class="h-10 w-full pl-9 pr-3 rounded-md border border-line bg-white text-sm" />
      </div>
      <div class="flex items-center gap-1">
        <button
          v-for="e in (['todas','activas','inactivas'] as const)"
          :key="e"
          @click="estadoFiltro = e"
          class="text-xs px-3 py-1.5 rounded-md border"
          :class="estadoFiltro === e ? 'bg-accent text-white border-accent' : 'border-line text-ink-2 hover:border-accent'"
        >
          {{ e === 'todas' ? 'Todas' : e === 'activas' ? 'Activas' : 'Inactivas' }}
        </button>
      </div>
      <button v-if="hayFiltros" @click="limpiarFiltros" class="h-10 px-3 rounded-md border border-line text-sm text-muted-ink hover:text-ink flex items-center gap-1">
        <X :size="14" /> Limpiar
      </button>
    </div>

    <!-- Filtro por tipo de equipo (partida) -->
    <div class="flex flex-wrap items-center gap-2 mt-3">
      <button
        @click="filtro = 'todas'"
        class="text-xs px-3 py-1.5 rounded-md border"
        :class="filtro === 'todas' ? 'bg-accent text-white border-accent' : 'border-line text-ink-2 hover:border-accent'"
      >
        Todos los tipos ({{ rutinas.length }})
      </button>
      <button
        v-for="p in partidasDisponibles"
        :key="p"
        @click="filtro = p"
        class="text-xs px-3 py-1.5 rounded-md border"
        :class="filtro === p ? 'bg-accent text-white border-accent' : 'border-line text-ink-2 hover:border-accent'"
      >
        {{ p }} ({{ cuenta(p) }})
      </button>
      <span class="text-line-strong">·</span>
      <button
        @click="gestionando = true"
        class="flex items-center gap-1 text-xs text-muted-ink hover:text-accent"
        title="Agregar o quitar tipos de equipo"
      >
        <Settings2 :size="13" /> Gestionar tipos
      </button>
      <span class="text-xs text-muted-ink ml-1">{{ visibles.length }} resultado{{ visibles.length === 1 ? '' : 's' }}</span>
    </div>

    <div v-if="cargando" class="p-10 text-center text-muted-ink">
      <LoaderCircle :size="20" class="animate-spin mx-auto" />
    </div>
    <div v-else-if="rutinas.length === 0" class="p-10 text-center mt-6">
      <div class="border border-dashed border-line-strong rounded-lg p-8">
        <Wrench :size="28" class="mx-auto text-muted-ink mb-3" />
        <p class="text-muted-ink text-sm">Aún no hay rutinas. Crea la primera con «Nueva rutina».</p>
      </div>
    </div>
    <div v-else-if="visibles.length === 0" class="p-10 text-center mt-6">
      <div class="border border-dashed border-line-strong rounded-lg p-8">
        <Search :size="28" class="mx-auto text-muted-ink mb-3" />
        <p class="text-muted-ink text-sm">Ninguna rutina coincide con los filtros.</p>
        <button @click="limpiarFiltros" class="text-sm text-accent hover:text-accent-bright mt-2">Limpiar filtros</button>
      </div>
    </div>

    <div v-else class="bg-card border border-line rounded-lg shadow-sm mt-6 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[560px]">
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
                  <button @click="viendo = r" class="flex items-center gap-1 text-xs text-accent hover:text-accent-bright" title="Ver pasos">
                    <Eye :size="14" /> Ver
                  </button>
                  <button @click="abrirEditar(r)" class="flex items-center gap-1 text-xs text-ink-2 hover:text-accent" title="Editar rutina">
                    <Pencil :size="14" /> Editar
                  </button>
                  <button
                    @click="alternarActiva(r)"
                    :disabled="procesando === r.id"
                    class="text-xs text-muted-ink hover:text-ink disabled:opacity-50"
                  >
                    {{ procesando === r.id ? '…' : r.activa ? 'Desactivar' : 'Activar' }}
                  </button>
                  <button
                    @click="eliminar(r)"
                    :disabled="procesando === r.id"
                    class="text-muted-ink hover:text-danger disabled:opacity-50"
                    title="Eliminar rutina"
                  >
                    <Trash2 :size="15" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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

    <!-- Modal NUEVA rutina -->
    <div v-if="creando" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div class="bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div class="p-6 border-b border-line flex items-start justify-between">
          <div>
            <p class="eyebrow eyebrow--marca">Rutinas</p>
            <h2 class="text-xl leading-tight">{{ editandoId ? 'Editar rutina' : 'Nueva rutina' }}</h2>
          </div>
          <button @click="creando = false" class="text-muted-ink hover:text-ink"><X :size="20" /></button>
        </div>

        <div class="overflow-auto p-6 space-y-5">
          <!-- Datos generales -->
          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="eyebrow block mb-1">Nombre de la rutina</label>
              <input v-model="form.nombre" placeholder="Ej. Mantenimiento preventivo de UPS" class="h-10 w-full px-3 rounded-md border border-line bg-white text-sm" />
            </div>
            <div>
              <label class="eyebrow block mb-1">Tipo de equipo (partida)</label>
              <select v-model="form.partida" class="h-10 w-full px-3 rounded-md border border-line bg-white text-sm">
                <option v-for="p in partidasDisponibles" :key="p" :value="p">{{ p }}</option>
              </select>
              <button type="button" @click="gestionando = true" class="text-xs text-accent hover:text-accent-bright mt-1">
                + Gestionar tipos
              </button>
            </div>
          </div>

          <!-- Pasos -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="eyebrow">Pasos ({{ form.pasos.length }})</label>
              <button @click="agregarPaso" class="flex items-center gap-1 text-xs text-accent hover:text-accent-bright font-medium">
                <Plus :size="14" /> Agregar paso
              </button>
            </div>

            <div class="space-y-3">
              <div v-for="(p, i) in form.pasos" :key="i" class="border border-line rounded-lg p-3 bg-secondary/30">
                <div class="flex items-start gap-2">
                  <span class="mt-2 text-xs font-mono text-muted-ink w-5 shrink-0 text-right">{{ i + 1 }}</span>
                  <div class="flex-1 min-w-0 space-y-2">
                    <input
                      v-model="p.instruccion"
                      :placeholder="`Instrucción del paso ${i + 1} (ej. Limpiar filtros de aire)`"
                      class="h-9 w-full px-3 rounded-md border border-line bg-white text-sm"
                    />
                    <div class="flex flex-wrap items-center gap-2">
                      <select v-model="p.tipo" class="h-9 px-2 rounded-md border border-line bg-white text-xs">
                        <option v-for="t in TIPOS" :key="t.v" :value="t.v">{{ t.t }}</option>
                      </select>

                      <!-- Campos extra para medición -->
                      <template v-if="p.tipo === 'medicion'">
                        <input v-model="p.unidad" placeholder="Unidad (V, °C, PSI…)" class="h-9 w-28 px-2 rounded-md border border-line bg-white text-xs" />
                        <label class="flex items-center gap-1 text-xs text-ink-2">
                          <input v-model="p.rangoDefinido" type="checkbox" class="accent-[var(--color-accent)]" /> Rango
                        </label>
                        <template v-if="p.rangoDefinido">
                          <input v-model.number="p.rangoMin" type="number" placeholder="mín" class="h-9 w-16 px-2 rounded-md border border-line bg-white text-xs" />
                          <span class="text-muted-ink text-xs">–</span>
                          <input v-model.number="p.rangoMax" type="number" placeholder="máx" class="h-9 w-16 px-2 rounded-md border border-line bg-white text-xs" />
                        </template>
                        <label class="flex items-center gap-1 text-xs text-ink-2">
                          <input v-model="p.requiereFoto" type="checkbox" class="accent-[var(--color-accent)]" /> + foto
                        </label>
                      </template>
                    </div>
                    <p class="text-[11px] text-muted-ink">{{ TIPOS.find((t) => t.v === p.tipo)?.ayuda }}</p>
                  </div>
                  <button
                    v-if="form.pasos.length > 1"
                    @click="quitarPaso(i)"
                    class="mt-1 text-muted-ink hover:text-danger shrink-0"
                    title="Quitar paso"
                  >
                    <Trash2 :size="16" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <p v-if="error" class="text-sm text-danger">{{ error }}</p>
        </div>

        <div class="p-4 border-t border-line flex justify-end gap-2">
          <button @click="creando = false" class="h-10 px-4 rounded-md border border-line text-sm text-muted-ink hover:text-ink">Cancelar</button>
          <button
            @click="guardarRutina"
            :disabled="guardando"
            class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 inline-flex items-center gap-2"
          >
            <LoaderCircle v-if="guardando" :size="15" class="animate-spin" />
            {{ guardando ? 'Guardando…' : editandoId ? 'Guardar cambios' : 'Crear rutina' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Modal GESTIONAR tipos de equipo -->
    <div v-if="gestionando" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div class="bg-card rounded-xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div class="p-6 border-b border-line flex items-start justify-between">
          <div>
            <p class="eyebrow eyebrow--marca">Rutinas</p>
            <h2 class="text-xl leading-tight">Tipos de equipo</h2>
          </div>
          <button @click="gestionando = false" class="text-muted-ink hover:text-ink"><X :size="20" /></button>
        </div>

        <div class="p-6 space-y-4 overflow-auto">
          <p class="text-xs text-muted-ink">
            Las categorías que aparecen al crear una rutina. Agrega las que uses en G-ener.
          </p>

          <!-- Agregar -->
          <div class="flex gap-2">
            <input
              v-model="nuevoTipo"
              @keyup.enter="agregarTipo"
              placeholder="Ej. Equipo hidráulico"
              class="h-10 flex-1 px-3 rounded-md border border-line bg-white text-sm"
            />
            <button
              @click="agregarTipo"
              :disabled="guardandoTipo || !nuevoTipo.trim()"
              class="h-10 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 inline-flex items-center gap-1"
            >
              <LoaderCircle v-if="guardandoTipo" :size="15" class="animate-spin" /><Plus v-else :size="15" /> Agregar
            </button>
          </div>
          <p v-if="errorTipo" class="text-sm text-danger">{{ errorTipo }}</p>

          <!-- Lista -->
          <ul v-if="tipos.length" class="divide-y divide-line border border-line rounded-lg">
            <li v-for="t in tipos" :key="t.id" class="px-4 py-2.5 flex items-center justify-between">
              <span class="text-sm">{{ t.nombre }}<span class="text-xs text-muted-ink"> · {{ cuenta(t.nombre) }} rutina(s)</span></span>
              <button @click="borrarTipo(t)" class="text-muted-ink hover:text-danger" title="Eliminar tipo">
                <Trash2 :size="15" />
              </button>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-ink text-center py-4">
            Aún no hay tipos en el catálogo. Se muestran los base ({{ TIPOS_EQUIPO_BASE.join(', ') }}) hasta que agregues los tuyos.
          </p>
        </div>

        <div class="p-4 border-t border-line text-right">
          <button @click="gestionando = false" class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright">Listo</button>
        </div>
      </div>
    </div>
  </div>
</template>
