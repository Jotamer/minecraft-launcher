// CONFIGURACION Y DEPENDENCIAS
const cfg = require("../config.json");

let session = null;
const setSession = (s) => { session = s; };



// GESTION DE PETICIONES
async function call(name, { method = "GET", body, query } = {}) {
  const url = new URL(`${cfg.functionsUrl}/${name}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(session ? { "x-session": session } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Error ${r.status}`), { status: r.status });
  return data;
}



// EXPORTACION DE MODULO
module.exports = { call, setSession };