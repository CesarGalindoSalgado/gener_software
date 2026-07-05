import { reactive, readonly, watch } from 'vue';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { Usuario } from './dominio/tipos';

interface EstadoSesion {
  cargando: boolean; // true hasta resolver el primer onAuthStateChanged
  usuarioAuth: User | null;
  usuario: Usuario | null; // doc de usuarios/{correo}; null si no está en la lista blanca
}

const estado = reactive<EstadoSesion>({
  cargando: true,
  usuarioAuth: null,
  usuario: null,
});

// Resuelve el doc usuarios/{correo}. Si no existe o está inactivo, el usuario
// autenticado no forma parte de G-ener (lista blanca): se deja usuario = null.
async function resolverUsuario(correo: string): Promise<Usuario | null> {
  const snap = await getDoc(doc(db, 'usuarios', correo));
  if (!snap.exists()) return null;
  const u = snap.data() as Usuario;
  return u.activo ? u : null;
}

onAuthStateChanged(auth, async (user) => {
  estado.usuarioAuth = user;
  try {
    estado.usuario = user?.email ? await resolverUsuario(user.email) : null;
  } catch (e) {
    // Lectura rechazada por reglas o red: no dejar la sesión colgada.
    console.error('No se pudo resolver el usuario en Firestore:', e);
    estado.usuario = null;
  } finally {
    estado.cargando = false;
  }
});

export const sesion = readonly(estado);

export async function iniciarSesion(correo: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, correo.trim().toLowerCase(), password);
}

export async function cerrarSesion(): Promise<void> {
  await signOut(auth);
}

// Espera a que termine la carga inicial de sesión (útil en el guard del router).
// OJO: hay que esperar a que `cargando` sea false, es decir a que se haya
// RESUELTO el doc de la lista blanca (usuarios/{correo}), no solo al primer
// evento de auth. Si no, en una pestaña nueva (p. ej. la vista de impresión que
// abre el botón de PDF) el guard corre antes de resolver el usuario y redirige
// al login por error.
export function esperarCarga(): Promise<void> {
  if (!estado.cargando) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(
      () => estado.cargando,
      (cargando) => {
        if (!cargando) {
          stop();
          resolve();
        }
      }
    );
  });
}
