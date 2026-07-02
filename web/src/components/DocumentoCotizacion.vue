<script setup lang="ts">
import { computed } from 'vue';
import type { BorradorCotizacion } from '../dominio/tipos';
import { calcularTotales, formatearMoneda } from '../dominio/totales';
import { importeConLetra } from '../dominio/importeConLetra';

// Plantilla PROVISIONAL del documento de cotización (= lo que será el PDF).
// CSS propio, aislado del sistema de diseño de la app (el brief pide que el PDF
// use su propia plantilla, no el DESIGN-SYSTEM). Se afinará contra el PDF final.
const props = defineProps<{ borrador: BorradorCotizacion }>();

const totales = computed(() => calcularTotales(props.borrador.partidas));
const enLetra = computed(() => importeConLetra(totales.value.total));

const fechaLarga = computed(() => {
  const d = new Date(props.borrador.fecha);
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
});
</script>

<template>
  <div class="doc">
    <!-- Encabezado -->
    <header class="doc-header">
      <div class="marca">
        <div class="rayo">⚡</div>
        <div>
          <div class="marca-nombre">Gener Power &amp; Control</div>
          <div class="marca-sub">Soluciones eléctricas e industriales</div>
        </div>
      </div>
      <div class="doc-meta">
        <div class="doc-titulo">COTIZACIÓN</div>
        <table class="meta-tabla">
          <tbody>
            <tr>
              <td>Folio</td>
              <td>{{ borrador.folio ?? '—' }}</td>
            </tr>
            <tr>
              <td>Revisión</td>
              <td>{{ borrador.rev }}</td>
            </tr>
            <tr>
              <td>Fecha</td>
              <td>{{ fechaLarga }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </header>

    <!-- Cliente -->
    <section class="cliente">
      <div><span class="etq">Cliente:</span> {{ borrador.cliente.nombre }}</div>
      <div v-if="borrador.cliente.atencion"><span class="etq">Atención:</span> {{ borrador.cliente.atencion }}</div>
      <div v-if="borrador.cliente.telefono"><span class="etq">Tel:</span> {{ borrador.cliente.telefono }}</div>
      <div v-if="borrador.cliente.correo"><span class="etq">Correo:</span> {{ borrador.cliente.correo }}</div>
      <div class="asunto"><span class="etq">Asunto:</span> {{ borrador.asunto }}</div>
    </section>

    <!-- Partidas -->
    <table class="partidas">
      <thead>
        <tr>
          <th class="c-num">#</th>
          <th class="c-cant">Cant.</th>
          <th class="c-desc">Concepto</th>
          <th class="c-imp">Importe</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in borrador.partidas" :key="i">
          <td class="c-num">{{ i + 1 }}</td>
          <td class="c-cant">{{ p.cantidad }}</td>
          <td class="c-desc">
            <div class="p-titulo">{{ p.titulo }}</div>
            <div v-if="p.descripcion" class="p-desc">{{ p.descripcion }}</div>
            <ul v-if="p.lineas.length" class="p-lineas">
              <li v-for="(l, j) in p.lineas" :key="j">{{ l }}</li>
            </ul>
          </td>
          <td class="c-imp">{{ formatearMoneda(p.importe * (p.cantidad || 1)) }}</td>
        </tr>
        <tr v-if="borrador.partidas.length === 0" class="vacio">
          <td colspan="4">Sin partidas todavía.</td>
        </tr>
      </tbody>
    </table>

    <!-- Totales -->
    <section class="totales">
      <table>
        <tbody>
          <tr>
            <td>Subtotal</td>
            <td>{{ formatearMoneda(totales.subtotal) }}</td>
          </tr>
          <tr>
            <td>IVA (16%)</td>
            <td>{{ formatearMoneda(totales.iva) }}</td>
          </tr>
          <tr class="gran-total">
            <td>Total</td>
            <td>{{ formatearMoneda(totales.total) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="en-letra">{{ enLetra }}</div>

    <!-- Observaciones -->
    <section class="observaciones">
      <div><span class="etq">Forma de pago:</span> {{ borrador.formaPago }}</div>
      <div><span class="etq">Tiempo de entrega:</span> {{ borrador.tiempoEntrega }}</div>
      <div class="nota">Precios en moneda nacional (M.N.). En caso de encontrar algún desperfecto adicional se notificará antes de proceder.</div>
    </section>

    <!-- Pie oficial -->
    <footer class="pie">
      Paseo de los Fresnos S/N, Col. Bugambilias, 62577, Jiutepec, Morelos, México ·
      generpowercontrol@gmail.com
    </footer>
  </div>
</template>

<style scoped>
/* Plantilla del documento — deliberadamente independiente del design-system. */
.doc {
  background: #fff;
  color: #1a1a1a;
  font-family: 'Segoe UI', Arial, sans-serif;
  font-size: 12px;
  line-height: 1.45;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 32px 36px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.doc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 2px solid #10243f;
  padding-bottom: 14px;
}
.marca {
  display: flex;
  gap: 10px;
  align-items: center;
}
.rayo {
  font-size: 28px;
  color: #d99400;
}
.marca-nombre {
  font-size: 16px;
  font-weight: 700;
  color: #10243f;
}
.marca-sub {
  font-size: 10px;
  color: #647183;
}
.doc-meta {
  text-align: right;
}
.doc-titulo {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #10243f;
  margin-bottom: 6px;
}
.meta-tabla {
  border-collapse: collapse;
  margin-left: auto;
  font-size: 11px;
}
.meta-tabla td {
  padding: 1px 6px;
}
.meta-tabla td:first-child {
  color: #647183;
  text-align: right;
}
.meta-tabla td:last-child {
  font-weight: 600;
}

.cliente {
  margin: 16px 0;
  font-size: 12px;
}
.cliente .asunto {
  margin-top: 6px;
}
.etq {
  color: #647183;
  font-weight: 600;
}

.partidas {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
}
.partidas th {
  background: #10243f;
  color: #fff;
  font-weight: 600;
  text-align: left;
  padding: 7px 8px;
  font-size: 11px;
}
.partidas td {
  border-bottom: 1px solid #e1e6ee;
  padding: 8px;
  vertical-align: top;
}
.c-num {
  width: 28px;
  text-align: center;
}
.c-cant {
  width: 48px;
  text-align: center;
}
.c-imp {
  width: 120px;
  text-align: right;
  white-space: nowrap;
}
.p-titulo {
  font-weight: 600;
}
.p-desc {
  color: #2d3e54;
  margin-top: 2px;
}
.p-lineas {
  margin: 4px 0 0;
  padding-left: 16px;
  color: #2d3e54;
}
.vacio td {
  text-align: center;
  color: #647183;
  padding: 18px;
}

.totales {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}
.totales table {
  border-collapse: collapse;
  min-width: 240px;
}
.totales td {
  padding: 4px 8px;
  text-align: right;
}
.totales td:first-child {
  color: #647183;
}
.gran-total td {
  border-top: 2px solid #10243f;
  font-weight: 700;
  font-size: 13px;
  color: #10243f;
  padding-top: 6px;
}

.en-letra {
  margin-top: 10px;
  font-weight: 600;
  color: #10243f;
  font-size: 11px;
}

.observaciones {
  margin-top: 18px;
  font-size: 11px;
}
.observaciones .nota {
  margin-top: 6px;
  color: #647183;
  font-style: italic;
}

.pie {
  margin-top: 24px;
  padding-top: 10px;
  border-top: 1px solid #e1e6ee;
  text-align: center;
  font-size: 10px;
  color: #647183;
}
</style>
