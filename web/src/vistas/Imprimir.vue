<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import DocumentoCotizacion from '../components/DocumentoCotizacion.vue';
import type { BorradorCotizacion } from '../dominio/tipos';
import {
  suscribirCotizacion,
  suscribirVersion,
  type CotizacionDoc,
  type VersionDoc,
} from '../servicios/cotizaciones';

// Vista de impresión: solo el documento (sin sidebar ni chat), pensada para
// "Guardar como PDF". Se abre en pestaña nueva desde el taller y lanza el
// diálogo de impresión en cuanto la cotización cargó.
const route = useRoute();
const id = route.params.id as string;

const cot = ref<CotizacionDoc | null>(null);
const ver = ref<VersionDoc | null>(null);
let yaImprimio = false;

const offCot = suscribirCotizacion(id, (c) => {
  cot.value = c;
  if (c?.versionActualId) {
    offVer?.();
    offVer = suscribirVersion(id, c.versionActualId, (v) => (ver.value = v));
  }
});
let offVer: (() => void) | null = null;
onUnmounted(() => {
  offCot();
  offVer?.();
});

const borrador = computed<BorradorCotizacion | null>(() => {
  if (!cot.value || !ver.value) return null;
  return {
    cliente: {
      nombre: cot.value.cliente?.nombre ?? '',
      atencion: cot.value.cliente?.atencion ?? undefined,
      telefono: cot.value.cliente?.telefono ?? undefined,
      correo: cot.value.cliente?.correo ?? undefined,
    },
    asunto: cot.value.titulo,
    folio: cot.value.folio,
    rev: ver.value.rev,
    fecha: (ver.value.fecha?.toDate() ?? new Date()).toISOString(),
    partidas: ver.value.partidas ?? [],
    formaPago: ver.value.formaPago,
    tiempoEntrega: ver.value.tiempoEntrega,
  };
});

// Cuando el documento ya tiene datos, dispara la impresión una sola vez.
watch(borrador, (b) => {
  if (b && !yaImprimio) {
    yaImprimio = true;
    // Espera al render y a las fuentes antes de imprimir.
    setTimeout(() => window.print(), 600);
  }
});

function imprimir() {
  window.print();
}
</script>

<template>
  <div class="pantalla">
    <div class="barra no-print">
      <button @click="imprimir" class="btn">Imprimir / Guardar como PDF</button>
      <span class="ayuda">En el diálogo, elige “Guardar como PDF” como destino.</span>
    </div>
    <div class="hoja">
      <DocumentoCotizacion v-if="borrador" :borrador="borrador" />
      <p v-else class="cargando">Cargando cotización…</p>
    </div>
  </div>
</template>

<style scoped>
.pantalla {
  min-height: 100vh;
  background: #e9edf3;
  padding: 24px 0 48px;
}
.barra {
  max-width: 800px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.btn {
  height: 38px;
  padding: 0 16px;
  border-radius: 6px;
  background: #143d6b;
  color: #fff;
  border: none;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover {
  background: #1d5f9a;
}
.ayuda {
  font-size: 12px;
  color: #647183;
}
.cargando {
  text-align: center;
  color: #647183;
  padding: 40px;
}

/* Al imprimir: solo el documento, sin barra ni fondo. */
@media print {
  .no-print {
    display: none !important;
  }
  .pantalla {
    background: #fff;
    padding: 0;
  }
  /* La plantilla del documento vive en el componente hijo (estilos scoped). */
  :deep(.doc) {
    box-shadow: none !important;
    max-width: none !important;
  }
}
</style>

<style>
/* Márgenes de página al imprimir (no scoped para que aplique a @page). */
@page {
  size: letter;
  margin: 14mm;
}
</style>
