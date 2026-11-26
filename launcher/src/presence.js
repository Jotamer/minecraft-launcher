// CONFIGURACION Y DEPENDENCIAS
let RPC = null;
try { RPC = require("discord-rpc"); } catch {}

const LARGE_IMAGE = "logo";   
let clientId = "", client = null, ready = false, stopped = true, retry = null;
let activity = null;
const appStart = new Date();
const LOADERS = { fabric: "Fabric", neoforge: "NeoForge" };



// GESTION DE CONEXION
function schedule() {
  if (stopped || retry) return;
  retry = setTimeout(() => { retry = null; connect(); }, 30000);   
}

function connect() {
  if (stopped || client || !RPC || !clientId) return;
  const c = new RPC.Client({ transport: "ipc" });
  client = c;
  const lost = () => { if (client === c) { client = null; ready = false; schedule(); } };
  c.on("ready", () => { ready = true; push(); });
  c.on("disconnected", lost);
  c.login({ clientId }).catch(() => { try { c.destroy().catch(() => {}); } catch {} lost(); });
}



// ACTUALIZACION DE ESTADO
function push() {
  if (!ready || !client || !activity) return;
  client.setActivity({ ...activity, largeImageKey: LARGE_IMAGE, largeImageText: "3AM Studios Launcher", instance: false }).catch(() => {});
}

function set(a) { activity = a; push(); }



// EXPORTACION DE MODULO
module.exports = {
  start(id) {
    clientId = String(id || "").trim(); stopped = false;
    if (!RPC || !clientId) return;
    this.menu(); connect();
  },
  menu() { set({ details: "En el launcher", state: "Eligiendo instancia", startTimestamp: appStart }); },
  installing(name) { set({ details: `Instalando ${name}`.slice(0, 120), state: "Preparando el modpack", startTimestamp: new Date() }); },
  playing({ name, mc, loader }) {
    const extra = [mc && `Minecraft ${mc}`, LOADERS[loader]].filter(Boolean).join(" · ");
    set({ details: `Jugando ${name}`.slice(0, 120), state: extra || "En partida", startTimestamp: new Date() });
  },
  stop() {
    stopped = true; clearTimeout(retry); retry = null;
    const c = client; client = null; ready = false;
    if (c) { try { c.clearActivity().catch(() => {}); c.destroy().catch(() => {}); } catch {} }
  },
};