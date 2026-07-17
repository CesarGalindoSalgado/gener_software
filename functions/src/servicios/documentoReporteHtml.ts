import { PasoEjecucion } from '../dominio/tipos';
import { HOST_WEB } from '../dominio/entorno';

// Render del REPORTE de rutina como página HTML autocontenida. Sirve para:
//  - el enlace que revisa/aprueba el técnico (con edición y botones),
//  - el PDF (el navegador imprime, o el bot lo renderiza): en impresión se
//    ocultan botones y controles de edición (clase .no-print), así el PDF queda
//    idéntico al HTML sin la interfaz.

export interface DatosReporte {
  folio: string | null;
  fecha: Date;
  rutinaNombre: string;
  equipo: string;
  sede: string;
  cliente?: string | null;
  recibe?: string | null;
  tecnico: string;
  pasos: PasoEjecucion[];
  oportunidad?: string | null;
  evidenciaFirmaUrl?: string | null;
  faltanteFirmaRazon?: string | null;
  aprobado?: boolean;
}

export interface OpcionesReporte {
  aprobarUrl?: string; // POST para aprobar + enviar PDF por WhatsApp
  editarUrl?: string; // POST para guardar ediciones de comentarios/lecturas
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fechaHora(d: Date): string {
  const p = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}-${g('month').replace('.', '')}-${g('year')} · ${g('hour')}:${g('minute')}`;
}

const CSS = `
  *{box-sizing:border-box}
  body{margin:0;background:#e9edf3;padding:22px 12px 60px;font-family:'Segoe UI',Arial,sans-serif;color:#17233a;font-size:12px;line-height:1.5}
  .doc{max-width:640px;margin:0 auto;background:#fff;border:1px solid #d7dee8;box-shadow:0 1px 4px rgba(15,29,46,.1);padding:24px 26px}
  .band{background:#10243f;color:#fff;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;padding:5px 10px}
  .box{border:1px solid #d7dee8}
  .eyebrow{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#9a6b00;font-weight:600}
  .thumb{background:#eef2f6;border:1px solid #d7dee8;border-radius:6px;height:130px;display:flex;align-items:center;justify-content:center;color:#8a97a8;font-size:11px}
  .badge{font-size:11px;padding:2px 9px;border-radius:5px;font-weight:600;white-space:nowrap}
  .ok{background:#e0f0ec;color:#1f7a6b}
  .no{background:#f6e0e4;color:#a8324a}
  .pt{font-weight:600;color:#10243f;font-size:12px}
  .pc{color:#3a4a63;font-size:11.5px}
  .hd{display:flex;justify-content:space-between;align-items:flex-start}
  .brand{display:flex;align-items:center;gap:10px}
  .brand .nm{font-size:20px;font-weight:700;letter-spacing:.05em;color:#10243f;line-height:1}
  .brand .sb{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#5b6b82}
  .rule{border-top:1.5px solid #10243f;margin:12px 0 14px}
  .grid-top{display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-bottom:12px}
  .stack{display:flex;flex-direction:column;gap:10px;min-width:0}
  .meta{padding:8px 10px}
  .meta .big{font-weight:600;color:#10243f}
  .meta .mut{color:#5b6b82;font-size:11px;margin-top:4px;line-height:1.7}
  .folio-v{padding:7px 10px;font-size:14px;font-weight:700;color:#9a6b00}
  .fecha-v{padding:7px 10px;font-size:12px;font-weight:600;color:#10243f}
  .chips{padding:8px 10px;margin-bottom:14px;color:#3a4a63;font-size:11px;display:flex;flex-wrap:wrap;gap:14px}
  .chips b{color:#10243f}
  .paso{padding:10px 12px;margin-bottom:9px}
  .paso-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
  .med-row{display:flex;gap:16px;align-items:center;margin-top:6px;flex-wrap:wrap}
  .med-val .big{font-size:20px;font-weight:700;color:#10243f;font-family:Georgia,serif;line-height:1.1}
  .med-val .cap{font-size:10px;color:#5b6b82}
  .fotos{display:flex;gap:10px;margin-top:8px;flex-wrap:wrap}
  .fcol{flex:1;min-width:150px;display:flex;flex-direction:column;gap:4px}
  .fcap{font-size:10px;color:#5b6b82;text-align:center}
  .ph{width:100%;height:170px;object-fit:contain;background:#f4f6f9;border-radius:6px;border:1px solid #d7dee8;display:block}
  .bar-wrap{margin-top:8px}
  .bar-lbl{font-size:10px;color:#5b6b82;display:flex;justify-content:space-between;margin-bottom:3px}
  .bar{position:relative;height:12px;border-radius:6px;background:#eef2f6;border:1px solid #d7dee8}
  .bar .rng{position:absolute;height:100%;background:#cfe6dd;border-radius:6px}
  .bar .val{position:absolute;top:-2px;width:3px;height:14px;background:#10243f;border-radius:2px}
  .coment{margin-top:8px;font-size:11.5px;color:#2d3e54}
  .edit{border-bottom:1px dashed #b9c6d8;outline:none;min-height:16px;padding:1px 2px}
  .edit:focus{border-bottom-color:#9a6b00;background:#fffdf5}
  .edit:empty:before{content:attr(data-ph);color:#aab4c2}
  input.edit-num{font:inherit;font-size:20px;font-weight:700;color:#10243f;font-family:Georgia,serif;width:5.5em;border:none;border-bottom:1px dashed #b9c6d8;background:transparent;outline:none;padding:0}
  input.edit-num:focus{border-bottom-color:#9a6b00;background:#fffdf5}
  .opp{border:1px solid #e7cf9a;background:#faf1dc;border-radius:6px;padding:9px 11px;margin:4px 0 16px}
  .opp-t{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9a6b00;font-weight:700}
  .opp-c{color:#5a4a20;font-size:11px;margin-top:4px}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:10px}
  .sign .col{text-align:center}
  .sign .ln{border-bottom:1px solid #10243f;height:36px}
  .sign .nm{font-size:11px;color:#10243f;font-weight:600;margin-top:3px}
  .sign .cap{font-size:10px;color:#5b6b82;margin-top:2px}
  .foot{border-top:1px solid #d7dee8;margin-top:16px;padding-top:8px;text-align:center;font-size:10px;color:#7a869a}
  .barra-acc{position:sticky;bottom:0;margin:16px auto 0;max-width:640px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
  .btn{border:none;border-radius:7px;padding:11px 20px;font-size:12.5px;font-weight:600;letter-spacing:.02em;cursor:pointer}
  .btn-1{background:#10243f;color:#fff}
  .btn-2{background:#fff;color:#10243f;border:1px solid #c3cddb}
  .btn:disabled{opacity:.5;cursor:default}
  .aviso{font-size:11.5px;color:#5b6b82;text-align:center;margin-top:8px}
  @media print{
    body{background:#fff;padding:0}
    .doc{border:none;box-shadow:none;max-width:none}
    .no-print{display:none !important}
    .edit,input.edit-num{border:none !important;background:transparent !important;padding:0 !important}
    .edit:empty:before{content:'' !important}
  }
`;

const LOGO = `<img src="${HOST_WEB}/logo-gener.png" alt="Gener Power & Control" style="height:56px;width:auto;object-fit:contain"/>`;

// <img> real (grande, sin recortar) envuelta en enlace para abrirla completa.
function foto(url: string | undefined, etiqueta: string): string {
  return url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="Abrir imagen" style="display:block;line-height:0"><img class="ph" src="${esc(url)}"></a>`
    : `<div class="thumb">${esc(etiqueta)}</div>`;
}

function barraRango(paso: PasoEjecucion): string {
  const min = (paso as { rangoMin?: number }).rangoMin;
  const max = (paso as { rangoMax?: number }).rangoMax;
  if (paso.lectura == null || min == null || max == null || max <= min) return '';
  const span = max - min;
  const lo = min - span * 0.5;
  const hi = max + span * 0.5;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return `<div class="bar-wrap">
    <div class="bar-lbl"><span>${lo.toFixed(1)}</span><span>rango ${min}–${max}${paso.unidad ? ' ' + esc(paso.unidad) : ''}</span><span>${hi.toFixed(1)}</span></div>
    <div class="bar"><div class="rng" style="left:${pct(min)}%;width:${pct(max) - pct(min)}%"></div><div class="val" style="left:${pct(paso.lectura)}%"></div></div>
  </div>`;
}

// Comentario: editable (contenteditable) cuando `editable`; si no, texto plano.
function comentario(paso: PasoEjecucion, editable: boolean): string {
  const txt = esc(paso.comentario ?? '');
  if (editable) {
    return `<div class="coment edit" contenteditable="true" data-orden="${paso.orden}" data-campo="comentario" data-ph="Agregar comentario…">${txt}</div>`;
  }
  return paso.comentario ? `<div class="coment">${txt}</div>` : '';
}

function bloquePaso(paso: PasoEjecucion, i: number, editable: boolean): string {
  const titulo = `${i + 1} · ${esc(paso.instruccion)}`;

  if (paso.tipo === 'antes_despues') {
    return `<div class="box paso">
      <div class="pt">${titulo}</div>
      <div class="fotos">
        <div class="fcol">${foto(paso.fotoAntes, 'Antes')}<div class="fcap">Antes</div></div>
        <div class="fcol">${foto(paso.fotoDespues, 'Después')}<div class="fcap">Después</div></div>
      </div>
      ${comentario(paso, editable)}
    </div>`;
  }

  if (paso.tipo === 'medicion' && (paso.lectura != null || editable)) {
    const badge =
      paso.cumple === true
        ? '<span class="badge ok">Cumple</span>'
        : paso.cumple === false
          ? '<span class="badge no">Fuera de rango</span>'
          : '';
    const unidad = paso.unidad ? ` ${esc(paso.unidad)}` : '';
    const valor = editable
      ? `<input class="edit-num" type="text" inputmode="decimal" data-orden="${paso.orden}" data-campo="lectura" value="${esc(paso.lectura ?? '')}">${unidad}`
      : `${esc(paso.lectura)}${unidad}`;
    const fotoMed = paso.fotos?.length ? `<div class="fcol" style="max-width:200px">${foto(paso.fotos[0], 'Foto')}</div>` : '';
    return `<div class="box paso">
      <div class="paso-head"><div class="pt">${titulo}</div>${badge}</div>
      <div class="med-row">
        <div class="med-val"><div class="big">${valor}</div><div class="cap">lectura registrada</div></div>
        ${fotoMed}
      </div>
      ${barraRango(paso)}
      ${comentario(paso, editable)}
    </div>`;
  }

  // foto_comentario u otro: título, foto(s) grande(s) y comentario.
  const fotos = paso.fotos?.length
    ? `<div class="fotos">${paso.fotos.map((u) => `<div class="fcol">${foto(u, 'Foto')}</div>`).join('')}</div>`
    : '';
  return `<div class="box paso">
    <div class="pt">${titulo}</div>
    ${fotos}
    ${comentario(paso, editable)}
  </div>`;
}

export function paginaReporteHtml(d: DatosReporte, opciones: OpcionesReporte = {}): string {
  const editable = !!opciones.editarUrl && !d.aprobado;
  const pasos = d.pasos.map((p, i) => bloquePaso(p, i, editable)).join('');
  const subSede = [d.cliente, d.recibe ? `Recibe: ${d.recibe}` : '']
    .filter(Boolean)
    .map((t) => `<div>${esc(t)}</div>`)
    .join('');

  const oportunidad = d.oportunidad
    ? `<div class="opp"><div class="opp-t">Oportunidad de negocio</div><div class="opp-c">${esc(d.oportunidad)}</div></div>`
    : '';

  // La foto de la hoja firmada YA NO va en el reporte: se consulta aparte desde
  // el portal (icono "evidencia de firma"). El reporte conserva las firmas.

  // Barra de acciones (no sale en el PDF). Antes de aprobar: Guardar + Aprobar.
  // Después: solo Descargar. Descargar (imprimir) siempre disponible.
  const acciones = `
    <div class="barra-acc no-print" id="barraAcc">
      ${editable ? '<button class="btn btn-2" id="btnGuardar">💾 Guardar cambios</button>' : ''}
      ${opciones.aprobarUrl && !d.aprobado ? '<button class="btn btn-1" id="btnAprobar">✓ Aprobar y enviar por WhatsApp</button>' : ''}
      <button class="btn btn-2" id="btnDescargar">⬇️ Descargar PDF</button>
    </div>
    <div class="aviso no-print" id="avisoAcc">${d.aprobado ? '✅ Reporte aprobado.' : ''}</div>`;

  const script = `<script>
    (function(){
      var EDITAR=${JSON.stringify(opciones.editarUrl ?? null)}, APROBAR=${JSON.stringify(opciones.aprobarUrl ?? null)};
      var aviso=document.getElementById('avisoAcc');
      var g=document.getElementById('btnGuardar'), a=document.getElementById('btnAprobar'), d=document.getElementById('btnDescargar');
      function recolectar(){
        var out=[];
        document.querySelectorAll('[data-orden]').forEach(function(el){
          out.push({orden:+el.getAttribute('data-orden'), campo:el.getAttribute('data-campo'), valor:(el.tagName==='INPUT'?el.value:el.textContent).trim()});
        });
        return out;
      }
      if(d) d.addEventListener('click', function(){ window.print(); });
      if(g&&EDITAR) g.addEventListener('click', function(){
        g.disabled=true; aviso.style.color='#5b6b82'; aviso.textContent='Guardando…';
        fetch(EDITAR,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cambios:recolectar()})})
          .then(function(r){ if(!r.ok) throw 0; return r.json(); })
          .then(function(){ g.disabled=false; aviso.style.color='#1f7a6b'; aviso.textContent='✅ Cambios guardados.'; })
          .catch(function(){ g.disabled=false; aviso.style.color='#a8324a'; aviso.textContent='No se pudo guardar. Intenta de nuevo.'; });
      });
      if(a&&APROBAR) a.addEventListener('click', function(){
        if(!confirm('¿Aprobar el reporte? Ya no podrás editarlo y te lo enviaremos en PDF por WhatsApp.')) return;
        a.disabled=true; aviso.style.color='#5b6b82'; aviso.textContent='Aprobando y enviando…';
        // Guarda primero cualquier edición pendiente, luego aprueba.
        var guardar = EDITAR ? fetch(EDITAR,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cambios:recolectar()})}) : Promise.resolve();
        guardar.then(function(){ return fetch(APROBAR,{method:'POST'}); })
          .then(function(r){ if(!r.ok) throw 0; return r.json(); })
          .then(function(){
            document.querySelectorAll('[contenteditable]').forEach(function(el){ el.setAttribute('contenteditable','false'); el.classList.remove('edit'); });
            document.querySelectorAll('input.edit-num').forEach(function(el){ el.readOnly=true; el.style.borderBottom='none'; });
            if(g) g.remove(); a.remove();
            aviso.style.color='#1f7a6b'; aviso.innerHTML='✅ <b>Reporte aprobado.</b> Te lo enviamos en PDF por WhatsApp.';
          })
          .catch(function(){ a.disabled=false; aviso.style.color='#a8324a'; aviso.textContent='No se pudo aprobar. Intenta de nuevo.'; });
      });
    })();
  </script>`;

  return `<!doctype html><html lang="es"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reporte ${esc(d.folio ?? 'de rutina')}</title><style>${CSS}</style></head><body>
    <div class="doc">
      <div class="hd">
        <div class="brand">${LOGO}</div>
        <div style="text-align:right"><div class="eyebrow">Reporte de servicio</div><div style="font-size:11px;color:#5b6b82;margin-top:2px">Mantenimiento preventivo</div></div>
      </div>
      <div class="rule"></div>

      <div class="grid-top">
        <div class="box" style="min-width:0"><div class="band">Sede</div>
          <div class="meta"><div class="big">${esc(d.sede)}</div>${subSede ? `<div class="mut">${subSede}</div>` : ''}</div>
        </div>
        <div class="stack">
          <div class="box"><div class="band">Folio</div><div class="folio-v">${esc(d.folio ?? 'pendiente')}</div></div>
          <div class="box"><div class="band">Fecha</div><div class="fecha-v">${esc(fechaHora(d.fecha))}</div></div>
        </div>
      </div>

      <div class="box chips">
        <span><b>Técnico:</b> ${esc(d.tecnico)}</span>
        <span><b>Rutina:</b> ${esc(d.rutinaNombre)}</span>
        <span><b>No. inventario:</b> ${esc(d.equipo)}</span>
      </div>

      <div class="eyebrow" style="margin-bottom:6px">Pasos y evidencia</div>
      ${pasos}

      ${oportunidad}

      <div class="sign">
        <div class="col"><div class="ln"></div>${d.recibe ? `<div class="nm">${esc(d.recibe)}</div>` : ''}<div class="cap">Nombre y firma de quien recibe</div></div>
        <div class="col"><div class="ln"></div><div class="nm">${esc(d.tecnico)}</div><div class="cap">Técnico responsable (G-ener)</div></div>
      </div>

      <div class="foot">Paseo de los Fresnos S/N, Col. Bugambilias, 62577, Jiutepec, Morelos, México · generpowercontrol@gmail.com</div>
    </div>
    ${acciones}
    ${script}
  </body></html>`;
}
