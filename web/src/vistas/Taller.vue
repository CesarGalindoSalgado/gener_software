<script setup lang="ts">
import { reactive } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowLeft, Plus, Trash2, MessageSquare } from 'lucide-vue-next';
import DocumentoCotizacion from '../components/DocumentoCotizacion.vue';
import type { BorradorCotizacion } from '../dominio/tipos';

// Borrador reactivo. Por ahora vive en el cliente (semilla de ejemplo); en el
// siguiente paso se conecta a Firestore con listener en vivo y al chat de Portteo.
const borrador = reactive<BorradorCotizacion>({
  cliente: { nombre: 'Jardines México', atencion: '', telefono: '', correo: '' },
  asunto: 'Mantenimiento preventivo básico a grupo electrógeno estacionario',
  folio: null,
  rev: 'A',
  fecha: '2026-07-02',
  partidas: [
    {
      titulo: 'Mantenimiento preventivo básico a grupo electrógeno estacionario (Mca. Cummins)',
      descripcion: 'Incluye maquinaria, herramienta, mano de obra y lo necesario para las actividades.',
      lineas: [
        'Suministro y cambio de aceite, filtros (aceite/combustible/aire) y anticongelante',
        'Limpieza general y reapriete de conexiones',
        'Pruebas con/sin carga y aislamiento con Megger',
      ],
      cantidad: 1,
      importe: 16437,
    },
  ],
  formaPago: '70% anticipo / 30% entrega',
  tiempoEntrega: '1 a 2 días hábiles',
});

function agregarPartida() {
  borrador.partidas.push({ titulo: 'Nuevo concepto', descripcion: '', lineas: [], cantidad: 1, importe: 0 });
}
function eliminarPartida(i: number) {
  borrador.partidas.splice(i, 1);
}
function editarLineas(i: number, texto: string) {
  borrador.partidas[i].lineas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
</script>

<template>
  <div class="flex flex-col h-screen">
    <!-- Barra superior -->
    <div class="flex items-center gap-3 px-6 py-3 border-b border-line bg-card shrink-0">
      <RouterLink :to="{ name: 'cotizaciones' }" class="text-muted-ink hover:text-accent">
        <ArrowLeft :size="18" />
      </RouterLink>
      <div>
        <p class="eyebrow eyebrow--marca">Taller de cotización</p>
        <p class="text-sm text-ink-2">{{ borrador.cliente.nombre || 'Nueva cotización' }}</p>
      </div>
      <div class="ml-auto">
        <button class="h-9 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright" disabled title="Disponible al conectar el flujo completo">
          Aprobar
        </button>
      </div>
    </div>

    <div class="flex flex-1 min-h-0">
      <!-- Panel izquierdo: chat (placeholder) + editor temporal -->
      <div class="w-[42%] border-r border-line flex flex-col bg-secondary/40">
        <!-- Chat placeholder -->
        <div class="px-5 py-4 border-b border-line">
          <div class="flex items-center gap-2 text-muted-ink">
            <MessageSquare :size="16" />
            <span class="eyebrow">Chat de Portteo</span>
          </div>
          <p class="text-sm text-muted-ink mt-2">
            Aquí conversarás con Portteo para armar la cotización. Se conecta al agente en el
            siguiente paso.
          </p>
          <input
            disabled
            placeholder="Escribe a Portteo… (próximamente)"
            class="w-full h-10 mt-3 px-3 rounded-md border border-line bg-white/60 text-sm"
          />
        </div>

        <!-- Editor temporal -->
        <div class="flex-1 overflow-auto p-5 space-y-4">
          <p class="eyebrow">Editor de prueba (temporal)</p>

          <div class="space-y-2">
            <label class="eyebrow block">Cliente</label>
            <input v-model="borrador.cliente.nombre" class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
            <label class="eyebrow block">Asunto</label>
            <input v-model="borrador.asunto" class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
          </div>

          <div v-for="(p, i) in borrador.partidas" :key="i" class="bg-white border border-line rounded-md p-3 space-y-2">
            <div class="flex items-center justify-between">
              <span class="eyebrow">Bloque {{ i + 1 }}</span>
              <button @click="eliminarPartida(i)" class="text-danger hover:opacity-70"><Trash2 :size="15" /></button>
            </div>
            <input v-model="p.titulo" placeholder="Título" class="w-full h-9 px-3 rounded-md border border-line text-sm" />
            <input v-model="p.descripcion" placeholder="Descripción" class="w-full h-9 px-3 rounded-md border border-line text-sm" />
            <textarea
              :value="p.lineas.join('\n')"
              @input="editarLineas(i, ($event.target as HTMLTextAreaElement).value)"
              placeholder="Líneas de alcance (una por renglón)"
              rows="3"
              class="w-full px-3 py-2 rounded-md border border-line text-sm"
            ></textarea>
            <div class="flex gap-2">
              <div class="flex-1">
                <label class="eyebrow block mb-1">Cantidad</label>
                <input v-model.number="p.cantidad" type="number" min="1" class="w-full h-9 px-3 rounded-md border border-line text-sm" />
              </div>
              <div class="flex-1">
                <label class="eyebrow block mb-1">Importe (MXN)</label>
                <input v-model.number="p.importe" type="number" min="0" step="0.01" class="w-full h-9 px-3 rounded-md border border-line text-sm" />
              </div>
            </div>
          </div>

          <button @click="agregarPartida" class="flex items-center gap-2 text-sm text-accent hover:text-accent-bright font-medium">
            <Plus :size="16" /> Agregar bloque
          </button>
        </div>
      </div>

      <!-- Panel derecho: documento en vivo -->
      <div class="flex-1 overflow-auto bg-paper p-8">
        <DocumentoCotizacion :borrador="borrador" />
      </div>
    </div>
  </div>
</template>
