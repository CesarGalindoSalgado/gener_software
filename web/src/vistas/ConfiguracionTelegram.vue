<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Send, LoaderCircle, Check, ShieldCheck, Link2 } from 'lucide-vue-next';
import { estadoConfigTelegram, guardarConfigTelegram, registrarWebhookTelegram } from '../servicios/cotizaciones';
import { sesion } from '../sesion';

const esSuperAdmin = computed(() => sesion.usuario?.rol === 'superAdmin');

const cargando = ref(true);
const tieneToken = ref(false);
const botUsername = ref<string | null>(null);
const webhookOk = ref(false);
const ultimoError = ref<string | null>(null);
const botToken = ref('');
const guardando = ref(false);
const registrando = ref(false);
const verGuia = ref(false);
const ok = ref('');
const error = ref('');

async function cargar() {
  cargando.value = true;
  try {
    const st = await estadoConfigTelegram();
    tieneToken.value = st.tieneToken;
    botUsername.value = st.botUsername;
    webhookOk.value = st.webhookOk;
    ultimoError.value = st.ultimoError;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo leer el estado.';
  } finally {
    cargando.value = false;
  }
}
onMounted(cargar);

async function guardar() {
  guardando.value = true;
  ok.value = '';
  error.value = '';
  try {
    await guardarConfigTelegram({ botToken: botToken.value.trim() || undefined });
    botToken.value = '';
    ok.value = 'Token guardado. Ahora presiona "Registrar webhook".';
    await cargar();
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo guardar.';
  } finally {
    guardando.value = false;
  }
}

async function registrar() {
  registrando.value = true;
  ok.value = '';
  error.value = '';
  try {
    const res = await registrarWebhookTelegram();
    ok.value = `Webhook registrado${res.botUsername ? ` para @${res.botUsername}` : ''}. Ya puede recibir mensajes.`;
    await cargar();
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo registrar el webhook.';
  } finally {
    registrando.value = false;
  }
}
</script>

<template>
  <div class="p-8 max-w-2xl">
    <p class="eyebrow eyebrow--marca">Configuración</p>
    <h1 class="text-4xl mb-1">Telegram</h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>
    <p class="text-sm text-muted-ink mt-3">
      Telegram es el canal de <b>respaldo</b> del bot (por si WhatsApp falla). Conecta el bot con el token que
      te da <b>BotFather</b> y registra el webhook. Los usuarios vinculan su Telegram desde <b>Usuarios</b>.
    </p>

    <!-- Guía paso a paso -->
    <div class="mt-4 border border-line rounded-lg bg-secondary/30">
      <button @click="verGuia = !verGuia" class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-ink">
        <span>📘 ¿Cómo creo el bot y obtengo el token? (guía paso a paso)</span>
        <span class="text-muted-ink">{{ verGuia ? '▲' : '▼' }}</span>
      </button>
      <div v-if="verGuia" class="px-4 pb-4 text-sm text-ink-2 space-y-3 border-t border-line pt-3">
        <ol class="list-decimal ml-5 space-y-2">
          <li>En Telegram, abre un chat con <a href="https://t.me/BotFather" target="_blank" class="text-accent hover:underline"><b>@BotFather</b></a> (el bot oficial de Telegram para crear bots).</li>
          <li>Envíale el comando <code class="text-xs bg-white border border-line rounded px-1.5 py-0.5">/newbot</code>.</li>
          <li>Te pedirá un <b>nombre</b> (ej. <i>Portteo G-ener</i>) y un <b>usuario</b> que debe terminar en <code class="text-xs bg-white border border-line rounded px-1.5 py-0.5">bot</code> (ej. <i>portteo_gener_bot</i>).</li>
          <li>BotFather te responde con un <b>token</b> (algo como <code class="text-xs bg-white border border-line rounded px-1.5 py-0.5">123456:ABC-DEF...</code>). Cópialo.</li>
          <li>Pégalo aquí abajo → <b>Guardar token</b> → <b>Registrar webhook</b>.</li>
          <li>Listo. Para que una persona use el bot, en <b>Usuarios</b> se vincula su Telegram (comparte su número con el bot y queda ligado a su cuenta).</li>
        </ol>
        <p class="text-xs text-muted-ink">El token es como una contraseña del bot: se guarda cifrado del lado del servidor y nunca se muestra de vuelta.</p>
      </div>
    </div>

    <div v-if="cargando" class="p-10 text-center text-muted-ink"><LoaderCircle :size="20" class="animate-spin mx-auto" /></div>

    <template v-else>
      <!-- Estado -->
      <div class="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <span v-if="tieneToken" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#e0f0ec] text-success font-medium">
          <ShieldCheck :size="15" /> Bot válido{{ botUsername ? ` · @${botUsername}` : '' }}
        </span>
        <span v-else class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#fef3d6] text-[#8a6d1a] font-medium">Sin token</span>
        <span v-if="tieneToken" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs" :class="webhookOk ? 'bg-[#e0f0ec] text-success' : 'bg-[#fef3d6] text-[#8a6d1a]'">
          <Link2 :size="13" /> {{ webhookOk ? 'Webhook conectado' : 'Webhook sin registrar' }}
        </span>
        <button @click="cargar" class="text-xs text-accent hover:text-accent-bright">Actualizar</button>
      </div>
      <p v-if="ultimoError" class="text-xs text-danger mt-1">Último error de Telegram: {{ ultimoError }}</p>

      <div class="bg-card border border-line rounded-lg shadow-sm mt-4 p-6 space-y-4">
        <div>
          <label class="eyebrow block mb-1">Token del bot (BotFather)</label>
          <input v-model="botToken" :disabled="!esSuperAdmin" type="password"
            :placeholder="tieneToken ? '•••• (guardado — escribe uno nuevo para cambiarlo)' : '123456789:ABCdef...'"
            class="h-10 w-full px-3 rounded-md border border-line bg-white text-sm disabled:bg-secondary/40" />
        </div>
        <div v-if="esSuperAdmin" class="flex flex-wrap items-center gap-2">
          <button @click="guardar" :disabled="guardando"
            class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 inline-flex items-center gap-2">
            <LoaderCircle v-if="guardando" :size="15" class="animate-spin" /><Check v-else :size="16" /> Guardar token
          </button>
          <button @click="registrar" :disabled="registrando || !tieneToken"
            class="h-10 px-4 rounded-md border border-line-strong text-sm text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50 inline-flex items-center gap-2">
            <LoaderCircle v-if="registrando" :size="15" class="animate-spin" /><Send v-else :size="15" /> Registrar webhook
          </button>
        </div>
        <p v-else class="text-xs text-muted-ink">Solo el superAdmin puede configurar Telegram.</p>
      </div>

      <p v-if="ok" class="text-sm text-success mt-4">{{ ok }}</p>
      <p v-if="error" class="text-sm text-danger mt-4">{{ error }}</p>
    </template>
  </div>
</template>
