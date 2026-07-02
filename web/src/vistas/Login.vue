<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Zap } from 'lucide-vue-next';
import { auth } from '../firebase';
import { iniciarSesion } from '../sesion';

const router = useRouter();
const correo = ref('');
const password = ref('');
const error = ref('');
const enviando = ref(false);

async function entrar() {
  error.value = '';
  enviando.value = true;
  try {
    await iniciarSesion(correo.value, password.value);
    // El doc usuarios/{correo} se resuelve en el store; si no está en la lista
    // blanca, se cierra sesión y se avisa.
    const { sesion, cerrarSesion } = await import('../sesion');
    // Pequeña espera a que onAuthStateChanged resuelva el rol.
    await new Promise((r) => setTimeout(r, 300));
    if (sesion.usuario === null) {
      await cerrarSesion();
      error.value = 'Tu cuenta no está autorizada en Porttea-Gener. Contacta al administrador.';
      return;
    }
    router.push({ name: 'cotizaciones' });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code ?? '';
    error.value =
      code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'
        ? 'Correo o contraseña incorrectos.'
        : 'No se pudo iniciar sesión. Intenta de nuevo.';
  } finally {
    enviando.value = false;
    void auth; // referencia para asegurar init de firebase
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-sm bg-card border border-line rounded-lg shadow-sm p-8">
      <div class="flex items-center gap-2 mb-1">
        <Zap :size="22" class="text-brand" fill="currentColor" stroke="#10243f" :stroke-width="1" />
        <span class="font-serif text-2xl text-ink">Porttea<span class="text-brand-text italic">-Gener</span></span>
      </div>
      <p class="eyebrow mb-6">Acceso a cotizaciones</p>

      <form @submit.prevent="entrar" class="space-y-4">
        <div>
          <label class="eyebrow block mb-1">Correo</label>
          <input
            v-model="correo"
            type="email"
            required
            autocomplete="email"
            class="w-full h-10 px-3 rounded-md border border-line bg-white text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-bright/25"
          />
        </div>
        <div>
          <label class="eyebrow block mb-1">Contraseña</label>
          <input
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            class="w-full h-10 px-3 rounded-md border border-line bg-white text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-bright/25"
          />
        </div>

        <p v-if="error" class="text-sm text-danger">{{ error }}</p>

        <button
          type="submit"
          :disabled="enviando"
          class="w-full h-10 rounded-md bg-accent text-white font-medium hover:bg-accent-bright transition-colors disabled:opacity-60"
        >
          {{ enviando ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>
    </div>
  </div>
</template>
