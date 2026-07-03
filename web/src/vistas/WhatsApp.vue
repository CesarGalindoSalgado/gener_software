<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import QRCode from 'qrcode';
import { Smartphone, CheckCircle2, RefreshCw, WifiOff, LoaderCircle } from 'lucide-vue-next';
import { db } from '../firebase';

interface EstadoWhatsApp {
  estado?: 'esperando_qr' | 'conectado' | 'desconectado' | 'desvinculado' | null;
  qr?: string | null;
  numero?: string | null;
  actualizadoEn?: Timestamp | null;
}

const estado = ref<EstadoWhatsApp | null>(null);
const cargando = ref(true);
const qrDataUrl = ref('');

const off = onSnapshot(doc(db, 'sistema', 'whatsapp'), (snap) => {
  estado.value = snap.exists() ? (snap.data() as EstadoWhatsApp) : null;
  cargando.value = false;
});
onUnmounted(off);

// Renderiza el string del QR a imagen escaneable.
watch(
  () => estado.value?.qr,
  async (qr) => {
    if (qr) {
      qrDataUrl.value = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
    } else {
      qrDataUrl.value = '';
    }
  },
  { immediate: true }
);

const conectado = () => estado.value?.estado === 'conectado';
</script>

<template>
  <div class="p-8 max-w-3xl">
    <p class="eyebrow eyebrow--marca">Integración</p>
    <h1 class="text-4xl mb-1">WhatsApp</h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>

    <p class="text-sm text-muted-ink mt-3">
      Vincula el número del bot escaneando el código con la app de WhatsApp del teléfono dedicado
      (Dispositivos vinculados → Vincular un dispositivo). El bot debe estar corriendo.
    </p>

    <div v-if="cargando" class="p-10 text-center text-muted-ink">
      <LoaderCircle :size="20" class="animate-spin mx-auto" />
    </div>

    <div v-else class="bg-card border border-line rounded-lg shadow-sm p-8 mt-6">
      <!-- Conectado -->
      <div v-if="conectado()" class="text-center">
        <CheckCircle2 :size="48" class="text-success mx-auto mb-3" />
        <p class="text-xl text-ink font-medium">WhatsApp conectado</p>
        <p v-if="estado?.numero" class="text-muted-ink mt-1">
          Número del bot: <span class="font-mono">{{ estado.numero }}</span>
        </p>
        <p class="text-sm text-muted-ink mt-3">El bot está en línea y responde a los números de la lista blanca.</p>
      </div>

      <!-- Esperando escaneo (hay QR) -->
      <div v-else-if="estado?.qr && qrDataUrl" class="text-center">
        <p class="eyebrow mb-4">Escanea para vincular</p>
        <img :src="qrDataUrl" alt="Código QR de WhatsApp" class="mx-auto rounded-lg border border-line" />
        <p class="text-sm text-muted-ink mt-4">
          En el teléfono del bot: <b>WhatsApp → Dispositivos vinculados → Vincular un dispositivo</b> y apunta a este código.
        </p>
      </div>

      <!-- Desconectado / sin bot corriendo -->
      <div v-else class="text-center">
        <component :is="estado?.estado === 'desvinculado' ? WifiOff : Smartphone" :size="48" class="text-muted-ink mx-auto mb-3" />
        <p class="text-lg text-ink-2">
          {{ estado?.estado === 'desvinculado' ? 'Sesión cerrada desde el teléfono' : 'Esperando al bot…' }}
        </p>
        <p class="text-sm text-muted-ink mt-2">
          Arranca el bot en tu servidor (<span class="font-mono">cd bot &amp;&amp; npm start</span>) y aquí
          aparecerá el código QR para vincular.
        </p>
        <div class="flex items-center justify-center gap-2 text-xs text-muted-ink mt-4">
          <RefreshCw :size="12" /> Esta pantalla se actualiza sola.
        </div>
      </div>
    </div>

    <p class="text-xs text-muted-ink mt-4">
      ⚠️ Baileys usa el protocolo de WhatsApp Web (no oficial). Usa un número dedicado al bot; hay riesgo
      de bloqueo si WhatsApp detecta uso automatizado.
    </p>
  </div>
</template>
