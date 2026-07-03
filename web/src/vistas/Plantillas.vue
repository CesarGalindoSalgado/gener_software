<script setup lang="ts">
import { onUnmounted, reactive, ref } from 'vue';
import { LayoutTemplate, Plus, LoaderCircle, Pencil, X, Check } from 'lucide-vue-next';
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

// --- Edición inline (nombre, precio, líneas, descripción) ---
const editandoId = ref<string | null>(null);
const guardando = ref(false);
const draft = reactive({ nombre: '', descripcion: '', precio: '' as string | number, lineasTexto: '' });

function abrirEdicion(p: PlantillaDoc) {
  editandoId.value = p.plantillaId;
  draft.nombre = p.nombre;
  draft.descripcion = p.descripcion ?? '';
  draft.precio = p.precioSugerido ?? '';
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
      descripcion: draft.descripcion,
      precioSugerido: draft.precio === '' ? null : Number(draft.precio),
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

// --- Alta ---
const creando = ref(false);
async function nueva() {
  creando.value = true;
  error.value = '';
  try {
    const { plantillaId } = await crearPlantilla({ nombre: 'Nueva plantilla', lineas: [] });
    // Abre en edición la recién creada.
    setTimeout(() => {
      const p = plantillas.value.find((x) => x.plantillaId === plantillaId);
      if (p) abrirEdicion(p);
    }, 400);
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo crear.';
  } finally {
    creando.value = false;
  }
}
</script>

<template>
  <div class="p-8 max-w-4xl">
    <p class="eyebrow eyebrow--marca">Administración</p>
    <div class="flex items-end justify-between">
      <div>
        <h1 class="text-4xl mb-1">Plantillas</h1>
        <div class="h-0.5 w-[90px] bg-brand"></div>
      </div>
      <button
        @click="nueva"
        :disabled="creando"
        class="flex items-center gap-2 h-10 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50"
      >
        <LoaderCircle v-if="creando" :size="15" class="animate-spin" /><Plus v-else :size="16" /> Nueva plantilla
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
              <p v-if="p.descripcion" class="text-sm text-muted-ink mt-1">{{ p.descripcion }}</p>
            </div>
            <div class="text-right shrink-0">
              <div class="font-serif text-2xl text-brand-text">
                {{ p.precioSugerido != null ? formatearMoneda(p.precioSugerido) : 'sin precio' }}
              </div>
              <p class="eyebrow">precio sugerido</p>
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
            <label class="eyebrow block mb-1">Descripción</label>
            <input v-model="draft.descripcion" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
          </div>
          <div>
            <label class="eyebrow block mb-1">Precio sugerido (MXN, vacío = sin precio)</label>
            <input v-model="draft.precio" type="number" min="0" step="0.01" class="w-48 h-10 px-3 rounded-md border border-line bg-white text-sm" />
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
  </div>
</template>
