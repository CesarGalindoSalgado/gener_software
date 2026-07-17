import { createRouter, createWebHistory } from 'vue-router';
import { esperarCarga, sesion } from './sesion';
import { ROLES_ADMIN, ROLES_OPERADOR } from './dominio/tipos';

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
          path: 'taller/:id?',
          name: 'taller',
          component: () => import('./vistas/Taller.vue'),
        },
        {
          path: 'panel',
          name: 'panel',
          component: () => import('./vistas/Panel.vue'),
          meta: { soloOperador: true },
        },
        {
          path: 'seguimiento',
          name: 'seguimiento',
          component: () => import('./vistas/Seguimiento.vue'),
        },
        {
          path: 'plantillas',
          name: 'plantillas',
          component: () => import('./vistas/Plantillas.vue'),
          meta: { soloAdmin: true },
        },
        {
          path: 'recordatorios',
          name: 'recordatorios',
          component: () => import('./vistas/Recordatorios.vue'),
          meta: { soloAdmin: true },
        },
        {
          path: 'whatsapp',
          name: 'whatsapp',
          component: () => import('./vistas/WhatsApp.vue'),
          meta: { soloAdmin: true },
        },
        {
          path: 'usuarios',
          name: 'usuarios',
          component: () => import('./vistas/Usuarios.vue'),
          meta: { soloAdmin: true },
        },
        {
          path: 'rutinas',
          name: 'rutinas',
          component: () => import('./vistas/Rutinas.vue'),
          meta: { soloOperador: true },
        },
        {
          path: 'clientes',
          name: 'clientes',
          component: () => import('./vistas/Clientes.vue'),
          meta: { soloOperador: true },
        },
        {
          path: 'sedes',
          name: 'sedes',
          component: () => import('./vistas/Sedes.vue'),
          meta: { soloOperador: true },
        },
        {
          path: 'ejecuciones',
          name: 'ejecuciones',
          component: () => import('./vistas/Ejecuciones.vue'),
          meta: { soloOperador: true },
        },
        {
          path: 'tablero-rutinas',
          name: 'tableroRutinas',
          component: () => import('./vistas/TableroRutinas.vue'),
          meta: { soloOperador: true },
        },
        {
          path: 'oportunidades',
          name: 'oportunidades',
          component: () => import('./vistas/Oportunidades.vue'),
          meta: { soloOperador: true },
        },
        {
          path: 'config-correo',
          name: 'configCorreo',
          component: () => import('./vistas/ConfiguracionCorreo.vue'),
          meta: { soloAdmin: true },
        },
        {
          path: 'config-drive',
          name: 'configDrive',
          component: () => import('./vistas/ConfiguracionDrive.vue'),
          meta: { soloAdmin: true },
        },
        {
          path: 'config-telegram',
          name: 'configTelegram',
          component: () => import('./vistas/ConfiguracionTelegram.vue'),
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
  // Rutas de operador (superAdmin/dueño/secretaria): Rutinas y Sedes.
  if (to.meta.soloOperador && !ROLES_OPERADOR.includes(sesion.usuario?.rol ?? 'trabajador')) {
    return { name: 'cotizaciones' };
  }
  return true;
});

export default router;
