import { canTest, db, json, requireUser } from "../_shared/common.ts";

// Lista instancias y versiones. Los jugadores nunca reciben versiones "testing" (solo moderadores y Beta Testers).
Deno.serve(async (req) => {
  const u = await requireUser(req);
  if (u instanceof Response) return u;

  const { data, error } = await db
    .from("instances")
    .select("code,name,mc_version,loader,loader_version,instance_versions(id,version,channel,size,created_at,updated_at,loader_version,revision,changelog_asset_id)")
    .order("code");
  if (error) return json({ error: error.message }, 500);

  const instances = (data ?? [])
    .map((i: any) => ({
      ...i,
      instance_versions: i.instance_versions
        .filter((v: any) => canTest(u.role) || v.channel === "stable")
        .sort((a: any, b: any) => b.id - a.id)
        // changelog_v: id del registro de cambios (null = no tiene). Sirve también para saber cuándo cambió y refrescar la copia guardada.
        .map(({ changelog_asset_id, ...v }: any) => ({ ...v, changelog_v: changelog_asset_id ?? null })),
    }))
    .filter((i: any) => i.instance_versions.length > 0);

  // Instancia destacada de Inicio (la misma para todos). Solo puede ser una con versión pública (stable).
  // Si ningún moderador eligió una (o la elegida ya no es pública), se usa la que tuvo la última subida o actualización pública.
  const publicAt = (data ?? [])
    .map((i: any) => ({
      code: i.code,
      at: Math.max(0, ...i.instance_versions.filter((v: any) => v.channel === "stable").map((v: any) => Date.parse(v.updated_at ?? v.created_at) || 0)),
    }))
    .filter((x: any) => x.at > 0);
  const { data: setting } = await db.from("app_settings").select("value").eq("key", "featured_instance").maybeSingle();
  const chosen = Number(setting?.value?.code);
  let featured: { code: number; auto: boolean } | null = null;
  if (publicAt.some((x: any) => x.code === chosen)) featured = { code: chosen, auto: false };
  else if (publicAt.length) featured = { code: publicAt.reduce((a: any, b: any) => (b.at > a.at ? b : a)).code, auto: true };

  // "existing": todos los códigos que existen (sin filtrar). El launcher lo usa para limpiar
  // instancias borradas del equipo sin confundirlas con instancias que solo tienen versiones testing.
  return json({ instances, featured, existing: (data ?? []).map((i: any) => i.code) });
});
