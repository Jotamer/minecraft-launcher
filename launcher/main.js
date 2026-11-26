const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");
const api = require("./src/api");
const store = require("./src/store");
const game = require("./src/game");
const gh = require("./src/github");
const loaders = require("./src/loaders");
const presence = require("./src/presence");
const THEMES = require("./renderer/themes");
const cfg = require("./config.json");

let win = null;
let me = null;
let playing = false;
let playingCode = null;
let installing = false;
const send = (ch, p) => win && win.webContents.send(ch, p);
const fail = (e) => ({ ok: false, error: e.message, expired: e.status === 401 });

// ---- Cuentas guardadas en este equipo
// Cada cuenta guarda su token de sesión, todo cifrado con DPAPI (safeStorage). El renderer nunca ve los tokens.
const readAcc = () => {
  try { const a = JSON.parse(store.loadSecret("accounts") || "null"); if (a && Array.isArray(a.list)) return a; } catch {}
  return { list: [], current: null };
};
const writeAcc = (a) => store.saveSecret("accounts", JSON.stringify(a));
const pubAcc = (a) => ({ accounts: a.list.map(({ id, name, role, avatar }) => ({ id, name, role, avatar })), currentId: a.current });
function rememberAccount(user, token) {
  const a = readAcc();
  const i = a.list.findIndex((x) => x.id === user.id);
  const entry = { id: user.id, name: user.name, role: user.role, token, avatar: i >= 0 ? a.list[i].avatar : undefined };   // la foto guardada se conserva
  if (i >= 0) a.list[i] = entry; else a.list.push(entry);
  a.current = user.id;
  writeAcc(a);
}
function forgetAccount(id) {
  const a = readAcc();
  a.list = a.list.filter((x) => x.id !== id);
  if (a.current === id) a.current = null;
  writeAcc(a);
}
const busyMsg = () => playing ? "Cierra Minecraft antes de cambiar de cuenta." : installing ? "Espera a que termine la instalación antes de cambiar de cuenta." : null;

ipcMain.handle("auth:auto", async () => {
  const a = readAcc();
  let acc = a.list.find((x) => x.id === a.current);
  let legacy = false;                                   // sesión guardada por versiones anteriores del launcher
  if (!acc) { const t = store.loadSecret("session"); if (t) { acc = { token: t }; legacy = true; } }
  if (!acc) return { ok: false, saved: pubAcc(a) };
  api.setSession(acc.token);
  try {
    me = await api.call("users", { method: "POST", body: { action: "me" } });
    rememberAccount(me, acc.token);                     // también actualiza el rol si cambió
    if (legacy) store.deleteSecret("session");
    return { ok: true, me };
  } catch (e) {
    if (e.status === 401) {
      api.setSession(null);
      if (legacy) store.deleteSecret("session"); else forgetAccount(acc.id);
      return { ok: false, saved: pubAcc(readAcc()) };
    }
    return { ok: false, error: "No se pudo conectar con el servidor: " + e.message, saved: pubAcc(a) };
  }
});

ipcMain.handle("auth:login", async (_e, { username, password }) => {
  if (me && busyMsg()) return { ok: false, error: busyMsg() };
  const prev = me, prevToken = readAcc().list.find((x) => x.id === readAcc().current)?.token;
  try {
    const r = await api.call("auth", { method: "POST", body: { username, password } });
    api.setSession(r.token);
    me = { id: r.id, name: r.name, role: r.role };
    rememberAccount(me, r.token);
    store.deleteSecret("session");
    return { ok: true, me };
  } catch (e) {
    me = prev; api.setSession(prevToken || null);       // si falla agregar otra cuenta, se conserva la actual
    return fail(e);
  }
});

// Al salir (cerrar sesión, cambiar de cuenta, cerrar el launcher) se avisa para desaparecer de "Usuarios conectados" al instante
const leavePresence = () => (me
  ? Promise.race([api.call("presence", { method: "POST", body: { action: "leave" } }).catch(() => {}), new Promise((r) => setTimeout(r, 1500))])
  : Promise.resolve());

ipcMain.handle("auth:logout", async () => {
  await leavePresence();
  if (me) forgetAccount(me.id);
  store.deleteSecret("session");
  me = null; api.setSession(null);
  return pubAcc(readAcc());
});

ipcMain.handle("accounts:list", () => ({ ok: true, ...pubAcc(readAcc()) }));

ipcMain.handle("accounts:switch", async (_e, { id }) => {
  if (me && busyMsg()) return { ok: false, error: busyMsg() };
  const a = readAcc(), acc = a.list.find((x) => x.id === id);
  if (!acc) return { ok: false, error: "Esa cuenta ya no está guardada en este equipo." };
  const prevToken = a.list.find((x) => x.id === a.current)?.token || null;
  await leavePresence();                                 // la cuenta anterior deja de verse como conectada
  api.setSession(acc.token);
  try {
    const u = await api.call("users", { method: "POST", body: { action: "me" } });
    me = u; rememberAccount(u, acc.token);
    return { ok: true, me };
  } catch (e) {
    api.setSession(prevToken);                          // la cuenta actual sigue activa
    if (e.status === 401) {
      forgetAccount(id);
      return { ok: false, gone: true, username: acc.name, error: `La sesión de ${acc.name} expiró. Agrégala de nuevo con su contraseña.` };
    }
    return { ok: false, error: "No se pudo cambiar de cuenta: " + e.message };
  }
});

ipcMain.handle("accounts:remove", (_e, { id }) => {
  if (me && me.id === id) return { ok: false, error: "Para salir de la cuenta activa usa \"Cerrar sesión\"." };
  forgetAccount(id);
  return { ok: true, ...pubAcc(readAcc()) };
});

ipcMain.handle("users", async (_e, body) => {
  try { return { ok: true, ...(await api.call("users", { method: "POST", body })) }; } catch (e) { return fail(e); }
});

// ---- Ajustes de RAM y argumentos de la JVM
// Hay unos GLOBALES (Opciones > Configuración de instalaciones) y cada instancia puede tener los suyos (su engranaje).
// Una instancia usa los globales en todo lo que el jugador no cambió en su engranaje.
const parseMem = (v, fallbackMb) => {
  const m = /^(\d+(?:\.\d+)?)\s*([GM])$/i.exec(String(v || "").trim());
  return m ? Math.round(Number(m[1]) * (m[2].toUpperCase() === "G" ? 1024 : 1)) : fallbackMb;
};
const systemMb = () => Math.floor(os.totalmem() / 1048576);
const DEFAULT_RAM_MB = () => Math.min(parseMem(cfg.memory, 4096), systemMb());
const MIN_RAM_MB = 1024;
const clampRam = (mb) => Math.min(Math.max(mb, MIN_RAM_MB), systemMb());
const ramLimits = () => ({ minMb: MIN_RAM_MB, maxMb: systemMb() });

function readGlobal() {
  const g = store.readJson("launcher.json", {}).globalSettings || {};
  return { ramMb: Number.isInteger(g.ramMb) ? clampRam(g.ramMb) : DEFAULT_RAM_MB(), jvmArgs: typeof g.jvmArgs === "string" ? g.jvmArgs : "" };
}

// Lo que la instancia cambió por su cuenta: solo existen las claves que difieren de los globales.
function readOverride(code) {
  const s = store.readJson("settings.json", {})[String(code)] || {};
  const o = {};
  if (Number.isInteger(s.ramMb)) o.ramMb = s.ramMb;
  if (typeof s.jvmArgs === "string") o.jvmArgs = s.jvmArgs;
  if (!s.v) {   // guardado por una versión anterior (guardaba los dos campos juntos): lo que quedó igual al valor de antes no cuenta como cambio
    if (o.ramMb === DEFAULT_RAM_MB()) delete o.ramMb;
    if (o.jvmArgs === "") delete o.jvmArgs;
  }
  return o;
}

function getSettings(code) {
  const g = readGlobal(), o = readOverride(code);
  return {
    ramMb: "ramMb" in o ? clampRam(o.ramMb) : g.ramMb,
    jvmArgs: "jvmArgs" in o ? o.jvmArgs : g.jvmArgs,
    custom: { ramMb: "ramMb" in o, jvmArgs: "jvmArgs" in o },
  };
}

// Separa por espacios (respeta comillas). Cada argumento debe empezar con "-".
// -Xmx/-Xms se rechazan: la memoria se elige en su propio campo.
function parseJvmArgs(text) {
  const args = (String(text || "").match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map((a) => a.replace(/"([^"]*)"|'([^']*)'/g, "$1$2"));
  for (const a of args) {
    if (!a.startsWith("-")) return { error: `Argumento inválido: "${a}". Cada argumento debe empezar con "-" (ejemplo: -XX:+UseG1GC).` };
    if (/^-X(mx|ms)/i.test(a)) return { error: `"${a}" no se puede usar aquí: la memoria se configura en el campo de RAM.` };
    if (/^-(cp|classpath|jar)$/i.test(a) || /^--class-path/i.test(a)) return { error: `"${a}" no está permitido: lo gestiona el launcher.` };
  }
  return { args };
}

function validateSettings(ramMb, jvmArgs) {
  ramMb = Math.round(Number(ramMb));
  if (!Number.isFinite(ramMb) || ramMb < MIN_RAM_MB || ramMb > systemMb()) {
    return { error: `La memoria debe estar entre ${MIN_RAM_MB / 1024} GB y ${(systemMb() / 1024).toFixed(1)} GB (la RAM de tu equipo).` };
  }
  const p = parseJvmArgs(jvmArgs);
  if (p.error) return { error: p.error };
  return { ramMb, jvmArgs: p.args.join(" ") };
}

// Ajustes de una instancia (engranaje). "defaults" = los globales: es lo que restaura el botón Restaurar.
ipcMain.handle("settings:get", (_e, { code }) => ({ ok: true, settings: getSettings(code), defaults: readGlobal(), limits: ramLimits() }));

ipcMain.handle("settings:set", (_e, { code, ramMb, jvmArgs }) => {
  const v = validateSettings(ramMb, jvmArgs);
  if (v.error) return { ok: false, error: v.error };
  const g = readGlobal(), rec = { v: 2 };
  if (v.ramMb !== g.ramMb) rec.ramMb = v.ramMb;            // solo se guarda lo que cambia respecto a los globales
  if (v.jvmArgs !== g.jvmArgs) rec.jvmArgs = v.jvmArgs;
  const all = store.readJson("settings.json", {});
  if ("ramMb" in rec || "jvmArgs" in rec) all[String(code)] = rec; else delete all[String(code)];
  store.writeJson("settings.json", all);
  return { ok: true, settings: getSettings(code) };
});

// Ajustes globales (valen para todas las instancias que no tengan los suyos)
ipcMain.handle("globalSettings:get", () => ({ ok: true, settings: readGlobal(), defaults: { ramMb: DEFAULT_RAM_MB(), jvmArgs: "" }, limits: ramLimits() }));

ipcMain.handle("globalSettings:set", (_e, { ramMb, jvmArgs }) => {
  const v = validateSettings(ramMb, jvmArgs);
  if (v.error) return { ok: false, error: v.error };
  const all = store.readJson("launcher.json", {});
  all.globalSettings = { ramMb: v.ramMb, jvmArgs: v.jvmArgs };
  store.writeJson("launcher.json", all);
  return { ok: true, settings: readGlobal() };
});

// ---- Tema de colores y logo (se guarda en este equipo)
const readTheme = () => THEMES.sanitize(store.readJson("launcher.json", {}).theme);
function applyWindowTheme() {
  if (!win) return;
  const t = THEMES.resolve(readTheme());
  try { win.setBackgroundColor(t.colors.bg); } catch {}
  try { win.setIcon(nativeImage.createFromPath(path.join(__dirname, "renderer", "logos", THEMES.LOGOS[t.logo].file))); } catch {}
}
ipcMain.on("theme:boot", (e) => { e.returnValue = readTheme(); });   // lectura síncrona: el tema se aplica antes del primer dibujo
ipcMain.handle("theme:set", (_e, saved) => {
  const clean = THEMES.sanitize(saved);
  const all = store.readJson("launcher.json", {});
  all.theme = clean; store.writeJson("launcher.json", all);
  applyWindowTheme();
  return { ok: true, theme: clean };
});

// ---- Foto de perfil: la imagen se recorta al centro (cuadrada), se reduce a 256x256 y se envía como PNG
ipcMain.handle("avatar:pick", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Elige tu foto de perfil", properties: ["openFile"], filters: [{ name: "Imágenes", extensions: ["png", "jpg", "jpeg"] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: true, canceled: true };
  return { ok: true, path: r.filePaths[0], name: path.basename(r.filePaths[0]) };
});
ipcMain.handle("avatar:set", async (_e, { path: p }) => {
  try {
    if (typeof p !== "string" || !fs.statSync(p).isFile()) return { ok: false, error: "No se encontró el archivo." };
    if (fs.statSync(p).size > 20 * 1024 * 1024) return { ok: false, error: "La imagen pesa demasiado (máximo 20 MB)." };
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return { ok: false, error: "No se pudo leer la imagen. Usa un archivo PNG o JPG." };
    const { width, height } = img.getSize(), s = Math.min(width, height);
    const square = img.crop({ x: Math.floor((width - s) / 2), y: Math.floor((height - s) / 2), width: s, height: s });
    const png = square.resize({ width: 256, height: 256, quality: "best" }).toPNG();
    const r = await api.call("avatar", { method: "POST", body: { action: "set", image: png.toString("base64") } });
    return { ok: true, avatar_v: r.avatar_v, image: png.toString("base64") };
  } catch (e) { return fail(e); }
});
ipcMain.handle("avatar:get", async (_e, { id }) => {
  try { const r = await api.call("avatar", { method: "POST", body: { action: "get", id } }); return { ok: true, image: r.image, avatar_v: r.avatar_v }; } catch (e) { return fail(e); }
});
// La foto de cada cuenta guardada se recuerda en este equipo para mostrarla en la pantalla de inicio de sesión
ipcMain.handle("accounts:setAvatar", (_e, { id, dataUrl }) => {
  const a = readAcc(), x = a.list.find((y) => y.id === id);
  if (!x) return { ok: false };
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/png;base64,") && dataUrl.length < 120000) x.avatar = dataUrl; else delete x.avatar;
  writeAcc(a); return { ok: true };
});

// ---- Solicitar cuenta / restaurar cuenta (desde el inicio de sesión: todavía no hay sesión)
ipcMain.handle("request:account", async (_e, { kind, username, discord }) => {
  try { return { ok: true, ...(await api.call("requests", { method: "POST", body: { kind, username, discord } })) }; } catch (e) { return fail(e); }
});
ipcMain.handle("app:version", () => app.getVersion());

// ---- Inicio: usuarios conectados e instancia destacada
ipcMain.handle("presence", async () => {
  try { return { ok: true, ...(await api.call("presence", { method: "POST", body: { action: "ping" } })) }; } catch (e) { return fail(e); }
});
ipcMain.handle("featured:set", async (_e, { code }) => {
  try { return { ok: true, ...(await api.call("featured", { method: "POST", body: { code } })) }; } catch (e) { return fail(e); }
});

// ---- Contacto a los administradores (el backend comprueba el rol en cada llamada)
ipcMain.handle("support", async (_e, body) => {
  try { return { ok: true, ...(await api.call("support", { method: "POST", body })) }; } catch (e) { return fail(e); }
});

// ---- Consola de Minecraft: la salida del juego se guarda en memoria (últimas líneas) y se envía en vivo a la interfaz
const GLOG_MAX = 5000;
let glog = { code: null, lines: [], dropped: 0, pend: "", queue: [], timer: null, pendTimer: null };
function glogStart(code) {
  clearTimeout(glog.timer); clearTimeout(glog.pendTimer);
  glog = { code: Number(code), lines: [], dropped: 0, pend: "", queue: [], timer: null, pendTimer: null };
}
function glogFlush() {
  const g = glog; g.timer = null;
  if (!g.queue.length) return;
  const lines = g.queue; g.queue = [];
  send("game-log", { code: g.code, from: g.dropped + g.lines.length - lines.length, lines });   // from = posición absoluta de la primera línea
}
function glogPush(g, k, list) {
  for (const s of list) { const l = { k, s }; g.lines.push(l); g.queue.push(l); }
  if (g.lines.length > GLOG_MAX) { const n = g.lines.length - GLOG_MAX; g.lines.splice(0, n); g.dropped += n; }
  if (!g.timer) g.timer = setTimeout(glogFlush, 120);   // se envían en lotes para no saturar la interfaz
}
function glogAdd(k, text) {
  const g = glog; if (g.code === null) return;
  if (k === "l") { const p = text.split(/\r?\n/); if (p[p.length - 1] === "") p.pop(); return glogPush(g, "l", p); }
  const p = (g.pend + text).split(/\r?\n/);
  g.pend = p.pop();                       // lo último puede ser una línea a medias: espera al resto
  clearTimeout(g.pendTimer);
  if (g.pend) g.pendTimer = setTimeout(() => { const r = g.pend; g.pend = ""; if (r) glogPush(g, "g", [r]); }, 500);
  if (p.length) glogPush(g, "g", p);
}
function glogEnd() {
  const g = glog; clearTimeout(g.pendTimer);
  if (g.pend) { glogPush(g, "g", [g.pend]); g.pend = ""; }
  clearTimeout(g.timer); glogFlush();
  send("game-log", { code: g.code, from: g.dropped + g.lines.length, lines: [], ended: true });
}

// Lo que ve el botón de consola: la sesión en curso, la última sesión, o (si no hay) logs/latest.log de la instancia
ipcMain.handle("game:log", (_e, { code }) => {
  const n = Number(code);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: "Instancia inválida." };
  if (glog.code === n) return { ok: true, state: playing && playingCode === n ? "live" : "last", lines: glog.lines, next: glog.dropped + glog.lines.length };
  try {
    const f = path.join(store.instancesDir(), String(n), "logs", "latest.log");
    const size = fs.statSync(f).size, MAX = 512 * 1024, fd = fs.openSync(f, "r");
    const buf = Buffer.alloc(Math.min(size, MAX));
    try { fs.readSync(fd, buf, 0, buf.length, size - buf.length); } finally { fs.closeSync(fd); }
    let lines = buf.toString("utf8").split(/\r?\n/);
    if (size > MAX) lines.shift();         // la primera línea quedó cortada
    if (lines[lines.length - 1] === "") lines.pop();
    lines = lines.slice(-GLOG_MAX);
    return { ok: true, state: "file", lines: lines.map((s) => ({ k: "g", s })), next: lines.length };
  } catch { return { ok: true, state: "none", lines: [], next: 0 }; }
});

// ---- Registro de cambios del modpack: cambiosModpack.md (va en la raíz del zip y queda en la carpeta de la instancia)
const CHANGELOG_FILE = "cambiosmodpack.md";
const findChangelog = (dir) => { try { return fs.readdirSync(dir).find((f) => f.toLowerCase() === CHANGELOG_FILE); } catch { return null; } };

// Al actualizar, el archivo de la versión anterior no se borra solo: si el modpack nuevo no trae el suyo, no debe verse el viejo.
function dropStaleChangelog(code, since) {
  try {
    const dir = path.join(store.instancesDir(), String(code)), f = findChangelog(dir);
    if (f && fs.statSync(path.join(dir, f)).mtimeMs < since - 2000) fs.rmSync(path.join(dir, f), { force: true });
  } catch {}
}

ipcMain.handle("instance:changelog", (_e, { code }) => {
  const n = Number(code);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: "Instancia inválida." };
  const dir = path.join(store.instancesDir(), String(n));
  if (!fs.existsSync(dir)) return { ok: true, state: "notInstalled" };
  const f = findChangelog(dir);
  if (!f) return { ok: true, state: "missing" };
  try {
    const file = path.join(dir, f);
    if (!fs.statSync(file).isFile()) return { ok: true, state: "missing" };
    const MAX = 512 * 1024;
    const buf = fs.readFileSync(file), text = buf.subarray(0, MAX).toString("utf8").replace(/^\uFEFF/, "");
    return text.trim() ? { ok: true, state: "ok", text, truncated: buf.length > MAX } : { ok: true, state: "missing" };
  } catch (e) { return fail(e); }
});

// Registro de cambios guardado en GitHub (no hace falta tener la instancia instalada)
ipcMain.handle("changelog:get", async (_e, { versionId }) => {
  try { return { ok: true, ...(await api.call("changelog", { method: "POST", body: { versionId } })) }; } catch (e) { return fail(e); }
});

// Los enlaces del registro de cambios se abren en el navegador (solo http/https)
ipcMain.handle("app:openUrl", async (_e, url) => {
  try { const u = new URL(String(url)); if (u.protocol === "https:" || u.protocol === "http:") await shell.openExternal(u.href); } catch {}
  return { ok: true };
});

// ---- Catálogo e instalación
// Quita del equipo lo que ya no existe en el servidor (instancia borrada por un moderador).
// Solo actúa si el servidor envió la lista completa de códigos ("existing"), y nunca sobre la instancia en ejecución.
function cleanupDeleted(existing) {
  const installed = store.readJson("installed.json", {});
  const settings = store.readJson("settings.json", {});
  let changedI = false, changedS = false;
  for (const code of new Set([...Object.keys(installed), ...Object.keys(settings)])) {
    if (existing.includes(Number(code))) continue;
    if (playing && String(playingCode) === String(code)) continue;
    game.removeInstance(code);
    if (code in installed) { delete installed[code]; changedI = true; }
    if (code in settings) { delete settings[code]; changedS = true; }
  }
  if (changedI) store.writeJson("installed.json", installed);
  if (changedS) store.writeJson("settings.json", settings);
}

ipcMain.handle("catalog", async () => {
  try {
    const c = await api.call("catalog");
    if (Array.isArray(c.existing) && !installing) cleanupDeleted(c.existing);
    // Solo cuenta como instalada si los archivos siguen en el disco
    const installed = store.readJson("installed.json", {});
    for (const code of Object.keys(installed)) if (!installing && !game.hasMods(code)) delete installed[code];
    return { ok: true, instances: c.instances, featured: c.featured || null, installed, playing: playing ? playingCode : null };
  } catch (e) { return fail(e); }
});

// ---- Carpeta donde se instalan las instancias (la elige el jugador)
const numericDirs = (d) => {
  try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name); } catch { return []; }
};
const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();   // Windows no distingue mayúsculas
const inside = (child, parent) => { const r = path.relative(parent, child); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };

ipcMain.handle("instances:get", () => {
  const dir = store.instancesDir(), def = store.defaultInstancesDir();
  return { ok: true, dir, defaultDir: def, isDefault: sameDir(dir, def), existing: numericDirs(dir).length };
});

// El jugador elige una carpeta; dentro se crea (si hace falta) una subcarpeta "instances".
ipcMain.handle("instances:pick", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Elige dónde instalar las instancias", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return { ok: true, canceled: true };
  const picked = r.filePaths[0];
  return { ok: true, target: path.basename(picked).toLowerCase() === "instances" ? picked : path.join(picked, "instances") };
});

// target = carpeta nueva (null = volver a la predeterminada). move = mover las instancias ya instaladas.
ipcMain.handle("instances:set", async (_e, { target, move }) => {
  if (playing) return { ok: false, error: "Cierra Minecraft antes de cambiar la carpeta." };
  if (installing) return { ok: false, error: "Espera a que termine la instalación antes de cambiar la carpeta." };
  try {
    const cur = store.instancesDir(), def = store.defaultInstancesDir();
    const dest = target ? path.resolve(String(target)) : def;
    if (sameDir(cur, dest)) throw new Error("Esa ya es la carpeta actual.");
    if (inside(dest, cur) || inside(cur, dest)) throw new Error("La carpeta nueva no puede estar dentro de la actual, ni al revés.");
    fs.mkdirSync(dest, { recursive: true });
    const probe = path.join(dest, ".3am-prueba"); fs.writeFileSync(probe, "ok"); fs.rmSync(probe, { force: true });

    // 1) copiar (si algo falla se borran las copias y no se toca nada de lo original)
    const copied = [], skipped = [];
    if (move) {
      try {
        for (const code of numericDirs(cur)) {
          const to = path.join(dest, code);
          if (fs.existsSync(to)) { skipped.push(code); continue; }
          copied.push(code);
          await fs.promises.cp(path.join(cur, code), to, { recursive: true });
        }
      } catch (e) {
        for (const code of copied) fs.rmSync(path.join(dest, code), { recursive: true, force: true });
        throw new Error("No se pudieron copiar las instancias (¿falta espacio en el disco?): " + e.message);
      }
    }
    // 2) guardar la carpeta nueva  3) borrar los originales
    store.setInstancesDir(sameDir(dest, def) ? null : dest);
    for (const code of copied) await fs.promises.rm(path.join(cur, code), { recursive: true, force: true }).catch(() => {});
    return { ok: true, dir: dest, moved: copied.length, skipped };
  } catch (e) { return fail(e); }
});

// Abre en el explorador la carpeta donde están instaladas ahora todas las instancias
ipcMain.handle("instances:open", async () => {
  const dir = store.instancesDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const err = await shell.openPath(dir);
  return err ? { ok: false, error: err } : { ok: true };
});

// Abre la carpeta de la instancia (mods, config, logs, crash-reports...) en el explorador
ipcMain.handle("instance:openFolder", async (_e, { code }) => {
  const n = Number(code);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: "Instancia inválida." };
  const dir = path.join(store.instancesDir(), String(n));
  if (!fs.existsSync(dir)) return { ok: false, error: "Esta instancia aún no está instalada." };
  const err = await shell.openPath(dir);
  return err ? { ok: false, error: err } : { ok: true };
});

ipcMain.handle("instance:banner", (_e, { code }) => game.readBanner(code));

// Prioridad: loader elegido al crear la instancia > manifest.json del zip > config.json
async function prepareRuntime(code, meta, st) {
  const man = game.readManifest(code);
  const m = meta || {};
  const loader = m.loader || (man.fabric && !man.neoforge ? "fabric" : "neoforge");
  const mc = m.mc_version || man.minecraft || cfg.minecraft;
  let lv = m.loader_version || (loader === "fabric" ? man.fabric : man.neoforge || cfg.neoforge);
  if (!lv && loader === "fabric") lv = await loaders.latestFabricLoader();

  const javaw = await game.ensureJavaFor(await game.javaMajorFor(mc), st);
  const versionIdLoader = await game.ensureLoader({ loader, mc, loaderVersion: lv, javaw, status: st });
  return { loader, mc, lv, javaw, versionIdLoader };
}

// Instala o actualiza el modpack (también sirve para bajar una versión anterior).
ipcMain.handle("instance:install", async (_e, { code, name, versionId, version, revision, meta }) => {
  if (!me) return { ok: false, error: "Inicia sesión primero." };
  if (playing) return { ok: false, error: "Cierra Minecraft antes de instalar o actualizar." };
  if (installing) return { ok: false, error: "Ya hay una instalación en curso." };
  installing = true;
  presence.installing(name || `instancia ${code}`);
  const st = (msg, pct) => send("status", { msg, pct });
  try {
    const info = await api.call("download", { query: { id: versionId } });
    const startedAt = Date.now();
    await game.installInstance(code, info, st);
    dropStaleChangelog(code, startedAt);
    const installed = store.readJson("installed.json", {});
    installed[code] = { versionId, version, revision: revision || 0 };
    store.writeJson("installed.json", installed);
    // Deja listo Java y el loader para que "Jugar" abra el juego de inmediato.
    // Si esto falla, el modpack ya quedó instalado y "Jugar" lo reintenta.
    try { await prepareRuntime(code, meta, st); }
    catch (e) { return { ok: true, warning: `El modpack se instaló, pero no se pudo preparar Minecraft todavía: ${e.message}` }; }
    return { ok: true };
  } catch (e) { return fail(e); }
  finally { installing = false; if (!playing) presence.menu(); }
});

ipcMain.handle("play", async (_e, { code, name, meta }) => {
  if (!me) return { ok: false, error: "Inicia sesión primero." };
  if (playing) return { ok: false, error: "Ya hay una instancia en ejecución." };
  if (installing) return { ok: false, error: "Espera a que termine la instalación." };
  const installed = store.readJson("installed.json", {});
  if (!installed[code] || !game.hasMods(code)) return { ok: false, error: "Esta instancia no tiene ninguna versión instalada." };
  playing = true; playingCode = code; glogStart(code);
  const st = (msg, pct) => send("status", { msg, pct });
  try {
    const rt = await prepareRuntime(code, meta, st);
    const s = getSettings(code);
    const extra = parseJvmArgs(s.jvmArgs);
    if (extra.error) throw new Error("Argumentos de la JVM inválidos. Revisa los ajustes de la instancia o los globales (Opciones). " + extra.error);

    st("Iniciando Minecraft", null);
    const proc = await game.launch({
      code, mc: rt.mc, nf: rt.lv, loader: rt.loader, versionId: rt.versionIdLoader, javaw: rt.javaw, user: me.name,
      memory: `${s.ramMb}M`, minMemory: `${Math.min(2048, s.ramMb)}M`, extraJvmArgs: extra.args,
      onLog: glogAdd,
      onClose: () => { glogEnd(); playing = false; playingCode = null; presence.menu(); send("status", { msg: "", pct: null, done: true }); },
    });
    if (proc) presence.playing({ name: name || `instancia ${code}`, mc: rt.mc, loader: rt.loader });
    if (!proc) throw new Error("No se pudo iniciar el juego. Revisa logs/latest.log dentro de la carpeta de la instancia.");
    return { ok: true };
  } catch (e) {
    playing = false; playingCode = null;
    return fail(e);
  }
});

// ---- Versiones disponibles de cada loader (para el formulario de nueva instancia)
ipcMain.handle("loaders:list", async () => {
  try { return { ok: true, ...(await loaders.listAll()), defaults: { mc: cfg.minecraft, loader: "neoforge" } }; }
  catch (e) { return fail(e); }
});

// ---- Administración (el backend vuelve a comprobar el rol en cada llamada)
ipcMain.handle("admin:hasToken", () => !!store.loadSecret("gh-token"));
ipcMain.handle("admin:setToken", (_e, t) => { store.saveSecret("gh-token", String(t).trim()); return true; });
// Registro de cambios (opcional): cambiosModpack.md se sube como asset secundario del release de GitHub
const CHANGELOG_MAX = 512 * 1024, MD_TYPE = "text/markdown; charset=utf-8";
function checkChangelogFile(p) {
  if (!/\.md$/i.test(p)) throw new Error("El registro de cambios debe ser un archivo .md.");
  const st = fs.statSync(p);
  if (!st.isFile() || st.size === 0) throw new Error("El archivo del registro de cambios está vacío o no existe.");
  if (st.size > CHANGELOG_MAX) throw new Error("El registro de cambios pesa demasiado (máximo 512 KB).");
  return p;
}
ipcMain.handle("admin:pick", async (_e, a) => {
  const md = !!(a && a.kind === "md");
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [md ? { name: "Registro de cambios (.md)", extensions: ["md"] } : { name: "Modpack (.zip)", extensions: ["zip"] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("admin:check", (_e, b) => api.call("publish", { method: "POST", body: { ...b, check: true } }).catch((e) => ({ error: e.message })));

ipcMain.handle("admin:publish", async (_e, { name, code, version, file, changelogFile, loader, mcVersion, loaderVersion }) => {
  const st = (msg, pct) => send("admin-status", { msg, pct });
  try {
    if (!me || me.role !== "moderator") throw new Error("Solo los moderadores pueden subir instancias.");
    const token = store.loadSecret("gh-token");
    if (!token) throw new Error("Falta el token de GitHub.");

    if (changelogFile) checkChangelogFile(changelogFile);
    const chk = await api.call("publish", { method: "POST", body: { name, code, version, check: true } });
    if (chk.versionExists) throw new Error("Esa versión ya existe en esta instancia.");
    if (!chk.exists && !(loader && mcVersion && loaderVersion)) throw new Error("Elige el loader, la versión de Minecraft y la versión del loader para la instancia nueva.");

    st("Calculando huella SHA-256", null);
    const sha256 = await gh.sha256File(file);
    const size = fs.statSync(file).size;

    const tag = `inst-${code}-${version.replace(/\s+/g, "-")}`;
    const rel = await gh.createRelease(token, tag, `${chk.name || name} ${version}`, version.startsWith("testing"));
    let changelogAssetId = null;
    if (changelogFile) {   // primero el archivo pequeño: si falla, se limpia el release y no queda nada a medias
      st("Subiendo el registro de cambios", null);
      try { changelogAssetId = (await gh.uploadAsset(token, rel.id, changelogFile, () => {}, "cambiosModpack.md", MD_TYPE)).id; }
      catch (e) { await gh.deleteRelease(token, tag).catch(() => {}); throw new Error(`No se pudo subir el registro de cambios: ${e.message}`); }
    }
    const asset = await gh.uploadAsset(token, rel.id, file, (p) => st("Subiendo a GitHub", p));

    st("Registrando versión", null);
    const res = await api.call("publish", { method: "POST", body: { name, code, version, assetId: asset.id, changelogAssetId, sha256, size, loader, mcVersion, loaderVersion } });
    return { ok: true, ...res };
  } catch (e) { return fail(e); }
});

// ---- Modificar / borrar instancias y versiones (solo moderadores; el backend lo comprueba de nuevo)
const needMod = () => {
  if (!me || me.role !== "moderator") throw new Error("Solo los moderadores pueden hacer esto.");
  const token = store.loadSecret("gh-token");
  if (!token) throw new Error("Falta el token de GitHub. Pégalo en \"Subir instancia\".");
  return token;
};

ipcMain.handle("admin:modify", async (_e, { code, versionId, version, loaderVersion, file, changelogFile }) => {
  const st = (msg, pct) => send("admin-status", { msg, pct });
  try {
    const token = needMod();
    if (changelogFile) checkChangelogFile(changelogFile);
    const body = { action: "modify", code, versionId };
    if (loaderVersion) body.loaderVersion = loaderVersion;
    let uploaded = null, uploadedMd = null;
    const cleanup = async () => {
      if (uploaded) await gh.deleteAsset(token, uploaded.id).catch(() => {});
      if (uploadedMd) await gh.deleteAsset(token, uploadedMd.id).catch(() => {});
    };
    try {
      if (file || changelogFile) {
        const rel = await gh.getReleaseByTag(token, gh.tagFor(code, version));
        if (!rel) throw new Error(`No se encontró el release ${gh.tagFor(code, version)} en GitHub.`);
        // Los archivos nuevos se suben con otro nombre y los viejos se borran solo cuando todo salió bien.
        if (changelogFile) {
          st("Subiendo el registro de cambios", null);
          uploadedMd = await gh.uploadAsset(token, rel.id, changelogFile, () => {}, `cambiosModpack-${Date.now()}.md`, MD_TYPE);
          body.changelogAssetId = uploadedMd.id;
        }
        if (file) {
          st("Calculando huella SHA-256", null);
          body.sha256 = await gh.sha256File(file);
          body.size = fs.statSync(file).size;
          uploaded = await gh.uploadAsset(token, rel.id, file, (p) => st("Subiendo a GitHub", p), `modpack-${Date.now()}.zip`);
          body.assetId = uploaded.id;
        }
      }
      st("Guardando cambios", null);
      var res = await api.call("manage", { method: "POST", body });
    } catch (e) { await cleanup(); throw e; }
    let warning = null;
    if (res.oldAssetId) await gh.deleteAsset(token, res.oldAssetId).catch(() => { warning = "Se guardó el cambio, pero no se pudo borrar el archivo anterior de GitHub."; });
    if (res.oldChangelogAssetId) await gh.deleteAsset(token, res.oldChangelogAssetId).catch(() => { warning = warning || "Se guardó el cambio, pero no se pudo borrar el registro de cambios anterior de GitHub."; });
    return { ok: true, ...res, warning };
  } catch (e) { return fail(e); }
});

ipcMain.handle("admin:deleteVersion", async (_e, { code, versionId }) => {
  try {
    const token = needMod();
    const res = await api.call("manage", { method: "POST", body: { action: "deleteVersion", code, versionId } });
    let warning = null;
    try { await gh.deleteRelease(token, gh.tagFor(code, res.version)); }
    catch (e) { warning = `La versión se borró del sistema, pero no se pudo limpiar GitHub: ${e.message}`; }
    return { ok: true, ...res, warning };
  } catch (e) { return fail(e); }
});

ipcMain.handle("admin:deleteInstance", async (_e, { code }) => {
  try {
    const token = needMod();
    if (playing && String(playingCode) === String(code)) throw new Error("Cierra Minecraft antes de borrar esta instancia.");
    const res = await api.call("manage", { method: "POST", body: { action: "deleteInstance", code } });
    const failed = [];
    for (const v of res.versions || []) {
      try { await gh.deleteRelease(token, gh.tagFor(code, v.version)); } catch { failed.push(v.version); }
    }
    // Rastro local de este equipo (los demás equipos se limpian solos al actualizar el catálogo)
    const installed = store.readJson("installed.json", {}); delete installed[code]; store.writeJson("installed.json", installed);
    const settings = store.readJson("settings.json", {}); delete settings[code]; store.writeJson("settings.json", settings);
    game.removeInstance(code);
    return { ok: true, name: res.name, warning: failed.length ? `No se pudo limpiar GitHub para: ${failed.join(", ")}.` : null };
  } catch (e) { return fail(e); }
});

function createWindow() {
  const theme = THEMES.resolve(readTheme());
  win = new BrowserWindow({
    width: 1040, height: 700, minWidth: 860, minHeight: 600,
    title: "3AM Studios Launcher", icon: path.join(__dirname, "renderer", "logos", THEMES.LOGOS[theme.logo].file),
    autoHideMenuBar: true, backgroundColor: theme.colors.bg,
    // Barra de título propia (negra, con el logo); Windows dibuja solo los botones minimizar/maximizar/cerrar.
    titleBarStyle: "hidden", titleBarOverlay: { color: "#000000", symbolColor: "#ffffff", height: 32 },
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.setAppUserModelId("com.eventos.launcher");
app.whenReady().then(() => { createWindow(); presence.start(cfg.discordClientId); });
app.on("before-quit", () => { presence.stop(); leavePresence(); });
app.on("window-all-closed", () => app.quit());