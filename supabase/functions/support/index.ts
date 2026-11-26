import { db, json, requireUser } from "../_shared/common.ts";

const MAX_LEN = 1000;          // caracteres por mensaje
const MAX_PER_HOUR = 5;        // mensajes que un mismo jugador puede enviar por hora (evita spam)
const TYPES = ["Solicitud", "Reporte de Bugs", "Pregunta", "Comentario/Idea", "Reporte de Jugador"];

// Cualquier usuario: send.
// Solo moderadores: unread (cuántos hay sin leer), list, markRead, delete.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  const b = await req.json().catch(() => ({}));

  if (b.action === "send") {
    const message = typeof b.message === "string" ? b.message.trim() : "";
    if (message.length < 3) return json({ error: "Escribe tu mensaje antes de enviarlo." }, 400);
    if (message.length > MAX_LEN) return json({ error: `El mensaje es demasiado largo (máximo ${MAX_LEN} caracteres).` }, 400);

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await db.from("support_messages").select("id", { count: "exact", head: true }).eq("user_id", u.id).gte("created_at", since);
    if ((count ?? 0) >= MAX_PER_HOUR) return json({ error: "Enviaste varios mensajes seguidos. Espera un rato antes de enviar otro." }, 429);

    const { error } = await db.from("support_messages").insert({ user_id: u.id, username: u.username, role: u.role, type: TYPES.includes(b.type) ? b.type : "Comentario/Idea", message });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (u.role !== "moderator") return json({ error: "Solo moderadores" }, 403);

  switch (b.action) {
    case "unread": {
      const { count, error } = await db.from("support_messages").select("id", { count: "exact", head: true }).is("read_at", null);
      if (error) return json({ error: error.message }, 500);
      return json({ count: count ?? 0 });
    }
    case "list": {
      const { data, error } = await db.from("support_messages")
        .select("id,username,role,type,message,created_at,read_at,read_by_name,users(role)")
        .order("created_at", { ascending: false }).limit(200);
      if (error) return json({ error: error.message }, 500);
      // El rol que se muestra es el actual de la cuenta; si la cuenta ya no existe, el que tenía al enviar el mensaje.
      return json({ messages: (data ?? []).map(({ users, ...m }: any) => ({ ...m, role: users?.role ?? m.role })) });
    }
    case "markRead": {
      let q = db.from("support_messages").update({ read_at: new Date().toISOString(), read_by_name: u.username }).is("read_at", null);
      if (!b.all) {
        const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isInteger) : [];
        if (!ids.length) return json({ error: "Falta el mensaje" }, 400);
        q = q.in("id", ids);
      }
      const { error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    case "delete": {
      const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isInteger) : [];
      if (!ids.length) return json({ error: "Falta el mensaje" }, 400);
      const { error } = await db.from("support_messages").delete().in("id", ids);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    default:
      return json({ error: "Acción desconocida" }, 400);
  }
});
