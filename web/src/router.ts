import { createRouter, createWebHistory } from 'vue-router';
import { esperarCarga, sesion } from './sesion';
import { ROLES_ADMIN } from './dominio/tipos';

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
      // Vista de impresión (fuera del Shell: sin sidebar). Requiere sesión.
      path: '/imprimir/:id',
      name: 'imprimir',
      component: () => import('./vistas/Imprimir.vue'),
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
          path: 'taller/:id?',
          name: 'taller',
          component: () => import('./vistas/Taller.vue'),
        },
        {
          path: 'usuarios',
          name: 'usuarios',
          component: () => import('./vistas/Usuarios.vue'),
          meta: { soloAdmin: true },
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
  // Rutas solo para admin (superAdmin/dueño): la de usuarios es solo superAdmin.
  if (to.meta.soloAdmin && !ROLES_ADMIN.includes(sesion.usuario?.rol ?? 'trabajador')) {
    return { name: 'cotizaciones' };
  }
  return true;
});

export default router;
