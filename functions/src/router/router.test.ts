import { describe, expect, it } from 'vitest';
import { MensajeEntrante } from '../canal/tipos';
import { Usuario } from '../dominio/tipos';
import { procesarMensaje } from './router';

const USUARIOS: Record<string, Usuario> = {
  '5217771112233': { nombre: 'Gabriel', rol: 'dueno', activo: true },
  '5217774445566': { nombre: 'Paty', rol: 'secretaria', activo: true },
  '5217778889900': { nombre: 'Ex empleado', rol: 'trabajador', activo: false },
};

const ctx = {
  buscarUsuario: async (telefono: string) => USUARIOS[telefono] ?? null,
};

const mensaje = (telefono: string): MensajeEntrante => ({
  canal: 'whatsapp',
  telefono,
  texto: 'hola',
  fecha: new Date(),
});

describe('router — lista blanca y menú por rol', () => {
  it('el dueño recibe su menú (consulta + recordatorio, con salida a la web)', async () => {
    const r = await procesarMensaje(ctx, mensaje('5217771112233'));
    expect(r?.texto).toContain('Gabriel');
    expect(r?.texto).toContain('histórico');
    expect(r?.texto).toMatch(/recordatorio/i);
    expect(r?.texto).toContain('Porttea-Gener');
  });

  it('la secretaria recibe menú de consulta sin recordatorios', async () => {
    const r = await procesarMensaje(ctx, mensaje('5217774445566'));
    expect(r?.texto).toContain('borrador');
    expect(r?.texto).not.toMatch(/recordatorio/i);
  });

  it('un número desconocido se ignora (sin respuesta)', async () => {
    const r = await procesarMensaje(ctx, mensaje('5210000000000'));
    expect(r).toBeNull();
  });

  it('un usuario inactivo se ignora aunque exista', async () => {
    const r = await procesarMensaje(ctx, mensaje('5217778889900'));
    expect(r).toBeNull();
  });

  it('sin teléfono (telegram aún no mapeado) se ignora', async () => {
    const r = await procesarMensaje(ctx, { ...mensaje(''), canal: 'telegram' });
    expect(r).toBeNull();
  });
});
