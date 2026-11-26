# Launcher de eventos (Minecraft 1.21.1 + NeoForge 21.1.251)

Login con **usuario de Minecraft + contraseña** (modo no premium). Los moderadores crean las cuentas.
Estado: primera versión, **sin probar contra servicios reales**. Se prueba por etapas (ver abajo).

## Estructura

```
minecraft-launcher/
├─ supabase/                 <- backend (se edita en VS Code, se sube con la CLI de Supabase)
│  ├─ schema.sql             <- tablas; se pega en Supabase > SQL Editor
│  └─ functions/
│     ├─ _shared/common.ts   <- sesión, contraseñas (PBKDF2), acceso a la base
│     ├─ auth/               <- login usuario + contraseña (bloqueo 5 min tras 5 fallos)
│     ├─ users/              <- cuentas: crear, restablecer, rol, activar; cambiar mi contraseña
│     ├─ catalog/            <- lista instancias (los jugadores no ven "testing")
│     ├─ download/           <- URL temporal de descarga desde GitHub
│     ├─ publish/            <- solo moderadores: nueva instancia o nueva versión
│     └─ manage/             <- solo moderadores: modificar una versión, borrar versión o instancia
├─ tools/hash-password.js    <- genera el SQL de tu primera cuenta de moderador
└─ launcher/                 <- app de escritorio (Electron)
   ├─ config.json            <- TUS datos (ver paso 4)
   ├─ main.js / preload.js
   ├─ src/                   <- API, GitHub, Java/NeoForge/juego
   ├─ build/icon.ico         <- icono del .exe (generado desde el logo)
   └─ renderer/              <- interfaz (logo.png = logo del launcher, ícono de la ventana y avatar)
```

## Herramientas
Node.js LTS (nodejs.org), Git y Visual Studio Code (abre la carpeta `minecraft-launcher`).
La CLI de Supabase no se instala: se usa con `npx supabase ...`.

## Pasos

### 1. Servidor de Minecraft
En `server.properties`:
```
online-mode=false
enforce-secure-profile=false
white-list=true
```
Reinicia el servidor y vuelve a agregar a cada jugador con `/whitelist add NombreExacto`
(los UUID cambian en modo offline, así que la whitelist anterior ya no sirve).
Los datos que el servidor guardó con UUID premium (inventario, estadísticas) no se enlazan solos con el UUID offline.

### 2. GitHub
1. Crea un repositorio **privado** (por ejemplo `modpacks`) con un README (necesita al menos un commit).
2. Token de **lectura** (Settings > Developer settings > Fine-grained tokens): solo ese repo, Contents = Read. Va al servidor (paso 3).
3. Token de **escritura** (Contents = Read and write): lo pega cada moderador dentro del launcher.

### 3. Supabase
1. En el SQL Editor pega y ejecuta `supabase/schema.sql`.
2. En una terminal, dentro de `minecraft-launcher`:
   ```
   npx supabase login
   npx supabase link --project-ref TU_REF
   npx supabase secrets set GH_TOKEN=token_de_lectura GH_REPO=usuario/modpacks SESSION_SECRET=una_clave_larga_aleatoria
   npx supabase functions deploy --no-verify-jwt
   ```
   (`TU_REF` es la parte inicial de la URL de tu proyecto: https://TU_REF.supabase.co)

### 4. Tu primera cuenta de moderador
En la terminal, dentro de `minecraft-launcher`:
```
node tools/hash-password.js TuNombreDeMinecraft "TuContraseñaInicial"
```
Copia la línea `insert into users ...` que imprime y ejecútala en Supabase > SQL Editor.
(Usa comillas en la contraseña. Las demás cuentas se crean desde el launcher.)

### 5. Configurar y abrir el launcher
Edita `launcher/config.json`: `functionsUrl` (https://TU_REF.supabase.co/functions/v1) y `githubRepo` (usuario/repo).
```
cd launcher
npm install
npm start
```

## Loader y versión de Minecraft por instancia
Al crear una instancia nueva (código que aún no existe) en "Subir instancia" se eligen **Loader** (NeoForge o Fabric),
**versión de Minecraft** y **versión del loader**; las listas se leen de las páginas oficiales de cada loader.
Se guardan una sola vez, al crear la instancia (en la tabla `instances`), y las versiones nuevas de esa instancia las heredan.
El launcher descarga automáticamente el Java que pida esa versión de Minecraft (8, 17, 21, 25...).
Las instancias anteriores no tienen estos datos y siguen usando `manifest.json` del zip o `config.json`.

**Si ya tenías la base creada:** ejecuta `supabase/update-loaders.sql` en el SQL Editor y luego
`npx supabase functions deploy --no-verify-jwt`. (Haz el SQL primero: `catalog` ya pide las columnas nuevas.)


## Interfaz de jugadores y moderadores
- **Jugar** / **Instalar instancia** (pasa a **Actualizar Instancia** cuando hay una versión más nueva) / **⚙ Ajustes** (RAM y argumentos de la JVM, por instancia).
- **Jugar** se apaga si la instancia no tiene ninguna versión instalada (mensaje junto al cursor). Si la versión instalada no es la última, pide confirmación antes de abrir el juego.
- **Instalar instancia** se apaga cuando la versión elegida en el selector ya está instalada. Elegir una versión anterior en el selector la vuelve a activar.
- **Banner**: pon `modpack-banner.png` (también `.jpg`/`.webp`) en la raíz del .zip. Se muestra una vez instalada la instancia; antes se ve el logo.
- **Moderadores**: el engranaje junto a cada instancia abre "Modificar instancia" (una versión concreta: versión del loader y/o reemplazo del .zip) y "Borrar" (versión o instancia completa).
  Si se reemplaza el .zip, los jugadores que ya tenían esa versión verán "Actualizar Instancia".

**Si ya tenías la base creada:** ejecuta `supabase/update-manage.sql` en el SQL Editor y luego
`npx supabase functions deploy --no-verify-jwt` (SQL primero: `catalog` ya pide las columnas nuevas).

## Opciones, temas y contacto con administradores
El botón **Opciones** (barra lateral) reúne:
- **Configuración de cuenta**: el menú de cuentas de siempre.
- **Configuración de instalaciones**: carpeta de instancias (cambiarla), **ajustes globales** de RAM y argumentos de la JVM,
  y abrir la carpeta de instancias. Cada instancia usa los ajustes globales salvo en lo que se cambie desde su engranaje
  (solo se guarda lo que difiere de los globales; "Usar globales" en el engranaje lo restaura).
- **Personalización**: 4 temas (Carmesí, Verde Alien, Azul Noche, Celeste Claro) y un tema personalizado (6 colores + logo en 7 colores,
  que cambia en la interfaz, la pantalla de carga y el ícono de la ventana). Se guarda en el equipo del jugador.
  Los temas se definen en `launcher/renderer/themes.js`; los logos están en `launcher/renderer/logos/`.
- **Contacto a Administradores**: el jugador escribe un mensaje (máx. 1000 caracteres, 5 por hora). Los moderadores ven el botón **!** Mensajes
  en la barra lateral; se pone del color de highlight del tema mientras haya mensajes sin leer.

**Si ya tenías la base creada:** ejecuta `supabase/update-support.sql` en el SQL Editor y luego
`npx supabase functions deploy --no-verify-jwt` (SQL primero: la función `support` usa la tabla nueva).

## Roles y registro de cambios
- **Roles:** Jugador, **Beta Tester** y Moderador. El Beta Tester ve y descarga las versiones `testing`, pero no administra cuentas,
  no ve los mensajes ni puede modificar instancias. Los moderadores asignan el rol desde Mi cuenta > Administrar cuentas.
  Los mensajes de los jugadores muestran el rol de quien los envía.
- **Registro de cambios:** si el zip del modpack trae `cambiosModpack.md` en la raíz (junto a `mods/`), el botón con ícono de documento
  al lado de Ajustes de cada instancia lo muestra con su formato Markdown (títulos, listas, tablas, código, citas, enlaces...).
  Se lee de la instancia instalada, así que muestra los cambios de la versión que el jugador tiene.
  Si falta, el botón muestra el aviso de contactar a los administradores.

- **Consola de Minecraft:** el botón con ícono de terminal (junto al de cambios) muestra en vivo lo mismo que sale en la consola de VS Code.
  Guarda las últimas 5000 líneas; al cerrar el juego queda disponible la última sesión, y si no hay ninguna muestra `logs/latest.log` de la instancia.
  Rojo = errores y excepciones, amarillo = advertencias, gris = mensajes del launcher. "Copiar todo" sirve para adjuntar el log en un reporte.

**Si ya tenías la base creada:** ejecuta `supabase/update-beta.sql` en el SQL Editor y luego
`npx supabase functions deploy --no-verify-jwt` (SQL primero).

## Inicio de sesión (versión 1.1.0)
- Pantalla de inicio de sesión rediseñada (fondo `renderer/img/launcherBG2.png`).
- Dos fuentes: `04B_19.ttf` (pixel) solo para títulos grandes y botones grandes — solo tiene mayúsculas y no tiene ñ ni tildes, por eso esos textos van sin ellos —
  y `VCR_OSD_MONO.ttf` para los textos pequeños (subtítulos, etiquetas, enlaces, cuentas, versión), que sí tiene ñ, tildes y ¿ ¡.
  Se definen como `--font-px` y `--font-sm` en `renderer/styles.css`.
- **¿No tienes cuenta?** y **¿Olvidaste tu contraseña?** (sin sesión): el jugador escribe su usuario de Minecraft (y su usuario de Discord en la restauración)
  y los moderadores reciben un mensaje de "3AM Launcher" con rol "Servicio de Solicitudes". No crea ni cambia cuentas: la entrega de la contraseña sigue siendo manual.
  Límite contra spam: 5 solicitudes por hora por conexión (se guarda solo un hash, no la IP).

**Si ya tenías la base creada:** ejecuta `supabase/update-solicitudes.sql` en el SQL Editor y luego
`npx supabase functions deploy --no-verify-jwt` (SQL primero; hay una función nueva: `requests`).

## Inicio, barra lateral y modpack destacado
- Nueva barra lateral: **Inicio**, **Instancias**, y abajo **Soporte**, **Ajustes** y **Perfil**. Por ahora Instancias, Soporte (los jugadores escriben a los admins; los moderadores ven la bandeja), Ajustes y Perfil abren las pantallas de siempre, hasta que lleguen sus mockups. "Subir instancia" (moderadores) está arriba de la lista de Instancias y "Cerrar sesión" dentro de Perfil.
- **Inicio** muestra la instancia principal (banner al 75 %, nombre, etiqueta NUEVO/ACTUALIZAR; al hacer clic se abre la instancia), los usuarios conectados y el botón ULTIMO CHANGELOG.
- **Modpack destacado:** los moderadores lo eligen con el engranaje de Inicio. Solo puede ser una instancia con versión pública (no testing). Se guarda en `app_settings` y se mantiene hasta que un moderador lo cambie. Si no hay ninguna elegida (o ya no es pública) se usa la que tuvo la última subida o actualización pública.
- **Usuarios conectados:** cada launcher abierto avisa cada 45 s (función `presence`); se muestra a quien avisó en los últimos 2.5 minutos. Al cerrar sesión desaparece al instante.

**Si ya tenías la base creada:** ejecuta `supabase/update-inicio.sql` en el SQL Editor y luego
`npx supabase functions deploy --no-verify-jwt` (SQL primero; funciones nuevas: `featured` y `presence`; cambian `catalog` y `manage`).

## Rediseño completo (Instancias, Soporte, Mensajes, Ajustes, Perfil y fotos de perfil)
- **Barra lateral:** INICIO, INSTANCIAS y abajo SOPORTE (MENSAJES para moderadores), AJUSTES y PERFIL. El botón del menú elegido se pinta completo con el color highlight.
- **Instancias:** tarjetas con banner, nombre y etiqueta NUEVO/ACTUALIZAR; al abrir una se ve el detalle (instalar, versión, carpeta, jugar, ajustes, consola, changelogs). Los moderadores tienen un engranaje en cada tarjeta y en el detalle para modificar la instancia.
- **Soporte:** cuadro de texto + desplegable TIPO (Solicitud, Reporte de Bugs, Pregunta, Comentario/Idea, Reporte de Jugador). **Mensajes** (moderadores): lista con tipo, rol y usuario; VER MENSAJE lo abre y lo marca como leído.
- **Ajustes:** Configuración de instalaciones (carpeta, argumentos JVM y RAM globales), Personalización (temas, colores y logos) y, para moderadores, Subir instancia. Los ajustes de cada instancia usan la misma interfaz, compacta.
- **Perfil:** foto, nombre, rol, cambiar de cuenta (ahí también está Cerrar sesión), cambio de contraseña y de foto. Los moderadores administran cuentas con el engranaje.
- **Fotos de perfil:** se recortan al centro y se reducen a 256x256 PNG antes de subirse al bucket de Storage "Profile Pictures" (a través de la función `avatar`, con la service role, así que el bucket puede ser privado y no necesita políticas).
- **Botones:** todos con la forma de los mockups. La fuente pixel no tiene tildes ni ñ: los textos de botones y títulos se pasan automáticamente a su forma sin ellas.

**Si ya tenías la base creada:** ejecuta `supabase/update-pfp.sql` y luego `npx supabase functions deploy --no-verify-jwt` (SQL primero; función nueva: `avatar`; cambian `auth`, `users`, `presence` y `_shared`).

## Formato del modpack (.zip)
El zip contiene directamente las carpetas del juego:
```
mods/  config/  (resourcepacks/, shaderpacks/, etc.)
cambiosModpack.md   <- opcional: registro de cambios (Markdown) que se lee desde el launcher
manifest.json   <- opcional: {"minecraft":"1.21.1","neoforge":"21.1.251"}
modpack-banner.png   <- opcional: imagen que se ve en el launcher (proporción 2:1)
```
Sin manifest se usan los valores de `config.json`. Al actualizar se reemplaza `mods/` completo y se conservan `saves/` y `options.txt`.

## Cómo probar, por etapas
1. Login: entra con tu cuenta de moderador. Deben aparecer "Subir instancia" y "Cuentas".
2. Cuentas: crea una cuenta de jugador (botón Generar) y entra con ella en otra sesión o equipo.
3. Subida: sube un zip pequeño con código 1 y versión 1.0.0. Revisa GitHub > Releases y Supabase > Table Editor.
4. Descarga: el jugador ve la instancia con la etiqueta "Nuevo". Sube la 1.0.1: debe salir el aviso (se revisa cada 60 s) y la etiqueta "Actualizar".
5. Testing: sube "testing 1.0.2": el jugador no debe verla; el moderador sí.
6. Juego: pulsa "Instalar instancia" y luego "Jugar". La primera vez descarga Java 21 y NeoForge (varios minutos). Entra al servidor.

## Seguridad: lo que esto NO protege
Con `online-mode=false`, la contraseña del launcher protege el acceso a los modpacks, **no el servidor**:
cualquiera que abra Minecraft con otro launcher y escriba un nombre de tu whitelist entra como esa persona
(incluidos los OP). Para cerrar ese hueco, instala un plugin de autenticación en el servidor (por ejemplo AuthMe)
o limita el puerto del servidor por firewall/VPN a los jugadores de confianza.

## Pendiente / puntos de riesgo
- El arranque de NeoForge con `minecraft-launcher-core` es lo más probable que necesite ajustes. Plan B: `@xmcl/core`.
- No hay todavía: empaquetado `.exe` (`npm run dist`), auto-actualización del launcher, entrada directa al servidor.
- La tabla `users` conserva el campo `minecraft_uuid` para poder volver al login premium de Microsoft más adelante.
