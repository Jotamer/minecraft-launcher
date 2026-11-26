import { canTest, db, json, requireUser } from "../_shared/common.ts";

// Devuelve una URL temporal de GitHub (el repo es privado). El token de lectura
// nunca sale del servidor: GitHub responde 302 con una URL firmada de pocos minutos.
Deno.serve(async (req) => {
  const u = await requireUser(req);
  if (u instanceof Response) return u;

  const id = new URL(req.url).searchParams.get("id");
  const { data: v } = await db.from("instance_versions").select("*").eq("id", id).maybeSingle();
  if (!v) return json({ error: "Versión no encontrada" }, 404);
  if (v.channel === "testing" && !canTest(u.role)) return json({ error: "No autorizado" }, 403);

  const gh = await fetch(
    `https://api.github.com/repos/${Deno.env.get("GH_REPO")}/releases/assets/${v.github_asset_id}`,
    {
      headers: {
        Authorization: `Bearer ${Deno.env.get("GH_TOKEN")}`,
        Accept: "application/octet-stream",
        "User-Agent": "launcher-eventos",
      },
      redirect: "manual",
    },
  );
  const url = gh.headers.get("location");
  if (!url) return json({ error: `GitHub respondió ${gh.status}` }, 502);

  return json({ url, sha256: v.sha256, size: v.size });
});
