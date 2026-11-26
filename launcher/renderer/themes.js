// CONFIGURACION Y ESTRUCTURAS DE DATOS
(function (root) {
  const LOGOS = {
    pink:   { file: "logo-launcher.png",    label: "Roja (actual)" },
    blue:   { file: "logo-launcher-bl.png", label: "Azul" },
    cyan:   { file: "logo-launcher-cy.png", label: "Celeste" },
    green:  { file: "logo-launcher-gr.png", label: "Verde" },
    orange: { file: "logo-launcher-or.png", label: "Naranja" },
    purple: { file: "logo-launcher-pu.png", label: "Morada" },
    yellow: { file: "logo-launcher-ye.png", label: "Amarilla" },
  };

  const PRESETS = {
    carmesi: { name: "Carmesí (actual)", logo: "pink",  colors: { bg: "#1c1b20", panel: "#232229", text: "#ffffff", line: "#585962", accent: "#fe1c62", shadow: "#6a1a47" } },
    verde:   { name: "Verde Alien",      logo: "green", colors: { bg: "#1c2025", panel: "#202727", text: "#ffffff", line: "#556063", accent: "#3bff38", shadow: "#037863" } },
    azul:    { name: "Azul Noche",       logo: "blue",  colors: { bg: "#1d1b34", panel: "#222146", text: "#ffffff", line: "#5a6276", accent: "#0030ff", shadow: "#26018f" } },
    celeste: { name: "Celeste Claro",    logo: "cyan",  colors: { bg: "#89cef6", panel: "#a9fffe", text: "#000045", line: "#1e1b65", accent: "#05e4ff", shadow: "#0180ff" } },
  };
  
  const DEFAULT_ID = "carmesi";
  const COLOR_KEYS = ["bg", "panel", "text", "line", "accent", "shadow"];
  const HEX = /^#[0-9a-fA-F]{6}$/;



  // UTILIDADES DE CREACION DE TEMAS
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function sanitize(saved) {
    const s = saved && typeof saved === "object" ? saved : {};
    const id = s.id === "custom" || PRESETS[s.id] ? s.id : DEFAULT_ID;
    const base = PRESETS[DEFAULT_ID];
    const c = s.custom && typeof s.custom === "object" ? s.custom : {};
    const custom = { colors: {}, logo: LOGOS[c.logo] ? c.logo : base.logo };
    for (const k of COLOR_KEYS) custom.colors[k] = HEX.test(String((c.colors || {})[k])) ? String(c.colors[k]).toLowerCase() : base.colors[k];
    return { id, custom };
  }

  function resolve(saved) {
    const s = sanitize(saved);
    if (s.id === "custom") return { id: "custom", name: "Personalizado", colors: s.custom.colors, logo: s.custom.logo };
    const p = PRESETS[s.id];
    return { id: s.id, name: p.name, colors: clone(p.colors), logo: p.logo };
  }



  // EXPORTACION DE MODULO
  const api = { LOGOS, PRESETS, DEFAULT_ID, COLOR_KEYS, sanitize, resolve };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.THEMES = api;
})(typeof window !== "undefined" ? window : this);