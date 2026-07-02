<script setup lang="ts">
import { sesion } from '../sesion';
</script>

<template>
  <div class="p-8 max-w-5xl">
    <p class="eyebrow eyebrow--marca">Porttea-Gener</p>
    <h1 class="text-4xl mb-1">
      Bienvenido, <span class="italic text-brand-text">{{ sesion.usuario?.nombre }}</span>
    </h1>
    <div class="h-0.5 w-[90px] bg-brand mb-8"></div>

    <div class="bg-card border border-line rounded-lg shadow-sm p-6">
      <p class="eyebrow mb-2">Módulo de cotizaciones</p>
      <p class="text-ink-2">
        Aquí vivirá el listado de cotizaciones y, en el siguiente paso, el taller de dos paneles
        (chat + cotización en vivo). La sesión, el rol y las reglas de seguridad ya están conectados.
      </p>
    </div>
  </div>
</template>
