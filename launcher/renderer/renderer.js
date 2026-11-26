// CONFIGURACION Y DEPENDENCIAS
const $ = (s) => document.querySelector(s);
Theme.paintLogos();   
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const VER = /^(testing )?\d+\.\d+\.\d+$/;
const VIEWS = ["home", "instances", "instance", "edit", "support", "inbox", "settings", "profile", "manage"];
const NAV_OF = { home: "#nav-home", instances: "#nav-inst", instance: "#nav-inst", edit: "#nav-inst", support: "#nav-support", inbox: "#nav-support", settings: "#nav-opts", profile: "#nav-profile", manage: "#nav-profile" };
const ROLES = { moderator: "Moderador", beta: "Beta Tester", player: "Jugador" };
const roleName = (r) => (r === "service" ? "Servicio de Solicitudes" : ROLES[r] || ROLES.player);
const NO_CHANGELOG = "Esta versión de la Instancia no contiene un registro de cambios, contacte a los administradores desde el menú de opciones para solicitar que lo suban a la brevedad";
const P_PLAY = { bar: "#bar", fill: "#fill", txt: "#bar-msg" };
const P_PUB = { bar: "#a-bar", fill: "#a-fill", txt: "#a-msg" };
const P_EDIT = { bar: "#a-bar-e", fill: "#a-fill-e", txt: "#e-msg" };

let me = null, instances = [], installed = {}, sel = null, picked = {}, snap = null, busy = false, file = null, mdFile = null, poll = null;
let playingCode = null, edit = null, editFile = null, editMd = null, editBusy = false;
const banners = {};   

// INTERFAZ Y NAVEGACION
function show(id) { $("#login").hidden = id !== "login"; $("#app").hidden = id !== "app"; }
async function showView(v) {
  if (v !== "settings") revertPreview();

  const currentView = VIEWS.map((x) => $("#view-" + x)).find((el) => !el.hidden);
  const nextView = $("#view-" + v);

  if (currentView === nextView) return;

  if (currentView) {
    await currentView.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.98)" }
      ],
      { duration: 150, easing: "ease-in" }
    ).finished;

    currentView.hidden = true;
  }

  VIEWS.forEach((x) => {
    if (x !== v) $("#view-" + x).hidden = true;
  });
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("on", "#" + b.id === NAV_OF[v]));

  nextView.hidden = false;
  nextView.animate(
    [
      { opacity: 0, transform: "scale(1.01)" },
      { opacity: 1, transform: "scale(1)" }
    ],
    { duration: 200, easing: "ease-out" }
  );
}

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 6000);
}

function ping(title, body) { toast(`${title}. ${body}`); try { new Notification(title, { body }); } catch {} }
function say(sel, text, bad) { const el = $(sel); if (!el) return; el.classList.remove("bad", "muted"); el.classList.add(bad ? "bad" : "muted"); el.textContent = text; }

function progress(ids, { msg, pct }) {
  const bar = $(ids.bar), fl = $(ids.fill), txt = $(ids.txt);
  if (!bar) return;
  bar.hidden = false; bar.classList.toggle("indet", pct == null);
  fl.style.width = pct == null ? "" : Math.round(pct * 100) + "%";
  txt.className = "muted"; txt.textContent = msg + (pct == null ? "…" : ` ${Math.round(pct * 100)}%`);
}

const tip = $("#tip");
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest && e.target.closest("[data-tip]");
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip; tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(e.clientX + 16, innerWidth - w - 8) + "px";
  tip.style.top = Math.min(e.clientY + 18, innerHeight - h - 8) + "px";
});
document.addEventListener("mouseleave", () => (tip.hidden = true));

// GESTION DE VENTANAS EMERGENTES (DIALOGOS CON CONTROL DE PROPAGACION)
let dlgDone = null, glogView = null, currentOverlayAnim = null;

function openDialog(html) {
  // Cancelar animaciones de cierre pendientes si se abre un subdiálogo
  if (currentOverlayAnim) {
    currentOverlayAnim.cancel();
    currentOverlayAnim = null;
  }
  
  const dPrev = dlgDone;
  dlgDone = null;
  if (dPrev) dPrev("cancel");

  const overlay = $("#overlay");
  const dialog = $("#dialog");

  dialog.innerHTML = html;
  overlay.hidden = false;
  tip.hidden = true;

  dialog.animate(
    [
      { opacity: 0, transform: "translateY(8px) scale(0.97)" },
      { opacity: 1, transform: "translateY(0) scale(1)" }
    ],
    { duration: 180, easing: "ease-out" }
  );

  return dialog;
}

async function closeDialog(val) {
  const overlay = $("#overlay");

  if (currentOverlayAnim) {
    currentOverlayAnim.cancel();
    currentOverlayAnim = null;
  }

  if (!overlay.hidden) {
    currentOverlayAnim = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
    try {
      await currentOverlayAnim.finished;
    } catch (e) {
      // Si la animación fue cancelada por la apertura inmediata de otro diálogo
      return;
    }
    currentOverlayAnim = null;
  }

  overlay.hidden = true;
  $("#dialog").innerHTML = "";
  $("#dialog").className = "";
  glogView = null;

  const d = dlgDone;
  dlgDone = null;
  if (d) d(val);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#overlay").hidden) closeDialog("cancel"); });

function ask({ title, text, detail, buttons, stack, focus }) {
  const btn = (b) => `<button class="play ${b.cls || ""}" data-k="${b.key}">${esc(b.label)}</button>`;
  const body = stack
    ? buttons.map((b) => `<div class="opt">${btn(b)}${b.desc ? `<small>${esc(b.desc)}</small>` : ""}</div>`).join("")
    : `<div class="btns">${buttons.map(btn).join("")}</div>`;
  const d = openDialog(`<h3>${esc(title)}</h3><p>${esc(text)}</p>${detail ? `<p class="muted">${esc(detail)}</p>` : ""}${body}`);
  
  setTimeout(() => {
    d.onclick = (e) => {
      e.stopPropagation();
      const b = e.target.closest("button[data-k]");
      if (b) closeDialog(b.dataset.k);
    };
  }, 0);

  const f = d.querySelector(`[data-k="${focus}"]`); if (f) f.focus();
  return new Promise((res) => (dlgDone = res));
}

// SESION Y AUTENTICACION
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const splash = {
  el: $("#splash"), fill: $("#splash-fill"), t0: Date.now(), pct: 0,
  set(p) { this.pct = Math.max(this.pct, p); this.fill.style.width = Math.round(this.pct * 100) + "%"; },
  async finish() {
    this.set(1);
    await sleep(Math.max(300, 1500 - (Date.now() - this.t0)));
    this.el.classList.add("out");
    await sleep(500); this.el.hidden = true;
  },
};

function toLogin(msg) {
  clearInterval(poll); clearInterval(presTimer); online = []; revertPreview(); me = null; snap = null; sel = null; busy = false; playingCode = null; edit = null; inboxUnread = 0; inboxSeen = null; closeDialog("cancel");
  L.logout().then(renderSaved);
  show("login"); lgShow("login");
  $("#login-err").textContent = msg || ""; $("#btn-login").disabled = false;
}

function renderSaved(r) {
  const list = (r && r.accounts) || [];
  $("#saved").hidden = !list.length;
  $("#saved-list").innerHTML = list.map((a) => `<button type="button" class="saved-row" data-id="${a.id}">${pfpHtml(a, "s28")}<b>${esc(a.name)}</b><i>•</i><small>${esc(roleName(a.role))}</small></button>`).join("");
}

$("#saved-list").onclick = async (e) => {
  const b = e.target.closest("button[data-id]"); if (!b) return;
  b.disabled = true; $("#login-err").textContent = "";
  const r = await L.switchAccount({ id: Number(b.dataset.id) });
  if (r.ok) return enter(r.me);
  $("#login-err").textContent = r.error; renderSaved(await L.accounts());
  if (r.gone) $("#l-user").value = r.username;
};

$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  $("#btn-login").disabled = true; $("#login-err").textContent = "";
  const r = await L.login({ username: $("#l-user").value.trim(), password: $("#l-pass").value });
  $("#btn-login").disabled = false;
  if (r.ok) { $("#l-pass").value = ""; return enter(r.me); }
  $("#login-err").textContent = r.error;
};

(async () => {
  L.appVersion().then((v) => { if (v) $("#app-ver").textContent = v; });
  // Solo se carga 04B_19 ("Px") en la precarga de fuentes
  await Promise.all([document.fonts ? Promise.all([document.fonts.load("12px Px")]).catch(() => {}) : 0, document.fonts ? document.fonts.ready : 0, $("#splash img").decode().catch(() => {})]);
  splash.set(0.15);
  const r = await L.autoLogin();
  splash.set(0.4);
  if (r.ok) await enter(r.me, splash);
  else { show("login"); renderSaved(r.saved); if (r.error) $("#login-err").textContent = r.error; }
  await splash.finish();
})();

async function enter(user, progress) {
  me = user;
  const mod = me.role === "moderator";
  $("#home-gear").hidden = !mod;
  inboxUnread = 0; inboxSeen = null; paintInbox(); paintSidebarPfp(); wantAvatar(me);
  show("app"); showView("home"); renderHome();
  if (progress) progress.set(0.55);
  await refresh();
  if (progress) progress.set(0.8);
  await Promise.all(instances.filter((i) => installed[i.code]).map((i) => loadBanner(i).catch(() => {})));
  if (progress) progress.set(0.95);
  clearInterval(poll); poll = setInterval(refresh, 60000);
  clearInterval(presTimer); pingPresence(); presTimer = setInterval(pingPresence, 45000);   
}

// CATALOGO DE INSTANCIAS Y DETALLES
const latest = (i) => i.instance_versions[0];
const verOf = (i, id) => i.instance_versions.find((x) => String(x.id) === String(id));

function isOutdated(i) {
  const inst = installed[i.code]; if (!inst) return false;
  const l = latest(i);
  return inst.versionId !== l.id || (inst.revision || 0) < (l.revision || 0);
}

function installState(i, v) {
  const inst = installed[i.code];
  if (!inst) return { label: "Instalar instancia", on: true };
  if (inst.versionId === v.id) {
    return (inst.revision || 0) < (v.revision || 0)
      ? { label: "Actualizar Instancia", on: true }
      : { label: "Instalar instancia", on: false, tip: "Ya tienes esta versión instalada" };
  }
  return { label: v.id > inst.versionId ? "Actualizar Instancia" : "Instalar instancia", on: true };
}

async function refresh() {
  const c = await L.catalog();
  if (!c.ok) return c.expired ? toLogin("Tu sesión expiró. Inicia sesión de nuevo.") : toast("No se pudo actualizar la lista: " + c.error);
  instances = c.instances; installed = c.installed; playingCode = c.playing; featuredCode = c.featured ? c.featured.code : null;
  notifyChanges(); renderList(); checkInbox();
  if (!$("#view-home").hidden) renderHome();
  if (!$("#view-edit").hidden && edit && !instances.some((x) => x.code === edit.code)) { sel = null; edit = null; showView("instances"); renderList(); }
  if (sel && !busy && !$("#view-instance").hidden) renderDetail();
}

function notifyChanges() {
  const now = {};
  for (const i of instances) now[i.code] = `${latest(i).id}:${latest(i).revision || 0}`;
  if (snap) for (const i of instances) {
    if (!(i.code in snap)) ping(`Nueva instancia: ${i.name}`, `Ya está disponible la versión ${latest(i).version}.`);
    else if (snap[i.code] !== now[i.code]) {
      const sameVersion = snap[i.code].split(":")[0] === String(latest(i).id);
      ping(`${i.name} se actualizó`, sameVersion ? `Se corrigió la versión ${latest(i).version}.` : `Nueva versión ${latest(i).version}.`);
    }
  }
  snap = now;
}

function badge(i) {
  return !installed[i.code] ? "Nuevo" : isOutdated(i) ? "Actualizar" : "";
}

function renderCards() {
  const mod = me && me.role === "moderator", box = $("#cards");
  if (!instances.length) { box.innerHTML = '<p class="muted">Aún no hay instancias. Pide al staff que suba una.</p>'; return; }
  box.innerHTML = instances.map((i) => {
    const key = bannerKey(i), url = key && banners[key], b = badge(i);
    return `<div class="card" role="button" tabindex="0" data-code="${i.code}">
      <div class="card-art">${url ? `<img class="cover" alt="" src="${url}">` : `<img class="ph" data-logo alt="" src="${Theme.logo}">`}</div>
      ${b ? `<span class="feat-badge">${esc(b.toUpperCase())}</span>` : ""}
      ${mod ? `<button type="button" class="px-sq card-gear" data-gear="${i.code}" data-tip="Modificar instancia" aria-label="Modificar instancia"><i data-icon="gear"></i></button>` : ""}
      <div class="card-name"><span>${esc(i.name)}</span></div></div>`;
  }).join("");
  Icons.paint(box);
  instances.forEach((i) => loadBanner(i));
}
const renderList = renderCards;   

$("#cards").onclick = (e) => {
  const g = e.target.closest("[data-gear]");
  if (g) return openEdit(Number(g.dataset.gear));
  const c = e.target.closest(".card"); if (c) openInstance(Number(c.dataset.code));
};

$("#cards").onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("card")) { e.preventDefault(); openInstance(Number(e.target.dataset.code)); } };
$("#in-gear").onclick = () => { if (sel) openEdit(sel); };

function bannerKey(i) { const n = installed[i.code]; return n ? `${i.code}:${n.versionId}:${n.revision || 0}` : null; }

function paintBanner(i) {
  const box = $("#banner-box"); if (!box) return;
  const key = bannerKey(i), url = key && banners[key];
  box.innerHTML = "";
  if (url) { const im = document.createElement("img"); im.className = "banner"; im.alt = ""; im.src = url; box.appendChild(im); }
  else { box.innerHTML = `<div class="banner ph"><img src="${Theme.logo}" data-logo alt=""></div>`; }
}

const bannerLoading = new Set();
async function loadBanner(i) {
  const key = bannerKey(i); if (!key || key in banners || bannerLoading.has(key)) return;
  bannerLoading.add(key);
  banners[key] = (await L.banner({ code: i.code })) || "";
  bannerLoading.delete(key);
  if (sel === i.code && $("#banner-box")) paintBanner(i);
  if (featuredCode === i.code && !$("#view-home").hidden) renderHome();
  if (!$("#view-instances").hidden) renderCards();
}

function renderDetail() {
  tip.hidden = true;
  const i = instances.find((x) => x.code === sel), box = $("#detail");
  if (!i) { box.innerHTML = ""; if (!$("#view-instance").hidden) goto("instances"); return; }   
  $("#in-title").textContent = i.name; $("#in-gear").hidden = !(me && me.role === "moderator");
  const v = verOf(i, picked[i.code]) || latest(i);
  const inst = installed[i.code], st = installState(i, v);
  const dis = busy ? " disabled" : "";
  const playOff = !inst;
  const instOff = !st.on;
  const live = playingCode === i.code;
  box.innerHTML = `<div class="det">
    <div id="banner-box" class="det-banner" data-code="${i.code}"></div>
    <div class="det-grid">
      <div class="det-col">
        <button id="btn-install" class="play full"${dis}${!busy && instOff ? ` aria-disabled="true" data-tip="${esc(st.tip)}"` : ""}>${esc(st.label.replace(/^Actualizar.*/i, "Actualizar"))}</button>
        <label class="vsel"><span class="vl">VERSION</span><select id="ver"${dis}>${i.instance_versions.map((x) => `<option value="${x.id}"${x.id === v.id ? " selected" : ""}>${esc(x.version)}</option>`).join("")}</select><i data-icon="chev"></i></label>
        <button id="btn-folder" class="play neutral full"${!inst ? ' aria-disabled="true" data-tip="Instala la instancia para poder abrir su carpeta"' : ' data-tip="Abrir la carpeta de la instancia (mods, logs, crash reports...)"'}><i data-icon="folder"></i><span>VER CARPETA</span></button>
      </div>
      <div class="det-col">
        <button id="btn-play" class="play full"${dis}${!busy && playOff ? ' aria-disabled="true" data-tip="Esta instancia no tiene ninguna versión instalada"' : ""}>JUGAR INSTANCIA</button>
        <button id="btn-cfg" class="play neutral full"${dis} data-tip="Ajustes: memoria RAM y argumentos de la JVM de esta instancia"><i data-icon="gear"></i><span>AJUSTES</span></button>
        <button id="btn-mclog" class="play neutral full${live ? " live" : ""}" data-tip="${live ? "Consola de Minecraft (en ejecución)" : "Consola de Minecraft (log del juego)"}"><i data-icon="terminal"></i><span>CONSOLA</span></button>
      </div>
      <div class="det-col">
        <button id="btn-log" class="play full" data-tip="Registro de cambios del modpack">CHANGELOGS</button>
        <p class="det-sub">Versión ${esc(v.version)}<br>${Math.round(v.size / 1048576)} MB${inst ? `<br>Instalada: ${esc(inst.version)}` : ""}</p>
      </div>
    </div>
    <div class="bar" id="bar" hidden><i id="fill"></i></div><p id="bar-msg" class="smsg"></p></div>`;
  Icons.paint(box);
  paintBanner(i); loadBanner(i);
  if (busy) say("#bar-msg", playingCode === i.code ? "Minecraft se está abriendo." : "");

  $("#ver").onchange = (e) => { picked[i.code] = e.target.value; renderDetail(); };
  $("#btn-cfg").onclick = () => openSettings(i);
  $("#btn-log").onclick = () => openChangelog(i);
  $("#btn-mclog").onclick = () => openGameLog(i);
  $("#btn-folder").onclick = async (e) => {
    if (e.currentTarget.getAttribute("aria-disabled") === "true") return;
    const r = await L.openFolder({ code: i.code });
    if (!r.ok) toast(r.error);
  };

  $("#btn-play").onclick = async (e) => {
    if (e.currentTarget.getAttribute("aria-disabled") === "true" || busy) return;
    if (isOutdated(i)) {
      const r = await ask({
        title: "Aviso", text: "Aviso: Estás iniciando una versión desactualizada del modpack. ¿Deseas continuar?",
        buttons: [{ key: "go", label: "Continuar" }, { key: "cancel", label: "Cancelar", cls: "neutral" }], focus: "cancel",
      });
      if (r !== "go") return;
    }
    doPlay(i);
  };
  $("#btn-install").onclick = (e) => {
    if (e.currentTarget.getAttribute("aria-disabled") === "true" || busy) return;
    doInstall(i, v);
  };
}

async function doPlay(i) {
  const inst = installed[i.code], iv = (inst && verOf(i, inst.versionId)) || latest(i);
  busy = true; renderDetail();
  const r = await L.play({ code: i.code, name: i.name, meta: { mc_version: i.mc_version, loader: i.loader, loader_version: iv.loader_version || i.loader_version } });
  if (!r.ok) {
    busy = false;
    if (r.expired) return toLogin("Tu sesión expiró. Inicia sesión de nuevo.");
    renderDetail(); say("#bar-msg", r.error, true); return;
  }
  playingCode = i.code;
  $("#bar").hidden = true; $("#bar-msg").textContent = "Minecraft se está abriendo."; refresh();
}

async function doInstall(i, v) {
  busy = true; renderDetail();
  const r = await L.install({ code: i.code, name: i.name, versionId: v.id, version: v.version, revision: v.revision || 0, meta: { mc_version: i.mc_version, loader: i.loader, loader_version: v.loader_version || i.loader_version } });
  busy = false;
  if (!r.ok) {
    if (r.expired) return toLogin("Tu sesión expiró. Inicia sesión de nuevo.");
    renderDetail(); say("#bar-msg", r.error, true); return;
  }
  delete picked[i.code];          
  await refresh(); renderDetail();
  say("#bar-msg", r.warning || `Versión ${v.version} instalada.`, !!r.warning);
}

L.onStatus((s) => {
  if (s.done) { busy = false; playingCode = null; renderDetail(); refresh(); return; }
  progress(P_PLAY, s);
});

// FUNCIONES DE CONSOLA
const GLOG_STATE = { live: "en ejecución", last: "última sesión", file: "logs/latest.log", ended: "sesión terminada" };
const logLine = (l) => {
  const s = l.s, c = l.k === "l" ? "ln-l" : /\b(ERROR|FATAL)\b|Exception|Caused by:|^\s+at\s/.test(s) ? "ln-e" : /\bWARN\b/.test(s) ? "ln-w" : "";
  return `<div${c ? ` class="${c}"` : ""}>${esc(s) || "&nbsp;"}</div>`;
};

function appendGameLog(lines) {
  const el = glogView.el, atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;   
  el.insertAdjacentHTML("beforeend", lines.map(logLine).join(""));
  for (let n = el.childElementCount - 5000; n > 0; n--) el.firstElementChild.remove();
  if (atEnd) el.scrollTop = el.scrollHeight;
}

async function openGameLog(i) {
  const r = await L.gameLog({ code: i.code });
  if (!r.ok) return toast(r.error || "No se pudo leer la consola.");
  if (r.state === "none") {
    const d = openDialog(`<h3>Consola de Minecraft</h3><p>Esta instancia todavía no se ha abierto. Cuando la inicies, aquí verás lo que escribe el juego, en vivo.</p><div class="btns"><button class="play" data-k="close">Cerrar</button></div>`);
    d.onclick = (e) => { if (e.target.closest("button[data-k]")) closeDialog("cancel"); };
    return;
  }
  const d = openDialog(`<h3>Consola de ${esc(i.name)} <small class="muted" id="gl-state">${GLOG_STATE[r.state]}</small></h3>
    <div id="gl" class="mclog" tabindex="0"></div>
    <div class="btns"><button class="play neutral" data-k="copy">Copiar todo</button><button class="play" data-k="close">Cerrar</button></div>`);
  d.classList.add("wide");
  const el = $("#gl"); glogView = { code: i.code, have: r.next, el };
  el.innerHTML = r.lines.map(logLine).join(""); el.scrollTop = el.scrollHeight;
  d.onclick = async (e) => {
    const k = e.target.closest("button[data-k]")?.dataset.k;
    if (k === "close") return closeDialog("cancel");
    if (k === "copy") {
      try { await navigator.clipboard.writeText([...el.children].map((c) => c.textContent.replace(/\u00a0/g, " ")).join("\n")); toast("Consola copiada."); }
      catch { toast("No se pudo copiar."); }
    }
  };
}
L.onGameLog((m) => {
  if (!glogView || glogView.code !== m.code) return;
  const skip = Math.max(0, glogView.have - m.from), add = m.lines.slice(skip);   
  if (add.length) appendGameLog(add);
  glogView.have = Math.max(glogView.have, m.from + m.lines.length);
  if (m.ended && $("#gl-state")) $("#gl-state").textContent = GLOG_STATE.ended;
});

// VISUALIZADOR DE REGISTRO DE CAMBIOS
const clCache = {};   
const latestPublic = (i) => i.instance_versions.filter((v) => v.channel === "stable")[0] || latest(i);

async function openChangelog(i, v) {
  v = v || verOf(i, picked[i.code]) || latest(i);
  let doc = null;
  if (v.changelog_v) {
    const key = `${v.id}:${v.changelog_v}`;
    if (!clCache[key]) {
      const r = await L.serverChangelog({ versionId: v.id });
      if (!r.ok) return r.expired ? toLogin("Tu sesión expiró. Inicia sesión de nuevo.") : toast(r.error || "No se pudo leer el registro de cambios.");
      if (r.text) clCache[key] = { text: r.text, truncated: !!r.truncated };
    }
    doc = clCache[key] || null;
  }
  const inst = installed[i.code];
  if (!doc && inst && inst.version === v.version) {
    const r = await L.changelog({ code: i.code });
    if (r.ok && r.state === "ok") doc = { text: r.text, truncated: !!r.truncated };
  }
  const body = doc
    ? `<div class="md">${Markdown.render(doc.text)}</div>${doc.truncated ? '<p class="muted">El registro es muy largo: se muestra solo el principio.</p>' : ""}`
    : `<p>${esc(NO_CHANGELOG)}</p>`;
  const d = openDialog(`<h3>Cambios de ${esc(i.name)} (${esc(v.version)})</h3>${body}<div class="btns"><button class="play" data-k="close">Cerrar</button></div>`);
  d.classList.add("wide");
  d.onclick = (e) => {
    const a = e.target.closest("a[data-href]");
    if (a) { e.preventDefault(); return L.openUrl(a.dataset.href); }
    if (e.target.closest("button[data-k]")) closeDialog("cancel");
  };
  d.querySelector("button[data-k]").focus();
}

// GESTION DE AJUSTES GLOBALES
const gbText = (mb) => `${+(mb / 1024).toFixed(2)} GB`;

function bindRam(range, num, limits, onChange) {
  const step = 256, maxMb = Math.max(limits.minMb, Math.floor(limits.maxMb / step) * step);
  range.min = num.min = limits.minMb; range.max = num.max = maxMb; range.step = num.step = step;
  const clamp = (v) => Math.min(Math.max(Math.round((Number(v) || limits.minMb) / step) * step, limits.minMb), maxMb);
  const paint = () => range.style.setProperty("--pct", (((range.value - range.min) / (range.max - range.min || 1)) * 100) + "%");
  const set = (v) => { range.value = num.value = clamp(v); paint(); if (onChange) onChange(Number(range.value)); };
  range.oninput = () => set(range.value);
  num.onchange = () => set(num.value);
  return { set, get: () => Number(range.value) };
}

const ramHint = (mb, limits) => ({
  bad: mb > limits.maxMb * 0.75,
  text: `Tu equipo tiene ${gbText(limits.maxMb)} de RAM. ` + (mb > limits.maxMb * 0.75 ? "Asignar tanta memoria puede dejar lento el sistema; deja al menos 2 GB libres." : "Deja al menos 2 GB libres para el sistema."),
});

async function openSettings(i) {
  const r = await L.getSettings({ code: i.code });
  if (!r.ok) return toast(r.error || "No se pudieron leer los ajustes.");
  const { settings, defaults, limits } = r, c = settings.custom;
  const own = [c.ramMb && "la memoria RAM", c.jvmArgs && "los argumentos de la JVM"].filter(Boolean);
  const d = openDialog(`<h3>AJUSTES DE ${esc(i.name)}</h3>
    <p class="smsg">${own.length
      ? `Esta instancia tiene valores propios para ${own.join(" y ")}. Lo demás usa los ajustes globales (Ajustes > Configuración de instalaciones).`
      : "Esta instancia usa los ajustes globales (Ajustes > Configuración de instalaciones). Lo que cambies aquí valdrá solo para ella."}</p>
    <div class="srow"><label class="sl">Argumentos JVM :</label><div class="sc"><textarea id="s-jvm" class="px-in area sm" spellcheck="false" placeholder="JVM ARGUMENTS"></textarea></div></div>
    <div class="srow"><label class="sl">Memoria RAM máxima :</label><div class="sc"><div class="ramrow"><input id="s-ram" class="px-range" type="range"><input id="s-ram-n" class="px-in num" type="number"><span class="unit">MB</span></div><p id="s-hint" class="smsg"></p></div></div>
    <p id="s-err" class="smsg bad"></p>
    <div class="btns"><button class="play neutral" data-k="cancel">Cancelar</button><button class="play neutral" data-k="reset">Usar globales</button><button class="play" data-k="save">Guardar cambios</button></div>`);
  d.classList.add("wide");
  const jvm = $("#s-jvm"), ctl = bindRam($("#s-ram"), $("#s-ram-n"), limits, (mb) => { const h = ramHint(mb, limits); $("#s-hint").className = "smsg" + (h.bad ? " bad" : ""); $("#s-hint").textContent = h.text; });
  jvm.value = settings.jvmArgs; ctl.set(settings.ramMb);
  d.onclick = async (e) => {
    const k = e.target.closest("button[data-k]")?.dataset.k; if (!k) return;
    if (k === "cancel") return closeDialog("cancel");
    if (k === "reset") { jvm.value = defaults.jvmArgs; ctl.set(defaults.ramMb); return say("#s-err", ""); }
    const w = await L.setSettings({ code: i.code, ramMb: ctl.get(), jvmArgs: jvm.value });
    if (!w.ok) return say("#s-err", w.error, true);
    closeDialog("saved"); toast("Ajustes guardados.");
  };
}

function goto(view) {
  showView(view);
  if (view === "home") renderHome();
  else if (view === "instances") renderCards();
  else if (view === "settings") openSettingsPage();
  else if (view === "profile") renderProfile();
  else if (view === "support") openSupportPage();
  else if (view === "inbox") loadInbox();
}

function openInstance(code) { sel = code; showView("instance"); renderDetail(); }

// ADMINISTRACION: CREACION DE INSTANCIAS
$("#btn-token").onclick = async () => {
  const t = $("#f-token").value.trim(); if (!t) return;
  await L.setToken(t); $("#f-token").value = ""; $("#gh-box").hidden = true;
};

$("#f-code").onchange = async () => {
  const code = Number($("#f-code").value), hint = $("#code-hint"), name = $("#f-name");
  if (!Number.isInteger(code) || code < 1) { hint.textContent = ""; return; }
  const r = await L.check({ code });
  if (r.error) { hint.textContent = r.error; return; }
  if (r.exists) {
    name.value = r.name; name.readOnly = true;
    hint.textContent = `La instancia ${code} ya existe (${r.name}). Se agregará una versión nueva.`;
    $("#loader-box").hidden = true;
    say("#loader-hint", r.loader
      ? `Esta instancia usa ${LOADER_NAMES[r.loader]} ${r.loaderVersion} para Minecraft ${r.mcVersion} (se elige solo al crearla).`
      : "Instancia anterior sin loader guardado: usa el manifest.json del zip o la configuración del launcher.");
  } else {
    name.readOnly = false; hint.textContent = `El código ${code} no existe. Se creará una instancia nueva.`;
    $("#loader-box").hidden = false; say("#loader-hint", "");
    if (!LV) loadLoaders();
  }
};

const LOADER_NAMES = { fabric: "Fabric", neoforge: "NeoForge" };
let LV = null;   
const fill = (sel, items, keep) => {
  const el = $(sel);
  el.innerHTML = items.map((x) => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join("");
  if (keep && items.some((x) => x.value === keep)) el.value = keep;
};

function renderLoaderFields() {
  if (!LV) return;
  const loader = $("#f-loader").value, d = LV[loader];
  if (!d) { fill("#f-mc", []); fill("#f-lv", []); return say("#loader-hint", `No se pudo leer la lista de ${LOADER_NAMES[loader]}: ${LV.errors[loader] || "sin datos"}`, true); }
  const prevMc = $("#f-mc").value;
  fill("#f-mc", d.mcVersions.map((v) => ({ value: v, label: v })), prevMc || LV.defaults.mc);
  renderLoaderVersions();
}

function renderLoaderVersions() {
  const loader = $("#f-loader").value, d = LV && LV[loader]; if (!d) return;
  const list = loader === "fabric" ? d.loaders : d.byMc[$("#f-mc").value] || [];
  fill("#f-lv", list.map((x) => ({ value: x.version, label: x.version + (x.beta ? " (beta)" : "") })));
  const stable = list.find((x) => !x.beta) || list[0];
  if (stable) $("#f-lv").value = stable.version;
  if (!$("#loader-box").hidden) say("#loader-hint", "");
}

async function loadLoaders() {
  if (!$("#loader-box").hidden) say("#loader-hint", "Cargando versiones disponibles…");
  const r = await L.loaders();
  if (!r.ok) return say("#loader-hint", "No se pudo leer las versiones: " + r.error, true);
  LV = r; renderLoaderFields();
  if (!r.neoforge && !r.fabric) say("#loader-hint", "No se pudo conectar con las páginas de los loaders. Revisa tu conexión.", true);
}

$("#f-loader").onchange = renderLoaderFields;
$("#f-mc").onchange = renderLoaderVersions;

function setupDrop(box, pickBtn, onPath, kind) {
  box.ondragover = (e) => { e.preventDefault(); box.classList.add("over"); };
  box.ondragleave = () => box.classList.remove("over");
  box.ondrop = (e) => { e.preventDefault(); box.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) onPath(L.pathFor(f)); };
  pickBtn.onclick = async () => { const p = await L.pick({ kind }); if (p) onPath(p); };
}
const DROP_TXT = "Arrastra aquí el archivo .zip de la instancia";

function setFile(p) {
  if (!/\.zip$/i.test(p)) return say("#a-msg", "El archivo debe ser un .zip.", true);
  file = p; $("#drop").classList.add("has"); $("#drop-txt").textContent = p.split(/[\\/]/).pop();
}
setupDrop($("#drop"), $("#btn-pick"), setFile);

const MD_TXT = "Arrastra aquí cambiosModpack.md";
function setMd(p) {
  if (!/\.md$/i.test(p)) return say("#a-msg", "El registro de cambios debe ser un archivo .md.", true);
  mdFile = p; $("#drop-md").classList.add("has"); $("#drop-md-txt").textContent = p.split(/[\\/]/).pop(); $("#btn-clear-md").hidden = false;
}

function clearMd() { mdFile = null; $("#drop-md").classList.remove("has"); $("#drop-md-txt").textContent = MD_TXT; $("#btn-clear-md").hidden = true; }
setupDrop($("#drop-md"), $("#btn-pick-md"), setMd, "md");
$("#btn-clear-md").onclick = clearMd;

L.onAdminStatus((s) => progress(!$("#view-edit").hidden ? P_EDIT : P_PUB, s));

$("#btn-publish").onclick = async () => {
  const code = Number($("#f-code").value), name = $("#f-name").value.trim(), version = $("#f-ver").value.trim();
  const fail = (m) => say("#a-msg", m, true);
  if (!Number.isInteger(code) || code < 1) return fail("El código debe ser un número entero mayor que 0.");
  if (!name) return fail("Escribe el nombre de la instancia.");
  if (!VER.test(version)) return fail('La versión debe verse como "1.1.1" o "testing 1.1.1".');
  if (!file) return fail("Arrastra un archivo .zip o elige uno.");
  const isNew = !$("#loader-box").hidden;
  const loader = $("#f-loader").value, mcVersion = $("#f-mc").value, loaderVersion = $("#f-lv").value;
  if (isNew && !(mcVersion && loaderVersion)) return fail("Elige la versión de Minecraft y la del loader (si la lista está vacía, revisa tu conexión).");
  $("#btn-publish").disabled = true; say("#a-msg", "Preparando…");
  const r = await L.publish({ name, code, version, file, changelogFile: mdFile, ...(isNew ? { loader, mcVersion, loaderVersion } : {}) });
  $("#btn-publish").disabled = false; $("#a-bar").hidden = true;
  if (!r.ok) return r.expired ? toLogin("Tu sesión expiró. Inicia sesión de nuevo.") : fail(r.error);
  say("#a-msg", r.created ? `Instancia nueva "${r.name}" publicada con la versión ${version}.` : `Versión ${version} agregada a "${r.name}".`);
  file = null; $("#drop").classList.remove("has"); $("#drop-txt").textContent = DROP_TXT; clearMd();
  $("#f-ver").value = ""; refresh();
};

// ADMINISTRACION: EDICION Y ELIMINACION DE INSTANCIAS
function openEdit(code) {
  const i = instances.find((x) => x.code === code); if (!i) return;
  sel = code; editFile = null; editMd = null; edit = { code, versionId: latest(i).id };
  showView("edit"); renderList(); renderEdit();
  say("#e-msg", ""); $("#a-bar-e").hidden = true;
  if (!LV) loadLoaders().then(() => !$("#view-edit").hidden && renderEditLoader());
}

function renderEdit() {
  const i = instances.find((x) => x.code === edit.code); if (!i) return;
  $("#e-title").textContent = i.name;
  $("#e-code").innerHTML = instances.map((x) => `<option value="${x.code}"${x.code === i.code ? " selected" : ""}>${x.code}</option>`).join("");
  $("#e-ver").innerHTML = i.instance_versions.map((x) => `<option value="${x.id}"${x.id === edit.versionId ? " selected" : ""}>${esc(x.version)}</option>`).join("");
  $("#e-drop").classList.toggle("has", !!editFile);
  $("#e-drop-txt").textContent = editFile ? editFile.split(/[\\/]/).pop() : DROP_TXT;
  const cv = verOf(i, edit.versionId);
  $("#e-drop-md").classList.toggle("has", !!editMd);
  $("#e-drop-md-txt").textContent = editMd ? editMd.split(/[\\/]/).pop() : "Arrastra aquí cambiosModpack.md (opcional)";
  $("#e-md-hint").textContent = cv && cv.changelog_v ? "Esta versión ya tiene registro de cambios: subir uno nuevo lo reemplaza. No obliga a los jugadores a reinstalar." : "Esta versión no tiene registro de cambios: puedes agregarlo aquí sin tocar el .zip.";
  Icons.paint($("#view-edit"));
  renderEditLoader();
  lockEdit();
}

function lockEdit() {
  ["#e-code", "#e-ver", "#btn-del", "#btn-mod", "#e-pick", "#e-pick-md"].forEach((q) => ($(q).disabled = editBusy));
  const i = instances.find((x) => x.code === (edit && edit.code));
  $("#e-lv").disabled = editBusy || !(i && i.loader);
}

function renderEditLoader() {
  const i = instances.find((x) => x.code === edit.code); if (!i) return;
  const v = verOf(i, edit.versionId) || latest(i), sel$ = $("#e-lv");
  if (!i.loader) {
    sel$.innerHTML = '<option value="">Sin loader guardado</option>'; sel$.disabled = true;
    return say("#e-hint", "Instancia anterior sin loader guardado: usa el manifest.json del zip o la configuración del launcher. Aquí solo puedes reemplazar el .zip.");
  }
  const cur = v.loader_version || i.loader_version;
  const d = LV && LV[i.loader];
  let list = !d ? [] : i.loader === "fabric" ? d.loaders : d.byMc[i.mc_version] || [];
  list = list.map((x) => ({ value: x.version, label: x.version + (x.beta ? " (beta)" : "") }));
  if (cur && !list.some((x) => x.value === cur)) list.unshift({ value: cur, label: cur });
  fill("#e-lv", list, cur); sel$.disabled = editBusy;
  say("#e-hint", `${LOADER_NAMES[i.loader]} para Minecraft ${i.mc_version}. Los cambios se aplican solo a la versión ${v.version}.${d ? "" : " Cargando lista de versiones del loader…"}`);
}

$("#e-code").onchange = (e) => { const i = instances.find((x) => x.code === Number(e.target.value)); if (i) openEdit(i.code); };
$("#e-ver").onchange = (e) => { edit.versionId = Number(e.target.value); renderEdit(); };
setupDrop($("#e-drop"), $("#e-pick"), (p) => {
  if (!/\.zip$/i.test(p)) return say("#e-msg", "El archivo debe ser un .zip.", true);
  editFile = p; $("#e-drop").classList.add("has"); $("#e-drop-txt").textContent = p.split(/[\\/]/).pop();
});
setupDrop($("#e-drop-md"), $("#e-pick-md"), (p) => {
  if (!/\.md$/i.test(p)) return say("#e-msg", "El registro de cambios debe ser un archivo .md.", true);
  editMd = p; $("#e-drop-md").classList.add("has"); $("#e-drop-md-txt").textContent = p.split(/[\\/]/).pop();
}, "md");

async function editAction(fn) {
  editBusy = true; lockEdit(); say("#e-msg", "");
  try { return await fn(); } finally { editBusy = false; $("#a-bar-e").hidden = true; lockEdit(); }
}

const afterGone = async (msg, warn) => {   
  edit = null; sel = null; showView("instances"); await refresh(); renderList(); toast(warn ? `${msg} ${warn}` : msg);
};

$("#btn-mod").onclick = () => editAction(async () => {
  const i = instances.find((x) => x.code === edit.code), v = i && verOf(i, edit.versionId); if (!v) return;
  const newLv = i.loader ? $("#e-lv").value : "", curLv = v.loader_version || i.loader_version;
  const lvChanged = !!newLv && newLv !== curLv;
  if (!lvChanged && !editFile && !editMd) return say("#e-msg", "No hay cambios: elige otra versión del loader, arrastra un .zip nuevo o sube un registro de cambios.", true);
  const changedMd = !!editMd;
  const r = await L.modify({ code: i.code, versionId: v.id, version: v.version, loaderVersion: lvChanged ? newLv : undefined, file: editFile, changelogFile: editMd });
  if (!r.ok) return r.expired ? toLogin("Tu sesión expiró. Inicia sesión de nuevo.") : say("#e-msg", r.error, true);
  editFile = null; editMd = null;
  await refresh(); renderEdit();
  say("#e-msg", r.warning || `Versión ${v.version} modificada.${changedMd ? " Registro de cambios actualizado." : ""}${r.replaced ? " Los jugadores que ya la tengan verán \"Actualizar Instancia\"." : ""}`, !!r.warning);
});

$("#btn-del").onclick = () => editAction(async () => {
  const i = instances.find((x) => x.code === edit.code), v = i && verOf(i, edit.versionId); if (!v) return;
  const only = i.instance_versions.length === 1;
  const r = await ask({
    title: "Borrar", text: "Confirma que deseas eliminar esta instancia o versión especificada de la instancia.",
    detail: `Instancia: ${i.name} (código ${i.code}). Versión: ${v.version}.`, stack: true, focus: "cancel",
    buttons: [
      { key: "instance", label: "BORRAR INSTANCIA", cls: "danger", desc: "Esta opción eliminará todas las versiones de la instancia y cualquier rastro de esta, tanto en el equipo del usuario como en la base de datos y en GitHub, liberando el código de la instancia para poder registrar un nuevo modpack con el código de la instancia borrada." },
      { key: "version", label: "BORRAR VERSIÓN", cls: "danger", desc: "Este botón solo eliminará la versión de la instancia especificada en la ventana anterior. Las demás versiones de la instancia se mantendrán intactas." + (only ? " Es la única versión que tiene: la instancia también se eliminará." : "") },
      { key: "cancel", label: "CANCELAR", cls: "neutral", desc: "Simplemente te devuelve a la ventana anterior sin modificar nada." },
    ],
  });
  if (r === "cancel") return;
  say("#e-msg", "Borrando…");
  if (r === "instance") {
    const w = await L.deleteInstance({ code: i.code });
    if (!w.ok) return w.expired ? toLogin("Tu sesión expiró. Inicia sesión de nuevo.") : say("#e-msg", w.error, true);
    return afterGone(`Instancia "${w.name}" eliminada. El código ${i.code} quedó libre.`, w.warning);
  }
  const w = await L.deleteVersion({ code: i.code, versionId: v.id });
  if (!w.ok) return w.expired ? toLogin("Tu sesión expiró. Inicia sesión de nuevo.") : say("#e-msg", w.error, true);
  if (w.instanceDeleted) return afterGone(`Versión ${v.version} eliminada. Era la única, así que la instancia también se eliminó.`, w.warning);
  edit.versionId = null;
  await refresh();
  const again = instances.find((x) => x.code === i.code);
  if (!again) return afterGone(`Versión ${v.version} eliminada.`, w.warning);
  edit.versionId = latest(again).id; renderEdit();
  say("#e-msg", w.warning || `Versión ${v.version} eliminada.`, !!w.warning);
});

// CARPETA DE INSTANCIAS
let dirInfo = null;

async function renderInstalls() {
  const r = await L.instancesDir();
  if (!r.ok) return say("#gs-dir-msg", r.error || "No se pudo leer la carpeta.", true);
  dirInfo = r;
  $("#gs-dir").value = r.dir;
  $("#gs-dir-reset").disabled = r.isDefault;
  say("#gs-dir-msg", `${r.isDefault ? "Es la carpeta predeterminada del launcher." : "Es una carpeta personalizada."} ${r.existing ? `Hay ${r.existing} instancia${r.existing === 1 ? "" : "s"} en ella.` : "No hay instancias instaladas en ella."}`);
}

$("#gs-dir-open").onclick = async () => { const r = await L.openInstancesFolder(); if (!r.ok) say("#gs-dir-msg", r.error, true); };

$("#gs-dir-change").onclick = async () => {
  if (!dirInfo) await renderInstalls();
  const p = await L.pickInstancesDir();
  if (p.ok && !p.canceled) confirmDir(dirInfo, p.target);
};

$("#gs-dir-reset").onclick = () => { if (dirInfo && !dirInfo.isDefault) confirmDir(dirInfo, null); };

async function confirmDir(cur, target) {
  const dest = target || cur.defaultDir;
  let move = false;
  if (cur.existing) {
    const a = await ask({
      title: "Carpeta de instancias", text: `Se usará: ${dest}`,
      detail: `Tienes ${cur.existing} instancia${cur.existing === 1 ? "" : "s"} instalada${cur.existing === 1 ? "" : "s"}. ¿Qué hacemos con ${cur.existing === 1 ? "ella" : "ellas"}?`, stack: true, focus: "move",
      buttons: [
        { key: "move", label: "MOVER INSTANCIAS", desc: "Las lleva a la carpeta nueva con sus mods, mundos y configuración, y borra las de la carpeta anterior. Puede tardar varios minutos." },
        { key: "keep", label: "SOLO CAMBIAR LA CARPETA", desc: "Las instancias de la carpeta anterior no se tocan, pero el launcher dejará de verlas y tendrás que instalarlas de nuevo." },
        { key: "cancel", label: "CANCELAR", cls: "neutral", desc: "No cambia nada." },
      ],
    });
    if (a === "cancel") return;
    move = a === "move";
  }
  openDialog(`<h3>Carpeta de instancias</h3><p>${move ? "Moviendo las instancias, no cierres el launcher…" : "Guardando…"}</p><div class="bar indet"><i></i></div>`);
  const w = await L.setInstancesDir({ target, move });
  closeDialog("done");
  if (!w.ok) { say("#gs-dir-msg", w.error, true); return toast(w.error); }
  await refresh(); renderInstalls();
  const extra = w.skipped && w.skipped.length ? ` No se movieron las instancias ${w.skipped.join(", ")} porque ya existían en la carpeta nueva.` : "";
  toast(`Carpeta actualizada. ${move ? `Se movieron ${w.moved} instancia${w.moved === 1 ? "" : "s"}.` : ""}${extra}`);
}

// GESTION DE PERFIL
function renderProfile() {
  $("#ac-name").textContent = me.name;
  $("#ac-role").textContent = roleName(me.role);
  $("#btn-modtools").hidden = me.role !== "moderator";
  $("#pf-pfp").innerHTML = pfpHtml(me, "s80");
  $("#p-cur").value = ""; $("#p-new").value = ""; say("#p-msg", ""); say("#pf-msg", "");
  pfFile = null; 
  $("#pf-pick span").textContent = "Subir imagen";
}
const renderAccount = renderProfile;

async function changeAccount(user) {
  clearInterval(poll); snap = null; sel = null; edit = null; picked = {}; busy = false;
  await enter(user); toast(`Sesión de ${user.name} iniciada.`);
}

async function openSwitcher(note, isErr) {
  const r = await L.accounts();
  const rows = (r.accounts || []).map((a) => `<div class="accrow${a.id === r.currentId ? " on" : ""}">
      ${pfpHtml(a, "s28")}<span><b>${esc(a.name)}</b> <small class="muted">${roleName(a.role)}</small></span>
      ${a.id === r.currentId ? '<em>Activa</em>' : `<button class="play sm" data-k="sw" data-id="${a.id}">Cambiar</button><button class="ghost" data-k="rm" data-id="${a.id}">Quitar</button>`}</div>`).join("");
  const d = openDialog(`<h3>Cambiar de cuenta</h3>
    <p class="muted">Cuentas guardadas en este equipo. Cambia entre ellas sin volver a escribir la contraseña.</p>
    <div class="accs">${rows}</div>
    <p id="sw-err" class="${isErr ? "bad" : "muted"}">${esc(note || "")}</p>
    <div class="btns"><button class="play neutral" data-k="logout">Cerrar sesión</button><button class="play neutral" data-k="cancel">Cerrar</button><button class="play" data-k="add">Agregar otra cuenta</button></div>`);
  
  setTimeout(() => {
    d.onclick = async (e) => {
      e.stopPropagation();
      const b = e.target.closest("button[data-k]"); if (!b) return;
      const k = b.dataset.k, id = Number(b.dataset.id);
      if (k === "logout") { closeDialog("logout"); return toLogin(); }
      if (k === "cancel") return closeDialog("cancel");
      if (k === "add") return openAddAccount();
      if (k === "rm") { await L.removeAccount({ id }); return openSwitcher(); }
      b.disabled = true;
      const w = await L.switchAccount({ id });
      if (w.ok) { closeDialog("ok"); return changeAccount(w.me); }
      if (w.gone) return openAddAccount(w.username, w.error);
      openSwitcher(w.error, true);
    };
  }, 0);
}

function openAddAccount(username, note) {
  const d = openDialog(`<h3>Agregar otra cuenta</h3>
    <p class="muted">Inicia sesión con la otra cuenta. Se quedará guardada en este equipo para cambiar de una a otra fácilmente.</p>
    <label class="sl" for="x-user">Usuario de Minecraft</label><input id="x-user" class="px-in" type="text" maxlength="16" autocomplete="username">
    <label class="sl" for="x-pass">Contraseña</label><input id="x-pass" class="px-in" type="password" autocomplete="current-password">
    <p id="x-err" class="smsg ${note ? "bad" : "muted"}">${esc(note || "")}</p>
    <div class="btns"><button class="play neutral" data-k="back">Volver</button><button class="play" data-k="go">Entrar</button></div>`);
  const u = $("#x-user"), p = $("#x-pass");
  u.value = username || "";
  const go = async () => {
    if (!u.value.trim() || !p.value) return say("#x-err", "Escribe el usuario y la contraseña.", true);
    $("#dialog button[data-k=go]").disabled = true;
    const r = await L.login({ username: u.value.trim(), password: p.value });
    if (r.ok) { closeDialog("ok"); return changeAccount(r.me); }
    $("#dialog button[data-k=go]").disabled = false; say("#x-err", r.error, true);
  };

  setTimeout(() => {
    d.onclick = (e) => {
      e.stopPropagation();
      const k = e.target.closest("button[data-k]")?.dataset.k;
      if (k === "back") openSwitcher();
      else if (k === "go") go();
    };
  }, 0);
  
  d.onkeydown = (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") go(); };
  (username ? p : u).focus();
}

$("#btn-switch").onclick = () => openSwitcher();
$("#btn-modtools").onclick = () => { showView("manage"); say("#u-msg", ""); loadUsers(); };
$("#btn-back-acc").onclick = () => goto("profile");
const rnd = () => {
  const a = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(12))].map((x) => a[x % a.length]).join("");
};
$("#btn-gen").onclick = () => { $("#u-pass").value = rnd(); };

// ADMINISTRACION DE CUENTAS
async function loadUsers() {
  const r = await L.users({ action: "list" });
  if (!r.ok) return r.expired ? toLogin("Tu sesión expiró. Inicia sesión de nuevo.") : say("#u-msg", r.error, true);
  $("#u-list").innerHTML = r.users.map((u) => `<div class="urow"><span><b>${esc(u.username)}</b> <small class="muted">${roleName(u.role)}${u.active ? "" : ", desactivada"}</small></span>
    ${u.role !== "moderator" ? `<button class="ghost" data-a="reset" data-id="${u.id}" data-n="${esc(u.username)}">Nueva contraseña</button>` : ""}
    <span class="selwrap rs"><select class="rolesel px-in" data-id="${u.id}" data-r="${u.role}" aria-label="Rol de ${esc(u.username)}" data-tip="Cambiar el rol">${Object.entries(ROLES).map(([k, n]) => `<option value="${k}"${k === u.role ? " selected" : ""}>${n}</option>`).join("")}</select><i data-icon="chev"></i></span>
    <button class="ghost" data-a="active" data-id="${u.id}" data-v="${u.active}">${u.active ? "Desactivar" : "Activar"}</button>${u.role !== "moderator" ? `<button class="ghost del" data-a="delete" data-id="${u.id}" data-n="${esc(u.username)}">Eliminar</button>` : ""}</div>`).join("");
  Icons.paint($("#u-list"));
}

$("#btn-create").onclick = async () => {
  const username = $("#u-name").value.trim(), password = $("#u-pass").value;
  if (!/^\w{3,16}$/.test(username)) return say("#u-msg", "Usuario inválido: 3 a 16 caracteres (letras, números o _).", true);
  if (password.length < 8) return say("#u-msg", "La contraseña debe tener al menos 8 caracteres.", true);
  const r = await L.users({ action: "create", username, password, role: $("#u-role").value });
  if (!r.ok) return say("#u-msg", r.error, true);
  say("#u-msg", `Cuenta creada. Usuario: ${username}. Contraseña: ${password}. Entrégasela en privado.`);
  $("#u-name").value = ""; $("#u-pass").value = ""; loadUsers();
};

$("#u-list").onchange = async (e) => {
  const sel = e.target.closest("select.rolesel"); if (!sel) return;
  const r = await L.users({ action: "setRole", id: Number(sel.dataset.id), role: sel.value });
  if (!r.ok) say("#u-msg", r.error, true);
  loadUsers();
};

$("#u-list").onclick = async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const id = Number(b.dataset.id); let r;
  if (b.dataset.a === "reset") {
    const password = rnd();
    r = await L.users({ action: "reset", id, password });
    if (r.ok) say("#u-msg", `Nueva contraseña de ${b.dataset.n}: ${password}. Cópiala ahora y entrégasela en privado.`);
  } else if (b.dataset.a === "delete") {
    const c = await ask({
      title: "Eliminar cuenta", text: `¿Eliminar la cuenta de ${b.dataset.n}?`,
      detail: "Se borra por completo y no se puede deshacer. Esa persona ya no podrá entrar al launcher; si solo quieres bloquearla un tiempo, usa \"Desactivar\".",
      buttons: [{ key: "del", label: "ELIMINAR", cls: "danger" }, { key: "cancel", label: "CANCELAR", cls: "neutral" }], focus: "cancel",
    });
    if (c !== "del") return;
    r = await L.users({ action: "delete", id });
    if (r.ok) say("#u-msg", `Cuenta de ${b.dataset.n} eliminada.`);
  } else {
    r = await L.users({ action: "setActive", id, active: b.dataset.v !== "true" });
  }
  if (!r.ok) return say("#u-msg", r.error, true);
  loadUsers();
};

$("#btn-pass").onclick = async () => {
  const current = $("#p-cur").value, newPassword = $("#p-new").value;
  if (newPassword.length < 8) return say("#p-msg", "La nueva contraseña debe tener al menos 8 caracteres.", true);
  const r = await L.users({ action: "changePassword", current, newPassword });
  if (!r.ok) return say("#p-msg", r.error, true);
  $("#p-cur").value = ""; $("#p-new").value = ""; say("#p-msg", "Contraseña actualizada.");
};

// CONFIGURACION Y AJUSTES GLOBALES
let gs = null, gsRam = null;   

async function openSettingsPage() {
  const mod = me && me.role === "moderator";
  $("#box-upload").hidden = !mod;
  openCustom();
  const [g] = await Promise.all([L.getGlobalSettings(), renderInstalls()]);
  if (g.ok) {
    gs = g;
    gsRam = gsRam || bindRam($("#gs-ram"), $("#gs-ram-n"), g.limits, (mb) => { const h = ramHint(mb, g.limits); $("#gs-ram-hint").className = "smsg" + (h.bad ? " bad" : ""); $("#gs-ram-hint").textContent = h.text; });
    $("#gs-jvm").value = g.settings.jvmArgs; gsRam.set(g.settings.ramMb);
    say("#gs-jvm-msg", "Valen para todas las instancias que no tengan los suyos (engranaje AJUSTES de cada instancia). Se aplican la próxima vez que abras el juego.");
    say("#gs-ram-msg", "");
  }
  if (mod) { $("#gh-box").hidden = await L.hasToken(); loadLoaders(); }
}

async function saveGlobal(which) {
  if (!gs) return;
  const body = { ramMb: gs.settings.ramMb, jvmArgs: gs.settings.jvmArgs };
  if (which === "jvm") body.jvmArgs = $("#gs-jvm").value; else body.ramMb = gsRam.get();
  const w = await L.setGlobalSettings(body), msg = which === "jvm" ? "#gs-jvm-msg" : "#gs-ram-msg";
  if (!w.ok) return say(msg, w.error, true);
  gs.settings = w.settings; $("#gs-jvm").value = w.settings.jvmArgs;
  say(msg, "Guardado. Se aplica la próxima vez que abras el juego.");
}

$("#gs-jvm-save").onclick = () => saveGlobal("jvm");
$("#gs-ram-save").onclick = () => saveGlobal("ram");
$("#gs-jvm-reset").onclick = () => { if (!gs) return; $("#gs-jvm").value = gs.defaults.jvmArgs; saveGlobal("jvm"); };
$("#gs-ram-reset").onclick = () => { if (!gs) return; gsRam.set(gs.defaults.ramMb); saveGlobal("ram"); };

// TEMAS VISUALES
const TH_LABELS = { bg: "Fondo", panel: "Paneles/Barra lateral", text: "Texto", line: "Líneas", accent: "Botones/Highlights", shadow: "Sombra de botones" };
let thDraft = null, thSel = "carmesi", previewing = false;    
const cloneJ = (o) => JSON.parse(JSON.stringify(o));
const savedTheme = () => THEMES.resolve(Theme.saved);

function revertPreview() {
  if (!previewing) return;
  previewing = false; Theme.apply(savedTheme());
}

function previewDraft() {
  previewing = true;
  Theme.apply({ id: "custom", name: "Personalizado", colors: thDraft.colors, logo: thDraft.logo });
  paintThemeUi(false);
}

function presetDraft(id) { const p = THEMES.PRESETS[id]; return { colors: cloneJ(p.colors), logo: p.logo }; }

function openCustom() {
  const sv = Theme.saved;
  thSel = sv.id; thDraft = sv.id === "custom" ? cloneJ(sv.custom) : presetDraft(sv.id);
  previewing = false; say("#th-msg", ""); paintThemeUi(true);
}

function paintThemeUi(full) {
  const T = THEMES;
  if (full) {
    $("#th-select").innerHTML = Object.entries(T.PRESETS).map(([id, p]) => `<option value="${id}">${esc(p.name)}</option>`).join("") + '<option value="custom">Tema personalizado</option>';
    $("#th-swatches").innerHTML = T.COLOR_KEYS.map((k) => `<label class="swatch"><input type="color" data-k="${k}"><span>${TH_LABELS[k]}</span><code></code></label>`).join("");
    $("#th-logos").innerHTML = Object.entries(T.LOGOS).map(([k, l]) => `<button type="button" class="logopick" data-k="${k}" data-tip="${esc(l.label)}" aria-label="Logo ${esc(l.label)}"><img src="${Theme.logoUrl(k)}" alt=""></button>`).join("");
  }
  $("#th-select").value = thSel;
  document.querySelectorAll("#th-swatches .swatch").forEach((l) => {
    const inp = l.querySelector("input"), v = thDraft.colors[inp.dataset.k];
    if (inp.value !== v) inp.value = v;
    l.querySelector("code").textContent = v;
  });
  document.querySelectorAll("#th-logos .logopick").forEach((b) => b.classList.toggle("on", b.dataset.k === thDraft.logo));
  $("#th-warn").textContent = Theme.warnings(thDraft.colors).join(" ");
}

async function saveTheme(saved) {
  const r = await L.setTheme(saved);
  if (!r.ok) return false;
  previewing = false; Theme.saved = r.theme; Theme.apply(savedTheme());
  return true;
}

$("#th-select").onchange = (e) => { thSel = e.target.value; thDraft = thSel === "custom" ? cloneJ(Theme.saved.custom) : presetDraft(thSel); previewDraft(); };
$("#th-swatches").oninput = (e) => {
  const k = e.target.dataset && e.target.dataset.k; if (!k) return;
  thDraft.colors[k] = e.target.value.toLowerCase(); thSel = "custom"; previewDraft();   
};
$("#th-logos").onclick = (e) => {
  const b = e.target.closest(".logopick"); if (!b) return;
  thDraft.logo = b.dataset.k; thSel = "custom"; previewDraft();
};
$("#th-save").onclick = async () => {
  const ok = await saveTheme(thSel === "custom" ? { id: "custom", custom: thDraft } : { id: thSel, custom: Theme.saved.custom });
  if (!ok) return say("#th-msg", "No se pudo guardar el tema.", true);
  say("#th-msg", "Tema guardado y aplicado.");
};
$("#th-reset").onclick = () => { thSel = "carmesi"; thDraft = presetDraft("carmesi"); previewDraft(); say("#th-msg", "Tema Carmesí cargado. Pulsa GUARDAR Y APLICAR para conservarlo."); };

// SOPORTE Y MENSAJERIA
const MSG_MAX = 1000;

function openSupportPage() {
  $("#sp-text").value = "";
  $("#sp-reason-select").value = "Solicitud";
  $("#sp-other-wrapper").style.display = "none";
  $("#sp-other-text").value = "";
  $("#sp-count").textContent = `0 / ${MSG_MAX}`;
  say("#sp-msg", "");
}

$("#sp-reason-select").onchange = (e) => {
  const value = e.target.value;
  $("#sp-other-wrapper").style.display = value === "OTRO" ? "block" : "none";
};

$("#sp-text").oninput = () => { $("#sp-count").textContent = `${$("#sp-text").value.length} / ${MSG_MAX}`; };

$("#sp-send").onclick = async () => {
  const message = $("#sp-text").value.trim();
  const selectVal = $("#sp-reason-select").value;
  let finalReason = selectVal;

  if (selectVal === "OTRO") {
    const customReason = $("#sp-other-text").value.trim();
    if (!customReason) return say("#sp-msg", "Especifica el motivo de tu mensaje.", true);
    finalReason = `Otro: ${customReason}`;
  }

  if (message.length < 3) return say("#sp-msg", "Escribe tu mensaje antes de enviarlo.", true);
  
  const btn = $("#sp-send"); btn.disabled = true; say("#sp-msg", "Enviando…");
  const r = await L.support({ action: "send", message, type: finalReason });
  btn.disabled = false;
  if (r.ok) { 
    $("#sp-text").value = ""; 
    $("#sp-other-text").value = "";
    $("#sp-reason-select").value = "Solicitud";
    $("#sp-other-wrapper").style.display = "none";
    $("#sp-count").textContent = `0 / ${MSG_MAX}`; 
    say("#sp-msg", "Mensaje enviado a los administradores."); 
    return toast("Mensaje enviado a los administradores."); 
  }
  if (r.expired) return toLogin("Tu sesión expiró. Inicia sesión de nuevo.");
  say("#sp-msg", r.error, true);
};

let inboxUnread = 0, inboxSeen = null, inboxMsgs = [];
function paintInbox() {
  const b = $("#nav-support"); if (!b) return;
  const mod = me && me.role === "moderator", base = mod ? "MENSAJES" : "SOPORTE";
  b.classList.toggle("alert", mod && inboxUnread > 0);          
  $("#inbox-label").textContent = mod && inboxUnread ? `${base} (${inboxUnread})` : base;
  if (mod) b.dataset.tip = inboxUnread ? `Tienes ${inboxUnread} mensaje${inboxUnread === 1 ? "" : "s"} sin leer` : "No hay mensajes nuevos";
  else delete b.dataset.tip;
}

async function checkInbox() {
  if (!me || me.role !== "moderator") return;
  const r = await L.support({ action: "unread" });
  if (!r.ok || !me) return;
  if (inboxSeen !== null && r.count > inboxSeen) ping("Nuevo mensaje de un jugador", "Revisa el botón MENSAJES.");
  inboxSeen = r.count; inboxUnread = r.count; paintInbox();
  if (!$("#view-inbox").hidden) loadInbox();
}

async function loadInbox() {
  const r = await L.support({ action: "list" });
  if (!r.ok) return r.expired ? toLogin("Tu sesión expiró. Inicia sesión de nuevo.") : say("#inbox-msg", r.error, true);
  inboxMsgs = r.messages || []; inboxUnread = inboxSeen = inboxMsgs.filter((m) => !m.read_at).length; paintInbox();
  $("#inbox-readall").hidden = !inboxUnread;
  say("#inbox-msg", inboxMsgs.length ? "" : "No hay mensajes.");
  $("#inbox-list").innerHTML = inboxMsgs.map((m) => `<div class="mrow">
      <div class="mrow-l"><div class="mrow-t"><p class="px-h2">${esc(m.type || "Comentario/Idea")}</p>${m.read_at ? "" : '<span class="newtag">NUEVO</span>'}</div>
      <span class="mrole">${esc(roleName(m.role))}</span><span class="muname">${esc(m.username)}</span></div>
      <button class="play" type="button" data-id="${m.id}">VER MENSAJE</button></div>`).join("");
}

$("#inbox-readall").onclick = async () => {
  const r = await L.support({ action: "markRead", all: true });
  if (!r.ok) return say("#inbox-msg", r.error, true);
  loadInbox();
};

$("#inbox-list").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) openMessage(Number(b.dataset.id)); };

function openMessage(id) {
  const m = inboxMsgs.find((x) => x.id === id); if (!m) return;
  const d = openDialog(`<h3>${esc(m.type || "Comentario/Idea")}</h3>
    <p class="msgmeta">${esc(roleName(m.role))} · ${esc(m.username)} · ${esc(new Date(m.created_at).toLocaleString("es"))}${m.read_at ? ` · Leído${m.read_by_name ? " por " + esc(m.read_by_name) : ""}` : ""}</p>
    <div class="msgview">${esc(m.message)}</div>
    <div class="btns"><button class="play danger" data-k="del">Eliminar</button><button class="play neutral" data-k="close">Cerrar</button></div>`);
  d.classList.add("wide");
  if (!m.read_at) L.support({ action: "markRead", ids: [id] }).then(() => loadInbox());   
  
  setTimeout(() => {
    d.onclick = async (e) => {
      e.stopPropagation();
      const k = e.target.closest("button[data-k]")?.dataset.k; if (!k) return;
      if (k === "close") return closeDialog("cancel");
      const c = await ask({ title: "Eliminar mensaje", text: "¿Eliminar este mensaje?", detail: "Se borra por completo y no se puede deshacer.",
        buttons: [{ key: "del", label: "ELIMINAR", cls: "danger" }, { key: "cancel", label: "CANCELAR", cls: "neutral" }], focus: "cancel" });
      if (c !== "del") return;
      const r = await L.support({ action: "delete", ids: [id] });
      if (!r.ok) return say("#inbox-msg", r.error, true);
      loadInbox();
    };
  }, 0);
}

// IMAGENES DE PERFIL
const avatarCache = {}, avatarWait = {};     
const initialOf = (u) => (String(u.name || u.username || "?").trim().charAt(0) || "?").toUpperCase();
function avatarUrl(u) {
  if (u.avatar) return u.avatar;               
  const c = avatarCache[u.id];
  return c && c.v === u.avatar_v ? c.url : "";
}

const pfpHtml = (u, size) => { const url = avatarUrl(u); return url ? `<img class="pfp ${size}" src="${url}" alt="">` : `<span class="pfp ph ${size}">${esc(initialOf(u))}</span>`; };

async function wantAvatar(u) {
  if (!u || !u.avatar_v || u.avatar) return;
  const c = avatarCache[u.id]; if (c && c.v === u.avatar_v) return;
  const k = u.id + ":" + u.avatar_v; if (avatarWait[k]) return;
  avatarWait[k] = 1;
  const r = await L.avatar({ id: u.id });
  delete avatarWait[k];
  if (r.ok && r.image) {
    avatarCache[u.id] = { v: r.avatar_v || u.avatar_v, url: "data:image/png;base64," + r.image };
    if (me && u.id === me.id) L.setAccountAvatar({ id: me.id, dataUrl: avatarCache[u.id].url });
    repaintPfps();
  }
}

function paintSidebarPfp() { if (me) $("#nav-pfp").innerHTML = pfpHtml(me, "s28"); }

function repaintPfps() {
  paintSidebarPfp();
  if (!$("#view-home").hidden) renderOnline();
  if (!$("#view-profile").hidden && me) $("#pf-pfp").innerHTML = pfpHtml(me, "s80");
}

let pfFile = null;
$("#pf-pick").onclick = async () => {
  const r = await L.pickAvatar();
  if (r.ok && !r.canceled) { pfFile = r.path; $("#pf-pick span").textContent = r.name; say("#pf-msg", ""); }
};

$("#pf-save").onclick = async () => {
  if (!pfFile) return say("#pf-msg", "Elige primero una imagen (PNG o JPG).", true);
  const btn = $("#pf-save"); btn.disabled = true; say("#pf-msg", "Subiendo…");
  const r = await L.setAvatar({ path: pfFile });
  btn.disabled = false;
  if (!r.ok) return r.expired ? toLogin("Tu sesión expiró. Inicia sesión de nuevo.") : say("#pf-msg", r.error, true);
  me.avatar_v = r.avatar_v;
  avatarCache[me.id] = { v: r.avatar_v, url: "data:image/png;base64," + r.image };
  L.setAccountAvatar({ id: me.id, dataUrl: avatarCache[me.id].url });
  pfFile = null; $("#pf-pick span").textContent = "Subir imagen"; say("#pf-msg", "Foto de perfil actualizada.");
  repaintPfps();
};

// RUTEO DE NAVEGACION
$("#nav-home").onclick = () => goto("home");
$("#nav-inst").onclick = () => goto("instances");
$("#nav-opts").onclick = () => goto("settings");
$("#nav-profile").onclick = () => goto("profile");
$("#nav-support").onclick = () => goto(me && me.role === "moderator" ? "inbox" : "support");
document.addEventListener("click", (e) => { const b = e.target.closest("[data-goto]"); if (b) goto(b.dataset.goto); });

// FUENTE PIXEL (Incluye .nav-btn para filtrado correcto)
const PX_SEL = ".play,.ghost,.nav-btn,.px-h,.px-h2,.px-sq,.px-btn,.px-title,.feat-name,.feat-badge,.card-name,.sbox-t,.vsel .vl,#dialog h3";
const pxPlain = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿¡]/g, "");
function pxFixEl(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const t = pxPlain(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
}
function pxFix(root) { if (root.matches && root.matches(PX_SEL)) pxFixEl(root); if (root.querySelectorAll) root.querySelectorAll(PX_SEL).forEach(pxFixEl); }
new MutationObserver((ms) => {
  for (const m of ms) {
    if (m.type === "characterData") { const el = m.target.parentElement && m.target.parentElement.closest(PX_SEL); if (el) pxFixEl(el); }
    else m.addedNodes.forEach((n) => { if (n.nodeType === 1) pxFix(n); else if (n.nodeType === 3) { const el = n.parentElement && n.parentElement.closest(PX_SEL); if (el) pxFixEl(el); } });
  }
}).observe(document.body, { childList: true, characterData: true, subtree: true });
pxFix(document.body);
Icons.paint();

// PANTALLAS DE AUTENTICACION
const LG_SCREENS = ["login", "request", "restore"];
function lgShow(name) {
  LG_SCREENS.forEach((n) => ($("#lg-" + n).hidden = n !== name));
  for (const id of ["#login-err", "#rq-msg", "#rs-msg"]) { const el = $(id); el.textContent = ""; el.className = ""; }
  const first = { login: "#l-user", request: "#rq-user", restore: "#rs-user" }[name];
  if (first) $(first).focus();
}

$("#go-request").onclick = () => lgShow("request");
$("#go-restore").onclick = () => lgShow("restore");
document.querySelectorAll("#login [data-back]").forEach((b) => (b.onclick = () => lgShow("login")));

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/, DISCORD_NAME = /^[\p{L}\p{N}_.#-]{2,37}$/u;
function lgSay(sel, text, ok) { const el = $(sel); el.textContent = text; el.className = ok ? "okmsg" : ""; }

async function lgRequest({ kind, msg, btn, user, discord, done }) {
  const username = user.value.trim();
  if (!MC_NAME.test(username)) return lgSay(msg, "Escribe tu nombre de usuario de Minecraft (3 a 16 caracteres: letras, números o _).");
  let d;
  if (discord) {
    d = discord.value.trim();
    if (!DISCORD_NAME.test(d)) return lgSay(msg, "Escribe tu nombre de usuario de Discord (2 a 37 caracteres, sin espacios).");
  }
  $(btn).disabled = true; lgSay(msg, "Enviando…", true);
  const r = await L.requestAccount({ kind, username, discord: d });
  if (!r.ok) { $(btn).disabled = false; return lgSay(msg, r.error || "No se pudo enviar la solicitud."); }
  user.value = ""; if (discord) discord.value = "";
  lgSay(msg, done, true);
  setTimeout(() => ($(btn).disabled = false), 4000);
}

$("#rq-form").onsubmit = (e) => {
  e.preventDefault();
  lgRequest({ kind: "create", msg: "#rq-msg", btn: "#rq-btn", user: $("#rq-user"), done: "Solicitud enviada. Un moderador la revisará y se pondrá en contacto contigo." });
};
$("#rs-form").onsubmit = (e) => {
  e.preventDefault();
  lgRequest({ kind: "restore", msg: "#rs-msg", btn: "#rs-btn", user: $("#rs-user"), discord: $("#rs-discord"), done: "Solicitud enviada. Un moderador te escribirá por Discord con tu contraseña temporal." });
};

// PANTALLA DE INICIO
let featuredCode = null, online = [], presTimer = null;

async function pingPresence() {
  if (!me) return;
  const r = await L.presence();
  if (!me) return;
  if (!r.ok) { if (r.expired) toLogin("Tu sesión expiró. Inicia sesión de nuevo."); return; }
  online = r.users || []; online.forEach(wantAvatar);
  if (!$("#view-home").hidden) renderOnline();
}

function renderOnline() {
  $("#online-list").innerHTML = online.length
    ? online.map((u) => `<div class="orow">${pfpHtml(u, "s28")}<b>${esc(u.username)}</b><span class="meta"><small>${esc(roleName(u.role))}</small><i>|</i><em>Online</em></span></div>`).join("")
    : '<p class="muted">Nadie está conectado.</p>';
  Theme.paintLogos($("#online-list"));
}

function renderHome() {
  const i = instances.find((x) => x.code === featuredCode) || null;
  const feat = $("#feat"), art = $("#feat-art");
  feat.disabled = !i; $("#home-log").disabled = !i;
  $("#feat-name").textContent = i ? i.name : "Aún no hay instancias";
  $("#online-feat").textContent = i ? i.name : "";
  const b = i ? badge(i) : "";
  $("#feat-badge").hidden = !b; $("#feat-badge").textContent = b.toUpperCase();
  const key = i && bannerKey(i), url = key && banners[key];
  art.innerHTML = url ? `<img class="cover" alt="" src="${url}">` : `<img class="ph" data-logo alt="" src="${Theme.logo}">`;
  if (i) loadBanner(i);
  renderOnline();
}

$("#feat").onclick = () => {
  if (!featuredCode) return;
  openInstance(featuredCode);   
};

$("#home-log").onclick = () => { const i = instances.find((x) => x.code === featuredCode); if (i) openChangelog(i, latestPublic(i)); };

$("#home-gear").onclick = () => {
  if (!me || me.role !== "moderator") return;
  let pick = featuredCode;
  const isPublic = (i) => i.instance_versions.some((v) => v.channel === "stable");
  const rows = instances.map((i) => {
    const ok = isPublic(i);
    return `<button type="button" class="feat-opt${i.code === pick ? " on" : ""}" data-code="${i.code}"${ok ? "" : ' disabled aria-disabled="true"'}>
      <span><b>${esc(i.name)}</b><small>${ok ? `Versión ${esc(i.instance_versions.find((v) => v.channel === "stable").version)}` : "Sin versión pública (solo testing): no se puede destacar"}</small></span>
      ${i.code === featuredCode ? "<em>Actual</em>" : ""}</button>`;
  }).join("");
  const d = openDialog(`<p class="px-h2">MODPACK DESTACADO</p>
    <p class="muted">Elige la instancia que se muestra como principal en Inicio. Solo pueden destacarse instancias con una versión pública (no testing). Se mantiene hasta que un moderador la cambie.</p>
    <div class="feat-list">${rows || '<p class="muted">Aún no hay instancias subidas.</p>'}</div>
    <p id="ft-err" class="bad"></p>
    <div class="btns"><button class="play neutral" data-k="cancel">Cancelar</button><button id="ft-save" class="play" data-k="save" disabled>ESTABLECER MODPACK DESTACADO</button></div>`);
  d.classList.add("wide");
  
  setTimeout(() => {
    d.onclick = async (e) => {
      e.stopPropagation();
      const opt = e.target.closest(".feat-opt");
      if (opt && !opt.disabled) {
        pick = Number(opt.dataset.code);
        d.querySelectorAll(".feat-opt").forEach((o) => o.classList.toggle("on", o === opt));
        $("#ft-save").disabled = pick === featuredCode;
        return;
      }
      const k = e.target.closest("button[data-k]")?.dataset.k; if (!k) return;
      if (k === "cancel") return closeDialog("cancel");
      $("#ft-save").disabled = true; say("#ft-err", "");
      const r = await L.setFeatured({ code: pick });
      if (!r.ok) { $("#ft-save").disabled = false; return say("#ft-err", r.error, true); }
      closeDialog("saved"); toast("Modpack destacado actualizado.");
      await refresh();
    };
  }, 0);
};