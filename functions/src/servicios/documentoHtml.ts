import { Partida } from '../dominio/tipos';
import { calcularTotales } from '../dominio/totales';
import { importeConLetra } from '../dominio/importeConLetra';
import { HOST_WEB } from '../dominio/entorno';

// Render del documento de cotización como página HTML autocontenida, para el
// enlace que ve el cliente. Misma plantilla visual que el componente del portal
// (DocumentoCotizacion.vue), pero en el servidor (agnóstica al framework).

interface DatosDocumento {
  folio?: string | null;
  rev: string;
  fecha: Date;
  cliente: { nombre?: string; atencion?: string; telefono?: string; correo?: string };
  asunto: string;
  partidas: Partida[];
  formaPago?: string;
  tiempoEntrega?: string;
  notas?: string;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaLarga(d: Date): string {
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

const CSS = `
  *{box-sizing:border-box}
  body{margin:0;background:#e9edf3;padding:20px 12px 48px;font-family:'Segoe UI',Arial,sans-serif}
  .doc{background:#fff;color:#1a1a1a;font-size:12px;line-height:1.45;width:100%;max-width:800px;margin:0 auto;padding:32px 36px;box-shadow:0 2px 12px rgba(0,0,0,.08);border-radius:4px}
  .doc-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #10243f;padding-bottom:14px}
  .marca{display:flex;align-items:center}
  .marca-logo{height:60px;width:auto;object-fit:contain}
  .doc-meta{text-align:right}
  .doc-titulo{font-size:18px;font-weight:700;letter-spacing:2px;color:#10243f;margin-bottom:6px}
  .meta-tabla{border-collapse:collapse;margin-left:auto;font-size:11px}
  .meta-tabla td{padding:1px 6px}
  .meta-tabla td:first-child{color:#647183;text-align:right}
  .meta-tabla td:last-child{font-weight:600}
  .cliente{margin:16px 0;font-size:12px}
  .cliente .asunto{margin-top:6px}
  .etq{color:#647183;font-weight:600}
  .partidas{width:100%;border-collapse:collapse;margin-top:8px}
  .partidas th{background:#10243f;color:#fff;font-weight:600;text-align:left;padding:7px 8px;font-size:11px}
  .partidas td{border-bottom:1px solid #e1e6ee;padding:8px;vertical-align:top}
  .c-num{width:28px;text-align:center}
  .c-cant{width:48px;text-align:center}
  .c-imp{width:120px;text-align:right;white-space:nowrap}
  .p-titulo{font-weight:600}
  .p-desc{color:#2d3e54;margin-top:2px}
  .p-lineas{margin:4px 0 0;padding-left:16px;color:#2d3e54}
  .totales{display:flex;justify-content:flex-end;margin-top:4px}
  .totales table{border-collapse:collapse;min-width:240px}
  .totales td{padding:4px 8px;text-align:right}
  .totales td:first-child{color:#647183}
  .gran-total td{border-top:2px solid #10243f;font-weight:700;font-size:13px;color:#10243f;padding-top:6px}
  .en-letra{margin-top:10px;font-weight:600;color:#10243f;font-size:11px}
  .observaciones{margin-top:18px;font-size:11px}
  .observaciones .nota{margin-top:6px;color:#647183;font-style:italic}
  .firmas{display:flex;justify-content:space-around;gap:40px;margin-top:40px}
  .firma{flex:1;max-width:240px;text-align:center}
  .firma-linea{border-top:1px solid #10243f;margin-bottom:6px;height:28px}
  .firma-rol{font-size:11px;color:#647183}
  .firma-nombre{font-size:12px;font-weight:600;color:#10243f}
  .pie{margin-top:30px;padding-top:10px;border-top:1px solid #e1e6ee;text-align:center;font-size:10px;color:#647183}
  @media print{body{background:#fff;padding:0}.doc{box-shadow:none;max-width:none}}
`;

function filaPartida(p: Partida, i: number): string {
  const lineas =
    p.lineas && p.lineas.length
      ? `<ul class="p-lineas">${p.lineas.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
      : '';
  const importeLinea = p.importe * (p.cantidad || 1);
  return `<tr>
    <td class="c-num">${i + 1}</td>
    <td class="c-cant">${esc(p.cantidad)}</td>
    <td class="c-desc"><div class="p-titulo">${esc(p.titulo)}</div>${lineas}</td>
    <td class="c-imp">${money(p.importe)}</td>
    <td class="c-imp">${money(importeLinea)}</td>
  </tr>`;
}

export function paginaCotizacionHtml(d: DatosDocumento): string {
  const t = calcularTotales(d.partidas);
  const cli = d.cliente ?? {};
  const filas = d.partidas.map(filaPartida).join('');
  const bloqueCliente = [
    `<div><span class="etq">Cliente:</span> ${esc(cli.nombre)}</div>`,
    cli.atencion ? `<div><span class="etq">Atención:</span> ${esc(cli.atencion)}</div>` : '',
    cli.telefono ? `<div><span class="etq">Tel:</span> ${esc(cli.telefono)}</div>` : '',
    cli.correo ? `<div><span class="etq">Correo:</span> ${esc(cli.correo)}</div>` : '',
    `<div class="asunto"><span class="etq">Asunto:</span> ${esc(d.asunto)}</div>`,
  ].join('');

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cotización ${esc(d.folio ?? '')} · Gener Power & Control</title>
<style>${CSS}</style>
</head><body>
<div class="doc">
  <header class="doc-header">
    <div class="marca">
      <img src="${HOST_WEB}/logo-gener.png" alt="Gener Power & Control" class="marca-logo" />
    </div>
    <div class="doc-meta">
      <div class="doc-titulo">COTIZACIÓN</div>
      <table class="meta-tabla"><tbody>
        <tr><td>Folio</td><td>${esc(d.folio ?? '—')}</td></tr>
        <tr><td>Revisión</td><td>${esc(d.rev)}</td></tr>
        <tr><td>Fecha</td><td>${esc(fechaLarga(d.fecha))}</td></tr>
      </tbody></table>
    </div>
  </header>

  <section class="cliente">${bloqueCliente}</section>

  <table class="partidas">
    <thead><tr>
      <th class="c-num">Partida</th><th class="c-cant">Cant.</th>
      <th class="c-desc">Conceptos</th><th class="c-imp">P. Unit</th><th class="c-imp">Importe</th>
    </tr></thead>
    <tbody>${filas || '<tr><td colspan="5" style="text-align:center;color:#647183;padding:18px">Sin partidas.</td></tr>'}</tbody>
  </table>

  <section class="totales"><table><tbody>
    <tr><td>Subtotal</td><td>${money(t.subtotal)}</td></tr>
    <tr><td>IVA (16%)</td><td>${money(t.iva)}</td></tr>
    <tr class="gran-total"><td>Total</td><td>${money(t.total)}</td></tr>
  </tbody></table></section>

  <div class="en-letra">${esc(importeConLetra(t.total))}</div>

  <section class="observaciones">
    <div><span class="etq">Forma de pago:</span> ${esc(d.formaPago ?? '')}</div>
    <div><span class="etq">Tiempo de entrega:</span> ${esc(d.tiempoEntrega ?? '')} según disponibilidad de refacciones</div>
    ${d.notas ? `<div><span class="etq">Notas:</span> ${esc(d.notas)}</div>` : ''}
    <div class="nota">Precios en moneda nacional (M.N.). En caso de encontrar algún desperfecto adicional se notificará antes de proceder.</div>
  </section>

  <section class="firmas">
    <div class="firma"><div class="firma-linea"></div><div class="firma-rol">Atentamente</div><div class="firma-nombre">Gener Power &amp; Control</div></div>
    <div class="firma"><div class="firma-linea"></div><div class="firma-rol">Acepta el cliente</div><div class="firma-nombre">${esc(cli.atencion || cli.nombre)}</div></div>
  </section>

  <footer class="pie">Paseo de los Fresnos S/N, Col. Bugambilias, 62577, Jiutepec, Morelos, México · generpowercontrol@gmail.com</footer>
</div>
</body></html>`;
}

export function paginaError(mensaje: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Cotización</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;background:#e9edf3;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.caja{background:#fff;padding:32px 40px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);text-align:center;max-width:360px}
.caja h1{color:#10243f;font-size:18px}.caja p{color:#647183;font-size:14px}</style></head>
<body><div class="caja"><h1>Gener Power &amp; Control</h1><p>${esc(mensaje)}</p></div></body></html>`;
}
