import { collection, onSnapshot, type Timestamp, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import type { Rol } from '../dominio/tipos';

export interface UsuarioDoc {
  correo: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  telefono?: string | null;
  telegramChatId?: string | null;
  creadoEn?: Timestamp | null;
}

const callableCrear = httpsCallable<
  { correo: string; nombre: string; rol: Rol; password: string; telefono?: string; telegramChatId?: string },
  { ok: boolean }
>(functions, 'crearUsuarioCallable');

const callableActualizar = httpsCallable<
  { correo: string; nombre?: string; rol?: Rol; activo?: boolean; telefono?: string; telegramChatId?: string; password?: string },
  { ok: boolean }
>(functions, 'actualizarUsuarioCallable');

export async function crearUsuario(datos: {
  correo: string;
  nombre: string;
  rol: Rol;
  password: string;
  telefono?: string;
  telegramChatId?: string;
}) {
  return (await callableCrear(datos)).data;
}

export async function actualizarUsuario(datos: {
  correo: string;
  nombre?: string;
  rol?: Rol;
  activo?: boolean;
  telefono?: string;
  telegramChatId?: string;
  password?: string;
}) {
  return (await callableActualizar(datos)).data;
}

export function suscribirUsuarios(cb: (items: UsuarioDoc[]) => void): Unsubscribe {
  // OJO: NO usar orderBy('nombre') en la query — Firestore omite los documentos
  // que no tienen ese campo, así que un usuario sin "nombre" desaparecería de la
  // lista. Traemos todos y ordenamos en el cliente.
  return onSnapshot(collection(db, 'usuarios'), (snap) => {
    const items = snap.docs.map((d) => ({ correo: d.id, ...(d.data() as Omit<UsuarioDoc, 'correo'>) }));
    items.sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''));
    cb(items);
  });
}
