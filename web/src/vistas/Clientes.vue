<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { Users, Plus, LoaderCircle, Pencil, Trash2, Check, X, Search, Contact } from 'lucide-vue-next';
import {
  suscribirClientes,
  crearCliente,
  renombrarCliente,
  eliminarCliente,
  guardarContactosCliente,
  type ClienteDoc,
  type ContactoCliente,
} from '../servicios/rutinas';
import { confirmar } from '../components/confirmar';

const clientes = ref<ClienteDoc[]>([]);
const cargando = ref(true);
const off = suscribirClientes((l) => {
  clientes.value = [...l].sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''));
  cargando.value = false;
});
onUnmounted(off);

const error = ref('');
const busca = ref('');
const visibles = computed(() => {
  const t = busca.value.trim().toLowerCase();
  return t ? clientes.value.filter((c) => (c.nombre ?? '').toLowerCase().includes(t)) : clientes.value;
});

// --- Agregar ---
const nuevo = ref('');
const agregando = ref(false);
async function agregar() {
  const n = nuevo.value.trim();
  if (!n || agregando.value) return;
  agregando.value = true;
  error.value = '';
  try {
    await crearCliente(n);
    nuevo.value = '';
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo agregar.';
  } finally {
    agregando.value = false;
  }
}

// --- Renombrar en línea ---
const editId = ref<string | null>(null);
const editNombre = ref('');
const guardando = ref(false);
function abrirEdit(c: ClienteDoc) {
  editId.value = c.id;
  editNombre.value = c.nombre ?? '';
  error.value = '';
}
async function guardar() {
  if (!editId.value || !editNombre.value.trim() || guardando.value) return;
  guardando.value = true;
  error.value = '';
  try {
    await renombrarCliente(editId.value, editNombre.value.trim());
    editId.value = null;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo renombrar.';
  } finally {
    guardando.value = false;
  }
}

// --- Contactos (varios por cliente) ---
const contactosCliente = ref<ClienteDoc | null>(null); // cliente cuyo modal está abierto
const formContactos = ref<ContactoCliente[]>([]);
const guardandoContactos = ref(false);
function nContactos(c: ClienteDoc): number {
  return c.contactos?.length ?? 0;
}
function abrirContactos(c: ClienteDoc) {
  contactosCliente.value = c;
  // Copia editable (no tocamos el doc hasta guardar).
  formContactos.value = (c.contactos ?? []).map((x) => ({
    nombre: x.nombre ?? '',
    puesto: x.puesto ?? '',
    correo: x.correo ?? '',
    telefono: x.telefono ?? '',
  }));
  error.value = '';
}
function agregarContacto() {
  formContactos.value.push({ nombre: '', puesto: '', correo: '', telefono: '' });
}
function quitarContacto(i: number) {
  formContactos.value.splice(i, 1);
}
async function guardarContactos() {
  if (!contactosCliente.value || guardandoContactos.value) return;
  guardandoContactos.value = true;
  error.value = '';
  try {
    await guardarContactosCliente(contactosCliente.value.id, formContactos.value);
    contactosCliente.value = null;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudieron guardar los contactos.';
  } finally {
    guardandoContactos.value = false;
  }
}

// --- Eliminar ---
const procesando = ref<string | null>(null);
async function borrar(c: ClienteDoc) {
  if (!(await confirmar({
    titulo: 'Eliminar cliente',
    mensaje: `Se eliminará "${c.nombre}" del directorio. Las cotizaciones ya hechas conservan su copia.`,
    confirmar: 'Eliminar',
    cancelar: 'Cancelar',
    peligro: true,
  }))) return;
  procesando.value = c.id;
  error.value = '';
  try {
    await eliminarCliente(c.id);
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo eliminar.';
  } finally {
    procesando.value = null;
  }
}
</script>

<template>
  <div class="p-8 max-w-3xl">
    <p class="eyebrow eyebrow--marca">Directorio</p>
    <h1 class="text-4xl mb-1">Clientes</h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>
    <p class="text-sm text-muted-ink mt-3">
      Tu directorio de clientes (compartido por Cotizaciones y Rutinas). {{ clientes.length }} en total.
    </p>
    <p v-if="error" class="text-sm text-danger mt-3">{{ error }}</p>

    <!-- Agregar + buscar -->
    <div class="flex flex-wrap gap-3 mt-6">
      <form @submit.prevent="agregar" class="flex gap-2">
        <input v-model="nuevo" placeholder="Nuevo cliente" class="h-10 px-3 rounded-md border border-line bg-white text-sm w-56" />
        <button type="submit" :disabled="agregando || !nuevo.trim()" class="h-10 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center gap-2">
          <LoaderCircle v-if="agregando" :size="15" class="animate-spin" /><Plus v-else :size="16" /> Agregar
        </button>
      </form>
      <div class="relative flex-1 min-w-48">
        <Search :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
        <input v-model="busca" placeholder="Buscar…" class="h-10 w-full pl-9 pr-3 rounded-md border border-line bg-white text-sm" />
      </div>
    </div>

    <div v-if="cargando" class="p-10 text-center text-muted-ink"><LoaderCircle :size="20" class="animate-spin mx-auto" /></div>
    <div v-else-if="visibles.length === 0" class="p-10 text-center mt-6">
      <div class="border border-dashed border-line-strong rounded-lg p-8">
        <Users :size="28" class="mx-auto text-muted-ink mb-3" />
        <p class="text-muted-ink text-sm">{{ busca ? 'Sin resultados.' : 'Aún no hay clientes. Agrega el primero arriba.' }}</p>
      </div>
    </div>

    <div v-else class="bg-card border border-line rounded-lg shadow-sm mt-6 divide-y divide-line">
      <div v-for="c in visibles" :key="c.id" class="flex items-center gap-3 px-5 py-3">
        <template v-if="editId === c.id">
          <input v-model="editNombre" @keyup.enter="guardar" class="flex-1 h-9 px-3 rounded-md border border-line bg-white text-sm" />
          <button @click="guardar" :disabled="guardando" class="h-9 w-9 rounded-md bg-accent text-white flex items-center justify-center disabled:opacity-50">
            <LoaderCircle v-if="guardando" :size="15" class="animate-spin" /><Check v-else :size="16" />
          </button>
          <button @click="editId = null" class="h-9 w-9 rounded-md border border-line text-muted-ink flex items-center justify-center"><X :size="16" /></button>
        </template>
        <template v-else>
          <span class="flex-1 text-ink">{{ c.nombre || '(sin nombre)' }}</span>
          <button @click="abrirContactos(c)" class="flex items-center gap-1 text-xs text-ink-2 hover:text-accent" title="Contactos del cliente">
            <Contact :size="15" /> Contactos
            <span v-if="nContactos(c)" class="ml-0.5 text-[11px] px-1.5 rounded-full bg-secondary text-ink-2">{{ nContactos(c) }}</span>
          </button>
          <button @click="abrirEdit(c)" class="text-muted-ink hover:text-accent" title="Renombrar"><Pencil :size="16" /></button>
          <button @click="borrar(c)" :disabled="procesando === c.id" class="text-muted-ink hover:text-danger disabled:opacity-50" title="Eliminar">
            <LoaderCircle v-if="procesando === c.id" :size="16" class="animate-spin" /><Trash2 v-else :size="16" />
          </button>
        </template>
      </div>
    </div>

    <!-- Modal: contactos del cliente -->
    <div v-if="contactosCliente" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="contactosCliente = null">
      <div class="bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div class="p-6 border-b border-line flex items-start justify-between">
          <div>
            <p class="eyebrow eyebrow--marca">Contactos</p>
            <h2 class="text-xl leading-tight">{{ contactosCliente.nombre }}</h2>
            <p class="text-xs text-muted-ink mt-1">Personas de contacto del cliente (encargado, compras, almacén…), cada una con su correo y teléfono.</p>
          </div>
          <button @click="contactosCliente = null" class="text-muted-ink hover:text-ink"><X :size="20" /></button>
        </div>

        <div class="overflow-auto p-6 space-y-3">
          <div v-for="(ct, i) in formContactos" :key="i" class="border border-line rounded-lg p-3 bg-secondary/30">
            <div class="grid sm:grid-cols-2 gap-2">
              <div>
                <label class="eyebrow block mb-1">Nombre</label>
                <input v-model="ct.nombre" placeholder="Ej. Ing. Juan Torres" class="h-9 w-full px-3 rounded-md border border-line bg-white text-sm" />
              </div>
              <div>
                <label class="eyebrow block mb-1">Puesto / rol</label>
                <input v-model="ct.puesto" placeholder="Ej. Encargado, Compras…" class="h-9 w-full px-3 rounded-md border border-line bg-white text-sm" />
              </div>
              <div>
                <label class="eyebrow block mb-1">Correo</label>
                <input v-model="ct.correo" type="email" placeholder="correo@empresa.com" class="h-9 w-full px-3 rounded-md border border-line bg-white text-sm" />
              </div>
              <div>
                <label class="eyebrow block mb-1">Teléfono</label>
                <input v-model="ct.telefono" placeholder="55 1234 5678" class="h-9 w-full px-3 rounded-md border border-line bg-white text-sm" />
              </div>
            </div>
            <div class="text-right mt-2">
              <button @click="quitarContacto(i)" class="inline-flex items-center gap-1 text-xs text-muted-ink hover:text-danger">
                <Trash2 :size="14" /> Quitar
              </button>
            </div>
          </div>

          <button @click="agregarContacto" class="flex items-center gap-1 text-sm text-accent hover:text-accent-bright font-medium">
            <Plus :size="15" /> Agregar contacto
          </button>
          <p v-if="formContactos.length === 0" class="text-sm text-muted-ink text-center py-4">Sin contactos todavía. Agrega el primero.</p>
          <p v-if="error" class="text-sm text-danger">{{ error }}</p>
        </div>

        <div class="p-4 border-t border-line flex justify-end gap-2">
          <button @click="contactosCliente = null" class="h-10 px-4 rounded-md border border-line text-sm text-muted-ink hover:text-ink">Cancelar</button>
          <button @click="guardarContactos" :disabled="guardandoContactos" class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 inline-flex items-center gap-2">
            <LoaderCircle v-if="guardandoContactos" :size="15" class="animate-spin" /><Check v-else :size="16" />
            {{ guardandoContactos ? 'Guardando…' : 'Guardar contactos' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
