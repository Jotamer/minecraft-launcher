import { db, json, requireUser } from "../_shared/common.ts";

// "Usuarios conectados" de Inicio. Cada launcher abierto llama a ping cada ~45 s; se considera conectado
// a quien avisó en los últimos 2.5 minutos. leave se usa al cerrar sesión para desaparecer de inmediato.
const ONLINE_MS = 150 * 1000;
const RANK: Record<string, number> = { moderator: 0, beta: 1, player: 2 };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  const b = await req.json().catch(() => ({}));

  if (b.action === "leave") {
    await db.from("users").update({ last_seen: null }).eq("id", u.id);
    return json({ ok: true });
  }

  await db.from("users").update({ last_seen: new Date().toISOString() }).eq("id", u.id);
  const since = new Date(Date.now() - ONLINE_MS).toISOString();
  const { data, error } = await db.from("users").select("id,username,role,avatar_v").eq("active", true).gte("last_seen", since).limit(100);
  if (error) return json({ error: error.message }, 500);
  const users = (data ?? []).sort((a: any, b: any) => (RANK[a.role] ?? 3) - (RANK[b.role] ?? 3) || a.username.localeCompare(b.username));
  return json({ users });
});
