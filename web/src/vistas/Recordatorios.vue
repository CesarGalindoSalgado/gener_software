<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { BellRing, Plus, LoaderCircle, Check, FileText, RotateCcw, Pencil, Trash2 } from 'lucide-vue-next';
import {
  crearRecordatorio,
  editarRecordatorio,
  eliminarRecordatorio,
  marcarRecordatorio,
  suscribirRecordatorios,
  type RecordatorioDoc,
} from '../servicios/recordatorios';
import { crearCotizacion } from '../servicios/cotizaciones';
import { confirmar } from '../components/confirmar';

const router = useRouter();

const items = ref<RecordatorioDoc[]>([]);
const cargando = ref(true);
const off = suscribirRecordatorios((lista) => {
  items.value = lista;
  cargando.value = false;
});
onUnmounted(off);

const pendientes = computed(() => items.value.filter((r) => r.estatus === 'pendiente'));
const hechos = computed(() => items.value.filter((r) => r.estatus === 'hecho'));

// --- Alta ---
const descripcion = ref('');
const clienteTexto = ref('');
const guardando = ref(false);
const error = ref('');

async function agregar() {
  if (!descripcion.value.trim() || guardando.value) return;
  guardando.value = true;
  error.value = '';
  try {
    await crearRecordatorio(descripcion.value.trim(), clienteTexto.value.trim() || undefined);
    descripcion.value = '';
    clienteTexto.value = '';
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo crear.';
  } finally {
    guardando.value = false;
  }
}

const procesando = ref<string | null>(null);
async function alternar(r: RecordatorioDoc) {
  procesando.value = r.id;
  try {
    await marcarRecordatorio(r.id, r.estatus === 'pendiente' ? 'hecho' : 'pendiente');
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo actualizar.';
  } finally {
    procesando.value = null;
  }
}

// --- Editar / Eliminar ---
const editando = ref<RecordatorioDoc | null>(null);
const editDesc = ref('');
const editCliente = ref('');
const guardandoEdit = ref(false);
const errorEdit = ref('');

function abrirEditar(r: RecordatorioDoc) {
  editando.value = r;
  editDesc.value = r.descripcion;
  editCliente.value = r.clienteTexto ?? '';
  errorEdit.value = '';
}

async function guardarEdicion() {
  if (!editando.value || guardandoEdit.value) return;
  if (!editDesc.value.trim()) {
    errorEdit.value = 'La descripción no puede ir vacía.';
    return;
  }
  guardandoEdit.value = true;
  errorEdit.value = '';
  try {
    await editarRecordatorio(editando.value.id, editDesc.value.trim(), editCliente.value.trim() || undefined);
    editando.value = null;
  } catch (e: unknown) {
    errorEdit.value = (e as { message?: string })?.message ?? 'No se pudo editar.';
  } finally {
    guardandoEdit.value = false;
  }
}

async function eliminar(r: RecordatorioDoc) {
  if (!(await confirmar({
    titulo: 'Eliminar recordatorio',
    mensaje: `Se eliminará "${r.descripcion}". No se puede deshacer.`,
    confirmar: 'Eliminar',
    peligro: true,
  }))) return;
  procesando.value = r.id;
  error.value = '';
  try {
    await eliminarRecordatorio(r.id);
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo eliminar.';
  } finally {
    procesando.value = null;
  }
}

// Convertir un recordatorio en cotización: crea el borrador con el cliente del
// recordatorio, lo marca hecho y abre el taller.
async function convertir(r: RecordatorioDoc) {
  procesando.value = r.id;
  error.value = '';
  try {
    const { cotizacionId } = await crearCotizacion(r.clienteTexto || 'Cliente', r.descripcion);
    await marcarRecordatorio(r.id, 'hecho');
    router.push({ name: 'taller', params: { id: cotizacionId } });
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo crear la cotización.';
    procesando.value = null;
  }
}
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Recordatorios</p>
    <h1 class="text-4xl mb-1">No se te <span class="italic text-brand-text">olvide</span></h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>

    <p class="text-sm text-muted-ink mt-3">
      Anota las cotizaciones que tienes que armar. Los lunes, miércoles y viernes, si hay
      pendientes, recibes un aviso por WhatsApp (a los dueños con teléfono registrado).
    </p>

    <!-- Alta -->
    <div class="bg-card border border-line rounded-lg shadow-sm p-5 mt-6">
      <form @submit.prevent="agregar" class="flex flex-wrap gap-3 items-end">
        <div class="flex-[2] min-w-64">
          <label class="eyebrow block mb-1">Qué cotizar</label>
          <input
            v-model="descripcion"
            required
            placeholder="Ej. Mantenimiento preventivo al generador"
            class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm"
          />
        </div>
        <div class="flex-1 min-w-40">
          <label class="eyebrow block mb-1">Cliente (opcional)</label>
          <input v-model="clienteTexto" placeholder="Ej. Jardines México" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
        </div>
        <button
          type="submit"
          :disabled="guardando || !descripcion.trim()"
          class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center gap-2"
        >
          <LoaderCircle v-if="guardando" :size="15" class="animate-spin" /><Plus v-else :size="16" /> Agregar
        </button>
      </form>
      <p v-if="error" class="text-sm text-danger mt-3">{{ error }}</p>
    </div>

    <div v-if="cargando" class="p-8 text-center text-muted-ink">
      <LoaderCircle :size="20" class="animate-spin mx-auto" />
    </div>

    <template v-else>
      <!-- Pendientes -->
      <p class="eyebrow mt-8 mb-3">Pendientes ({{ pendientes.length }})</p>
      <div v-if="pendientes.length === 0" class="border border-dashed border-line-strong rounded-lg p-6 text-center text-sm text-muted-ink">
        <BellRing :size="24" class="mx-auto text-muted-ink mb-2" /> Nada pendiente. ¡Vas al día!
      </div>
      <div v-else class="space-y-2">
        <div v-for="r in pendientes" :key="r.id" class="bg-card border border-line rounded-lg shadow-sm p-4 flex items-center gap-3">
          <button
            @click="alternar(r)"
            :disabled="procesando === r.id"
            class="w-5 h-5 rounded border-2 border-line-strong hover:border-accent flex items-center justify-center shrink-0"
            title="Marcar como hecho"
          ></button>
          <div class="flex-1 min-w-0">
            <p class="text-ink font-medium">{{ r.descripcion }}</p>
            <p v-if="r.clienteTexto" class="text-sm text-muted-ink">{{ r.clienteTexto }}</p>
          </div>
          <button
            @click="convertir(r)"
            :disabled="procesando === r.id"
            class="flex items-center gap-1.5 h-9 px-3 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 shrink-0"
          >
            <FileText :size="14" /> Crear cotización
          </button>
          <button @click="abrirEditar(r)" :disabled="procesando === r.id" class="text-muted-ink hover:text-accent shrink-0 p-1" title="Editar">
            <Pencil :size="16" />
          </button>
          <button @click="eliminar(r)" :disabled="procesando === r.id" class="text-muted-ink hover:text-danger shrink-0 p-1" title="Eliminar">
            <Trash2 :size="16" />
          </button>
        </div>
      </div>

      <!-- Hechos -->
      <template v-if="hechos.length">
        <p class="eyebrow mt-8 mb-3">Hechos ({{ hechos.length }})</p>
        <div class="space-y-2">
          <div v-for="r in hechos" :key="r.id" class="bg-secondary/40 border border-line rounded-lg p-3 flex items-center gap-3">
            <Check :size="16" class="text-success shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-muted-ink line-through">{{ r.descripcion }}</p>
            </div>
            <button
              @click="alternar(r)"
              :disabled="procesando === r.id"
              class="flex items-center gap-1 text-xs text-muted-ink hover:text-accent shrink-0"
            >
              <RotateCcw :size="13" /> Reactivar
            </button>
          </div>
        </div>
      </template>
    </template>

    <!-- ===== Modal editar recordatorio ===== -->
    <div v-if="editando" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div class="bg-card rounded-xl shadow-xl w-full max-w-md p-6">
        <p class="eyebrow eyebrow--marca">Editar recordatorio</p>
        <h2 class="text-xl mb-4">Ajusta el pendiente</h2>

        <div class="space-y-3">
          <div>
            <label class="eyebrow block mb-1">Qué cotizar</label>
            <input v-model="editDesc" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
          </div>
          <div>
            <label class="eyebrow block mb-1">Cliente (opcional)</label>
            <input v-model="editCliente" placeholder="Ej. Jardines México" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
          </div>
        </div>

        <p v-if="errorEdit" class="text-sm text-danger mt-3">{{ errorEdit }}</p>

        <div class="flex gap-2 mt-5">
          <button
            @click="guardarEdicion"
            :disabled="guardandoEdit"
            class="flex-1 h-10 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <LoaderCircle v-if="guardandoEdit" :size="15" class="animate-spin" />
            {{ guardandoEdit ? 'Guardando…' : 'Guardar cambios' }}
          </button>
          <button @click="editando = null" class="flex-1 h-10 rounded-md text-sm font-medium text-muted-ink hover:text-ink">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
