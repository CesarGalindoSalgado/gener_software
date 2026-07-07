import { reactive } from 'vue';

// Pop-up de confirmación global (reemplaza a window.confirm). Uso:
//   import { confirmar } from '../components/confirmar';
//   if (!(await confirmar({ mensaje: '¿Seguro?' }))) return;

export interface OpcionesConfirm {
  titulo?: string;
  mensaje: string;
  confirmar?: string;
  cancelar?: string;
  peligro?: boolean; // estilo rojo para acciones destructivas
}

interface EstadoConfirm extends Required<Omit<OpcionesConfirm, 'mensaje'>> {
  abierto: boolean;
  mensaje: string;
  resolver: ((v: boolean) => void) | null;
}

export const estadoConfirm = reactive<EstadoConfirm>({
  abierto: false,
  titulo: '¿Confirmar?',
  mensaje: '',
  confirmar: 'Confirmar',
  cancelar: 'Cancelar',
  peligro: false,
  resolver: null,
});

export function confirmar(opciones: OpcionesConfirm): Promise<boolean> {
  return new Promise((resolve) => {
    estadoConfirm.titulo = opciones.titulo ?? '¿Confirmar?';
    estadoConfirm.mensaje = opciones.mensaje;
    estadoConfirm.confirmar = opciones.confirmar ?? 'Confirmar';
    estadoConfirm.cancelar = opciones.cancelar ?? 'Cancelar';
    estadoConfirm.peligro = opciones.peligro ?? false;
    estadoConfirm.abierto = true;
    estadoConfirm.resolver = resolve;
  });
}

export function responderConfirm(valor: boolean) {
  estadoConfirm.abierto = false;
  estadoConfirm.resolver?.(valor);
  estadoConfirm.resolver = null;
}
