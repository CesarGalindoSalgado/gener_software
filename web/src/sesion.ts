import { reactive, readonly } from 'vue';
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
  if (user?.email) {
    estado.usuario = await resolverUsuario(user.email);
  } else {
    estado.usuario = null;
  }
  estado.cargando = false;
});

export const sesion = readonly(estado);

export async function iniciarSesion(correo: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, correo.trim().toLowerCase(), password);
}

export async function cerrarSesion(): Promise<void> {
  await signOut(auth);
}

// Espera a que termine la carga inicial de auth (útil en el guard del router).
export function esperarCarga(): Promise<void> {
  if (!estado.cargando) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, () => {
      stop();
      resolve();
    });
  });
}
