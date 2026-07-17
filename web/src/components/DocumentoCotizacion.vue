<script setup lang="ts">
import { computed } from 'vue';
import type { BorradorCotizacion } from '../dominio/tipos';
import { calcularTotales, formatearMoneda } from '../dominio/totales';
import { importeConLetra } from '../dominio/importeConLetra';

// Plantilla del documento de cotización (= lo que será el PDF). Con `editable`,
// los campos se pueden editar en el mismo documento (clic en el texto) y al salir
// del campo se emite `editar` para que el taller lo guarde en Firestore.
const props = defineProps<{ borrador: BorradorCotizacion; editable?: boolean }>();
const emit = defineEmits<{
  editar: [p: { campo: string; valor: string; partidaIndex?: number; lineaIndex?: number }];
}>();

const totales = computed(() => calcularTotales(props.borrador.partidas));
const enLetra = computed(() => importeConLetra(totales.value.total));

const fechaLarga = computed(() => {
  const d = new Date(props.borrador.fecha);
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
});

function onEdit(e: FocusEvent, campo: string, partidaIndex?: number, lineaIndex?: number) {
  const valor = (e.target as HTMLElement).innerText.replace(/\n+/g, ' ').trim();
  emit('editar', { campo, valor, partidaIndex, lineaIndex });
}
</script>

<template>
  <div class="doc">
    <!-- Encabezado -->
    <header class="doc-header">
      <div class="marca">
        <img src="/logo-gener.png" alt="Gener Power &amp; Control" class="marca-logo" />
      </div>
      <div class="doc-meta">
        <div class="doc-titulo">COTIZACIÓN</div>
        <table class="meta-tabla">
          <tbody>
            <tr><td>Folio</td><td>{{ borrador.folio ?? '—' }}</td></tr>
            <tr><td>Revisión</td><td>{{ borrador.rev }}</td></tr>
            <tr><td>Fecha</td><td>{{ fechaLarga }}</td></tr>
          </tbody>
        </table>
      </div>
    </header>

    <!-- Cliente -->
    <section class="cliente">
      <div><span class="etq">Cliente:</span>
        <span class="v" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'clienteNombre')" data-ph="nombre del cliente">{{ borrador.cliente.nombre }}</span>
      </div>
      <!-- Atención / Tel / Correo son opcionales: aparecen SOLO si tienen valor
           (lo pone Portteo cuando el usuario lo indica). Si están vacíos, no se
           muestran (ni en el documento ni en el PDF) en vez de salir con "—". -->
      <div v-if="borrador.cliente.atencion"><span class="etq">Atención:</span>
        <span class="v" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'atencion')">{{ borrador.cliente.atencion }}</span>
      </div>
      <div v-if="borrador.cliente.telefono"><span class="etq">Tel:</span>
        <span class="v" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'telefono')">{{ borrador.cliente.telefono }}</span>
      </div>
      <div v-if="borrador.cliente.correo"><span class="etq">Correo:</span>
        <span class="v" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'correo')">{{ borrador.cliente.correo }}</span>
      </div>
      <div class="asunto"><span class="etq">Asunto:</span>
        <span class="v" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'titulo')" data-ph="asunto de la cotización">{{ borrador.asunto }}</span>
      </div>
    </section>

    <!-- Partidas -->
    <table class="partidas">
      <thead>
        <tr>
          <th class="c-num">Partida</th>
          <th class="c-cant">Cant.</th>
          <th class="c-desc">Conceptos</th>
          <th class="c-imp">P. Unit</th>
          <th class="c-imp">Importe</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in borrador.partidas" :key="i">
          <td class="c-num">{{ i + 1 }}</td>
          <td class="c-cant">
            <span class="num" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'partida.cantidad', i)">{{ p.cantidad }}</span>
          </td>
          <td class="c-desc">
            <div class="p-titulo" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'partida.titulo', i)" data-ph="título del concepto">{{ p.titulo }}</div>
            <ul v-if="p.lineas.length" class="p-lineas">
              <li v-for="(l, j) in p.lineas" :key="j" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'partida.linea', i, j)">{{ l }}</li>
            </ul>
          </td>
          <td class="c-imp">
            <span class="num" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'partida.importe', i)">{{ formatearMoneda(p.importe) }}</span>
          </td>
          <td class="c-imp">{{ formatearMoneda(p.importe * (p.cantidad || 1)) }}</td>
        </tr>
        <tr v-if="borrador.partidas.length === 0" class="vacio">
          <td colspan="5">Sin partidas todavía.</td>
        </tr>
      </tbody>
    </table>

    <!-- Totales -->
    <section class="totales">
      <table>
        <tbody>
          <tr><td>Subtotal</td><td>{{ formatearMoneda(totales.subtotal) }}</td></tr>
          <tr><td>IVA (16%)</td><td>{{ formatearMoneda(totales.iva) }}</td></tr>
          <tr class="gran-total"><td>Total</td><td>{{ formatearMoneda(totales.total) }}</td></tr>
        </tbody>
      </table>
    </section>

    <div class="en-letra">{{ enLetra }}</div>

    <!-- Observaciones -->
    <section class="observaciones">
      <div><span class="etq">Forma de pago:</span>
        <span class="v" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'formaPago')" data-ph="ej. 70% anticipo / 30% entrega">{{ borrador.formaPago }}</span>
      </div>
      <div><span class="etq">Tiempo de entrega:</span>
        <span class="v v-entrega" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'tiempoEntrega')" data-ph="…">{{ borrador.tiempoEntrega }}</span>
        <!-- Sufijo FIJO: siempre acompaña al tiempo de entrega (no se edita ni se guarda). -->
        <span class="suf-entrega">según disponibilidad de refacciones</span>
      </div>
      <div v-if="editable || borrador.notas"><span class="etq">Notas:</span>
        <span class="v" :class="{ editable }" :contenteditable="editable" @blur="onEdit($event, 'notas')" data-ph="—">{{ borrador.notas }}</span>
      </div>
      <div class="nota">Precios en moneda nacional (M.N.). En caso de encontrar algún desperfecto adicional se notificará antes de proceder.</div>
    </section>

    <!-- Firma -->
    <section class="firmas">
      <div class="firma">
        <div class="firma-linea"></div>
        <div class="firma-rol">Atentamente</div>
        <div class="firma-nombre">Gener Power &amp; Control</div>
      </div>
      <div class="firma">
        <div class="firma-linea"></div>
        <div class="firma-rol">Acepta el cliente</div>
        <div class="firma-nombre">{{ borrador.cliente.atencion || borrador.cliente.nombre }}</div>
      </div>
    </section>

    <footer class="pie">
      Paseo de los Fresnos S/N, Col. Bugambilias, 62577, Jiutepec, Morelos, México ·
      generpowercontrol@gmail.com
    </footer>
  </div>
</template>

<style scoped>
.doc {
  background: #fff;
  color: #1a1a1a;
  font-family: 'Segoe UI', Arial, sans-serif;
  font-size: 12px;
  line-height: 1.45;
  width: 800px;
  margin: 0;
  padding: 32px 36px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

/* Afordancia de edición: subrayado punteado al pasar/enfocar; placeholder si vacío. */
.editable { outline: none; border-radius: 3px; transition: background 0.12s; cursor: text; }
.editable:hover { background: #f2f6ff; box-shadow: inset 0 0 0 1px #d7e0f0; }
.editable:focus { background: #fffdf5; box-shadow: inset 0 0 0 1px #d99400; }
.editable:empty:before { content: attr(data-ph); color: #aab4c2; }

.doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #10243f; padding-bottom: 14px; }
.marca { display: flex; align-items: center; }
.marca-logo { height: 60px; width: auto; object-fit: contain; }
.doc-meta { text-align: right; }
.doc-titulo { font-size: 18px; font-weight: 700; letter-spacing: 2px; color: #10243f; margin-bottom: 6px; }
.meta-tabla { border-collapse: collapse; margin-left: auto; font-size: 11px; }
.meta-tabla td { padding: 1px 6px; }
.meta-tabla td:first-child { color: #647183; text-align: right; }
.meta-tabla td:last-child { font-weight: 600; }

.cliente { margin: 16px 0; font-size: 12px; }
.cliente > div { margin-top: 2px; }
.cliente .asunto { margin-top: 6px; }
.etq { color: #647183; font-weight: 600; }
.v { display: inline-block; min-width: 40px; }

.partidas { width: 100%; border-collapse: collapse; margin-top: 8px; }
.partidas th { background: #10243f; color: #fff; font-weight: 600; text-align: left; padding: 7px 8px; font-size: 11px; }
.partidas td { border-bottom: 1px solid #e1e6ee; padding: 8px; vertical-align: top; }
.c-num { width: 28px; text-align: center; }
.c-cant { width: 48px; text-align: center; }
.c-imp { width: 120px; text-align: right; white-space: nowrap; }
.c-cant .num, .c-imp .num { display: inline-block; min-width: 24px; }
.p-titulo { font-weight: 600; }
.p-desc { color: #2d3e54; margin-top: 2px; }
.p-lineas { margin: 4px 0 0; padding-left: 16px; color: #2d3e54; }
.vacio td { text-align: center; color: #647183; padding: 18px; }

.totales { display: flex; justify-content: flex-end; margin-top: 4px; }
.totales table { border-collapse: collapse; min-width: 240px; }
.totales td { padding: 4px 8px; text-align: right; }
.totales td:first-child { color: #647183; }
.gran-total td { border-top: 2px solid #10243f; font-weight: 700; font-size: 13px; color: #10243f; padding-top: 6px; }

.en-letra { margin-top: 10px; font-weight: 600; color: #10243f; font-size: 11px; }

.observaciones { margin-top: 18px; font-size: 11px; }
.observaciones > div { margin-top: 2px; }
.observaciones .nota { margin-top: 6px; color: #647183; font-style: italic; }
/* El tiempo de entrega no reserva ancho: si va vacío, el sufijo queda pegado. */
.v-entrega { min-width: 0; }
.suf-entrega { color: #2d3e54; }
.suf-entrega::before { content: ' '; }

.firmas { display: flex; justify-content: space-around; gap: 40px; margin-top: 40px; }
.firma { flex: 1; max-width: 240px; text-align: center; }
.firma-linea { border-top: 1px solid #10243f; margin-bottom: 6px; }
.firma-rol { font-size: 11px; color: #647183; }
.firma-nombre { font-size: 12px; font-weight: 600; color: #10243f; }

.pie { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e1e6ee; text-align: center; font-size: 10px; color: #647183; }
</style>
