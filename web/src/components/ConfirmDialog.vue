<script setup lang="ts">
import { AlertTriangle, HelpCircle } from 'lucide-vue-next';
import { estadoConfirm, responderConfirm } from './confirmar';
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="estadoConfirm.abierto"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
        @click.self="responderConfirm(false)"
        @keydown.esc="responderConfirm(false)"
      >
        <div class="bg-card rounded-xl shadow-xl w-full max-w-sm">
          <div class="p-6 flex items-start gap-3">
            <div
              class="shrink-0 h-10 w-10 rounded-full grid place-items-center"
              :class="estadoConfirm.peligro ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'"
            >
              <AlertTriangle v-if="estadoConfirm.peligro" :size="20" />
              <HelpCircle v-else :size="20" />
            </div>
            <div class="flex-1 min-w-0 pt-0.5">
              <h3 class="text-lg font-medium text-ink leading-tight">{{ estadoConfirm.titulo }}</h3>
              <p class="text-sm text-muted-ink mt-1.5 leading-relaxed">{{ estadoConfirm.mensaje }}</p>
            </div>
          </div>
          <div class="flex justify-end gap-2 px-6 pb-5">
            <button
              @click="responderConfirm(false)"
              class="h-10 px-4 rounded-md border border-line-strong text-sm text-ink-2 hover:border-accent hover:text-accent transition-colors"
            >
              {{ estadoConfirm.cancelar }}
            </button>
            <button
              @click="responderConfirm(true)"
              autofocus
              class="h-10 px-5 rounded-md text-white text-sm font-medium transition-colors"
              :class="estadoConfirm.peligro ? 'bg-danger hover:opacity-90' : 'bg-accent hover:bg-accent-bright'"
            >
              {{ estadoConfirm.confirmar }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
