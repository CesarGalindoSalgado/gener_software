// Espejo de docs/muestras/plantillas-gener.json, embebido para poder cargarlo
// desde una Cloud Function (el deploy solo incluye functions/). Mantener en
// sincronía con el JSON de docs si cambian los conceptos.

export interface PlantillaSeed {
  nombre: string;
  activa: boolean;
  descripcion: string;
  precioSugerido: number | null;
  lineas: string[];
}

export const PLANTILLAS_SEED: PlantillaSeed[] = [
  {
    nombre: 'Suministro de radiador nuevo',
    activa: true,
    descripcion: 'Incluye maquinaria, herramienta, mano de obra y lo necesario para las siguientes actividades.',
    precioSugerido: null,
    lineas: [
      'Traslado a lugar de servicio con herramientas y equipos',
      'Suministro de radiador de acuerdo a especificaciones del equipo',
      'Puesta en fuera de servicio de grupo electrógeno para servicio',
      'Drenado de anticongelante de sistema de enfriamiento de motor',
      'Desmontaje mecánico de radiador de motor',
      'Montaje de radiador nuevo',
      'Montaje y conexión de mangueras de sistema de enfriamiento',
      'Suministro de anticongelante drenado a sistema de enfriamiento',
      'Prueba de funcionamiento de grupo electrógeno sin carga',
      'Prueba de funcionamiento grupo electrógeno con carga',
    ],
  },
  {
    nombre: 'Mantenimiento preventivo',
    activa: true,
    descripcion: 'Incluye maquinaria, herramienta, mano de obra y lo necesario para las siguientes actividades.',
    precioSugerido: null,
    lineas: [
      'Traslado al lugar del servicio',
      'Suministro de aceite para motor a Diesel',
      'Suministro de anticongelante trabajo pesado',
      'Suministro de líquido electrolítico para batería',
      'Suministro de desengrasante',
      'Suministro de material de limpieza',
      'Suministro de filtros de aceite según modelo de filtro',
      'Suministro de filtros de combustible según modelo de filtro',
      'Suministro de filtros de aire según modelo de filtro',
      'Suministro de líquido electrolítico en depósito de batería',
      'Retirar y contener aceite usado de generador en contenedor',
      'Cambio de filtro de aceite',
      'Retirar y contener líquido anticongelante usado de generador',
      'Cambio de filtro de anticongelante',
      'Montaje y conexión de mangueras de sistema de enfriamiento',
      'Cambio de filtro de combustible y purga de sistema',
      'Carga de aceite a depósito de motor de combustión',
      'Carga de anticongelante a depósito de motor de combustión',
      'Cambio de batería y limpieza de terminales',
      'Limpieza general a motor con desengrasante',
      'Limpieza general a generador eléctrico',
      'Revisión de instalación eléctrica de control de motor de combustión',
      'Revisión de condiciones de tapón de radiador',
      'Pruebas de aislamiento con Megger a devanados de generador',
      'Reapriete de tornillería de conexiones de potencia a generador',
      'Reapriete de tornillería de conexiones de potencia a transferencia',
      'Reapriete de tornillería de conexiones de control a generador',
      'Pruebas de funcionamiento a cargador de baterías',
      'Pruebas de funcionamiento a generador sin carga',
      'Pruebas de funcionamiento a generador con carga',
    ],
  },
  {
    nombre: 'Reparación de radiador',
    activa: true,
    descripcion: 'Incluye maquinaria, herramienta, mano de obra y lo necesario para las siguientes actividades.',
    precioSugerido: null,
    lineas: [
      'Traslado a lugar de servicio con herramientas y equipos',
      'Puesta en fuera de servicio de grupo electrógeno para servicio',
      'Drenado de anticongelante de sistema de enfriamiento de motor',
      'Desmontaje mecánico de radiador de motor',
      'Traslado a taller de servicio para reparación',
      'Traslado a sitio para montaje de radiador',
      'Montaje y conexión de mangueras de sistema de enfriamiento',
      'Suministro de anticongelante drenado a sistema de enfriamiento',
      'Prueba de funcionamiento de grupo electrógeno sin carga',
      'Prueba de funcionamiento grupo electrógeno con carga',
    ],
  },
];

// Carga idempotente por nombre.
export async function cargarPlantillasSeed(
  db: FirebaseFirestore.Firestore
): Promise<{ creadas: number; actualizadas: number }> {
  let creadas = 0;
  let actualizadas = 0;
  for (const p of PLANTILLAS_SEED) {
    const existente = await db.collection('plantillas').where('nombre', '==', p.nombre).limit(1).get();
    if (existente.empty) {
      await db.collection('plantillas').add(p);
      creadas++;
    } else {
      await existente.docs[0].ref.set(p, { merge: true });
      actualizadas++;
    }
  }
  return { creadas, actualizadas };
}
