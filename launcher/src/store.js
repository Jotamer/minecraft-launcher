// CONFIGURACION Y DEPENDENCIAS
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");



// RUTAS Y ARCHIVOS BASE
const base = () => {
  const d = app.getPath("userData");
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const file = (n) => path.join(base(), n);

const readJson = (n, fallback) => {
  try { return JSON.parse(fs.readFileSync(file(n), "utf8")); } catch { return fallback; }
};

const writeJson = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 2));



// SEGURIDAD Y SECRETOS
const saveSecret = (name, value) => fs.writeFileSync(file(name + ".bin"), safeStorage.encryptString(value));

const loadSecret = (name) => {
  try { return safeStorage.decryptString(fs.readFileSync(file(name + ".bin"))); } catch { return null; }
};

const deleteSecret = (name) => { try { fs.unlinkSync(file(name + ".bin")); } catch {} };



// GESTION DE DIRECTORIOS DE INSTANCIAS
const dataDir = () => {
  const d = path.join(base(), "data");
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const defaultInstancesDir = () => path.join(dataDir(), "instances");

const instancesDir = () => {
  const d = readJson("launcher.json", {}).instancesDir;
  if (typeof d === "string" && path.isAbsolute(d)) {
    try { fs.mkdirSync(d, { recursive: true }); return d; } catch {}
  }
  return defaultInstancesDir();
};

const setInstancesDir = (d) => {
  const s = readJson("launcher.json", {});
  if (d) s.instancesDir = d; else delete s.instancesDir;
  writeJson("launcher.json", s);
};



// EXPORTACION DE MODULO
module.exports = { readJson, writeJson, saveSecret, loadSecret, deleteSecret, dataDir, defaultInstancesDir, instancesDir, setInstancesDir };