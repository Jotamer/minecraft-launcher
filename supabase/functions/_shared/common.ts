import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate, verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(Deno.env.get("SESSION_SECRET")!),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const signSession = (id: number) =>
  create({ alg: "HS256", typ: "JWT" }, { sub: String(id), exp: getNumericDate(60 * 60 * 24 * 30) }, key);

export type Role = "player" | "beta" | "moderator";
export type User = { id: number; username: string; role: Role; avatar_v?: number | null };
// Moderadores y Beta Testers pueden ver y descargar las versiones "testing".
export const canTest = (role: string) => role === "moderator" || role === "beta";

// Verifica la sesión y lee rol/estado SIEMPRE desde la base de datos.
export async function requireUser(req: Request): Promise<User | Response> {
  const token = req.headers.get("x-session");
  if (!token) return json({ error: "No autenticado" }, 401);
  try {
    const payload = await verify(token, key);
    const { data } = await db.from("users").select("id,username,role,active,avatar_v").eq("id", Number(payload.sub)).single();
    if (!data || !data.active) return json({ error: "Cuenta no disponible" }, 401);
    return { id: data.id, username: data.username, role: data.role, avatar_v: data.avatar_v ?? null };
  } catch {
    return json({ error: "Sesión inválida" }, 401);
  }
}

// ---- Contraseñas: PBKDF2-SHA256 (formato: pbkdf2$iteraciones$salt$hash, en base64)
const ITER = 600000;
const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(pw: string, salt: Uint8Array, iter: number) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256));
}
export async function hashPassword(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await derive(pw, salt, ITER))}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, it, s, h] = stored.split("$");
  if (alg !== "pbkdf2") return false;
  const d = await derive(pw, unb64(s), Number(it));
  const e = unb64(h);
  if (d.length !== e.length) return false;
  let diff = 0;
  for (let i = 0; i < d.length; i++) diff |= d[i] ^ e[i];
  return diff === 0;
}
