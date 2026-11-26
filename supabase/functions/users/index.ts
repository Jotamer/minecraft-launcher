import { db, hashPassword, json, requireUser, verifyPassword } from "../_shared/common.ts";

const NAME = /^[A-Za-z0-9_]{3,16}$/;
const okPass = (p: unknown) => typeof p === "string" && p.length >= 8 && p.length <= 72;

// Acciones para cualquier usuario: me, changePassword.
// Acciones solo de moderadores: list, create, reset, setRole, setActive, delete.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  const b = await req.json().catch(() => ({}));

  if (b.action === "me") return json({ id: u.id, name: u.username, role: u.role, avatar_v: u.avatar_v ?? null });

  if (b.action === "changePassword") {
    if (!okPass(b.newPassword)) return json({ error: "La nueva contraseña debe tener entre 8 y 72 caracteres" }, 400);
    const { data } = await db.from("users").select("password_hash").eq("id", u.id).single();
    if (!data || !(await verifyPassword(String(b.current ?? ""), data.password_hash))) {
      return json({ error: "La contraseña actual no es correcta" }, 403);
    }
    await db.from("users").update({ password_hash: await hashPassword(b.newPassword) }).eq("id", u.id);
    return json({ ok: true });
  }

  if (u.role !== "moderator") return json({ error: "Solo moderadores" }, 403);

  switch (b.action) {
    case "list": {
      const { data, error } = await db.from("users").select("id,username,role,active,last_login").order("username_lower");
      if (error) return json({ error: error.message }, 500);
      return json({ users: data });
    }
    case "create": {
      if (typeof b.username !== "string" || !NAME.test(b.username)) return json({ error: "Usuario inválido: 3 a 16 caracteres (letras, números o _)" }, 400);
      if (!okPass(b.password)) return json({ error: "La contraseña debe tener entre 8 y 72 caracteres" }, 400);
      const role = ["moderator", "beta"].includes(b.role) ? b.role : "player";
      const { error } = await db.from("users").insert({ username: b.username, password_hash: await hashPassword(b.password), role });
      if (error) return json({ error: error.code === "23505" ? "Ese usuario ya existe" : error.message }, error.code === "23505" ? 409 : 500);
      return json({ ok: true });
    }
    case "reset": {
      if (!okPass(b.password)) return json({ error: "La contraseña debe tener entre 8 y 72 caracteres" }, 400);
      // Las contraseñas de los moderadores solo las cambia cada uno desde "Mi cuenta"
      const { data: target } = await db.from("users").select("role").eq("id", Number(b.id)).maybeSingle();
      if (!target) return json({ error: "Esa cuenta ya no existe" }, 404);
      if (target.role === "moderator") return json({ error: "La contraseña de un moderador solo la puede cambiar él mismo desde Mi cuenta" }, 403);
      await db.from("users").update({ password_hash: await hashPassword(b.password), failed_attempts: 0, locked_until: null }).eq("id", Number(b.id));
      return json({ ok: true });
    }
    case "setRole": {
      if (Number(b.id) === u.id) return json({ error: "No puedes cambiar tu propio rol" }, 400);
      if (!["player", "beta", "moderator"].includes(b.role)) return json({ error: "Rol inválido" }, 400);
      await db.from("users").update({ role: b.role }).eq("id", Number(b.id));
      return json({ ok: true });
    }
    case "setActive": {
      if (Number(b.id) === u.id) return json({ error: "No puedes desactivar tu propia cuenta" }, 400);
      await db.from("users").update({ active: !!b.active }).eq("id", Number(b.id));
      return json({ ok: true });
    }
    case "delete": {
      const id = Number(b.id);
      if (id === u.id) return json({ error: "No puedes eliminar tu propia cuenta" }, 400);
      const { data: t } = await db.from("users").select("id,username,role").eq("id", id).maybeSingle();
      if (!t) return json({ error: "Esa cuenta ya no existe" }, 404);
      if (t.role === "moderator") return json({ error: "Primero convierte esa cuenta en jugador (\"Hacer jugador\") y luego podrás eliminarla" }, 400);
      const { error } = await db.from("users").delete().eq("id", id);   // las versiones que publicó conservan todo (created_by pasa a null)
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, username: t.username });
    }
    default:
      return json({ error: "Acción desconocida" }, 400);
  }
});
