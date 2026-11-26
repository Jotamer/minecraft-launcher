// CONFIGURACION Y DEPENDENCIAS
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { Client } = require("minecraft-launcher-core");
const { dataDir, instancesDir } = require("./store");



// UTILIDADES DE SISTEMA
const dirs = () => {
  const b = dataDir();
  return {
    shared: path.join(b, "shared"),
    runtime: path.join(b, "runtime"),
    tmp: path.join(b, "tmp"),
    instances: instancesDir(),
  };
};

const ensure = (p) => { fs.mkdirSync(p, { recursive: true }); return p; };

function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}



// GESTOR DE DESCARGAS
async function download(url, dest, onPct, expectedSha) {
  const attempts = expectedSha ? 3 : 1;
  let lastErr = null;
  const sysRoot = process.env.SystemRoot || "C:\\Windows";
  const curlPath = path.join(sysRoot, "System32", "curl.exe");

  let totalSize = 0;
  try {
    const h = await fetch(url, { method: "HEAD", redirect: "follow" });
    totalSize = Number(h.headers.get("content-length")) || 0;
  } catch (e) {}

  for (let i = 1; i <= attempts; i++) {
    try {
      if (fs.existsSync(curlPath)) {
        console.log(`[Descarga] Iniciando con curl... (Tamaño esperado: ${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
        
        await new Promise((resolve, reject) => {
          const p = spawn(curlPath, ["-L", "-s", "-S", "-o", dest, url], { windowsHide: true });
          let errLog = "";
          p.stderr.on("data", (d) => (errLog += d.toString()));
          
          const timer = setInterval(() => {
            try {
              if (fs.existsSync(dest) && totalSize > 0) {
                const current = fs.statSync(dest).size;
                if (onPct) onPct(Math.min(current / totalSize, 0.99));
              }
            } catch (e) {}
          }, 500);

          p.on("close", (code) => {
            clearInterval(timer);
            if (code === 0) resolve(); else reject(new Error(errLog));
          });
          p.on("error", (err) => {
            clearInterval(timer);
            reject(err);
          });
        });
      } else {
        console.log("[Descarga] Iniciando con fetch (curl no encontrado)...");
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Descarga fallida (${r.status})`);
        const total = Number(r.headers.get("content-length")) || 0;
        let got = 0;
        const src = Readable.fromWeb(r.body);
        src.on("data", (c) => { got += c.length; if (total && onPct) onPct(got / total); });
        await pipeline(src, fs.createWriteStream(dest));
      }

      const onDisk = fs.statSync(dest).size;
      console.log(`[Descarga completada] Archivo en disco: ${(onDisk / 1024 / 1024).toFixed(2)} MB`);
      if (onPct) onPct(1); 

      if (!expectedSha) return;

      const actual = await sha256OfFile(dest);
      if (actual === expectedSha.toLowerCase()) {
        console.log(`[Descarga] OK (${onDisk} bytes, sha256 ${actual})`);
        return;
      }
      lastErr = new Error(`El archivo descargado está dañado (SHA-256 esperado ${expectedSha.toLowerCase()}, obtenido ${actual}).`);
      console.warn(`[Descarga] intento ${i}/${attempts}: ${lastErr.message}`);
    } catch (err) {
      lastErr = err;
      console.warn(`[Descarga] intento ${i}/${attempts} falló: ${err.message}`);
    }
  }
  fs.rmSync(dest, { force: true });
  throw lastErr;
}



// BUSQUEDA DE EJECUTABLE JAVA
function findJava(root, targetExe = "javaw.exe") {
  if (!fs.existsSync(root)) return null;
  
  const quickPath = path.join(root, "bin", targetExe);
  
  if (fs.existsSync(quickPath)) return quickPath;
  const search = (dir) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = search(fullPath);
          if (found) return found;
        } else if (entry.isFile() && entry.name.toLowerCase() === targetExe.toLowerCase()) {
          return fullPath;
        }
      }
    } catch { return null; }
    return null;
  };
  return search(root);
}



// EXTRACTOR DE ARCHIVOS ZIP
async function extractZip(zipPath, destDir) {
  ensure(destDir);
  const sysRoot = process.env.SystemRoot || "C:\\Windows";
  let lastError = "";

  const sevenZip = "C:\\Program Files\\7-Zip\\7z.exe";
  if (fs.existsSync(sevenZip)) {
    try {
      console.log("[Extractor] Intentando con 7-Zip...");
      await new Promise((resolve, reject) => {
        const p = spawn(sevenZip, ["x", zipPath, `-o${destDir}`, "-y"], { windowsHide: true });
        let err = "";
        p.stderr.on("data", (d) => (err += d.toString()));
        p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(err))));
        p.on("error", reject);
      });
      return; 
    } catch (e) { lastError = e.message; console.warn("[Extractor] 7-Zip falló:", e.message); }
  }

  try {
    console.log("[Extractor] Intentando con PowerShell .NET ZipFile...");
    const psPath = path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    await new Promise((resolve, reject) => {
      const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}', '${destDir.replace(/'/g, "''")}')`;
      const ps = spawn(psPath, ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
      let stderr = "";
      ps.stderr.on("data", (d) => (stderr += d.toString()));
      ps.on("close", (c) => (c === 0 ? resolve() : reject(new Error(stderr))));
      ps.on("error", reject);
    });
    return; 
  } catch (e) { lastError = e.message; console.warn("[Extractor] PowerShell .NET falló:", e.message); }

  try {
    console.log("[Extractor] Intentando con adm-zip...");
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
    return; 
  } catch (e) {
    lastError = e.message;
    console.warn("[Extractor] adm-zip falló o no está instalado:", e.message);
  }

  throw new Error(`Todos los métodos de descompresión fallaron. Revisa si el archivo está dañado. Último error: ${lastError}`);
}



// INSTALACION DE DEPENDENCIAS CORE
async function ensureJava(status) {
  const { runtime, tmp } = dirs();
  const root = path.join(runtime, "java21");
  let j = findJava(root);
  if (j) return j;

  ensure(tmp);
  const zip = path.join(tmp, "java21.zip");
  status("Descargando Java 21", 0);

  const javaUrl = "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.4%2B7/OpenJDK21U-jre_x64_windows_hotspot_21.0.4_7.zip";
  await download(javaUrl, zip, (p) => status("Descargando Java 21", p));

  status("Instalando Java", null);
  try {
    await extractZip(zip, root);
  } catch (err) {
    throw new Error(`Error al extraer Java 21: ${err.message}`);
  } finally {
    fs.rmSync(zip, { force: true });
  }

  j = findJava(root);
  if (!j) throw new Error("No se pudo encontrar javaw.exe tras la instalación.");
  return j;
}

async function ensureNeoForge(javaw, nf, status) {
  const { shared, tmp } = dirs();
  const id = `neoforge-${nf}`;
  if (fs.existsSync(path.join(shared, "versions", id, `${id}.json`))) return id;
  ensure(shared); ensure(tmp);
  const lp = path.join(shared, "launcher_profiles.json");
  if (!fs.existsSync(lp)) fs.writeFileSync(lp, JSON.stringify({ profiles: {} }));

  const jar = path.join(tmp, `neoforge-${nf}-installer.jar`);
  status("Descargando NeoForge", 0);
  await download(`https://maven.neoforged.net/releases/net/neoforged/neoforge/${nf}/neoforge-${nf}-installer.jar`, jar, (p) => status("Descargando NeoForge", p));

  status("Instalando NeoForge (puede tardar varios minutos)", null);
  const java = javaw.replace(/javaw\.exe$/i, "java.exe");
  await new Promise((resolve, reject) => {
    const p = spawn(java, ["-jar", jar, "--installClient", shared], { windowsHide: true });
    let log = "";
    p.stdout.on("data", (d) => (log += d));
    p.stderr.on("data", (d) => (log += d));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error("Falló la instalación de NeoForge:\n" + log.slice(-600)))));
  });
  fs.rmSync(jar, { force: true });
  return id;
}



// GESTION DE INSTANCIAS Y MODPACKS
function findPackRoot(base, depth = 3) {
  if (fs.existsSync(path.join(base, "mods"))) return base;
  if (depth === 0) return null;
  let subs = [];
  try { subs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return null; }
  subs.sort((a, b) => (b.name === "overrides") - (a.name === "overrides"));
  for (const s of subs) {
    const r = findPackRoot(path.join(base, s.name), depth - 1);
    if (r) return r;
  }
  return null;
}

function listJars(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".jar")); } catch { return []; }
}

function hasMods(code) {
  return listJars(path.join(dirs().instances, String(code), "mods")).length > 0;
}

async function installInstance(code, info, status) {
  const { instances, tmp } = dirs();
  const dir = ensure(path.join(instances, String(code)));
  ensure(tmp);
  const zip = path.join(tmp, `inst-${code}.zip`);
  const staging = path.join(tmp, `inst-${code}-extract`);

  await download(info.url, zip, (p) => status("Descargando modpack", p), null);

  status("Instalando archivos", null);
  fs.rmSync(staging, { recursive: true, force: true });
  ensure(staging);

  try {
    await extractZip(zip, staging);

    const root = findPackRoot(staging);
    if (!root) {
      const top = fs.readdirSync(staging).slice(0, 15).join(", ") || "(vacío)";
      throw new Error(`El zip no contiene una carpeta "mods". Contenido en la raíz: ${top}`);
    }

    fs.rmSync(path.join(dir, "mods"), { recursive: true, force: true });
    fs.cpSync(root, dir, { recursive: true, force: true });

    const rootManifest = path.join(staging, "manifest.json");
    if (root !== staging && fs.existsSync(rootManifest) && !fs.existsSync(path.join(dir, "manifest.json"))) {
      fs.copyFileSync(rootManifest, path.join(dir, "manifest.json"));
    }

    const jars = listJars(path.join(dir, "mods"));
    console.log(`[Instalación] Raíz del modpack: ${root} | mods instalados: ${jars.length}`);
    if (jars.length === 0) throw new Error('La carpeta "mods" del modpack no contiene ningún .jar.');
  } catch (err) {
    const kept = path.join(tmp, `inst-${code}.failed.zip`);
    try { fs.rmSync(kept, { force: true }); fs.renameSync(zip, kept); } catch {}
    throw new Error(`Falló la instalación del modpack: ${err.message}`);
  } finally {
    fs.rmSync(zip, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function removeInstance(code) {
  const n = Number(code);
  if (!Number.isInteger(n) || n < 1) return;
  const { instances, tmp } = dirs();
  fs.rmSync(path.join(instances, String(n)), { recursive: true, force: true });
  fs.rmSync(path.join(tmp, `inst-${n}.failed.zip`), { force: true });
  fs.rmSync(path.join(tmp, `inst-${n}.zip`), { force: true });
  fs.rmSync(path.join(tmp, `inst-${n}-extract`), { recursive: true, force: true });
}

function readBanner(code) {
  const dir = path.join(dirs().instances, String(Number(code)));
  const types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
  for (const ext of Object.keys(types)) {
    const f = path.join(dir, `modpack-banner.${ext}`);
    try {
      if (fs.existsSync(f) && fs.statSync(f).size < 15 * 1048576) return `data:${types[ext]};base64,${fs.readFileSync(f).toString("base64")}`;
    } catch {}
  }
  return null;
}

function readManifest(code) {
  try { return JSON.parse(fs.readFileSync(path.join(dirs().instances, String(code), "manifest.json"), "utf8")); } catch { return {}; }
}

function offlineUuid(name) {
  const h = crypto.createHash("md5").update("OfflinePlayer:" + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}



// EMPIEZA CARGA DE JUEGO
function neoForgeJvmArgs(versionId, shared) {
  const jsonPath = path.join(shared, "versions", versionId, `${versionId}.json`);
  const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const libDir = path.join(shared, "libraries");

  return (json.arguments?.jvm || [])
    .filter((a) => typeof a === "string") 
    .map((a) =>
      a
        .replace(/\$\{library_directory\}/g, libDir)
        .replace(/\$\{classpath_separator\}/g, ";")
        .replace(/\$\{version_name\}/g, versionId)
    )
    .filter((a) => !a.includes("${") && a !== "-cp");
}

function launch({ code, mc, nf, loader = "neoforge", versionId, javaw, user, memory, extraJvmArgs = [], onClose, onLog }) {
  const { shared, instances } = dirs();
  const launcher = new Client();

  launcher.on("debug", (e) => { console.log("[MLC Debug]:", e); if (onLog) onLog("l", String(e)); });   
  launcher.on("data", (e) => { console.log("[MLC Data]:", e); if (onLog) onLog("g", String(e)); });      
  launcher.on("close", (c) => {
    console.log("[MLC Close]: Proceso cerrado con código:", c);
    if (onClose) onClose(c);
  });

  const uuid = offlineUuid(user);

  console.log("Iniciando lanzamiento con Javaw en:", javaw);
  console.log("Directorio de instancia:", path.join(instances, String(code)));

  const custom = versionId || `neoforge-${nf}`;
  const jvmArgs = loader === "fabric" ? [] : neoForgeJvmArgs(custom, shared);

  const performanceArgs = [
    "-XX:+UseZGC",
    "-XX:+ZGenerational",
    "-XX:+AlwaysPreTouch",
    "-XX:+DisableExplicitGC",
    "-XX:+PerfDisableSharedMem",
    "-Dforge.forceNoDataFixer=true" 
  ];

  return launcher.launch({
    authorization: {
      access_token: "0",
      client_token: "0",
      uuid,
      name: user,
      user_properties: "{}",
      meta: { type: "mojang", demo: false },
    },
    root: shared,
    javaPath: javaw,
    version: { number: mc, type: "release", custom },
    memory: { max: memory, min: memory },
    customArgs: [...jvmArgs, ...performanceArgs, ...extraJvmArgs],
    overrides: { gameDirectory: path.join(instances, String(code)) },
  });
}



// REVISA VERSION DE JAVA Y LOADERS
async function javaMajorFor(mc) {
  const local = path.join(dirs().shared, "versions", mc, `${mc}.json`);
  try { return JSON.parse(fs.readFileSync(local, "utf8")).javaVersion?.majorVersion || 8; } catch {}
  try {
    const getJson = async (u) => (await fetch(u, { signal: AbortSignal.timeout(20000) })).json();
    const man = await getJson("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json");
    const v = man.versions.find((x) => x.id === mc);
    if (!v) throw new Error("versión desconocida");
    return (await getJson(v.url)).javaVersion?.majorVersion || 8;
  } catch (e) {
    console.warn(`[Java] No se pudo consultar la versión de Java para ${mc}, se usa 21:`, e.message);
    return 21;
  }
}

async function ensureJavaFor(major, status) {
  if (major === 21) return ensureJava(status);
  const { runtime, tmp } = dirs();
  const root = path.join(runtime, `java${major}`);
  let j = findJava(root);
  if (j) return j;

  ensure(tmp);
  const zip = path.join(tmp, `java${major}.zip`);
  status(`Descargando Java ${major}`, 0);
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
  await download(url, zip, (p) => status(`Descargando Java ${major}`, p));

  status("Instalando Java", null);
  try {
    await extractZip(zip, root);
  } catch (err) {
    throw new Error(`Error al extraer Java ${major}: ${err.message}`);
  } finally {
    fs.rmSync(zip, { force: true });
  }
  j = findJava(root);
  if (!j) throw new Error(`No se pudo encontrar javaw.exe de Java ${major} tras la instalación.`);
  return j;
}

async function ensureFabric(mc, loaderVersion, status) {
  const { shared } = dirs();
  const id = `fabric-loader-${loaderVersion}-${mc}`;
  const file = path.join(shared, "versions", id, `${id}.json`);
  if (fs.existsSync(file)) return id;

  status("Descargando Fabric", null);
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Fabric no tiene el loader ${loaderVersion} para Minecraft ${mc} (respuesta ${r.status}).`);
  const profile = await r.json();
  if (profile.id !== id) throw new Error(`El perfil de Fabric trae un id inesperado: ${profile.id}`);
  ensure(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(profile, null, 2));
  return id;
}

async function ensureLoader({ loader, mc, loaderVersion, javaw, status }) {
  if (loader === "fabric") return ensureFabric(mc, loaderVersion, status);
  return ensureNeoForge(javaw, loaderVersion, status);
}



// EXPORTACION DE MODULO
module.exports = { ensureJava, ensureJavaFor, javaMajorFor, ensureFabric, ensureLoader, ensureNeoForge, installInstance, extractZip, hasMods, removeInstance, readBanner, readManifest, launch, offlineUuid, findJava };