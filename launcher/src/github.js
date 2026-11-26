// CONFIGURACION Y DEPENDENCIAS
const https = require("https");
const fs = require("fs");
const crypto = require("crypto");
const { githubRepo } = require("../config.json");

const H = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "launcher-eventos",
});

const API = () => `https://api.github.com/repos/${githubRepo}`;
const tagFor = (code, version) => `inst-${code}-${String(version).replace(/\s+/g, "-")}`;



// UTILIDADES DE SISTEMA
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}



// GESTION DE RELEASES Y ASSETS
async function createRelease(token, tag, name, prerelease) {
  const r = await fetch(`https://api.github.com/repos/${githubRepo}/releases`, {
    method: "POST",
    headers: { ...H(token), "Content-Type": "application/json" },
    body: JSON.stringify({ tag_name: tag, name, prerelease, body: "Modpack" }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub: ${d.message || r.status}. Revisa el token y el nombre del repositorio.`);
  return d;
}

function uploadAsset(token, releaseId, file, onProgress, name = "modpack.zip", contentType = "application/zip") {
  return new Promise((resolve, reject) => {
    const size = fs.statSync(file).size;
    const req = https.request(
      {
        method: "POST",
        hostname: "uploads.github.com",
        path: `/repos/${githubRepo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
        headers: { ...H(token), "Content-Type": contentType, "Content-Length": size },
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          if (res.statusCode >= 300) return reject(new Error(`GitHub ${res.statusCode}: ${b.slice(0, 200)}`));
          resolve(JSON.parse(b));
        });
      },
    );
    req.on("error", reject);
    let sent = 0;
    const rs = fs.createReadStream(file);
    rs.on("data", (c) => { sent += c.length; onProgress(sent / size); });
    rs.pipe(req);
  });
}

async function getReleaseByTag(token, tag) {
  const r = await fetch(`${API()}/releases/tags/${encodeURIComponent(tag)}`, { headers: H(token) });
  if (r.status === 404) return null;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub: ${d.message || r.status}. Revisa el token.`);
  return d;
}



// GESTION DE ELIMINACION
async function deleteAsset(token, assetId) {
  const r = await fetch(`${API()}/releases/assets/${assetId}`, { method: "DELETE", headers: H(token) });
  if (!r.ok && r.status !== 404) throw new Error(`GitHub ${r.status} al borrar el archivo ${assetId}`);
}

async function deleteRelease(token, tag) {
  const rel = await getReleaseByTag(token, tag);
  if (!rel) return false;
  const r = await fetch(`${API()}/releases/${rel.id}`, { method: "DELETE", headers: H(token) });
  if (!r.ok && r.status !== 404) throw new Error(`GitHub ${r.status} al borrar el release ${tag}`);
  const t = await fetch(`${API()}/git/refs/tags/${encodeURIComponent(tag)}`, { method: "DELETE", headers: H(token) });
  if (!t.ok && t.status !== 404 && t.status !== 422) throw new Error(`GitHub ${t.status} al borrar el tag ${tag}`);
  return true;
}



// EXPORTACION DE MODULO
module.exports = { sha256File, createRelease, uploadAsset, tagFor, getReleaseByTag, deleteAsset, deleteRelease };