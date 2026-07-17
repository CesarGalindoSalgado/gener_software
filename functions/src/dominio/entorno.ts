// URLs públicas del proyecto, derivadas del ID en tiempo de ejecución para que el
// MISMO código sirva en producción y en un proyecto de pruebas sin editar nada.
// Cloud Functions expone el proyecto en GCLOUD_PROJECT. El fallback es producción.
const REGION = 'us-central1';
export const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'gener-3ecc1';

// Base de las funciones HTTP (https://us-central1-<proyecto>.cloudfunctions.net).
export const BASE_FUNCIONES = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
// Host del portal (Firebase Hosting): https://<proyecto>.web.app
export const HOST_WEB = `https://${PROJECT_ID}.web.app`;
