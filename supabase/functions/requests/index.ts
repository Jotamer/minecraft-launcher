import { db, json } from "../_shared/common.ts";

// Solicitudes SIN sesión desde la pantalla de inicio de sesión: pedir una cuenta o pedir restaurar una.
// No crea ni modifica cuentas: solo deja un mensaje para los moderadores, enviado por el "Servicio de Solicitudes".
// Al solicitante siempre se le responde igual (no se revela si la cuenta existe o no).
const NAME = /^[A-Za-z0-9_]{3,16}$/;                  // usuario de Minecraft Java
const DISCORD = /^[\p{L}\p{N}_.#-]{2,37}$/u;           // usuario de Discord (con o sin #0000)
const MAX_PER_HOUR_IP = 5;                            // solicitudes por hora desde la misma conexión
const MAX_PER_HOUR_ALL = 40;                          // tope general por hora, por si cambian de conexión

async function sha256(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const b = await req.json().catch(() => ({}));
  if (b.kind !== "create" && b.kind !== "restore") return json({ error: "Solicitud inválida" }, 400);

  const username = typeof b.username === "string" ? b.username.trim() : "";
  if (!NAME.test(username)) return json({ error: "Usuario inválido: 3 a 16 caracteres (letras, números o _)." }, 400);

  let message: string;
  if (b.kind === "create") {
    message = `Se ha solicitado la creacion de una cuenta con el nombre de usuario ${username}`;
  } else {
    const discord = typeof b.discord === "string" ? b.discord.trim() : "";
    if (!DISCORD.test(discord)) return json({ error: "Escribe tu nombre de usuario de Discord (2 a 37 caracteres, sin espacios)." }, 400);
    message = `Se ha solicitado restaurar la cuenta de ${username}, contactar al DM de discord: ${discord}`;
  }

  // Límite contra spam
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
  const ipHash = ip ? await sha256("solicitud:" + ip) : null;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  if (ipHash) {
    const { count } = await db.from("support_messages").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since);
    if ((count ?? 0) >= MAX_PER_HOUR_IP) return json({ error: "Enviaste varias solicitudes seguidas. Espera un rato antes de intentarlo de nuevo." }, 429);
  }
  const { count: all } = await db.from("support_messages").select("id", { count: "exact", head: true }).eq("role", "service").gte("created_at", since);
  if ((all ?? 0) >= MAX_PER_HOUR_ALL) return json({ error: "Hay demasiadas solicitudes en este momento. Inténtalo más tarde." }, 429);

  // Si ya hay una igual sin leer, no se duplica (el jugador igual ve el aviso de éxito)
  const { data: dup } = await db.from("support_messages").select("id").eq("role", "service").eq("message", message).is("read_at", null).limit(1);
  if (dup && dup.length) return json({ ok: true });

  const { error } = await db.from("support_messages").insert({
    user_id: null, username: "3AM Launcher", role: "service", type: "Solicitud", message, ip_hash: ipHash,
  });
  if (error) return json({ error: "No se pudo enviar la solicitud. Inténtalo de nuevo." }, 500);
  return json({ ok: true });
});
