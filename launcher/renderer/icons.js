// Íconos pixel art (extraídos de los mockups). Cada uno es un mapa de píxeles dibujado con rectángulos: se tiñe con el color del texto (currentColor).
(function () {
  const ICONS = {
    gear: [28, 28, "M10 0h8v1h-8zM6 1h1v1h-1zM10 1h8v1h-8zM21 1h1v1h-1zM5 2h3v1h-3zM10 2h8v1h-8zM20 2h3v1h-3zM4 3h5v1h-5zM10 3h8v1h-8zM19 3h5v1h-5zM3 4h22v1h-22zM2 5h24v1h-24zM1 6h26v1h-26zM2 7h24v1h-24zM3 8h22v1h-22zM4 9h20v1h-20zM0 10h11v1h-11zM17 10h11v1h-11zM0 11h10v1h-10zM18 11h10v1h-10zM0 12h10v1h-10zM18 12h10v1h-10zM0 13h10v1h-10zM18 13h10v1h-10zM0 14h10v1h-10zM18 14h10v1h-10zM0 15h10v1h-10zM18 15h10v1h-10zM0 16h10v1h-10zM18 16h10v1h-10zM0 17h11v1h-11zM17 17h11v1h-11zM4 18h20v1h-20zM3 19h22v1h-22zM2 20h24v1h-24zM1 21h26v1h-26zM2 22h24v1h-24zM3 23h22v1h-22zM4 24h5v1h-5zM10 24h8v1h-8zM19 24h5v1h-5zM5 25h3v1h-3zM10 25h8v1h-8zM20 25h3v1h-3zM6 26h1v1h-1zM10 26h8v1h-8zM21 26h1v1h-1zM10 27h8v1h-8z"],
    folder: [26, 19, "M1 0h7v1h-7zM0 1h1v1h-1zM7 1h2v1h-2zM0 2h1v1h-1zM8 2h18v1h-18zM0 3h1v1h-1zM25 3h1v1h-1zM0 4h1v1h-1zM25 4h1v1h-1zM0 5h1v1h-1zM25 5h1v1h-1zM0 6h1v1h-1zM25 6h1v1h-1zM0 7h1v1h-1zM25 7h1v1h-1zM0 8h1v1h-1zM25 8h1v1h-1zM0 9h1v1h-1zM25 9h1v1h-1zM0 10h1v1h-1zM25 10h1v1h-1zM0 11h1v1h-1zM25 11h1v1h-1zM0 12h1v1h-1zM25 12h1v1h-1zM0 13h1v1h-1zM25 13h1v1h-1zM0 14h1v1h-1zM25 14h1v1h-1zM0 15h1v1h-1zM25 15h1v1h-1zM0 16h1v1h-1zM25 16h1v1h-1zM0 17h26v1h-26zM0 18h26v1h-26z"],
    terminal: [27, 19, "M0 0h27v1h-27zM0 1h1v1h-1zM26 1h1v1h-1zM0 2h1v1h-1zM26 2h1v1h-1zM0 3h1v1h-1zM26 3h1v1h-1zM0 4h1v1h-1zM4 4h3v1h-3zM26 4h1v1h-1zM0 5h1v1h-1zM5 5h3v1h-3zM26 5h1v1h-1zM0 6h1v1h-1zM6 6h3v1h-3zM26 6h1v1h-1zM0 7h1v1h-1zM7 7h3v1h-3zM26 7h1v1h-1zM0 8h1v1h-1zM6 8h3v1h-3zM26 8h1v1h-1zM0 9h1v1h-1zM5 9h3v1h-3zM13 9h8v1h-8zM26 9h1v1h-1zM0 10h1v1h-1zM4 10h3v1h-3zM13 10h8v1h-8zM26 10h1v1h-1zM0 11h1v1h-1zM26 11h1v1h-1zM0 12h1v1h-1zM26 12h1v1h-1zM0 13h1v1h-1zM26 13h1v1h-1zM0 14h1v1h-1zM26 14h1v1h-1zM0 15h1v1h-1zM26 15h1v1h-1zM0 16h1v1h-1zM26 16h1v1h-1zM0 17h27v1h-27zM0 18h27v1h-27z"],
    chev: [17, 10, "M0 0h4v1h-4zM13 0h4v1h-4zM0 1h5v1h-5zM12 1h5v1h-5zM1 2h5v1h-5zM11 2h5v1h-5zM2 3h4v1h-4zM11 3h4v1h-4zM3 4h4v1h-4zM10 4h4v1h-4zM4 5h4v1h-4zM9 5h4v1h-4zM4 6h9v1h-9zM5 7h7v1h-7zM6 8h5v1h-5zM7 9h3v1h-3z"],
    excl: [6, 19, "M0 0h6v12H0zM0 14h6v5H0z"],
    arrow: [10, 8, "M3 0h1v1h-1zM2 1h2v1h-2zM1 2h3v1h-3zM0 3h10v1h-10zM0 4h10v1h-10zM1 5h3v1h-3zM2 6h2v1h-2zM3 7h1v1h-1z"],
  };
  const svg = (name) => {
    const [w, h, d] = ICONS[name];
    return `<svg class="pxi pxi-${name}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
  };
  // Rellena todos los <i data-icon="nombre"> que haya dentro de un elemento (o de todo el documento)
  const paint = (root) => (root || document).querySelectorAll("i[data-icon]").forEach((el) => { if (!el.firstChild) el.innerHTML = svg(el.dataset.icon); });
  window.Icons = { svg, paint };
})();
