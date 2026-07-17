<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { LoaderCircle, Check, ShieldCheck, FolderOpen, ExternalLink, Send } from 'lucide-vue-next';
import { estadoConfigDrive, guardarConfigDrive, urlConsentimientoDrive, probarDrive } from '../servicios/cotizaciones';
import { sesion } from '../sesion';
import { projectId } from '../firebase';

const esSuperAdmin = computed(() => sesion.usuario?.rol === 'superAdmin');

// URI que hay que registrar en Google Cloud (debe ser EXACTA). Se deriva del
// proyecto actual, así en pruebas muestra la URL del proyecto de pruebas.
const REDIRECT_URI = `https://us-central1-${projectId}.cloudfunctions.net/driveOAuthCallback`;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const verGuia = ref(false);
const copiado = ref('');
async function copiar(texto: string, cual: string) {
  try {
    await navigator.clipboard.writeText(texto);
    copiado.value = cual;
    setTimeout(() => (copiado.value = ''), 1500);
  } catch {
    /* ignore */
  }
}

const cargando = ref(true);
const conectado = ref(false);
const tieneCredenciales = ref(false);
const folderNombre = ref('G-ener Documentos');
const folderId = ref<string | null>(null);
const clientId = ref('');
const clientSecret = ref('');
const guardando = ref(false);
const conectando = ref(false);
const probando = ref(false);
const ok = ref('');
const error = ref('');

async function cargar() {
  cargando.value = true;
  try {
    const st = await estadoConfigDrive();
    conectado.value = st.conectado;
    tieneCredenciales.value = st.tieneCredenciales;
    folderNombre.value = st.folderNombre;
    folderId.value = st.folderId;
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
    await guardarConfigDrive({
      clientId: clientId.value.trim() || undefined,
      clientSecret: clientSecret.value.trim() || undefined,
      folderNombre: folderNombre.value.trim() || undefined,
    });
    clientId.value = '';
    clientSecret.value = '';
    ok.value = 'Guardado. Ahora presiona "Conectar Drive".';
    await cargar();
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo guardar.';
  } finally {
    guardando.value = false;
  }
}

async function conectar() {
  conectando.value = true;
  ok.value = '';
  error.value = '';
  try {
    const { url } = await urlConsentimientoDrive();
    window.open(url, '_blank');
    ok.value = 'Abrí Google en otra pestaña. Autoriza y luego regresa y presiona "Actualizar estado".';
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo iniciar la conexión.';
  } finally {
    conectando.value = false;
  }
}

async function probar() {
  probando.value = true;
  ok.value = '';
  error.value = '';
  try {
    const res = await probarDrive();
    ok.value = `Archivo de prueba subido a Drive. Ábrelo: ${res.link}`;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo subir el archivo de prueba.';
  } finally {
    probando.value = false;
  }
}
</script>

<template>
  <div class="p-8 max-w-2xl">
    <p class="eyebrow eyebrow--marca">Configuración</p>
    <h1 class="text-4xl mb-1">Google Drive</h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>
    <p class="text-sm text-muted-ink mt-3">
      Conecta la cuenta de Google donde se guardarán las cotizaciones aprobadas y los reportes de rutinas
      firmados. La app solo accede a los archivos que ella misma crea.
    </p>

    <!-- Guía paso a paso (para hacerlo sin ayuda técnica) -->
    <div class="mt-4 border border-line rounded-lg bg-secondary/30">
      <button @click="verGuia = !verGuia" class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-ink">
        <span>📘 ¿Cómo obtengo el Client ID y el Client Secret? (guía paso a paso)</span>
        <span class="text-muted-ink">{{ verGuia ? '▲' : '▼' }}</span>
      </button>
      <div v-if="verGuia" class="px-4 pb-4 text-sm text-ink-2 space-y-3 border-t border-line pt-3">
        <p>Se hace una sola vez, en la consola de Google Cloud, con la cuenta de Google donde quieres guardar los documentos. Toma ~5 minutos.</p>
        <ol class="list-decimal ml-5 space-y-2">
          <li>Entra a <a href="https://console.cloud.google.com/" target="_blank" class="text-accent hover:underline">console.cloud.google.com</a> con tu cuenta de Google. Si te pide crear/elegir un proyecto, crea uno (nombre libre, ej. "G-ener").</li>
          <li>Busca arriba <b>"Google Drive API"</b> y presiona <b>Habilitar</b>.</li>
          <li>Menú → <b>APIs y servicios → Pantalla de consentimiento de OAuth</b>:
            <ul class="list-disc ml-5 mt-1 space-y-0.5">
              <li>Tipo de usuario: <b>Externo</b> → Crear.</li>
              <li>Nombre de la app: <i>G-ener Documentos</i>. Correo de asistencia y de contacto: tu mismo Gmail.</li>
              <li>En <b>Permisos / Scopes</b>, agrega este permiso:
                <div class="flex items-center gap-2 mt-1">
                  <code class="text-xs bg-white border border-line rounded px-2 py-1 break-all">{{ SCOPE }}</code>
                  <button @click="copiar(SCOPE, 'scope')" class="text-xs text-accent hover:underline shrink-0">{{ copiado === 'scope' ? '¡copiado!' : 'copiar' }}</button>
                </div>
              </li>
              <li>Al final, presiona <b>Publicar aplicación</b> (así la conexión no caduca; con este permiso no requiere verificación de Google).</li>
            </ul>
          </li>
          <li><b>APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth</b>:
            <ul class="list-disc ml-5 mt-1 space-y-0.5">
              <li>Tipo: <b>Aplicación web</b>.</li>
              <li>En <b>URIs de redireccionamiento autorizados</b>, presiona "Agregar URI" y pega EXACTAMENTE esto:
                <div class="flex items-center gap-2 mt-1">
                  <code class="text-xs bg-white border border-line rounded px-2 py-1 break-all">{{ REDIRECT_URI }}</code>
                  <button @click="copiar(REDIRECT_URI, 'uri')" class="text-xs text-accent hover:underline shrink-0">{{ copiado === 'uri' ? '¡copiado!' : 'copiar' }}</button>
                </div>
              </li>
              <li>Presiona <b>Crear</b>. Google te mostrará el <b>Client ID</b> y el <b>Client Secret</b>.</li>
            </ul>
          </li>
          <li>Copia esos dos valores y pégalos aquí abajo (paso 1). Luego presiona <b>Guardar credenciales</b> y después <b>Conectar Drive</b>.</li>
        </ol>
        <p class="text-xs text-muted-ink">Nota: si al conectar Google dice "app no verificada", es normal en apps nuevas; presiona <i>Configuración avanzada → Ir a G-ener (no seguro)</i> y continúa. Con la app publicada normalmente ni aparece.</p>
      </div>
    </div>

    <div v-if="cargando" class="p-10 text-center text-muted-ink"><LoaderCircle :size="20" class="animate-spin mx-auto" /></div>

    <template v-else>
      <!-- Estado -->
      <div class="mt-6 flex items-center gap-2 text-sm">
        <span v-if="conectado" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#e0f0ec] text-success font-medium">
          <ShieldCheck :size="15" /> Conectado
        </span>
        <span v-else class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#fef3d6] text-[#8a6d1a] font-medium">
          Sin conectar
        </span>
        <button @click="cargar" class="text-xs text-accent hover:text-accent-bright">Actualizar estado</button>
      </div>

      <!-- Credenciales -->
      <div class="bg-card border border-line rounded-lg shadow-sm mt-4 p-6 space-y-4">
        <p class="text-sm font-medium text-ink">1 · Credenciales de Google (OAuth)</p>
        <div>
          <label class="eyebrow block mb-1">Client ID</label>
          <input v-model="clientId" :disabled="!esSuperAdmin" :placeholder="tieneCredenciales ? '•••• (guardado — escribe uno nuevo para cambiarlo)' : 'xxxxx.apps.googleusercontent.com'"
            class="h-10 w-full px-3 rounded-md border border-line bg-white text-sm disabled:bg-secondary/40" />
        </div>
        <div>
          <label class="eyebrow block mb-1">Client Secret</label>
          <input v-model="clientSecret" :disabled="!esSuperAdmin" type="password" :placeholder="tieneCredenciales ? '•••• (guardado)' : 'GOCSPX-...'"
            class="h-10 w-full px-3 rounded-md border border-line bg-white text-sm disabled:bg-secondary/40" />
        </div>
        <div>
          <label class="eyebrow block mb-1">Nombre de la carpeta en Drive</label>
          <input v-model="folderNombre" :disabled="!esSuperAdmin" class="h-10 w-full px-3 rounded-md border border-line bg-white text-sm disabled:bg-secondary/40" />
          <p v-if="folderId" class="text-xs text-muted-ink mt-1 inline-flex items-center gap-1"><FolderOpen :size="13" /> Carpeta creada en tu Drive.</p>
        </div>
        <div v-if="esSuperAdmin" class="flex flex-wrap items-center gap-2">
          <button @click="guardar" :disabled="guardando"
            class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 inline-flex items-center gap-2">
            <LoaderCircle v-if="guardando" :size="15" class="animate-spin" /><Check v-else :size="16" /> Guardar credenciales
          </button>
        </div>
        <p v-else class="text-xs text-muted-ink">Solo el superAdmin puede configurar Drive.</p>
      </div>

      <!-- Conectar -->
      <div v-if="esSuperAdmin" class="bg-card border border-line rounded-lg shadow-sm mt-4 p-6 space-y-3">
        <p class="text-sm font-medium text-ink">2 · Conectar la cuenta</p>
        <p class="text-xs text-muted-ink">Se abrirá Google para autorizar. Al terminar, vuelve y presiona "Actualizar estado".</p>
        <div class="flex flex-wrap gap-2">
          <button @click="conectar" :disabled="conectando || !tieneCredenciales"
            class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 inline-flex items-center gap-2">
            <LoaderCircle v-if="conectando" :size="15" class="animate-spin" /><ExternalLink v-else :size="16" />
            {{ conectado ? 'Reconectar Drive' : 'Conectar Drive' }}
          </button>
          <button v-if="conectado" @click="probar" :disabled="probando"
            class="h-10 px-4 rounded-md border border-line-strong text-sm text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50 inline-flex items-center gap-2">
            <LoaderCircle v-if="probando" :size="15" class="animate-spin" /><Send v-else :size="15" /> Subir archivo de prueba
          </button>
        </div>
      </div>

      <p v-if="ok" class="text-sm text-success mt-4 break-all">{{ ok }}</p>
      <p v-if="error" class="text-sm text-danger mt-4">{{ error }}</p>
    </template>
  </div>
</template>
