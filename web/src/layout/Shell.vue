<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import {
  FileText, Users, LayoutTemplate, BellRing, LogOut, Zap, ClipboardCheck,
  MessageCircle, Wrench, Building2, PanelLeftClose, PanelLeftOpen,
} from 'lucide-vue-next';
import { sesion, cerrarSesion } from '../sesion';
import { ROLES_ADMIN, ROLES_OPERADOR } from '../dominio/tipos';

const router = useRouter();

const nombre = computed(() => sesion.usuario?.nombre ?? '');
const rol = computed(() => sesion.usuario?.rol ?? 'trabajador');
const esAdmin = computed(() => ROLES_ADMIN.includes(rol.value));
const esOperador = computed(() => ROLES_OPERADOR.includes(rol.value));

// Estado "fijado": el usuario contrajo la barra (recordado entre sesiones).
const colapsado = ref(localStorage.getItem('sidebar-colapsado') === '1');
const hover = ref(false);
// Visualmente abierta si NO está contraída, o si lo está pero el mouse está
// encima: en ese caso se despliega SOBRE el contenido sin recolocarlo.
const expandido = computed(() => !colapsado.value || hover.value);
// Flotando por encima del contenido (contraída + hover).
const flotante = computed(() => colapsado.value && hover.value);

function alternar() {
  colapsado.value = !colapsado.value;
  hover.value = false;
  localStorage.setItem('sidebar-colapsado', colapsado.value ? '1' : '0');
}

const nav = computed(() => [
  { nombre: 'Cotizaciones', ruta: 'cotizaciones', icono: FileText, visible: true },
  { nombre: 'Seguimiento', ruta: 'seguimiento', icono: ClipboardCheck, visible: true },
  { nombre: 'Rutinas', ruta: 'rutinas', icono: Wrench, visible: esOperador.value },
  { nombre: 'Sedes y equipos', ruta: 'sedes', icono: Building2, visible: esOperador.value },
  { nombre: 'Plantillas', ruta: 'plantillas', icono: LayoutTemplate, visible: esAdmin.value },
  { nombre: 'Usuarios', ruta: 'usuarios', icono: Users, visible: esAdmin.value },
  { nombre: 'Recordatorios', ruta: 'recordatorios', icono: BellRing, visible: esAdmin.value },
  { nombre: 'WhatsApp', ruta: 'whatsapp', icono: MessageCircle, visible: esAdmin.value },
]);

async function salir() {
  await cerrarSesion();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="min-h-screen flex">
    <!-- Espaciador: reserva en el flujo el ancho "fijado" (no el desplegado). -->
    <div class="shrink-0 transition-[width] duration-200 ease-out" :class="colapsado ? 'w-14' : 'w-60'"></div>

    <!-- Barra lateral fija. Contraída, se despliega sobre el contenido al hover. -->
    <aside
      @mouseenter="hover = true"
      @mouseleave="hover = false"
      class="fixed top-0 left-0 h-screen bg-sidebar text-sidebar-fg flex flex-col z-40
             transition-[width] duration-200 ease-out overflow-hidden"
      :class="[expandido ? 'w-60' : 'w-14', flotante && 'shadow-2xl shadow-black/50']"
    >
      <!-- Banda superior: marca + toggle -->
      <div class="h-16 bg-sidebar-band flex items-center gap-2 shrink-0" :class="expandido ? 'px-4' : 'justify-center px-0'">
        <Zap :size="20" class="text-brand shrink-0" fill="currentColor" stroke="#0a1f3d" :stroke-width="1" />
        <span v-if="expandido" class="font-serif text-xl text-white whitespace-nowrap flex-1">
          Porttea<span class="text-brand italic">-Gener</span>
        </span>
        <button
          v-if="expandido"
          @click="alternar"
          :title="colapsado ? 'Fijar abierta' : 'Contraer'"
          class="shrink-0 grid place-items-center h-8 w-8 rounded-md text-sidebar-fg hover:text-white hover:bg-white/10 transition-colors"
        >
          <PanelLeftOpen v-if="colapsado" :size="18" />
          <PanelLeftClose v-else :size="18" />
        </button>
      </div>

      <nav class="flex-1 py-4 min-h-0 overflow-y-auto overflow-x-hidden">
        <template v-for="item in nav" :key="item.nombre">
          <RouterLink
            v-if="item.visible"
            :to="{ name: item.ruta }"
            :title="expandido ? undefined : item.nombre"
            class="flex items-center gap-3 h-11 text-sm hover:text-white hover:bg-white/5 transition-colors"
            :class="expandido ? 'px-5' : 'justify-center px-0'"
            exact-active-class="text-white border-l-2 border-brand bg-brand/10"
          >
            <component :is="item.icono" :size="18" class="shrink-0" />
            <span v-if="expandido" class="whitespace-nowrap">{{ item.nombre }}</span>
          </RouterLink>
        </template>
      </nav>

      <div class="py-4 border-t border-sidebar-dim/40 shrink-0" :class="expandido ? 'px-5' : 'px-0 flex justify-center'">
        <template v-if="expandido">
          <p class="text-white text-sm font-medium leading-tight truncate">{{ nombre }}</p>
          <p class="eyebrow mb-3" style="color: var(--color-sidebar-fg)">{{ rol }}</p>
          <button @click="salir" class="flex items-center gap-2 text-sm text-sidebar-fg hover:text-white transition-colors">
            <LogOut :size="16" /> Salir
          </button>
        </template>
        <button v-else @click="salir" title="Salir" class="grid place-items-center h-8 w-8 rounded-md text-sidebar-fg hover:text-white hover:bg-white/10 transition-colors">
          <LogOut :size="18" />
        </button>
      </div>
    </aside>

    <!-- Contenido -->
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
  </div>
</template>
