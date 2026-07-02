<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { Plus } from 'lucide-vue-next';
import { sesion } from '../sesion';
</script>

<template>
  <div class="p-8 max-w-5xl">
    <p class="eyebrow eyebrow--marca">Porttea-Gener</p>
    <div class="flex items-end justify-between">
      <div>
        <h1 class="text-4xl mb-1">
          Bienvenido, <span class="italic text-brand-text">{{ sesion.usuario?.nombre }}</span>
        </h1>
        <div class="h-0.5 w-[90px] bg-brand"></div>
      </div>
      <RouterLink
        :to="{ name: 'taller' }"
        class="flex items-center gap-2 h-10 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright"
      >
        <Plus :size="16" /> Nueva cotización
      </RouterLink>
    </div>

    <div class="bg-card border border-line rounded-lg shadow-sm p-6 mt-8">
      <p class="eyebrow mb-2">Módulo de cotizaciones</p>
      <p class="text-ink-2">
        Aquí vivirá el listado de cotizaciones con su estatus. Por ahora, abre el
        <RouterLink :to="{ name: 'taller' }" class="text-accent underline">taller de dos paneles</RouterLink>
        para ver la cotización renderizándose en vivo.
      </p>
    </div>
  </div>
</template>
