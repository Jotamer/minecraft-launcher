import { db, json, requireUser } from "../_shared/common.ts";

// Solo moderadores: elegir la instancia destacada de Inicio. Debe tener al menos una versión pública (stable).
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  if (u.role !== "moderator") return json({ error: "Solo moderadores" }, 403);

  const b = await req.json().catch(() => ({}));
  const code = Number(b.code);
  if (!Number.isInteger(code) || code < 1) return json({ error: "Instancia inválida" }, 400);

  const { data: inst } = await db.from("instances").select("code").eq("code", code).maybeSingle();
  if (!inst) return json({ error: "Esa instancia ya no existe" }, 404);
  const { count } = await db.from("instance_versions").select("id", { count: "exact", head: true }).eq("instance_code", code).eq("channel", "stable");
  if (!count) return json({ error: "Esa instancia no tiene ninguna versión pública (solo testing): no puede ser la destacada." }, 400);

  const { error } = await db.from("app_settings").upsert({ key: "featured_instance", value: { code }, updated_at: new Date().toISOString(), updated_by: u.id });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, code });
});
