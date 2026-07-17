<script setup lang="ts">
import { onUnmounted, reactive, ref } from 'vue';
import { LayoutTemplate, Plus, LoaderCircle, Pencil, X, Check, Trash2 } from 'lucide-vue-next';
import { formatearMoneda } from '../dominio/totales';
import {
  actualizarPlantilla,
  crearPlantilla,
  suscribirPlantillas,
  type PlantillaDoc,
} from '../servicios/plantillas';

const plantillas = ref<PlantillaDoc[]>([]);
const cargando = ref(true);
const off = suscribirPlantillas((lista) => {
  plantillas.value = lista;
  cargando.value = false;
});
onUnmounted(off);

const error = ref('');

// Forma común de edición/alta. `subtipos` es una lista {nombre, precio}; cuando
// `tieneSubtipos` está activo, se usan esos en vez del precio único.
interface FormaPlantilla {
  nombre: string;
  precio: string | number;
  tieneSubtipos: boolean;
  subtipos: { nombre: string; precio: string | number }[];
  lineasTexto: string;
}
function nuevoSubtipo() {
  return { nombre: '', precio: '' as string | number };
}
function agregarSubtipo(f: FormaPlantilla) {
  f.subtipos.push(nuevoSubtipo());
}
function quitarSubtipo(f: FormaPlantilla, i: number) {
  f.subtipos.splice(i, 1);
}
// Al activar el checkbox, arranca con un subtipo vacío para capturar.
function alternarSubtipos(f: FormaPlantilla) {
  f.tieneSubtipos = !f.tieneSubtipos;
  if (f.tieneSubtipos && f.subtipos.length === 0) f.subtipos.push(nuevoSubtipo());
}
// Payload de precio/subtipos según el modo.
function payloadPrecio(f: FormaPlantilla) {
  if (f.tieneSubtipos) {
    return {
      tieneSubtipos: true,
      subtipos: f.subtipos
        .map((s) => ({ nombre: s.nombre.trim(), precio: Number(s.precio) || 0 }))
        .filter((s) => s.nombre),
      precioSugerido: null,
    };
  }
  return { tieneSubtipos: false, subtipos: [], precioSugerido: f.precio === '' ? null : Number(f.precio) };
}

// --- Edición inline (nombre, precio/subtipos, líneas) ---
const editandoId = ref<string | null>(null);
const guardando = ref(false);
const draft = reactive<FormaPlantilla>({ nombre: '', precio: '', tieneSubtipos: false, subtipos: [], lineasTexto: '' });

function abrirEdicion(p: PlantillaDoc) {
  editandoId.value = p.plantillaId;
  draft.nombre = p.nombre;
  draft.precio = p.precioSugerido ?? '';
  draft.tieneSubtipos = !!p.tieneSubtipos;
  draft.subtipos = (p.subtipos ?? []).map((s) => ({ nombre: s.nombre, precio: s.precio }));
  draft.lineasTexto = (p.lineas ?? []).join('\n');
  error.value = '';
}
function cancelar() {
  editandoId.value = null;
}
async function guardar(id: string) {
  guardando.value = true;
  error.value = '';
  try {
    await actualizarPlantilla({
      plantillaId: id,
      nombre: draft.nombre,
      ...payloadPrecio(draft),
      lineas: draft.lineasTexto.split('\n').map((l) => l.trim()).filter(Boolean),
    });
    editandoId.value = null;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo guardar.';
  } finally {
    guardando.value = false;
  }
}

async function alternarActiva(p: PlantillaDoc) {
  try {
    await actualizarPlantilla({ plantillaId: p.plantillaId, activa: !p.activa });
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo actualizar.';
  }
}

// --- Alta (en modal) ---
const creando = ref(false);
const modalAbierto = ref(false);
const nuevo = reactive<FormaPlantilla>({ nombre: '', precio: '', tieneSubtipos: false, subtipos: [], lineasTexto: '' });

function abrirModal() {
  nuevo.nombre = '';
  nuevo.precio = '';
  nuevo.tieneSubtipos = false;
  nuevo.subtipos = [];
  nuevo.lineasTexto = '';
  error.value = '';
  modalAbierto.value = true;
}
function cerrarModal() {
  if (creando.value) return;
  modalAbierto.value = false;
}
async function crear() {
  if (!nuevo.nombre.trim()) {
    error.value = 'El nombre es obligatorio.';
    return;
  }
  if (nuevo.tieneSubtipos && !nuevo.subtipos.some((s) => s.nombre.trim())) {
    error.value = 'Agrega al menos un subtipo con su nombre y precio.';
    return;
  }
  creando.value = true;
  error.value = '';
  try {
    await crearPlantilla({
      nombre: nuevo.nombre.trim(),
      ...payloadPrecio(nuevo),
      lineas: nuevo.lineasTexto.split('\n').map((l) => l.trim()).filter(Boolean),
    });
    modalAbierto.value = false;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo crear.';
  } finally {
    creando.value = false;
  }
}
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Administración</p>
    <div class="flex items-end justify-between">
      <div>
        <h1 class="text-4xl mb-1">Plantillas</h1>
        <div class="h-0.5 w-[90px] bg-brand"></div>
      </div>
      <button
        @click="abrirModal"
        class="flex items-center gap-2 h-10 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright"
      >
        <Plus :size="16" /> Nueva plantilla
      </button>
    </div>

    <p class="text-sm text-muted-ink mt-3">
      Bloques de servicio reutilizables. El <b>precio sugerido</b> es el que Portteo propondrá al
      insertar la plantilla (déjalo vacío si prefieres definirlo en cada cotización).
    </p>
    <p v-if="error" class="text-sm text-danger mt-3">{{ error }}</p>

    <div v-if="cargando" class="p-8 text-center text-muted-ink">
      <LoaderCircle :size="20" class="animate-spin mx-auto" />
    </div>

    <div v-else class="space-y-4 mt-6">
      <div v-for="p in plantillas" :key="p.plantillaId" class="bg-card border border-line rounded-lg shadow-sm">
        <!-- Modo lectura -->
        <div v-if="editandoId !== p.plantillaId" class="p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-xl">{{ p.nombre }}</h3>
                <span
                  v-if="!p.activa"
                  class="text-xs px-2 py-0.5 rounded-md bg-[#f9e6ea] text-danger"
                >inactiva</span>
              </div>
            </div>
            <div class="text-right shrink-0">
              <template v-if="p.tieneSubtipos && p.subtipos?.length">
                <div class="text-sm text-ink-2 space-y-0.5">
                  <div v-for="(s, i) in p.subtipos" :key="i" class="whitespace-nowrap">
                    <span class="text-muted-ink">{{ s.nombre }}:</span> <span class="font-medium text-brand-text">{{ formatearMoneda(s.precio) }}</span>
                  </div>
                </div>
                <p class="eyebrow mt-0.5">{{ p.subtipos.length }} subtipo{{ p.subtipos.length === 1 ? '' : 's' }}</p>
              </template>
              <template v-else>
                <div class="font-serif text-2xl text-brand-text">
                  {{ p.precioSugerido != null ? formatearMoneda(p.precioSugerido) : 'sin precio' }}
                </div>
                <p class="eyebrow">precio sugerido</p>
              </template>
            </div>
          </div>

          <details class="mt-3">
            <summary class="text-sm text-accent cursor-pointer">{{ p.lineas.length }} líneas de alcance</summary>
            <ul class="mt-2 pl-5 text-sm text-ink-2 list-disc space-y-0.5">
              <li v-for="(l, i) in p.lineas" :key="i">{{ l }}</li>
            </ul>
          </details>

          <div class="flex gap-4 mt-4 pt-3 border-t border-line">
            <button @click="abrirEdicion(p)" class="flex items-center gap-1.5 text-sm text-accent hover:text-accent-bright">
              <Pencil :size="14" /> Editar
            </button>
            <button @click="alternarActiva(p)" class="text-sm text-muted-ink hover:text-ink">
              {{ p.activa ? 'Desactivar' : 'Activar' }}
            </button>
          </div>
        </div>

        <!-- Modo edición -->
        <div v-else class="p-5 space-y-3">
          <div>
            <label class="eyebrow block mb-1">Nombre</label>
            <input v-model="draft.nombre" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
          </div>
          <div>
            <label class="flex items-center gap-2 text-sm cursor-pointer mb-2">
              <input type="checkbox" :checked="draft.tieneSubtipos" @change="alternarSubtipos(draft)" class="accent-[var(--color-accent)]" />
              Varios precios (subtipos)
            </label>
            <template v-if="!draft.tieneSubtipos">
              <label class="eyebrow block mb-1">Precio sugerido (MXN, vacío = sin precio)</label>
              <input v-model="draft.precio" type="number" min="0" step="0.01" class="w-48 h-10 px-3 rounded-md border border-line bg-white text-sm" />
            </template>
            <template v-else>
              <label class="eyebrow block mb-1">Subtipos (nombre y precio)</label>
              <div class="space-y-2">
                <div v-for="(s, i) in draft.subtipos" :key="i" class="flex gap-2 items-center">
                  <input v-model="s.nombre" placeholder="Nombre (ej. Chico)" class="flex-1 h-9 px-3 rounded-md border border-line bg-white text-sm" />
                  <input v-model="s.precio" type="number" min="0" step="0.01" placeholder="Precio" class="w-32 h-9 px-3 rounded-md border border-line bg-white text-sm" />
                  <button type="button" @click="quitarSubtipo(draft, i)" class="text-muted-ink hover:text-danger"><Trash2 :size="16" /></button>
                </div>
              </div>
              <button type="button" @click="agregarSubtipo(draft)" class="flex items-center gap-1 text-xs text-accent hover:text-accent-bright font-medium mt-2"><Plus :size="14" /> Agregar subtipo</button>
            </template>
          </div>
          <div>
            <label class="eyebrow block mb-1">Líneas de alcance (una por renglón)</label>
            <textarea v-model="draft.lineasTexto" rows="8" class="w-full px-3 py-2 rounded-md border border-line bg-white text-sm"></textarea>
          </div>
          <div class="flex gap-2">
            <button
              @click="guardar(p.plantillaId)"
              :disabled="guardando"
              class="h-9 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center gap-1.5"
            >
              <LoaderCircle v-if="guardando" :size="14" class="animate-spin" /><Check v-else :size="14" /> Guardar
            </button>
            <button @click="cancelar" class="h-9 px-4 rounded-md border border-line-strong text-sm text-ink-2 hover:border-accent flex items-center gap-1.5">
              <X :size="14" /> Cancelar
            </button>
          </div>
        </div>
      </div>

      <div v-if="plantillas.length === 0" class="p-10 text-center">
        <div class="border border-dashed border-line-strong rounded-lg p-8">
          <LayoutTemplate :size="28" class="mx-auto text-muted-ink mb-3" />
          <p class="text-muted-ink text-sm">No hay plantillas. Crea la primera.</p>
        </div>
      </div>
    </div>

    <!-- Modal: nueva plantilla -->
    <div v-if="modalAbierto" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="cerrarModal">
      <div class="bg-card rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div class="flex items-start justify-between p-6 border-b border-line">
          <div>
            <p class="eyebrow eyebrow--marca">Administración</p>
            <h2 class="text-2xl leading-tight">Nueva plantilla</h2>
          </div>
          <button @click="cerrarModal" class="text-muted-ink hover:text-ink"><X :size="20" /></button>
        </div>

        <div class="overflow-auto p-6 space-y-3">
          <div>
            <label class="eyebrow block mb-1">Nombre</label>
            <input v-model="nuevo.nombre" placeholder="Ej. Mantenimiento preventivo" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
          </div>
          <div>
            <label class="flex items-center gap-2 text-sm cursor-pointer mb-2">
              <input type="checkbox" :checked="nuevo.tieneSubtipos" @change="alternarSubtipos(nuevo)" class="accent-[var(--color-accent)]" />
              Varios precios (subtipos)
            </label>
            <template v-if="!nuevo.tieneSubtipos">
              <label class="eyebrow block mb-1">Precio sugerido (MXN, vacío = sin precio)</label>
              <input v-model="nuevo.precio" type="number" min="0" step="0.01" class="w-48 h-10 px-3 rounded-md border border-line bg-white text-sm" />
            </template>
            <template v-else>
              <label class="eyebrow block mb-1">Subtipos (nombre y precio)</label>
              <p class="text-xs text-muted-ink mb-2">Al usar la plantilla, Portteo preguntará cuál subtipo; el concepto será «Plantilla — Subtipo» con ese precio.</p>
              <div class="space-y-2">
                <div v-for="(s, i) in nuevo.subtipos" :key="i" class="flex gap-2 items-center">
                  <input v-model="s.nombre" placeholder="Nombre (ej. Chico)" class="flex-1 h-9 px-3 rounded-md border border-line bg-white text-sm" />
                  <input v-model="s.precio" type="number" min="0" step="0.01" placeholder="Precio" class="w-32 h-9 px-3 rounded-md border border-line bg-white text-sm" />
                  <button type="button" @click="quitarSubtipo(nuevo, i)" class="text-muted-ink hover:text-danger"><Trash2 :size="16" /></button>
                </div>
              </div>
              <button type="button" @click="agregarSubtipo(nuevo)" class="flex items-center gap-1 text-xs text-accent hover:text-accent-bright font-medium mt-2"><Plus :size="14" /> Agregar subtipo</button>
            </template>
          </div>
          <div>
            <label class="eyebrow block mb-1">Líneas de alcance (una por renglón)</label>
            <textarea v-model="nuevo.lineasTexto" rows="7" class="w-full px-3 py-2 rounded-md border border-line bg-white text-sm"></textarea>
          </div>
          <p v-if="error" class="text-sm text-danger">{{ error }}</p>
        </div>

        <div class="flex justify-end gap-2 p-4 border-t border-line">
          <button @click="cerrarModal" :disabled="creando" class="h-10 px-4 rounded-md border border-line-strong text-sm text-ink-2 hover:border-accent disabled:opacity-50">
            Cancelar
          </button>
          <button
            @click="crear"
            :disabled="creando"
            class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center gap-2"
          >
            <LoaderCircle v-if="creando" :size="15" class="animate-spin" /><Check v-else :size="15" /> Crear plantilla
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
