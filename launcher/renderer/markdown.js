// CONFIGURACION Y DEPENDENCIAS
(function (root) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const SAFE_URL = /^https?:\/\/[^\s<>"]+$/i;



  // FORMATEO DE ESTILOS EN LINEA
  function emphasis(s) {
    return s
      .replace(/\*\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w])__(?=\S)([\s\S]+?)(?<=\S)__(?![\w])/g, "$1<strong>$2</strong>")
      .replace(/\*(?=[^\s*])([\s\S]+?)(?<=[^\s*])\*/g, "<em>$1</em>")
      .replace(/(^|[^\w])_(?=[^\s_])([\s\S]+?)(?<=[^\s_])_(?![\w])/g, "$1<em>$2</em>")
      .replace(/~~(?=\S)([\s\S]+?)(?<=\S)~~/g, "<del>$1</del>");
  }

  function inline(src) {
    const keep = [];
    const hold = (html) => "\u0000" + (keep.push(html) - 1) + "\u0000";
    let s = String(src);
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _t, c) => hold("<code>" + esc(c.trim()) + "</code>"));   
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~|>])/g, (_m, c) => hold(esc(c)));                                
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) => hold(alt ? "<em>" + alt + "</em>" : ""));       
    const link = (text, url) => {
      const u = url.replace(/&amp;/g, "&");
      return SAFE_URL.test(u) ? hold(`<a href="#" data-href="${esc(u)}">${emphasis(text)}</a>`) : emphasis(text);
    };
    s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\s*\)/g, (_m, t, u) => link(t, u));
    s = s.replace(/&lt;(https?:\/\/[^\s&]+(?:&amp;[^\s&]*)*)&gt;/g, (_m, u) => link(u, u));              
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, (_m, pre, u) => pre + link(u, u));    
    s = emphasis(s);
    s = s.replace(/ {2,}\n|\\\n/g, "<br>");
    return s.replace(/\u0000(\d+)\u0000/g, (_m, n) => keep[Number(n)]);
  }



  // UTILIDADES DE BLOQUES DE TEXTO
  const LI = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const indentOf = (l) => /^\s*/.exec(l)[0].length;

  function startsBlock(l, next) {
    return FENCE.test(l) || HR.test(l) || /^\s{0,3}#{1,6}\s/.test(l) || /^\s{0,3}>/.test(l) || LI.test(l) ||
      (l.includes("|") && next !== undefined && TABLE_SEP.test(next) && next.includes("-"));
  }



  // CONVERSION A HTML COMPLETO
  function list(lines, i) {
    const first = LI.exec(lines[i]), base = first[1].length, ordered = /\d/.test(first[2][0]);
    const start = ordered ? parseInt(first[2], 10) : 1;
    let html = "";
    while (i < lines.length) {
      const m = LI.exec(lines[i]);
      if (!m || m[1].length < base || m[1].length > base + 1 || /\d/.test(m[2][0]) !== ordered) break;
      const body = [m[3]];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) { 
          let j = i; while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && indentOf(lines[j]) > base + 1) { body.push(""); i++; continue; }
          break;
        }
        if (indentOf(l) > base + 1) { body.push(l); i++; continue; }
        break;
      }
      const rest = body.slice(1), min = Math.min(...rest.filter((l) => l.trim()).map(indentOf), Infinity);
      const inner = [body[0], ...rest.map((l) => (l.trim() ? l.slice(Math.min(min, indentOf(l))) : ""))];
      let task = "";
      const t = /^\[( \vert{}x\vert{}X)\]\s+/.exec(inner[0]);
      if (t) { task = `<input type="checkbox" disabled${t[1] === " " ? "" : " checked"}> `; inner[0] = inner[0].slice(t[0].length); }
      html += "<li>" + task + blocks(inner).replace(/^<p>([\s\S]*?)<\/p>/, "$1") + "</li>";
    }
    const tag = ordered ? "ol" : "ul";
    return { html: `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>${html}</${tag}>`, next: i };
  }

  function blocks(lines) {
    let out = "", i = 0, m;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      if ((m = FENCE.exec(l))) {
        const ch = m[1][0], n = m[1].length, body = [];
        const close = new RegExp("^\\s{0,3}" + (ch === "`" ? "`" : "~") + "{" + n + ",}\\s*$");
        i++;
        while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
        i++;
        out += `<pre><code>${esc(body.join("\n"))}</code></pre>`; continue;
      }
      if ((m = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(l))) { out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue; }
      if (HR.test(l)) { out += "<hr>"; i++; continue; }
      if (/^\s{0,3}>/.test(l)) {
        const q = []; while (i < lines.length && /^\s{0,3}>/.test(lines[i])) q.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
        out += `<blockquote>${blocks(q)}</blockquote>`; continue;
      }
      if (l.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
        const head = cells(l), al = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : /^:-/.test(c) ? "left" : ""));
        const td = (t, c, k) => `<${t}${al[k] ? ` style="text-align:${al[k]}"` : ""}>${inline(c || "")}</${t}>`;
        let rows = ""; i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes("|")) { rows += "<tr>" + head.map((_h, k) => td("td", cells(lines[i])[k], k)).join("") + "</tr>"; i++; }
        out += `<div class="md-table"><table><thead><tr>${head.map((h, k) => td("th", h, k)).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`; continue;
      }
      if (LI.test(l)) { const r = list(lines, i); out += r.html; i = r.next; continue; }
      const p = [];
      while (i < lines.length && lines[i].trim() && (p.length === 0 || !startsBlock(lines[i], lines[i + 1]))) p.push(lines[i++]);
      out += `<p>${inline(p.join("\n"))}</p>`;
    }
    return out;
  }



  // EXPORTACION DE MODULO
  const render = (md) => blocks(String(md).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
  const api = { render };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Markdown = api;
})(typeof window !== "undefined" ? window : this);