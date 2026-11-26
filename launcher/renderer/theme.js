// CONFIGURACION BASE DEL GESTOR
(function () {
  const T = window.THEMES;
  const root = document.documentElement;



  // UTILIDADES DE PROCESAMIENTO DE COLOR
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  
  const lum = (h) => {
    const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  
  const readable = (bg) => (contrast(bg, "#000000") >= contrast(bg, "#ffffff") ? "#000000" : "#ffffff");



  // GESTION DE LOGOS DE TEMA
  const logoUrl = (key) => "logos/" + (T.LOGOS[key] || T.LOGOS.pink).file;

  function paintLogos(scope) {
    (scope || document).querySelectorAll("img[data-logo]").forEach((im) => { if (im.getAttribute("src") !== Theme.logo) im.setAttribute("src", Theme.logo); });
  }



  // APLICACION DE VARIABLES CSS (DOM)
  function apply(theme) {
    const c = theme.colors, st = root.style;
    st.setProperty("--bg", c.bg); st.setProperty("--panel", c.panel); st.setProperty("--text", c.text);
    st.setProperty("--line", c.line); st.setProperty("--torch", c.accent); st.setProperty("--torch-d", c.shadow);
    st.setProperty("--on-accent", readable(c.accent));                       
    st.setProperty("--on-accent-px", contrast(c.accent, "#ffffff") >= 3 ? "#ffffff" : readable(c.accent));   
    
    const hl = Math.min(contrast(c.accent, c.panel), contrast(c.accent, c.bg)) >= 2.2 ? c.accent : c.text;
    st.setProperty("--hl", hl);
    
    const light = lum(c.bg) > 0.4;
    st.setProperty("--bad", light ? "#b3261e" : "#e0675a");
    st.colorScheme = light ? "light" : "dark";
    
    Theme.current = theme; Theme.logo = logoUrl(theme.logo);
    if (document.readyState !== "loading") paintLogos();
  }



  // VALIDACIONES DE INTERFAZ Y EXPORTACION
  function warnings(c) {
    const w = [];
    if (contrast(c.text, c.bg) < 4.5) w.push("El texto se leerá mal sobre el fondo.");
    if (contrast(c.text, c.panel) < 4.5) w.push("El texto se leerá mal sobre los paneles.");
    if (contrast(readable(c.accent), c.accent) < 4.5) w.push("El texto de los botones se leerá mal sobre el color de botones.");
    return w;
  }

  const Theme = { current: null, logo: logoUrl("pink"), apply, paintLogos, logoUrl, warnings, lum, contrast };
  window.Theme = Theme;

  let saved = null;
  try { saved = window.L && window.L.themeBoot ? window.L.themeBoot() : null; } catch {}
  Theme.saved = T.sanitize(saved);
  apply(T.resolve(Theme.saved));
  document.addEventListener("DOMContentLoaded", () => paintLogos());
})();