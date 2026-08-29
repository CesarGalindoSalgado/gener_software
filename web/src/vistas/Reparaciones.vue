<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Hammer, Plus, LoaderCircle, PackageOpen, X, Stethoscope, ArrowRight, FileText, AlertTriangle } from 'lucide-vue-next';
import {
  suscribirOrdenes,
  crearOrdenReparacion,
  guardarDiagnostico,
  cambiarEstatus,
  crearCotizacionDesdeOrden,
  entregarOrden,
  subirImagenes,
  ETIQUETA_ESTATUS,
  COLOR_ESTATUS,
  SIGUIENTES,
  type OrdenReparacionDoc,
  type EstatusReparacion,
} from '../servicios/reparaciones';
import { suscribirClientes, type ClienteDoc } from '../servicios/rutinas';

const router = useRouter();

const ordenes = ref<OrdenReparacionDoc[]>([]);
const cargando = ref(true);
const off1 = suscribirOrdenes((l) => {
  ordenes.value = l;
  cargando.value = false;
});
const clientes = ref<ClienteDoc[]>([]);
const off2 = suscribirClientes((l) => (clientes.value = l));
onUnmounted(() => {
  off1();
  off2();
});

const error = ref('');
const ok = ref('');

// --- Formulario de recepción ---
const f = ref({
  cliente: '',
  descripcion: '',
  marca: '',
  modelo: '',
  numeroSerie: '',
  accesorios: '',
  falla: '',
});
const guardando = ref(false);
const fotosFiles = ref<File[]>([]);
const inputFotos = ref<HTMLInputElement | null>(null);
function onFotos(e: Event) {
  const t = e.target as HTMLInputElement;
  fotosFiles.value = t.files ? Array.from(t.files) : [];
}

function limpiar() {
  f.value = { cliente: '', descripcion: '', marca: '', modelo: '', numeroSerie: '', accesorios: '', falla: '' };
  fotosFiles.value = [];
  if (inputFotos.value) inputFotos.value.value = '';
}

async function recibir() {
  if (guardando.value) return;
  error.value = '';
  ok.value = '';
  if (!f.value.cliente.trim() || !f.value.descripcion.trim() || !f.value.falla.trim()) {
    error.value = 'Cliente, equipo y falla reportada son obligatorios.';
    return;
  }
  guardando.value = true;
  try {
    // Si el nombre coincide con un cliente existente, lo ligamos (clienteId).
    const match = clientes.value.find(
      (c) => (c.nombre ?? '').trim().toLowerCase() === f.value.cliente.trim().toLowerCase()
    );
    // Sube las fotos de llegada (si hay) a Storage antes de crear la orden.
    const fotosRecepcion = fotosFiles.value.length ? await subirImagenes(fotosFiles.value, 'recepciones') : [];
    const res = await crearOrdenReparacion({
      clienteId: match?.id ?? null,
      clienteNombre: f.value.cliente.trim(),
      equipo: {
        descripcion: f.value.descripcion.trim(),
        marca: f.value.marca.trim() || null,
        modelo: f.value.modelo.trim() || null,
        numeroSerie: f.value.numeroSerie.trim() || null,
        accesorios: f.value.accesorios.trim() || null,
      },
      fallaReportada: f.value.falla.trim(),
      fotosRecepcion,
    });
    ok.value = `Equipo recibido. Folio ${res.folio}.`;
    limpiar();
  } catch (e: unknown) {
    error.value = (e as { message?: string })?.message ?? 'No se pudo recibir el equipo.';
  } finally {
    guardando.value = false;
  }
}

function fecha(o: OrdenReparacionDoc): string {
  const s = o.fechaRecepcion?.seconds;
  return s ? new Date(s * 1000).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
}
const activas = computed(() => ordenes.value.filter((o) => o.estatus !== 'entregado' && o.estatus !== 'devuelto'));

// --- Vista Lista / Tablero (kanban) ---
const vista = ref<'lista' | 'tablero'>('lista');
const COLUMNAS: EstatusReparacion[] = ['recibido', 'en_diagnostico', 'cotizado', 'aprobado', 'en_reparacion', 'listo'];
const porColumna = computed(() => {
  const m: Record<string, OrdenReparacionDoc[]> = {};
  for (const c of COLUMNAS) m[c] = [];
  for (const o of ordenes.value) if (m[o.estatus]) m[o.estatus].push(o);
  return m;
});
// Días que lleva la orden en su etapa actual (desde el sello de esa etapa).
const AHORA_S = Date.now() / 1000;
function diasEnEtapa(o: OrdenReparacionDoc): number {
  const ts = o.fechas?.[o.estatus]?.seconds ?? o.fechaRecepcion?.seconds;
  return ts ? Math.floor((AHORA_S - ts) / 86400) : 0;
}
// "Atorado": lleva demasiado tiempo detenido en la misma etapa.
const DIAS_ATORO = 5;
function atorado(o: OrdenReparacionDoc): boolean {
  return diasEnEtapa(o) >= DIAS_ATORO;
}

// --- Detalle / diagnóstico / avance de estado ---
const selId = ref<string | null>(null);
// Se re-lee desde la lista en vivo, así el modal refleja cambios al instante.
const sel = computed(() => ordenes.value.find((o) => o.id === selId.value) ?? null);
const errorDet = ref('');
const procesando = ref(false);
const formDiag = ref({ hallazgos: '', refacciones: '', tecnico: '' });
const motivoRechazo = ref('');

function abrir(o: OrdenReparacionDoc) {
  selId.value = o.id;
  errorDet.value = '';
  motivoRechazo.value = '';
  mostrarEntrega.value = false;
  entregaForm.value = { recibeNombre: '', firma: null };
  formDiag.value = {
    hallazgos: o.diagnostico?.hallazgos ?? '',
    refacciones: o.diagnostico?.refacciones ?? '',
    tecnico: o.diagnostico?.tecnico ?? '',
  };
}

// Historial: otras órdenes del MISMO equipo (mismo número de serie real).
const historialEquipo = computed(() => {
  const s = (sel.value?.equipo?.numeroSerie ?? '').trim().toLowerCase();
  if (!sel.value || !s || s === 's/n') return [];
  return ordenes.value.filter(
    (o) => o.id !== sel.value!.id && (o.equipo?.numeroSerie ?? '').trim().toLowerCase() === s
  );
});

// Entrega con firma (E).
const mostrarEntrega = ref(false);
const entregaForm = ref<{ recibeNombre: string; firma: File | null }>({ recibeNombre: '', firma: null });
function onFirma(e: Event) {
  const t = e.target as HTMLInputElement;
  entregaForm.value.firma = t.files && t.files[0] ? t.files[0] : null;
}
async function registrarEntrega() {
  if (!sel.value || procesando.value) return;
  if (!entregaForm.value.recibeNombre.trim()) {
    errorDet.value = 'Anota quién recibe el equipo.';
    return;
  }
  procesando.value = true;
  errorDet.value = '';
  try {
    let firmaUrl: string | null = null;
    if (entregaForm.value.firma) {
      const urls = await subirImagenes([entregaForm.value.firma], `firmas/${sel.value.id}`);
      firmaUrl = urls[0] ?? null;
    }
    await entregarOrden({ ordenId: sel.value.id, recibeNombre: entregaForm.value.recibeNombre.trim(), firmaUrl });
    mostrarEntrega.value = false;
  } catch (e: unknown) {
    errorDet.value = (e as { message?: string })?.message ?? 'No se pudo registrar la entrega.';
  } finally {
    procesando.value = false;
  }
}
function cerrar() {
  selId.value = null;
}

async function guardarDiag() {
  if (!sel.value || procesando.value) return;
  if (!formDiag.value.hallazgos.trim()) {
    errorDet.value = 'Escribe los hallazgos del diagnóstico.';
    return;
  }
  procesando.value = true;
  errorDet.value = '';
  try {
    await guardarDiagnostico({
      ordenId: sel.value.id,
      hallazgos: formDiag.value.hallazgos.trim(),
      refacciones: formDiag.value.refacciones.trim() || null,
      tecnico: formDiag.value.tecnico.trim() || null,
    });
  } catch (e: unknown) {
    errorDet.value = (e as { message?: string })?.message ?? 'No se pudo guardar el diagnóstico.';
  } finally {
    procesando.value = false;
  }
}

async function crearCot() {
  if (!sel.value || procesando.value) return;
  procesando.value = true;
  errorDet.value = '';
  try {
    const res = await crearCotizacionDesdeOrden(sel.value.id);
    router.push({ name: 'taller', params: { id: res.cotizacionId } });
  } catch (e: unknown) {
    errorDet.value = (e as { message?: string })?.message ?? 'No se pudo crear la cotización.';
    procesando.value = false;
  }
}
function verCot() {
  if (sel.value?.cotizacionId) router.push({ name: 'taller', params: { id: sel.value.cotizacionId } });
}

async function avanzar(estatus: EstatusReparacion) {
  if (!sel.value || procesando.value) return;
  if (estatus === 'rechazado' && !motivoRechazo.value.trim()) {
    errorDet.value = 'Escribe el motivo del rechazo.';
    return;
  }
  procesando.value = true;
  errorDet.value = '';
  try {
    await cambiarEstatus({
      ordenId: sel.value.id,
      estatus,
      motivo: estatus === 'rechazado' ? motivoRechazo.value.trim() : null,
    });
  } catch (e: unknown) {
    errorDet.value = (e as { message?: string })?.message ?? 'No se pudo cambiar el estado.';
  } finally {
    procesando.value = false;
  }
}
</script>

<template>
  <div class="p-8 max-w-5xl">
    <p class="eyebrow eyebrow--marca">Taller</p>
    <h1 class="text-4xl mb-1">Reparaciones</h1>
    <div class="h-0.5 w-[90px] bg-brand"></div>
    <p class="text-sm text-muted-ink mt-3">
      Recibe un equipo a reparar y síguelo por etapas. {{ activas.length }} en taller · {{ ordenes.length }} en total.
    </p>

    <!-- Vista: Lista (con formulario) o Tablero (kanban) -->
    <div class="inline-flex mt-5 rounded-md border border-line overflow-hidden text-sm">
      <button @click="vista = 'lista'" class="px-4 h-9" :class="vista === 'lista' ? 'bg-accent text-white' : 'bg-white text-ink hover:bg-black/5'">Lista</button>
      <button @click="vista = 'tablero'" class="px-4 h-9 border-l border-line" :class="vista === 'tablero' ? 'bg-accent text-white' : 'bg-white text-ink hover:bg-black/5'">Tablero</button>
    </div>

    <div v-if="vista === 'lista'" class="grid lg:grid-cols-[380px_1fr] gap-8 mt-6">
      <!-- Formulario de recepción -->
      <form @submit.prevent="recibir" class="bg-card border border-line rounded-lg shadow-sm p-5 space-y-3 self-start">
        <p class="eyebrow">Recibir equipo</p>

        <div>
          <label class="text-xs text-muted-ink">Cliente *</label>
          <input v-model="f.cliente" list="lista-clientes" placeholder="Empresa"
                 class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
          <datalist id="lista-clientes">
            <option v-for="c in clientes" :key="c.id" :value="c.nombre" />
          </datalist>
        </div>

        <div>
          <label class="text-xs text-muted-ink">Equipo (descripción) *</label>
          <input v-model="f.descripcion" placeholder="Ej. Radiador de subestación"
                 class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-muted-ink">Marca</label>
            <input v-model="f.marca" class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
          </div>
          <div>
            <label class="text-xs text-muted-ink">Modelo</label>
            <input v-model="f.modelo" class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
          </div>
        </div>

        <div>
          <label class="text-xs text-muted-ink">Número de serie <span class="text-muted-ink">(o s/n)</span></label>
          <input v-model="f.numeroSerie" placeholder="s/n si no tiene"
                 class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
        </div>

        <div>
          <label class="text-xs text-muted-ink">Accesorios que entrega</label>
          <input v-model="f.accesorios" placeholder="Cable, maletín…"
                 class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
        </div>

        <div>
          <label class="text-xs text-muted-ink">Falla reportada *</label>
          <textarea v-model="f.falla" rows="3" placeholder="Lo que el cliente dice que falla"
                    class="w-full py-2 px-3 rounded-md border border-line bg-white text-sm resize-none"></textarea>
        </div>

        <div>
          <label class="text-xs text-muted-ink">Fotos de llegada</label>
          <input ref="inputFotos" type="file" multiple accept="image/*" @change="onFotos"
                 class="w-full text-xs text-muted-ink file:mr-2 file:h-8 file:px-3 file:rounded-md file:border-0 file:bg-accent/10 file:text-accent file:text-xs file:font-medium file:cursor-pointer" />
          <p v-if="fotosFiles.length" class="text-xs text-muted-ink mt-1">{{ fotosFiles.length }} foto(s) seleccionada(s)</p>
        </div>

        <button type="submit" :disabled="guardando"
                class="h-10 w-full rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-bright disabled:opacity-50 flex items-center justify-center gap-2">
          <LoaderCircle v-if="guardando" :size="15" class="animate-spin" /><Plus v-else :size="16" /> Recibir equipo
        </button>
        <p v-if="error" class="text-sm text-danger">{{ error }}</p>
        <p v-if="ok" class="text-sm text-emerald-600">{{ ok }}</p>
      </form>

      <!-- Listado -->
      <div>
        <div v-if="cargando" class="p-10 text-center text-muted-ink"><LoaderCircle :size="20" class="animate-spin mx-auto" /></div>
        <div v-else-if="ordenes.length === 0" class="p-10 text-center">
          <div class="border border-dashed border-line-strong rounded-lg p-8">
            <PackageOpen :size="28" class="mx-auto text-muted-ink mb-3" />
            <p class="text-muted-ink text-sm">Aún no hay equipos en el taller. Recibe el primero.</p>
          </div>
        </div>
        <div v-else class="bg-card border border-line rounded-lg shadow-sm divide-y divide-line">
          <div v-for="o in ordenes" :key="o.id" @click="abrir(o)"
               class="flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-black/[0.02] transition-colors">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-mono text-sm text-ink">{{ o.folio }}</span>
                <span class="text-xs px-2 py-0.5 rounded-full" :class="COLOR_ESTATUS[o.estatus]">{{ ETIQUETA_ESTATUS[o.estatus] }}</span>
              </div>
              <p class="text-sm text-ink truncate mt-0.5">
                <Hammer :size="13" class="inline -mt-0.5 text-muted-ink" /> {{ o.equipo?.descripcion }}
                <span v-if="o.equipo?.marca || o.equipo?.modelo" class="text-muted-ink">· {{ [o.equipo?.marca, o.equipo?.modelo].filter(Boolean).join(' ') }}</span>
              </p>
              <p class="text-xs text-muted-ink truncate">{{ o.clienteNombre }} · {{ o.fallaReportada }}</p>
            </div>
            <span class="text-xs text-muted-ink shrink-0">{{ fecha(o) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tablero kanban -->
    <div v-else class="mt-6 overflow-x-auto pb-3">
      <div class="flex gap-3 min-w-max">
        <div v-for="c in COLUMNAS" :key="c" class="w-60 shrink-0">
          <div class="flex items-center gap-2 px-1 pb-2">
            <span class="text-xs px-2 py-0.5 rounded-full" :class="COLOR_ESTATUS[c]">{{ ETIQUETA_ESTATUS[c] }}</span>
            <span class="text-xs text-muted-ink">{{ porColumna[c].length }}</span>
          </div>
          <div class="space-y-2 min-h-[60px] bg-black/[0.02] rounded-lg p-2">
            <button v-for="o in porColumna[c]" :key="o.id" @click="abrir(o)"
                    class="w-full text-left bg-card border rounded-md p-2.5 shadow-sm hover:shadow transition-shadow"
                    :class="atorado(o) ? 'border-amber-400' : 'border-line'">
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs">{{ o.folio }}</span>
                <span v-if="atorado(o)" class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
                  <AlertTriangle :size="10" /> {{ diasEnEtapa(o) }}d
                </span>
              </div>
              <p class="text-sm text-ink truncate mt-1"><Hammer :size="12" class="inline -mt-0.5 text-muted-ink" /> {{ o.equipo?.descripcion }}</p>
              <p class="text-xs text-muted-ink truncate">{{ o.clienteNombre }}</p>
            </button>
            <p v-if="porColumna[c].length === 0" class="text-xs text-muted-ink text-center py-3">—</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Panel de detalle -->
    <div v-if="sel" class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-auto" @click.self="cerrar">
      <div class="bg-card w-full max-w-lg rounded-lg shadow-2xl my-6">
        <div class="flex items-center gap-3 px-5 py-3 border-b border-line">
          <span class="font-mono text-sm">{{ sel.folio }}</span>
          <span class="text-xs px-2 py-0.5 rounded-full" :class="COLOR_ESTATUS[sel.estatus]">{{ ETIQUETA_ESTATUS[sel.estatus] }}</span>
          <button @click="cerrar" class="ml-auto h-8 w-8 grid place-items-center rounded-md text-muted-ink hover:bg-black/5"><X :size="16" /></button>
        </div>

        <div class="p-5 space-y-4">
          <!-- Datos del equipo -->
          <div class="text-sm space-y-1">
            <p><span class="text-muted-ink">Cliente:</span> {{ sel.clienteNombre }}</p>
            <p><span class="text-muted-ink">Equipo:</span> {{ sel.equipo?.descripcion }}
              <span v-if="sel.equipo?.marca || sel.equipo?.modelo" class="text-muted-ink">· {{ [sel.equipo?.marca, sel.equipo?.modelo].filter(Boolean).join(' ') }}</span>
            </p>
            <p v-if="sel.equipo?.numeroSerie"><span class="text-muted-ink">Serie:</span> {{ sel.equipo?.numeroSerie }}</p>
            <p v-if="sel.equipo?.accesorios"><span class="text-muted-ink">Accesorios:</span> {{ sel.equipo?.accesorios }}</p>
            <p><span class="text-muted-ink">Falla reportada:</span> {{ sel.fallaReportada }}</p>
            <p v-if="sel.rechazoRazon" class="text-rose-600"><span class="text-muted-ink">Motivo de rechazo:</span> {{ sel.rechazoRazon }}</p>
          </div>

          <button v-if="sel.cotizacionId" @click="verCot"
                  class="w-full h-9 rounded-md border border-accent text-accent text-sm font-medium hover:bg-accent/5 flex items-center justify-center gap-2">
            <FileText :size="15" /> Ver cotización enlazada
          </button>

          <!-- Fotos de llegada (B) -->
          <div v-if="sel.fotosRecepcion?.length">
            <p class="eyebrow mb-1.5">Fotos de llegada</p>
            <div class="flex flex-wrap gap-2">
              <a v-for="(url, i) in sel.fotosRecepcion" :key="i" :href="url" target="_blank" rel="noopener">
                <img :src="url" class="h-16 w-16 object-cover rounded-md border border-line" />
              </a>
            </div>
          </div>

          <!-- Entrega registrada (E) -->
          <div v-if="sel.entrega" class="text-sm bg-emerald-50 border border-emerald-200 rounded-md p-3">
            <p><span class="text-muted-ink">Recibió:</span> {{ sel.entrega.recibeNombre }}</p>
            <a v-if="sel.entrega.firmaUrl" :href="sel.entrega.firmaUrl" target="_blank" rel="noopener" class="text-accent hover:underline text-xs">Ver firma/acuse</a>
          </div>

          <!-- Historial del equipo (F) -->
          <div v-if="historialEquipo.length" class="border-t border-line pt-3">
            <p class="eyebrow mb-1.5">Historial de este equipo (serie {{ sel.equipo?.numeroSerie }})</p>
            <div class="space-y-1">
              <button v-for="h in historialEquipo" :key="h.id" @click="abrir(h)"
                      class="w-full text-left flex items-center gap-2 text-xs hover:bg-black/[0.03] rounded px-1.5 py-1">
                <span class="font-mono">{{ h.folio }}</span>
                <span class="px-1.5 py-0.5 rounded-full" :class="COLOR_ESTATUS[h.estatus]">{{ ETIQUETA_ESTATUS[h.estatus] }}</span>
                <span class="text-muted-ink truncate">{{ h.fallaReportada }}</span>
              </button>
            </div>
          </div>

          <!-- Diagnóstico -->
          <div class="border-t border-line pt-4">
            <p class="eyebrow flex items-center gap-1.5"><Stethoscope :size="13" /> Diagnóstico</p>
            <div class="space-y-2 mt-2">
              <textarea v-model="formDiag.hallazgos" rows="2" placeholder="Hallazgos: ¿se puede reparar? ¿qué tiene?"
                        class="w-full py-2 px-3 rounded-md border border-line bg-white text-sm resize-none"></textarea>
              <input v-model="formDiag.refacciones" placeholder="Refacciones / trabajos necesarios"
                     class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
              <input v-model="formDiag.tecnico" placeholder="Técnico que diagnostica"
                     class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
              <button @click="guardarDiag" :disabled="procesando"
                      class="h-9 px-4 rounded-md border border-accent text-accent text-sm font-medium hover:bg-accent/5 disabled:opacity-50 flex items-center gap-2">
                <LoaderCircle v-if="procesando" :size="14" class="animate-spin" /> Guardar diagnóstico
              </button>
            </div>
          </div>

          <!-- Avanzar de estado -->
          <div v-if="SIGUIENTES[sel.estatus].length" class="border-t border-line pt-4">
            <p class="eyebrow">Mover a</p>
            <div v-if="SIGUIENTES[sel.estatus].includes('rechazado')" class="mt-2">
              <input v-model="motivoRechazo" placeholder="Motivo (obligatorio si rechazas)"
                     class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
            </div>
            <div class="flex flex-wrap gap-2 mt-2">
              <button v-for="s in SIGUIENTES[sel.estatus]" :key="s"
                      @click="s === 'cotizado' ? crearCot() : s === 'entregado' ? (mostrarEntrega = true) : avanzar(s)" :disabled="procesando"
                      class="h-9 px-3 rounded-md text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
                      :class="s === 'rechazado' ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-accent text-white hover:bg-accent-bright'">
                <component :is="s === 'cotizado' ? FileText : ArrowRight" :size="14" />
                {{ s === 'cotizado' ? 'Crear cotización' : ETIQUETA_ESTATUS[s] }}
              </button>
            </div>

            <!-- Formulario de entrega (quién recibe + firma) -->
            <div v-if="mostrarEntrega" class="mt-3 space-y-2 bg-black/[0.03] rounded-md p-3">
              <p class="text-xs text-muted-ink">Datos de entrega</p>
              <input v-model="entregaForm.recibeNombre" placeholder="Nombre de quien recibe *"
                     class="w-full h-9 px-3 rounded-md border border-line bg-white text-sm" />
              <div>
                <label class="text-xs text-muted-ink">Firma / acuse (opcional)</label>
                <input type="file" accept="image/*" @change="onFirma"
                       class="w-full text-xs text-muted-ink file:mr-2 file:h-8 file:px-3 file:rounded-md file:border-0 file:bg-accent/10 file:text-accent file:text-xs file:font-medium file:cursor-pointer" />
              </div>
              <div class="flex gap-2">
                <button @click="registrarEntrega" :disabled="procesando"
                        class="h-9 px-4 rounded-md bg-accent text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                  <LoaderCircle v-if="procesando" :size="14" class="animate-spin" /> Registrar entrega
                </button>
                <button @click="mostrarEntrega = false" class="h-9 px-3 rounded-md border border-line text-sm text-muted-ink">Cancelar</button>
              </div>
            </div>
          </div>
          <p v-else class="border-t border-line pt-4 text-sm text-muted-ink">Orden cerrada ({{ ETIQUETA_ESTATUS[sel.estatus] }}).</p>

          <p v-if="errorDet" class="text-sm text-danger">{{ errorDet }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
