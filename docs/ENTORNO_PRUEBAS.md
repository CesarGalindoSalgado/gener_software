# Proyecto de pruebas (staging) separado de producción

Producción = **gener-3ecc1** (lo usan los clientes). Para probar sin tocar sus
datos, se crea un **segundo proyecto de Firebase** y se despliega el MISMO código.
El código ya es portable: todas las URLs se derivan del proyecto (ver
`functions/src/dominio/entorno.ts` y `web/src/firebase.ts`), así que **no hay que
editar código**, solo configurar.

## 1) Crear el proyecto de pruebas (una vez)

1. En https://console.firebase.google.com → **Agregar proyecto** (ej. `gener-pruebas`).
2. Súbelo al plan **Blaze** (las Cloud Functions gen2 y las llamadas a APIs externas
   lo requieren; el consumo de pruebas es mínimo, casi siempre $0).
3. Agrega una **App web** (ícono `</>`), copia la configuración del SDK.

## 2) Config del portal para pruebas

1. Copia `web/.env.pruebas.example` a `web/.env.pruebas` y pega los valores de la
   App web del proyecto de pruebas (apiKey, projectId, etc. — no son secretos).
2. Para compilar el portal contra pruebas:
   ```bash
   cd web
   npm run build -- --mode pruebas
   ```
   (Sin `--mode`, compila contra producción — usa los valores por defecto.)

## 3) Apuntar la CLI de Firebase al proyecto de pruebas

En `.firebaserc` ya hay un alias `pruebas`: reemplaza el placeholder por el ID real
del proyecto de pruebas. Luego:
```bash
firebase use pruebas        # cambia de proyecto activo (producción = alias "produccion")
```

## 4) Secretos del proyecto de pruebas

Los secretos son POR proyecto; hay que crearlos en pruebas (con la CLI apuntando a
pruebas):
```bash
firebase functions:secrets:set GEMINI_API_KEY --project pruebas
firebase functions:secrets:set WHATSAPP_WEBHOOK_SECRET --project pruebas
firebase functions:secrets:set TELEGRAM_WEBHOOK_SECRET --project pruebas
firebase functions:secrets:set TELEGRAM_BOT_TOKEN --project pruebas   # opcional (si probarás Telegram)
```
(Correo, Drive y Telegram también se configuran aparte desde el portal de pruebas,
en Configuración → …, con sus propias credenciales.)

## 5) Desplegar a pruebas

```bash
# backend + reglas
firebase deploy --only functions,firestore:rules,storage --project pruebas
# portal (tras compilar con --mode pruebas)
firebase deploy --only hosting --project pruebas
```
Queda en `https://<proyecto-pruebas>.web.app`.

## 6) Primer usuario admin en pruebas (bootstrap)

El proyecto de pruebas arranca sin usuarios. Crea el primer superAdmin a mano:
1. **Authentication → Usuarios → Agregar usuario** (correo + contraseña).
2. **Firestore → colección `usuarios` → documento con ID = ese correo**, campos:
   `nombre` (texto), `rol` = `superAdmin`, `activo` = `true`.
Con eso ya puedes entrar al portal de pruebas y dar de alta a los demás.

## 7) Bot de WhatsApp (opcional)

El bot (carpeta `bot/`, Baileys) es un proceso aparte. Para probar WhatsApp en
pruebas necesitas una **segunda instancia** del bot con **otro número/sesión**,
apuntando su `WEBHOOK_URL` al `webhookWhatsapp` del proyecto de pruebas. Si no,
puedes probar casi todo por el **portal** y por **Telegram** (con un bot de prueba
distinto). No mezcles el número de WhatsApp de producción con pruebas.

## Volver a producción

```bash
firebase use produccion
cd web && npm run build          # sin --mode (producción)
firebase deploy --project produccion --only hosting
```

> Regla de oro: antes de cada `deploy`, confirma con `firebase use` a qué proyecto
> estás apuntando. Producción = `gener-3ecc1`.
