# Sistema de diseño — G-ener · "Editorial eléctrico (azul marino + dorado)"

> **Cómo usar este archivo:** pégalo (o adjúntalo) al inicio de un chat nuevo y di:
> *"Quiero que mi app use ESTE sistema de diseño. Respétalo: tipografías, paleta, tokens y convenciones de componentes."*
> Es independiente de cualquier framework; trae los valores exactos (hex, tokens) listos para copiar.
> Variante de marca del sistema editorial base: misma estructura, con la paleta de G-ener.

---

## 1. Filosofía / vibra

Un look **editorial, sobrio y serio** — más cercano a un *documento ejecutivo impreso / revista financiera* que a un dashboard genérico de SaaS. Transmite orden, control y profesionalismo, con la identidad eléctrica de G-ener. Reglas mentales:

- **Plano, no brilloso:** nada de gradientes llamativos, neón ni sombras duras. Superficies limpias, sombras muy suaves.
- **Papel cálido-frío, no blanco puro:** el fondo es un gris-azulado muy claro con una textura sutil de puntos.
- **Serifa para lo importante:** títulos y números grandes en serif elegante; el cuerpo y la UI en una sans moderna; etiquetas pequeñas en monoespaciada MAYÚSCULAS con mucho *tracking*.
- **Dos colores de marca con jerarquía, no dos acentos que compiten:** el **azul marino manda** (estructura, texto, todo lo interactivo) y el **dorado eléctrico acentúa** (marca y energía: el rayo, barras de KPI, indicador activo, eyebrows). El dorado pesa **porque es escaso**; nunca es color de texto de cuerpo ni de botón.
- **Mucho aire, bordes finos, esquinas contenidas** (radios chicos, ~6px).

---

## 2. Tipografías (Google Fonts)

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&family=Manrope:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

| Rol | Fuente | Uso |
|---|---|---|
| **Serif** | `Cormorant Garamond` | Títulos (h1–h4) y **números grandes** (KPIs, montos). Pesos 500/600. Palabra clave del título en *itálica* + color **dorado** (marca). |
| **Sans** | `Manrope` | Texto de cuerpo, botones, inputs, todo lo demás. Pesos 400/500/600. |
| **Mono** | `JetBrains Mono` | "Eyebrows" y etiquetas pequeñas en MAYÚSCULAS con `letter-spacing` amplio; tags, fechas tipo dato. Los eyebrows de marca van en **dorado**. |

Detalles tipográficos del cuerpo: `line-height: 1.55`, `letter-spacing: -0.005em`, antialiased. Títulos: `letter-spacing: -0.015em`, `line-height: 1.1`, peso 500. **Siempre sentence case** (nunca Title Case ni ALL CAPS, salvo los eyebrows mono).

---

## 3. Paleta (hex exactos)

**Superficies y tinta**
- Papel / fondo: `#f4f7fb`
- Tarjeta: `#ffffff`
- Borde / divisor: `#e1e6ee` · borde fuerte: `#cdd5e0`
- Tinta (texto principal): `#10243f` *(el azul marino de la cotización)*
- Texto secundario: `#2d3e54`
- Texto atenuado / labels: `#647183`

**Barra lateral (oscura)**
- Sidebar: `#10243f` · banda superior: `#0a1f3d`
- Texto items inactivos: `#8497b0` · deshabilitados: `#41526f`

**Azul funcional (interactivo)** — botones, foco, enlaces, estados activos "de sistema"
- Navy profundo: `#143d6b`
- **Interactivo principal: `#143d6b`**
- Interactivo hover/foco: `#1d5f9a`
- Azul claro (sobre oscuro): `#4d9fdb`
- Fondos suaves: secondary `#eef2f8`, azul-ui `#e4eef9`

**Dorado eléctrico (marca / energía)** — el rayo, barras de KPI, indicador activo del sidebar, eyebrows, resaltos que llaman el ojo
- **Dorado de marca (brillante): `#d99400`** — rayo, barras de acento, activo
- Dorado texto (legible): `#9a6b00` — eyebrows, montos que resaltan, enlaces de marca
- Dorado suave (fondo): `#faf1dc` — badges/resaltos tenues

**Semánticos de estado**
- Éxito / autorizada / completado: `#1f7a6b` (verde azulado)
- "En pausa" / especial: `#5847b8` (violeta-índigo)
- Alerta / vencido / destructivo: `#a8324a` (vino)

**Prioridades** (3 niveles, accesibles para daltonismo: difieren en tono Y luminosidad)
- Alta: texto `#a8324a`, fondo `#f9e6ea`, punto `#e24b4a` (rojo)
- Media: texto `#a16207`, fondo `#fef7c3`, punto `#facc15` (amarillo)
- Baja: texto `#64748b`, fondo `#eef1f5`, punto `#94a3b8` (gris)

---

## 4. Tokens listos para copiar

### Opción A — CSS variables (cualquier stack)

```css
:root {
  --paper: #f4f7fb;
  --card: #ffffff;
  --line: #e1e6ee;
  --line-strong: #cdd5e0;
  --ink: #10243f;
  --ink-2: #2d3e54;
  --muted-ink: #647183;

  --sidebar: #10243f;
  --sidebar-band: #0a1f3d;
  --sidebar-fg: #8497b0;
  --sidebar-dim: #41526f;

  /* Azul funcional (interactivo) */
  --navy: #143d6b;
  --accent: #143d6b;
  --accent-bright: #1d5f9a;
  --accent-light: #4d9fdb;

  /* Dorado eléctrico (marca / energía) */
  --brand: #d99400;
  --brand-text: #9a6b00;
  --brand-ui: #faf1dc;

  --success: #1f7a6b;
  --paused: #5847b8;
  --danger: #a8324a;

  --secondary: #eef2f8;   /* fondo suave / hover */
  --accent-ui: #e4eef9;   /* fondo suave azul (estado enviada) */

  --font-sans: "Manrope", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Cormorant Garamond", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --radius: 0.375rem;          /* ~6px, esquinas contenidas */
  --radius-lg: 0.625rem;       /* tarjetas */

  /* sombras suaves */
  --shadow-sm: 0 1px 3px rgba(16,36,63,.05);
  --shadow-md: 0 12px 28px rgba(16,36,63,.14);
}

body {
  margin: 0;
  background-color: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  font-weight: 400;
  line-height: 1.55;
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
  /* textura sutil de puntos (clave del look) */
  background-image: radial-gradient(rgba(20,61,107,.05) 1px, transparent 1px);
  background-size: 30px 30px;
}

h1, h2, h3, h4 {
  font-family: var(--font-serif);
  color: var(--ink);
  font-weight: 500;
  line-height: 1.1;
  letter-spacing: -0.015em;
}

/* "eyebrow": etiqueta mono en mayúsculas (usa --brand-text para eyebrows de marca) */
.eyebrow {
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 0.62rem;
  color: var(--muted-ink);
}
.eyebrow--marca { color: var(--brand-text); }
```

### Opción B — Tailwind v4 (`@theme`)

Mapea los mismos valores a utilidades (`bg-paper`, `text-ink`, `text-accent`, `text-brand`, `font-serif`, `border-line`, etc.). Stack de referencia: **React + Vite + TypeScript + Tailwind v4 + shadcn/ui (estilo new-york) + íconos Lucide.**

```css
@theme {
  --font-sans: "Manrope", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Cormorant Garamond", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --color-paper: #f4f7fb;
  --color-card: #ffffff;
  --color-line: #e1e6ee;
  --color-line-strong: #cdd5e0;
  --color-ink: #10243f;
  --color-ink-2: #2d3e54;
  --color-muted-ink: #647183;
  --color-sidebar: #10243f;
  --color-sidebar-band: #0a1f3d;
  --color-sidebar-fg: #8497b0;

  /* azul funcional */
  --color-navy: #143d6b;
  --color-accent: #143d6b;
  --color-accent-bright: #1d5f9a;
  --color-accent-light: #4d9fdb;

  /* dorado de marca */
  --color-brand: #d99400;
  --color-brand-text: #9a6b00;
  --color-brand-ui: #faf1dc;

  --color-success: #1f7a6b;
  --color-paused: #5847b8;
  --color-danger: #a8324a;

  --radius-md: 0.375rem;
  --radius-lg: 0.625rem;
}
```

---

## 5. Convenciones de componentes

**Regla de oro del color:** el **azul (`--accent` / navy)** es el caballo de batalla (botones, foco, enlaces, estados de sistema). El **dorado (`--brand`)** es escaso y solo para marca/energía (rayo, barras de acento de KPI, indicador activo del sidebar, eyebrows, un número que debe jalar el ojo). Nunca uses dorado para texto de cuerpo ni fondo de botón.

**Tarjetas (cards):** fondo blanco, borde `0.5–1px` `--line`, `border-radius` ~6–10px, sombra `--shadow-sm`. Padding ~`1.25rem`. Mucho aire interno.

**Tarjeta KPI / dato grande:** tarjeta blanca con **barra de acento de 3px a la izquierda** (`border-left: 3px solid <color>`), arriba una **eyebrow** (label mono), y debajo el **número grande en serif** (≈2.5rem, peso 500). La barra y el número van en **dorado** cuando el KPI comunica energía/urgencia (p. ej. "enviadas sin cerrar"); en **navy** para métricas neutras. *(Cuando uses borde de un solo lado, esquinas a 0 en ese lado.)*

**Eyebrow:** etiqueta mono, MAYÚSCULAS, `letter-spacing: 0.22em`, ~0.62rem. Atenuada por defecto; **dorada** cuando es de marca.

**Encabezado de página:** eyebrow + `h1` serif (con una palabra en *itálica* y color **dorado**) + un **subrayado fino dorado** (~2px, ~90px de ancho) bajo el título.

**Pestañas tipo folder:** se ven como pestañas de carpeta sobre una línea inferior; la activa tiene fondo blanco + borde superior de 2px **azul** y "se conecta" con el contenido.

**Barra lateral (sidebar):** oscura (`--sidebar`), logo en serif/bold con el **rayo dorado**; items con ícono + texto; el activo lleva **barra izquierda dorada** + fondo tenue dorado (`rgba(217,148,0,.14)`) + texto blanco. Banda superior aún más oscura (`--sidebar-band`) con eyebrow mono.

**Botones:** primario = fondo **azul** (`--accent`), texto blanco, hover a `--accent-bright`. Outline = borde `--line-strong`, hover borde/texto azul. Ghost = transparente, hover fondo `secondary`. Radio ~6px. Íconos a 16px. *(El dorado no se usa como fondo de botón.)*

**Inputs:** alto ~40px, borde `--line`, fondo blanco, focus = borde **azul** + anillo suave (`ring` con `--accent-bright` a baja opacidad).

**Diálogos / modales:** tarjeta blanca centrada, overlay `rgba(16,36,63,.5)`, sombra fuerte (`--shadow-md`), título en serif, descripción atenuada.

**Badges / tags:** pequeñísimos, fondo suave del color + texto del tono oscuro del MISMO color (nunca negro). Estados: *enviada* = azul-ui `#e4eef9`/`#143d6b`; *autorizada* = verde `#e0f0ec`/`#1f7a6b`; *borrador* = ámbar `#fef7c3`/`#a16207`. Para "datos" estilo mono.

**Estados vacíos:** recuadro de **borde punteado** (`--line-strong`), ícono atenuado centrado, texto corto en `--muted-ink`, y un botón de acción.

**Gráficas:** minimalistas. Barras horizontales con relleno **azul** sobre pista `secondary`; el dorado solo para resaltar una serie/valor clave. Dona en SVG con la paleta (navy/azul/verde/violeta/vino…). Etiquetas chicas en `--muted-ink`.

**Íconos:** set de líneas (outline), consistente y fino — **Lucide** (o Tabler outline). Tamaños 16–20px inline.

**Motivo eléctrico:** el rayo (dorado con contorno navy) es la firma de marca. Úsalo en el logo y, con moderación, como detalle (una línea fina tipo onda). No lo repitas como textura de fondo.

---

## 6. Reglas rápidas (do / don't)

- ✅ Serif para títulos y números; mono solo para eyebrows/tags; sans para todo lo demás.
- ✅ Azul manda, dorado acentúa. El dorado comunica marca/energía, nunca decora de más.
- ✅ Fondo papel `#f4f7fb` + textura de puntos sutil. Tarjetas blancas.
- ✅ Bordes finos, esquinas chicas, sombras muy suaves, mucho aire.
- ✅ Sentence case en todo (salvo eyebrows mono).
- ❌ Nada de gradientes vistosos, neón, sombras duras ni glassmorphism.
- ❌ Dorado como texto de cuerpo o fondo de botón (no da contraste, se ve barato).
- ❌ Nada de blanco puro como fondo general ni tipografías "AI slop" (Inter/Roboto por defecto, morados sobre blanco).

---

## 7. Resumen de 1 línea (por si solo quieres pegar esto)

> *Look editorial eléctrico de G-ener: fondo gris-azulado `#f4f7fb` con textura de puntos, tarjetas blancas de bordes finos y esquinas chicas; tipografías Cormorant Garamond (serif, títulos y números, palabra clave en itálica + dorado), Manrope (sans, cuerpo/UI) y JetBrains Mono (eyebrows en mayúsculas); azul marino `#143d6b` como color funcional (botones, foco, enlaces) sobre tinta `#10243f`, y dorado eléctrico `#d99400` (texto `#9a6b00`) como acento de marca escaso (rayo, barras de KPI, activo, eyebrows); semánticos verde `#1f7a6b`, violeta `#5847b8`, vino `#a8324a`; sidebar oscura `#10243f`; sin gradientes ni neón.*
