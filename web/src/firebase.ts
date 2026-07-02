import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Config del proyecto gener-3ecc1. Estos valores NO son secretos: identifican
// el proyecto y viajan al cliente. La seguridad real vive en las reglas de
// Firestore y en la lista blanca de usuarios/{correo}.
const firebaseConfig = {
  apiKey: 'AIzaSyDdoG6FdNQuI30OAcfRTo-39C0aqpPh99w',
  authDomain: 'gener-3ecc1.firebaseapp.com',
  projectId: 'gener-3ecc1',
  storageBucket: 'gener-3ecc1.firebasestorage.app',
  messagingSenderId: '346403248547',
  appId: '1:346403248547:web:29b484c2586e90347d6216',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
