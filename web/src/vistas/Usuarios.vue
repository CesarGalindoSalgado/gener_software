<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue';
import { UserPlus, LoaderCircle, Check, X, Users as UsersIcon } from 'lucide-vue-next';
import type { Rol } from '../dominio/tipos';
import {
  actualizarUsuario,
  crearUsuario,
  suscribirUsuarios,
  type UsuarioDoc,
} from '../servicios/usuarios';

const ROLES: { valor: Rol; etiqueta: string }[] = [
  { valor: 'superAdmin', etiqueta: 'superAdmin (admin técnico)' },
  { valor: 'dueno', etiqueta: 'Dueño' },
  { valor: 'secretaria', etiqueta: 'Secretaria' },
  { valor: 'trabajador', etiqueta: 'Trabajador' },
];

const usuarios = ref<UsuarioDoc[]>([]);
const cargando = ref(true);
const off = suscribirUsuarios((lista) => {
  usuarios.value = lista;
  cargando.value = false;
});
onUnmounted(off);

// --- Alta ---
const mostrandoForma = ref(false);
const guardando = ref(false);
const error = ref('');
const ok = ref('');
const nuevo = reactive({ nombre: '', correo: '', rol: 'secretaria' as Rol, password: '', telefono: '' });

async function crear() {
  error.value = '';
  ok.value = '';
  if (!nuevo.nombre.trim() || !nuevo.correo.trim() || nuevo.password.length < 6) {
    error.value = 'Nombre, correo y contraseña (mínimo 6 caracteres) son obligatorios.';
    return;
  }
  guardando.value = true;
  try {
    await crearUsuario({ ...nuevo });
    ok.value = `Usuario ${nuevo.correo} creado.`;
    Object.assign(nuevo, { nombre: '', correo: '', rol: 'secretaria', password: '', telefono: '' });
    mostrandoForma.value = false;
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo crear el usuario.';
  } finally {
    guardando.value = false;
  }
}

// --- Activar / desactivar ---
const cambiando = ref<string | null>(null);
async function alternarActivo(u: UsuarioDoc) {
  cambiando.value = u.correo;
  error.value = '';
  try {
    await actualizarUsuario({ correo: u.correo, activo: !u.activo });
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo actualizar.';
  } finally {
    cambiando.value = null;
  }
}

// --- Editar ---
const editando = ref<UsuarioDoc | null>(null);
const guardandoEdit = ref(false);
const errorEdit = ref('');
const edit = reactive({ nombre: '', rol: 'secretaria' as Rol, telefono: '', password: '' });

function abrirEditar(u: UsuarioDoc) {
  editando.value = u;
  errorEdit.value = '';
  edit.nombre = u.nombre ?? '';
  edit.rol = u.rol;
  edit.telefono = u.telefono ?? '';
  edit.password = '';
}

async function guardarEdicion() {
  if (!editando.value || guardandoEdit.value) return;
  if (!edit.nombre.trim()) {
    errorEdit.value = 'El nombre no puede ir vacío.';
    return;
  }
  if (edit.password && edit.password.length < 6) {
    errorEdit.value = 'La nueva contraseña debe tener al menos 6 caracteres (o déjala vacía).';
    return;
  }
  guardandoEdit.value = true;
  errorEdit.value = '';
  try {
    await actualizarUsuario({
      correo: editando.value.correo,
      nombre: edit.nombre.trim(),
      rol: edit.rol,
      telefono: edit.telefono,
      password: edit.password || undefined,
    });
    ok.value = `Usuario ${editando.value.correo} actualizado.`;
    editando.value = null;
  } catch (e: unknown) {
    errorEdit.value = (e as { message?: string })?.message ?? 'No se pudo actualizar.';
  } finally {
    guardandoEdit.value = false;
  }
}

const total = computed(() => usuarios.value.length);
</script>

<template>
  <div class="p-8">
    <p class="eyebrow eyebrow--marca">Administración</p>
    <div class="flex items-end justify-between">
      <div>
        <h1 class="text-4xl mb-1">Usuarios</h1>
        <div class="h-0.5 w-[90px] bg-brand"></div>
      </div>
      <button
        @click="mostrandoForma = !mostrandoForma"
        class="flex items-center gap-2 h-10 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright"
      >
        <UserPlus :size="16" /> Nuevo usuario
      </button>
    </div>

    <p v-if="ok" class="text-sm text-success mt-4">{{ ok }}</p>

    <!-- Alta -->
    <div v-if="mostrandoForma" class="bg-card border border-line rounded-lg shadow-sm p-5 mt-6">
      <p class="eyebrow mb-3">Nuevo usuario</p>
      <form @submit.prevent="crear" class="grid grid-cols-2 gap-3">
        <div>
          <label class="eyebrow block mb-1">Nombre</label>
          <input v-model="nuevo.nombre" required class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
        </div>
        <div>
          <label class="eyebrow block mb-1">Correo (será su usuario)</label>
          <input v-model="nuevo.correo" type="email" required class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
        </div>
        <div>
          <label class="eyebrow block mb-1">Contraseña (mín. 6)</label>
          <input v-model="nuevo.password" type="text" required class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
        </div>
        <div>
          <label class="eyebrow block mb-1">Rol</label>
          <select v-model="nuevo.rol" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm">
            <option v-for="r in ROLES" :key="r.valor" :value="r.valor">{{ r.etiqueta }}</option>
          </select>
        </div>
        <div>
          <label class="eyebrow block mb-1">Teléfono (para el bot, opcional)</label>
          <input v-model="nuevo.telefono" placeholder="5217771234567" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
        </div>
        <div class="flex items-end">
          <button
            type="submit"
            :disabled="guardando"
            class="h-10 px-5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center gap-2"
          >
            <LoaderCircle v-if="guardando" :size="15" class="animate-spin" />
            {{ guardando ? 'Creando…' : 'Crear usuario' }}
          </button>
        </div>
      </form>
      <p v-if="error" class="text-sm text-danger mt-3">{{ error }}</p>
    </div>

    <!-- Listado -->
    <div class="bg-card border border-line rounded-lg shadow-sm mt-6 overflow-hidden">
      <div class="px-5 py-3 border-b border-line flex items-center justify-between">
        <p class="eyebrow">Cuentas ({{ total }})</p>
      </div>

      <div v-if="cargando" class="p-8 text-center text-muted-ink">
        <LoaderCircle :size="20" class="animate-spin mx-auto" />
      </div>
      <div v-else-if="total === 0" class="p-10 text-center">
        <div class="border border-dashed border-line-strong rounded-lg p-8">
          <UsersIcon :size="28" class="mx-auto text-muted-ink mb-3" />
          <p class="text-muted-ink text-sm">Aún no hay usuarios. Crea el primero.</p>
        </div>
      </div>

      <table v-else class="w-full text-sm">
        <thead>
          <tr class="text-left border-b border-line">
            <th class="px-5 py-2 eyebrow font-normal">Nombre</th>
            <th class="px-5 py-2 eyebrow font-normal">Correo</th>
            <th class="px-5 py-2 eyebrow font-normal">Rol</th>
            <th class="px-5 py-2 eyebrow font-normal">Estado</th>
            <th class="px-5 py-2 eyebrow font-normal"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in usuarios" :key="u.correo" class="border-b border-line last:border-0">
            <td class="px-5 py-3 font-medium">{{ u.nombre }}</td>
            <td class="px-5 py-3 text-ink-2">{{ u.correo }}</td>
            <td class="px-5 py-3">
              <span class="text-xs px-2 py-0.5 rounded-md bg-secondary text-ink-2 font-mono">{{ u.rol }}</span>
            </td>
            <td class="px-5 py-3">
              <span
                class="text-xs px-2 py-0.5 rounded-md flex items-center gap-1 w-fit"
                :class="u.activo ? 'bg-[#e0f0ec] text-success' : 'bg-[#f9e6ea] text-danger'"
              >
                <Check v-if="u.activo" :size="12" /><X v-else :size="12" />
                {{ u.activo ? 'Activo' : 'Inactivo' }}
              </span>
            </td>
            <td class="px-5 py-3 text-right">
              <div class="flex items-center justify-end gap-3">
                <button @click="abrirEditar(u)" class="text-xs text-accent hover:text-accent-bright">
                  Editar
                </button>
                <button
                  @click="alternarActivo(u)"
                  :disabled="cambiando === u.correo"
                  class="text-xs text-muted-ink hover:text-ink disabled:opacity-50"
                >
                  {{ cambiando === u.correo ? '…' : u.activo ? 'Desactivar' : 'Activar' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ===== Modal editar usuario ===== -->
    <div v-if="editando" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div class="bg-card rounded-xl shadow-xl w-full max-w-md p-6">
        <p class="eyebrow eyebrow--marca">Editar usuario</p>
        <h2 class="text-xl mb-1">{{ editando.correo }}</h2>
        <p class="text-xs text-muted-ink mb-4">El correo no se puede cambiar (es su identidad de acceso).</p>

        <div class="space-y-3">
          <div>
            <label class="eyebrow block mb-1">Nombre</label>
            <input v-model="edit.nombre" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="eyebrow block mb-1">Rol</label>
              <select v-model="edit.rol" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm">
                <option v-for="r in ROLES" :key="r.valor" :value="r.valor">{{ r.etiqueta }}</option>
              </select>
            </div>
            <div>
              <label class="eyebrow block mb-1">Teléfono (bot)</label>
              <input v-model="edit.telefono" placeholder="5217771234567" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
            </div>
          </div>
          <div>
            <label class="eyebrow block mb-1">Nueva contraseña (vacío = no cambiar)</label>
            <input v-model="edit.password" type="text" placeholder="mín. 6 caracteres" class="w-full h-10 px-3 rounded-md border border-line bg-white text-sm" />
          </div>
        </div>

        <p v-if="errorEdit" class="text-sm text-danger mt-3">{{ errorEdit }}</p>

        <div class="flex gap-2 mt-5">
          <button
            @click="guardarEdicion"
            :disabled="guardandoEdit"
            class="flex-1 h-10 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <LoaderCircle v-if="guardandoEdit" :size="15" class="animate-spin" />
            {{ guardandoEdit ? 'Guardando…' : 'Guardar cambios' }}
          </button>
          <button @click="editando = null" class="flex-1 h-10 rounded-md text-sm font-medium text-muted-ink hover:text-ink">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
