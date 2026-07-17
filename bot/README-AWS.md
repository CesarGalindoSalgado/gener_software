# Subir el bot de WhatsApp a AWS (EC2)

El bot es un proceso de Node que debe estar **encendido 24/7**. Hoy corre en tu
PC; esta guía lo mueve a una **EC2** (una PC virtual con Linux, siempre prendida)
para que ya no dependa de tu computadora.

> ⚠️ **Lo más importante:** la sesión de WhatsApp solo puede estar **activa en un
> lugar a la vez**. Cuando el bot arranque en AWS y escanees el QR nuevo, el bot
> de tu PC quedará desvinculado. **Apaga el de tu PC** (cierra la terminal) antes
> de vincular en AWS.

---

## Fase 1 — Crear la instancia EC2

1. Entra a la consola de AWS → busca **EC2** → **Launch instance**.
2. **Name:** `portteo-bot`.
3. **AMI (sistema):** *Ubuntu Server 22.04 LTS*.
4. **Instance type:** `t3.small` (2 GB RAM, recomendado por Puppeteer).
   - Alternativa barata: `t3.micro` (1 GB, capa gratuita 12 meses) — funciona si
     le agregas swap (ver Fase 3, paso 0).
5. **Key pair:** *Create new key pair* → nómbralo `portteo-bot` → descarga el
   `.pem`. **Guárdalo bien, es tu llave para entrar.**
6. **Network settings → Firewall (security group):** deja SOLO
   *Allow SSH (22)* y, si puedes, restríngelo a *My IP*.
   - El bot solo hace conexiones de SALIDA (a WhatsApp y a las funciones), así
     que **no necesita ningún puerto de entrada** más que SSH.
7. **Storage:** 16 GB está bien.
8. **Launch instance.**

Copia la **IP pública** de la instancia (la verás en la lista de EC2).

---

## Fase 2 — Conectarse por SSH

Desde tu PC (PowerShell o Git Bash), en la carpeta donde bajaste el `.pem`:

```bash
# Solo la primera vez, protege la llave (Git Bash / Linux / Mac):
chmod 400 portteo-bot.pem

ssh -i portteo-bot.pem ubuntu@LA_IP_PUBLICA
```

(En Windows con PowerShell es el mismo comando `ssh -i ...`.)

---

## Fase 3 — Instalar Node y las librerías de Chromium

Ya conectado a la EC2, pega esto:

```bash
# 0) (SOLO si elegiste t3.micro de 1 GB) crea 2 GB de swap para que Puppeteer
#    no se quede sin memoria:
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 1) Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 2) Librerías que necesita el Chromium de Puppeteer
sudo apt-get install -y ca-certificates fonts-liberation libasound2 \
  libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libexpat1 \
  libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
  libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils
```

---

## Fase 4 — Subir el código del bot

Solo necesitas la carpeta `bot/` (sin `auth/` ni `node_modules/`).

> ℹ️ **Por qué NO usamos `git clone`:** GitHub está muy atrás de tu código local
> (faltan decenas de commits y cambios sin subir). Clonar bajaría un bot viejo.
> Por eso copiamos la carpeta actual con `scp`.

**Paso 1 — en la EC2**, crea la carpeta destino:
```bash
mkdir -p /home/ubuntu/bot
```

**Paso 2 — en tu PC** (PowerShell o Git Bash, parado en `C:\Codigo\gener_software`),
copia solo los archivos necesarios:
```bash
scp -i RUTA\portteo-bot.pem \
  bot/index.js bot/package.json bot/package-lock.json bot/.env.example \
  ubuntu@LA_IP_PUBLICA:/home/ubuntu/bot/
```

**Paso 3 — de vuelta en la EC2:**
```bash
cd /home/ubuntu/bot
```

Instala dependencias (esto también baja el Chromium de Puppeteer):
```bash
npm install
```

---

## Fase 5 — Configurar el `.env` y arrancar con PM2

```bash
# 1) Crea el .env a partir del ejemplo y edítalo
cp .env.example .env
nano .env      # pega el WHATSAPP_WEBHOOK_SECRET real (el mismo de tu PC)
#              Ctrl+O, Enter, Ctrl+X para guardar y salir

# 2) PM2 (mantiene el bot vivo y lo reinicia si se cae)
sudo npm install -g pm2

# 3) Arranca el bot
pm2 start npm --name portteo-bot -- start

# 4) Míralo arrancar y saca el QR por la terminal
pm2 logs portteo-bot
```

---

## Fase 6 — Vincular WhatsApp (escanear el QR)

Con `pm2 logs portteo-bot` verás el **QR en la terminal**. También aparece en el
**portal → WhatsApp** (el bot lo publica solo).

1. **Apaga primero el bot de tu PC** (cierra su terminal), o el QR no servirá.
2. En tu teléfono: WhatsApp → *Dispositivos vinculados* → *Vincular dispositivo*
   → escanea el QR.
3. Cuando en los logs veas `✅ WhatsApp conectado`, ya quedó.

Sal de los logs con `Ctrl+C` (el bot **sigue corriendo** en segundo plano).

---

## Fase 7 — Que arranque solo al reiniciar la EC2

```bash
pm2 save
pm2 startup     # copia y ejecuta el comando que te imprime (empieza con "sudo env ...")
```

Listo. Aunque se reinicie la máquina, el bot vuelve solo.

---

## Comandos útiles del día a día

```bash
pm2 status                 # ¿está vivo?
pm2 logs portteo-bot       # ver la actividad / errores
pm2 restart portteo-bot    # reiniciarlo
pm2 stop portteo-bot       # detenerlo
```

## Notas

- **Costo aproximado:** `t3.small` ronda ~15 USD/mes; `t3.micro` entra en la capa
  gratuita el primer año. (Los precios varían por región; revisa la consola.)
- **Región:** usa una cercana (p. ej. `us-east-1`).
- **Nunca subas** `auth/` ni `.env` (la sesión y el secreto). Ya están en
  `.gitignore`.
- **Pruebas vs producción:** esta guía deja PRODUCCIÓN en AWS. El entorno de
  pruebas puede seguir en tu PC con `npm run start:pruebas` (usa su propio número
  y su carpeta `auth-pruebas`).
