import { canTest, db, json, requireUser } from "../_shared/common.ts";

// Devuelve el texto de cambiosModpack.md de una versión, sin que el jugador tenga que descargar la instancia.
// El archivo es un asset secundario del release de GitHub (privado): se lee aquí con el token del servidor.
const MAX_BYTES = 512 * 1024;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  const b = await req.json().catch(() => ({}));
  const id = Number(b.versionId);
  if (!Number.isInteger(id)) return json({ error: "Falta la versión" }, 400);

  const { data: v } = await db.from("instance_versions").select("channel,changelog_asset_id").eq("id", id).maybeSingle();
  if (!v) return json({ error: "Versión no encontrada" }, 404);
  if (v.channel === "testing" && !canTest(u.role)) return json({ error: "No autorizado" }, 403);
  if (!v.changelog_asset_id) return json({ text: null });          // esa versión no tiene registro de cambios

  const gh = await fetch(`https://api.github.com/repos/${Deno.env.get("GH_REPO")}/releases/assets/${v.changelog_asset_id}`, {
    headers: { Authorization: `Bearer ${Deno.env.get("GH_TOKEN")}`, Accept: "application/octet-stream", "User-Agent": "launcher-eventos" },
    redirect: "manual",
  });
  const url = gh.headers.get("location");
  if (!url) return json({ error: `GitHub respondió ${gh.status}` }, 502);
  const file = await fetch(url);
  if (!file.ok) return json({ error: `GitHub respondió ${file.status}` }, 502);

  const buf = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder("utf-8").decode(buf.subarray(0, MAX_BYTES)).replace(/^\uFEFF/, "");
  return json({ text: text.trim() ? text : null, truncated: buf.length > MAX_BYTES });
});
