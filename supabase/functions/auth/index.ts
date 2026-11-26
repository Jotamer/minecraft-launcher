import { db, hashPassword, json, signSession, verifyPassword } from "../_shared/common.ts";

// Login con usuario de Minecraft + contraseña. 5 fallos seguidos bloquean la cuenta 5 minutos.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const { username, password } = await req.json().catch(() => ({}));
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return json({ error: "Escribe tu usuario y tu contraseña" }, 400);
  }
  const bad = () => json({ error: "Usuario o contraseña incorrectos" }, 401);

  const { data: u } = await db.from("users").select("*").eq("username_lower", username.trim().toLowerCase()).maybeSingle();
  if (!u) { await hashPassword(password); return bad(); } // igualar tiempos de respuesta

  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }, 429);
  }
  if (!(await verifyPassword(password, u.password_hash))) {
    const n = u.failed_attempts + 1;
    await db.from("users").update(
      n >= 5 ? { failed_attempts: 0, locked_until: new Date(Date.now() + 5 * 60_000).toISOString() } : { failed_attempts: n },
    ).eq("id", u.id);
    return bad();
  }
  if (!u.active) return json({ error: "Tu cuenta está desactivada. Habla con el staff." }, 403);

  await db.from("users").update({ failed_attempts: 0, locked_until: null, last_login: new Date().toISOString() }).eq("id", u.id);
  return json({ token: await signSession(u.id), id: u.id, name: u.username, role: u.role, avatar_v: u.avatar_v ?? null });
});
