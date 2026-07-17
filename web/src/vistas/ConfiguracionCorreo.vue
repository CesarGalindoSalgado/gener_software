<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Mail, LoaderCircle, Check, Send, ShieldCheck } from 'lucide-vue-next';
import { computed } from 'vue';
import { estadoConfigCorreo, guardarConfigCorreo, probarCorreo } from '../servicios/cotizaciones';
import { sesion } from '../sesion';

// Solo el superAdmin puede editar (el backend también lo valida).
const esSuperAdmin = computed(() => sesion.usuario?.rol === 'superAdmin');

const verGuia = ref(false);

const cargando = ref(true);
const configurado = ref(false);
const remitente = ref('');
const appPassword = ref('');
const guardando = ref(false);
const probando = ref(false);
const ok = ref('');
const error = ref('');

async function cargar() {
  cargando.value = true;
  try {
    const st = await estadoConfigCorreo();
    configurado.value = st.configurado;
    remitente.value = st.remitente;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo leer la configuración.';
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
    // La contraseña solo se manda si escribieron una nueva (si la dejan vacía, no se cambia).
    await guardarConfigCorreo({ remitente: remitente.value.trim(), appPassword: appPassword.value.trim() || undefined });
    appPassword.value = '';
    ok.value = 'Configuración guardada.';
    await cargar();
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo guardar.';
  } finally {
    guardando.value = false;
  }
}

const correoPrueba = ref('');
async function enviarPrueba() {
  probando.value = true;
  ok.value = '';
  error.value = '';
  try {
    const res = await probarCorreo(correoPrueba.value.trim() || undefined);
    ok.value = `Correo de prueba enviado a ${res.para}. Revisa la bandeja.`;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo enviar el correo de prueba.';
  } finally {
    probando.value = false;
  }
}
</script>

<template>
  <div class="p-8 max-w-2xl">
    <p class="eyebrow eyebrow--marca">Configuración</p>
    <h1 class="text-4xl mb-1">Correo</h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>
    <p class="text-sm text-muted-ink mt-3">
      Credenciales para enviar cotizaciones por correo. Se usa el Gmail de la empresa con una
      <b>contraseña de aplicación</b> de Google (no la contraseña normal).
    </p>

    <!-- Guía paso a paso (para hacerlo sin ayuda técnica) -->
    <div class="mt-4 border border-line rounded-lg bg-secondary/30">
      <button @click="verGuia = !verGuia" class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-ink">
        <span>📘 ¿Cómo genero la contraseña de aplicación? (guía paso a paso)</span>
        <span class="text-muted-ink">{{ verGuia ? '▲' : '▼' }}</span>
      </button>
      <div v-if="verGuia" class="px-4 pb-4 text-sm text-ink-2 space-y-3 border-t border-line pt-3">
        <p>Una contraseña de aplicación es una clave de 16 caracteres que Google genera para que otras apps (como esta) envíen correo por ti, sin usar tu contraseña normal. Se hace una sola vez.</p>
        <ol class="list-decimal ml-5 space-y-2">
          <li>Entra a tu cuenta de Google en <a href="https://myaccount.google.com/security" target="_blank" class="text-accent hover:underline">myaccount.google.com/security</a> con el correo de la empresa (ej. generpowercontrol@gmail.com).</li>
          <li>Activa la <b>Verificación en 2 pasos</b> (si aún no la tienes). Es requisito para el siguiente paso; sigue el asistente de Google (te pedirá tu teléfono).</li>
          <li>Ya con la verificación en 2 pasos activa, entra a <a href="https://myaccount.google.com/apppasswords" target="_blank" class="text-accent hover:underline">myaccount.google.com/apppasswords</a> (o busca <b>"Contraseñas de aplicaciones"</b> en la barra de tu cuenta de Google).</li>
          <li>Escribe un nombre para identificarla (ej. <i>"Porttea-Gener"</i>) y presiona <b>Crear</b>.</li>
          <li>Google te muestra una clave de <b>16 letras</b> (en 4 bloques). Cópiala.</li>
          <li>Pégala aquí abajo en <b>"Contraseña de aplicación"</b>, confirma el <b>correo remitente</b>, y presiona <b>Guardar</b>. Luego usa <b>"Probar envío"</b> para verificar.</li>
        </ol>
        <p class="text-xs text-muted-ink">Nota: se puede pegar con o sin espacios, da igual. Si no ves "Contraseñas de aplicaciones", casi siempre es porque falta activar la verificación en 2 pasos (paso 2).</p>
      </div>
    </div>

    <div v-if="cargando" class="p-10 text-center text-muted-ink"><LoaderCircle :size="20" class="animate-spin mx-auto" /></div>

    <template v-else>
      <!-- Estado -->
      <div class="mt-6 flex items-center gap-2 text-sm">
        <span v-if="configurado" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#e0f0ec] text-success font-medium">
          <ShieldCheck :size="15" /> Configurado
        </span>
        <span v-else class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#fef3d6] text-[#8a6d1a] font-medium">
          Sin configurar
        </span>
      </div>

      <div class="bg-card border border-line rounded-lg shadow-sm mt-4 p-6 space-y-4">
        <div>
          <label class="eyebrow block mb-1">Correo remitente</label>
          <input v-model="remitente" :disabled="!esSuperAdmin" placeholder="generpowercontrol@gmail.com"
            class="h-10 w-full px-3 rounded-md border border-line bg-white text-sm disabled:bg-secondary/40" />
        </div>
        <div>
          <label class="eyebrow block mb-1">Contraseña de aplicación</label>
          <input v-model="appPassword" :disabled="!esSuperAdmin" type="password"
            :placeholder="configurado ? '•••••••• (guardada — escribe una nueva para cambiarla)' : '16 caracteres de la contraseña de aplicación'"
            class="h-10 w-full px-3 rounded-md border border-line bg-white text-sm disabled:bg-secondary/40" />
          <p class="text-xs text-muted-ink mt-1">
            Se guarda cifrada del lado del servidor y nunca se muestra de vuelta. Genera una en
            <b>Cuenta de Google → Seguridad → Contraseñas de aplicaciones</b> (requiere verificación en 2 pasos).
          </p>
        </div>

        <div v-if="esSuperAdmin" class="flex items-center gap-2">
          <button @click="guardar" :disabled="guardando"
            class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 inline-flex items-center gap-2">
            <LoaderCircle v-if="guardando" :size="15" class="animate-spin" /><Check v-else :size="16" /> Guardar
          </button>
        </div>
        <p v-else class="text-xs text-muted-ink">Solo el superAdmin puede editar estas credenciales.</p>
      </div>

      <!-- Probar -->
      <div class="bg-card border border-line rounded-lg shadow-sm mt-4 p-6">
        <label class="eyebrow block mb-1">Probar envío</label>
        <p class="text-xs text-muted-ink mb-2">Manda un correo de prueba para verificar que la configuración funciona.</p>
        <div class="flex gap-2">
          <input v-model="correoPrueba" type="email" placeholder="tu-correo@ejemplo.com (vacío = tu cuenta)"
            class="flex-1 h-10 px-3 rounded-md border border-line bg-white text-sm" />
          <button @click="enviarPrueba" :disabled="probando"
            class="h-10 px-4 rounded-md border border-line-strong text-sm text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50 inline-flex items-center gap-2">
            <LoaderCircle v-if="probando" :size="15" class="animate-spin" /><Send v-else :size="15" /> Enviar prueba
          </button>
        </div>
      </div>

      <p v-if="ok" class="text-sm text-success mt-4 inline-flex items-center gap-1"><Mail :size="15" /> {{ ok }}</p>
      <p v-if="error" class="text-sm text-danger mt-4">{{ error }}</p>
    </template>
  </div>
</template>
