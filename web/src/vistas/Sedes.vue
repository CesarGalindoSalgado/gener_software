<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue';
import { Building2, MapPin, Plus, LoaderCircle, ChevronRight } from 'lucide-vue-next';
import {
  crearCliente,
  crearSede,
  crearEquipo,
  suscribirClientes,
  suscribirSedes,
  suscribirEquipos,
  type ClienteDoc,
  type SedeDoc,
  type EquipoDoc,
} from '../servicios/rutinas';

const clientes = ref<ClienteDoc[]>([]);
const sedes = ref<SedeDoc[]>([]);
const equipos = ref<EquipoDoc[]>([]);
const offs = [
  suscribirClientes((l) => (clientes.value = l)),
  suscribirSedes((l) => (sedes.value = l)),
  suscribirEquipos((l) => (equipos.value = l)),
];
onUnmounted(() => offs.forEach((o) => o()));

const error = ref('');
const clienteSel = ref<string | null>(null);
const sedeSel = ref<string | null>(null);

const sedesDeCliente = computed(() => sedes.value.filter((s) => s.clienteId === clienteSel.value));
const equiposDeSede = computed(() => equipos.value.filter((e) => e.sedeId === sedeSel.value));

// --- Alta de cliente ---
const nuevoCliente = ref('');
const guardandoCliente = ref(false);
async function agregarCliente() {
  if (!nuevoCliente.value.trim() || guardandoCliente.value) return;
  guardandoCliente.value = true;
  error.value = '';
  try {
    const { clienteId } = await crearCliente(nuevoCliente.value.trim());
    nuevoCliente.value = '';
    clienteSel.value = clienteId;
    sedeSel.value = null;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo crear el cliente.';
  } finally {
    guardandoCliente.value = false;
  }
}

// --- Alta de sede ---
const nuevaSede = reactive({ nombre: '', direccion: '', responsable: '' });
const guardandoSede = ref(false);
async function agregarSede() {
  if (!clienteSel.value || !nuevaSede.nombre.trim() || guardandoSede.value) return;
  guardandoSede.value = true;
  error.value = '';
  try {
    const { sedeId } = await crearSede({
      clienteId: clienteSel.value,
      nombre: nuevaSede.nombre.trim(),
      direccion: nuevaSede.direccion.trim() || undefined,
      responsable: nuevaSede.responsable.trim() || undefined,
    });
    Object.assign(nuevaSede, { nombre: '', direccion: '', responsable: '' });
    sedeSel.value = sedeId;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo crear la sede.';
  } finally {
    guardandoSede.value = false;
  }
}

// --- Alta de equipo ---
const nuevoEquipo = reactive({ noInventario: '', descripcion: '' });
const guardandoEquipo = ref(false);
async function agregarEquipo() {
  if (!sedeSel.value || !nuevoEquipo.noInventario.trim() || guardandoEquipo.value) return;
  guardandoEquipo.value = true;
  error.value = '';
  try {
    await crearEquipo({
      sedeId: sedeSel.value,
      noInventario: nuevoEquipo.noInventario.trim(),
      descripcion: nuevoEquipo.descripcion.trim() || undefined,
    });
    Object.assign(nuevoEquipo, { noInventario: '', descripcion: '' });
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo crear el equipo.';
  } finally {
    guardandoEquipo.value = false;
  }
}

function seleccionarCliente(id: string) {
  clienteSel.value = id;
  sedeSel.value = null;
}
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Homologación</p>
    <h1 class="text-4xl mb-1">Sedes y <span class="italic text-brand-text">equipos</span></h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>
    <p class="text-sm text-muted-ink mt-3">
      Da de alta cliente → sede → equipo (por número de inventario). El historial de rutinas se acumula por equipo.
    </p>
    <p v-if="error" class="text-sm text-danger mt-4">{{ error }}</p>

    <div class="grid grid-cols-3 gap-4 mt-6">
      <!-- Clientes -->
      <div class="bg-card border border-line rounded-lg shadow-sm flex flex-col">
        <div class="px-4 py-3 border-b border-line"><p class="eyebrow">Clientes ({{ clientes.length }})</p></div>
        <div class="flex-1 overflow-auto max-h-96">
          <button
            v-for="c in clientes"
            :key="c.id"
            @click="seleccionarCliente(c.id)"
            class="w-full text-left px-4 py-2.5 text-sm border-b border-line last:border-0 flex items-center justify-between hover:bg-secondary/40"
            :class="clienteSel === c.id ? 'bg-secondary/60 font-medium text-accent' : 'text-ink-2'"
          >
            {{ c.nombre }} <ChevronRight :size="14" class="text-muted-ink" />
          </button>
          <p v-if="clientes.length === 0" class="px-4 py-6 text-center text-xs text-muted-ink">Sin clientes aún.</p>
        </div>
        <form @submit.prevent="agregarCliente" class="p-3 border-t border-line flex gap-2">
          <input v-model="nuevoCliente" placeholder="Nuevo cliente" class="flex-1 h-9 px-2 rounded-md border border-line text-sm" />
          <button type="submit" :disabled="guardandoCliente" class="h-9 w-9 rounded-md bg-accent text-white flex items-center justify-center disabled:opacity-50">
            <LoaderCircle v-if="guardandoCliente" :size="15" class="animate-spin" /><Plus v-else :size="16" />
          </button>
        </form>
      </div>

      <!-- Sedes -->
      <div class="bg-card border border-line rounded-lg shadow-sm flex flex-col">
        <div class="px-4 py-3 border-b border-line"><p class="eyebrow">Sedes</p></div>
        <div v-if="!clienteSel" class="flex-1 flex items-center justify-center p-6 text-center text-xs text-muted-ink">
          <span><Building2 :size="20" class="mx-auto mb-2 text-muted-ink" />Elige un cliente</span>
        </div>
        <template v-else>
          <div class="flex-1 overflow-auto max-h-80">
            <button
              v-for="s in sedesDeCliente"
              :key="s.id"
              @click="sedeSel = s.id"
              class="w-full text-left px-4 py-2.5 text-sm border-b border-line last:border-0 hover:bg-secondary/40"
              :class="sedeSel === s.id ? 'bg-secondary/60 font-medium text-accent' : 'text-ink-2'"
            >
              <p>{{ s.nombre }}</p>
              <p v-if="s.direccion" class="text-xs text-muted-ink">{{ s.direccion }}</p>
            </button>
            <p v-if="sedesDeCliente.length === 0" class="px-4 py-6 text-center text-xs text-muted-ink">Sin sedes.</p>
          </div>
          <form @submit.prevent="agregarSede" class="p-3 border-t border-line space-y-2">
            <input v-model="nuevaSede.nombre" placeholder="Nombre de la sede" class="w-full h-9 px-2 rounded-md border border-line text-sm" />
            <input v-model="nuevaSede.direccion" placeholder="Dirección (opcional)" class="w-full h-9 px-2 rounded-md border border-line text-sm" />
            <input v-model="nuevaSede.responsable" placeholder="Responsable (opcional)" class="w-full h-9 px-2 rounded-md border border-line text-sm" />
            <button type="submit" :disabled="guardandoSede" class="w-full h-9 rounded-md bg-accent text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
              <LoaderCircle v-if="guardandoSede" :size="15" class="animate-spin" /><Plus v-else :size="15" /> Agregar sede
            </button>
          </form>
        </template>
      </div>

      <!-- Equipos -->
      <div class="bg-card border border-line rounded-lg shadow-sm flex flex-col">
        <div class="px-4 py-3 border-b border-line"><p class="eyebrow">Equipos (inventario)</p></div>
        <div v-if="!sedeSel" class="flex-1 flex items-center justify-center p-6 text-center text-xs text-muted-ink">
          <span><MapPin :size="20" class="mx-auto mb-2 text-muted-ink" />Elige una sede</span>
        </div>
        <template v-else>
          <div class="flex-1 overflow-auto max-h-80">
            <div v-for="e in equiposDeSede" :key="e.id" class="px-4 py-2.5 text-sm border-b border-line last:border-0">
              <p class="font-mono text-xs text-accent">{{ e.noInventario }}</p>
              <p v-if="e.descripcion" class="text-ink-2">{{ e.descripcion }}</p>
            </div>
            <p v-if="equiposDeSede.length === 0" class="px-4 py-6 text-center text-xs text-muted-ink">Sin equipos.</p>
          </div>
          <form @submit.prevent="agregarEquipo" class="p-3 border-t border-line space-y-2">
            <input v-model="nuevoEquipo.noInventario" placeholder="Número de inventario" class="w-full h-9 px-2 rounded-md border border-line text-sm" />
            <input v-model="nuevoEquipo.descripcion" placeholder="Descripción (opcional)" class="w-full h-9 px-2 rounded-md border border-line text-sm" />
            <button type="submit" :disabled="guardandoEquipo" class="w-full h-9 rounded-md bg-accent text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
              <LoaderCircle v-if="guardandoEquipo" :size="15" class="animate-spin" /><Plus v-else :size="15" /> Agregar equipo
            </button>
          </form>
        </template>
      </div>
    </div>
  </div>
</template>
