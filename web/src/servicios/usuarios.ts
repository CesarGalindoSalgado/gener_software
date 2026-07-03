import { collection, onSnapshot, orderBy, query, type Timestamp, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import type { Rol } from '../dominio/tipos';

export interface UsuarioDoc {
  correo: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  telefono?: string | null;
  creadoEn?: Timestamp | null;
}

const callableCrear = httpsCallable<
  { correo: string; nombre: string; rol: Rol; password: string; telefono?: string },
  { ok: boolean }
>(functions, 'crearUsuarioCallable');

const callableActualizar = httpsCallable<
  { correo: string; nombre?: string; rol?: Rol; activo?: boolean; telefono?: string },
  { ok: boolean }
>(functions, 'actualizarUsuarioCallable');

export async function crearUsuario(datos: {
  correo: string;
  nombre: string;
  rol: Rol;
  password: string;
  telefono?: string;
}) {
  return (await callableCrear(datos)).data;
}

export async function actualizarUsuario(datos: {
  correo: string;
  nombre?: string;
  rol?: Rol;
  activo?: boolean;
  telefono?: string;
}) {
  return (await callableActualizar(datos)).data;
}

export function suscribirUsuarios(cb: (items: UsuarioDoc[]) => void): Unsubscribe {
  const q = query(collection(db, 'usuarios'), orderBy('nombre', 'asc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ correo: d.id, ...(d.data() as Omit<UsuarioDoc, 'correo'>) })));
  });
}
