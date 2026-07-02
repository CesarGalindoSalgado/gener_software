import { createRouter, createWebHistory } from 'vue-router';
import { esperarCarga, sesion } from './sesion';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./vistas/Login.vue'),
      meta: { publica: true },
    },
    {
      path: '/',
      component: () => import('./layout/Shell.vue'),
      children: [
        {
          path: '',
          name: 'cotizaciones',
          component: () => import('./vistas/Cotizaciones.vue'),
        },
        {
          path: 'taller',
          name: 'taller',
          component: () => import('./vistas/Taller.vue'),
        },
      ],
    },
  ],
});

// Guard: espera la carga inicial de auth, luego decide.
router.beforeEach(async (to) => {
  await esperarCarga();
  const autenticado = sesion.usuario !== null; // en la lista blanca y activo

  if (!to.meta.publica && !autenticado) {
    return { name: 'login' };
  }
  if (to.name === 'login' && autenticado) {
    return { name: 'cotizaciones' };
  }
  return true;
});

export default router;
