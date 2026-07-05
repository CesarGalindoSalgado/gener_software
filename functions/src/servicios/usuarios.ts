import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { Rol } from '../dominio/tipos';

// Gestión de usuarios (Admin SDK). Crea la cuenta de Firebase Auth (correo +
// contraseña, ya verificada para no exigir el correo de verificación) y el
// documento usuarios/{correo} con su rol. La identidad web es el correo.

export const ROLES_VALIDOS: Rol[] = ['superAdmin', 'dueno', 'secretaria', 'trabajador'];

export interface DatosNuevoUsuario {
  correo: string;
  nombre: string;
  rol: Rol;
  password: string;
  telefono?: string;
}

function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

export async function crearUsuario(db: Firestore, datos: DatosNuevoUsuario): Promise<void> {
  const correo = normalizarCorreo(datos.correo);
  if (!ROLES_VALIDOS.includes(datos.rol)) {
    throw new Error(`Rol inválido: ${datos.rol}`);
  }
  if ((datos.password ?? '').length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }

  const auth = getAuth();

  // 1) Cuenta de Firebase Auth. Si ya existe, la reutilizamos (idempotente).
  let uid: string;
  try {
    const user = await auth.createUser({
      email: correo,
      password: datos.password,
      displayName: datos.nombre,
      emailVerified: true, // el dueño da de alta cuentas confiables
    });
    uid = user.uid;
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/email-already-exists') {
      const existente = await auth.getUserByEmail(correo);
      uid = existente.uid;
      await auth.updateUser(uid, { password: datos.password, displayName: datos.nombre });
    } else {
      throw e;
    }
  }

  // 2) Documento de rol (id = correo). Fuente de verdad de la lista blanca.
  await db.doc(`usuarios/${correo}`).set(
    {
      nombre: datos.nombre.trim(),
      correo,
      rol: datos.rol,
      activo: true,
      telefono: datos.telefono?.replace(/\D/g, '') || null,
      uid,
      creadoEn: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function actualizarUsuario(
  db: Firestore,
  correo: string,
  cambios: { nombre?: string; rol?: Rol; activo?: boolean; telefono?: string; password?: string }
): Promise<void> {
  const id = normalizarCorreo(correo);
  const upd: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) upd.nombre = cambios.nombre.trim();
  if (cambios.rol !== undefined) {
    if (!ROLES_VALIDOS.includes(cambios.rol)) throw new Error(`Rol inválido: ${cambios.rol}`);
    upd.rol = cambios.rol;
  }
  if (cambios.activo !== undefined) upd.activo = cambios.activo;
  if (cambios.telefono !== undefined) upd.telefono = cambios.telefono.replace(/\D/g, '') || null;

  const cambiaPassword = cambios.password !== undefined && cambios.password !== '';
  if (cambiaPassword && cambios.password!.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }

  if (Object.keys(upd).length) {
    await db.doc(`usuarios/${id}`).set(upd, { merge: true });
  }

  // Efectos en la cuenta de Auth (desactivar y/o cambiar contraseña) requieren el uid.
  if (cambios.activo !== undefined || cambiaPassword) {
    const snap = await db.doc(`usuarios/${id}`).get();
    const uid = snap.data()?.uid as string | undefined;
    if (uid) {
      const authUpd: Record<string, unknown> = {};
      if (cambios.activo !== undefined) authUpd.disabled = !cambios.activo; // deshabilita el login
      if (cambiaPassword) authUpd.password = cambios.password;
      await getAuth().updateUser(uid, authUpd);
    }
  }
}
