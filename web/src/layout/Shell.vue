<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { FileText, Users, LayoutTemplate, BellRing, LogOut, Zap } from 'lucide-vue-next';
import { sesion, cerrarSesion } from '../sesion';
import { ROLES_ADMIN } from '../dominio/tipos';

const router = useRouter();

const nombre = computed(() => sesion.usuario?.nombre ?? '');
const rol = computed(() => sesion.usuario?.rol ?? 'trabajador');
const esAdmin = computed(() => ROLES_ADMIN.includes(rol.value));

const nav = computed(() => [
  { nombre: 'Cotizaciones', ruta: 'cotizaciones', icono: FileText, visible: true },
  { nombre: 'Plantillas', ruta: 'cotizaciones', icono: LayoutTemplate, visible: true },
  { nombre: 'Usuarios', ruta: 'usuarios', icono: Users, visible: esAdmin.value },
  { nombre: 'Recordatorios', ruta: 'cotizaciones', icono: BellRing, visible: esAdmin.value },
]);

async function salir() {
  await cerrarSesion();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="min-h-screen flex">
    <!-- Sidebar oscura -->
    <aside class="w-60 bg-sidebar text-sidebar-fg flex flex-col shrink-0">
      <div class="px-5 py-4 bg-sidebar-band flex items-center gap-2">
        <Zap :size="20" class="text-brand" fill="currentColor" stroke="#0a1f3d" :stroke-width="1" />
        <span class="font-serif text-xl text-white">Porttea<span class="text-brand italic">-Gener</span></span>
      </div>

      <nav class="flex-1 py-4">
        <template v-for="item in nav" :key="item.nombre">
          <RouterLink
            v-if="item.visible"
            :to="{ name: item.ruta }"
            class="flex items-center gap-3 px-5 py-2.5 text-sm hover:text-white hover:bg-white/5 transition-colors"
            active-class="text-white border-l-2 border-brand bg-brand/10"
          >
            <component :is="item.icono" :size="18" />
            {{ item.nombre }}
          </RouterLink>
        </template>
      </nav>

      <div class="px-5 py-4 border-t border-sidebar-dim/40">
        <p class="text-white text-sm font-medium leading-tight">{{ nombre }}</p>
        <p class="eyebrow mb-3" style="color: var(--color-sidebar-fg)">{{ rol }}</p>
        <button
          @click="salir"
          class="flex items-center gap-2 text-sm text-sidebar-fg hover:text-white transition-colors"
        >
          <LogOut :size="16" /> Salir
        </button>
      </div>
    </aside>

    <!-- Contenido -->
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
  </div>
</template>
