<script setup lang="ts">
import { RouterView } from 'vue-router';
import { sesion } from './sesion';
</script>

<template>
  <div v-if="sesion.cargando" class="min-h-screen flex items-center justify-center">
    <p class="eyebrow">Cargando…</p>
  </div>
  <RouterView v-else />
</template>
