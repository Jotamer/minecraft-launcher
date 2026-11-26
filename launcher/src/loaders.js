// CONFIGURACION Y PETICIONES
const FABRIC_META = "https://meta.fabricmc.net/v2/versions";
const NEOFORGE_API = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";

async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": "3am-launcher" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
  return r.json();
}



// UTILIDADES DE COMPARACION
function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

const nums = (v) => String(v).split("-")[0].split(".").map(Number);



// GESTION DE NEOFORGE
function neoforgeToMc(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(-.+)?$/.exec(v);
  if (!m) return null;
  const [, a, b, c, , suffix] = m;
  if (suffix && /snapshot|alpha/i.test(suffix)) return null; 
  if (Number(a) >= 26) return `${a}.${b}${Number(c) ? "." + c : ""}`;
  if (Number(a) < 20) return null;
  return `1.${a}${Number(b) ? "." + b : ""}`;
}

async function neoforgeVersions() {
  const data = await getJson(NEOFORGE_API);
  const byMc = {};
  for (const v of data.versions || []) {
    const mc = neoforgeToMc(v);
    if (!mc) continue;
    (byMc[mc] ||= []).push({ version: v, beta: v.includes("-") });
  }
  for (const mc of Object.keys(byMc)) byMc[mc].sort((x, y) => cmp(nums(y.version), nums(x.version)));
  const mcVersions = Object.keys(byMc).sort((x, y) => cmp(nums(y), nums(x)));
  return { mcVersions, byMc };
}



// GESTION DE FABRIC
async function fabricVersions() {
  const [games, loaders] = await Promise.all([getJson(`${FABRIC_META}/game`), getJson(`${FABRIC_META}/loader`)]);
  return {
    mcVersions: games.filter((g) => g.stable).map((g) => g.version),
    loaders: loaders.map((l) => ({ version: l.version, beta: !l.stable })),
  };
}

async function latestFabricLoader() {
  const l = (await fabricVersions()).loaders.find((x) => !x.beta);
  if (!l) throw new Error("No se encontró una versión estable de Fabric Loader.");
  return l.version;
}



// GESTION GENERAL Y EXPORTACION
async function listAll() {
  const out = { errors: {} };
  await Promise.all([
    neoforgeVersions().then((d) => (out.neoforge = d)).catch((e) => (out.errors.neoforge = e.message)),
    fabricVersions().then((d) => (out.fabric = d)).catch((e) => (out.errors.fabric = e.message)),
  ]);
  return out;
}

module.exports = { listAll, latestFabricLoader, neoforgeToMc };