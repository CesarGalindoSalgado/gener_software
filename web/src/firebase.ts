import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

// Config del proyecto. Estos valores NO son secretos: identifican el proyecto y
// viajan al cliente. La seguridad real vive en las reglas de Firestore y en la
// lista blanca de usuarios/{correo}. Por defecto = PRODUCCIÓN (gener-3ecc1); para
// compilar contra un proyecto de PRUEBAS, se sobreescriben con variables de
// entorno de Vite (ver web/.env.pruebas y `npm run build -- --mode pruebas`).
const E = import.meta.env;
const firebaseConfig = {
  apiKey: E.VITE_FB_API_KEY ?? 'AIzaSyDdoG6FdNQuI30OAcfRTo-39C0aqpPh99w',
  authDomain: E.VITE_FB_AUTH_DOMAIN ?? 'gener-3ecc1.firebaseapp.com',
  projectId: E.VITE_FB_PROJECT_ID ?? 'gener-3ecc1',
  storageBucket: E.VITE_FB_STORAGE_BUCKET ?? 'gener-3ecc1.firebasestorage.app',
  messagingSenderId: E.VITE_FB_MSG_SENDER_ID ?? '346403248547',
  appId: E.VITE_FB_APP_ID ?? '1:346403248547:web:29b484c2586e90347d6216',
};
// Útil para armar URLs del proyecto en el portal (ej. el redirect de Drive).
export const projectId = firebaseConfig.projectId;

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, 'us-central1');

// Con VITE_EMULADOR=1, las callables van al emulador local de Functions
// (auth y firestore siguen siendo los reales). Útil mientras no hay Blaze.
if (import.meta.env.VITE_EMULADOR === '1') {
  connectFunctionsEmulator(functions, window.location.hostname, 5001);
}
