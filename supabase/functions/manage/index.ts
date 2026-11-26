import { db, json, requireUser } from "../_shared/common.ts";

const LOADER_VERSION = /^[0-9A-Za-z.+_-]{1,40}$/;

// Solo moderadores. Corrige o elimina instancias y versiones ya publicadas.
//   modify         -> cambia la versión del loader y/o reemplaza el .zip de UNA versión
//   deleteVersion  -> borra UNA versión (si era la última, la instancia también se borra)
//   deleteInstance -> borra la instancia y todas sus versiones (libera el código)
// Devuelve los datos que el launcher necesita para limpiar GitHub con el token del moderador.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  if (u.role !== "moderator") return json({ error: "Solo moderadores" }, 403);

  const b = await req.json().catch(() => ({}));
  const code = Number(b.code);
  if (!Number.isInteger(code) || code < 1) return json({ error: "El código debe ser un entero positivo" }, 400);

  const { data: inst } = await db.from("instances").select("code,name,loader").eq("code", code).maybeSingle();
  if (!inst) return json({ error: "La instancia no existe" }, 404);

  if (b.action === "deleteInstance") {
    const { data: versions } = await db.from("instance_versions").select("version,github_asset_id").eq("instance_code", code);
    const { error } = await db.from("instances").delete().eq("code", code); // borra también sus versiones (cascade)
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, name: inst.name, versions: (versions ?? []).map((v: any) => ({ version: v.version, assetId: v.github_asset_id })) });
  }

  const versionId = Number(b.versionId);
  if (!Number.isInteger(versionId)) return json({ error: "Falta la versión" }, 400);
  const { data: v } = await db.from("instance_versions").select("*").eq("id", versionId).eq("instance_code", code).maybeSingle();
  if (!v) return json({ error: "Esa versión no existe en esta instancia" }, 404);

  if (b.action === "deleteVersion") {
    const { error } = await db.from("instance_versions").delete().eq("id", versionId);
    if (error) return json({ error: error.message }, 500);
    const { count } = await db.from("instance_versions").select("id", { count: "exact", head: true }).eq("instance_code", code);
    let instanceDeleted = false;
    if (!count) { // una instancia sin versiones no sirve de nada: se libera el código
      await db.from("instances").delete().eq("code", code);
      instanceDeleted = true;
    }
    return json({ ok: true, version: v.version, assetId: v.github_asset_id, instanceDeleted });
  }

  if (b.action === "modify") {
    const patch: Record<string, unknown> = {};
    if (b.loaderVersion !== undefined && b.loaderVersion !== null && b.loaderVersion !== "") {
      if (!inst.loader) return json({ error: "Esta instancia no tiene loader guardado; no se puede cambiar su versión" }, 400);
      if (typeof b.loaderVersion !== "string" || !LOADER_VERSION.test(b.loaderVersion)) return json({ error: "Versión del loader inválida" }, 400);
      patch.loader_version = b.loaderVersion;
    }
    if (b.assetId) {
      if (!b.sha256 || !b.size) return json({ error: "Faltan datos del archivo" }, 400);
      patch.github_asset_id = b.assetId;
      patch.sha256 = b.sha256;
      patch.size = b.size;
      // Los jugadores que ya instalaron esta versión verán "Actualizar" y recibirán el archivo corregido.
      patch.revision = (v.revision ?? 0) + 1;
    }
    // El registro de cambios se puede agregar o reemplazar sin tocar el .zip (no obliga a los jugadores a reinstalar).
    if (b.changelogAssetId) patch.changelog_asset_id = Number(b.changelogAssetId);
    if (!Object.keys(patch).length) return json({ error: "No hay cambios que guardar" }, 400);
    patch.updated_at = new Date().toISOString();   // cuenta como "actualizada" para la instancia destacada automática

    const { error } = await db.from("instance_versions").update(patch).eq("id", versionId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, version: v.version, oldAssetId: b.assetId ? v.github_asset_id : null, oldChangelogAssetId: b.changelogAssetId ? (v.changelog_asset_id ?? null) : null, replaced: !!b.assetId });
  }

  return json({ error: "Acción desconocida" }, 400);
});
