import { db, json, requireUser } from "../_shared/common.ts";

const VERSION = /^(testing )?\d+\.\d+\.\d+$/;
const LOADERS = ["fabric", "neoforge"];
const MC_VERSION = /^\d+\.\d+(\.\d+)?$/;
const LOADER_VERSION = /^[0-9A-Za-z.+_-]{1,40}$/;

// Solo moderadores. { check:true } consulta si el código ya existe sin guardar nada.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  if (u.role !== "moderator") return json({ error: "Solo moderadores" }, 403);

  const b = await req.json().catch(() => ({}));
  const code = Number(b.code);
  if (!Number.isInteger(code) || code < 1) return json({ error: "El código debe ser un entero positivo" }, 400);
  const version = typeof b.version === "string" ? b.version.trim() : "";
  if (version && !VERSION.test(version)) return json({ error: 'Versión inválida. Usa "1.1.1" o "testing 1.1.1"' }, 400);

  const { data: inst } = await db.from("instances").select("name,mc_version,loader,loader_version").eq("code", code).maybeSingle();
  let versionExists = false;
  if (inst && version) {
    const { data } = await db.from("instance_versions").select("id").eq("instance_code", code).eq("version", version).maybeSingle();
    versionExists = !!data;
  }
  if (b.check) return json({
    exists: !!inst, name: inst?.name ?? null, versionExists,
    mcVersion: inst?.mc_version ?? null, loader: inst?.loader ?? null, loaderVersion: inst?.loader_version ?? null,
  });

  if (!version) return json({ error: "Falta la versión" }, 400);
  if (versionExists) return json({ error: "Esa versión ya existe en esta instancia" }, 409);
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 60) : "";
  if (!inst && !name) return json({ error: "Falta el nombre de la instancia" }, 400);
  if (!b.assetId || !b.sha256 || !b.size) return json({ error: "Faltan datos del archivo" }, 400);

  // Instancia nueva: el loader y la versión de Minecraft se eligen una sola vez, al crearla.
  const loader = typeof b.loader === "string" ? b.loader : "";
  const mcVersion = typeof b.mcVersion === "string" ? b.mcVersion.trim() : "";
  const loaderVersion = typeof b.loaderVersion === "string" ? b.loaderVersion.trim() : "";
  if (!inst) {
    if (!LOADERS.includes(loader)) return json({ error: "Loader inválido (fabric o neoforge)" }, 400);
    if (!MC_VERSION.test(mcVersion)) return json({ error: "Versión de Minecraft inválida" }, 400);
    if (!LOADER_VERSION.test(loaderVersion)) return json({ error: "Versión del loader inválida" }, 400);
  }

  if (!inst) {
    const { error } = await db.from("instances").insert({ code, name, mc_version: mcVersion, loader, loader_version: loaderVersion });
    if (error) return json({ error: error.message }, 500);
  }
  const { error } = await db.from("instance_versions").insert({
    instance_code: code,
    version,
    channel: version.startsWith("testing ") ? "testing" : "stable",
    github_asset_id: b.assetId,
    changelog_asset_id: b.changelogAssetId ? Number(b.changelogAssetId) : null,   // opcional
    sha256: b.sha256,
    size: b.size,
    created_by: u.id,
  });
  if (error) return json({ error: error.message }, 500);

  return json({ created: !inst, name: inst?.name ?? name });
});
