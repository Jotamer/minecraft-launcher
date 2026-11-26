import { db, json, requireUser } from "../_shared/common.ts";

// Fotos de perfil. El launcher reduce la imagen a 256x256 PNG antes de enviarla; aquí se vuelve a comprobar
// que sea un PNG pequeño y se guarda como <id>.png en el bucket "Profile Pictures" (con la service role).
const BUCKET = Deno.env.get("PFP_BUCKET") ?? "Profile Pictures";
const MAX_BYTES = 600 * 1024;
const MAX_SIDE = 512;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function toB64(a: Uint8Array) {
  let s = "";
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  const b = await req.json().catch(() => ({}));

  // Cambiar MI foto
  if (b.action === "set") {
    if (typeof b.image !== "string" || b.image.length > MAX_BYTES * 1.4) return json({ error: "La imagen es demasiado grande." }, 400);
    let bytes: Uint8Array;
    try { bytes = fromB64(b.image); } catch { return json({ error: "Imagen inválida." }, 400); }
    if (bytes.length < 100 || bytes.length > MAX_BYTES || !PNG_SIG.every((v, i) => bytes[i] === v)) return json({ error: "Imagen inválida." }, 400);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const w = dv.getUint32(16), h = dv.getUint32(20);               // IHDR: ancho y alto
    if (!w || !h || w > MAX_SIDE || h > MAX_SIDE) return json({ error: "La imagen debe medir como máximo 512x512." }, 400);

    const { error } = await db.storage.from(BUCKET).upload(`${u.id}.png`, bytes, { contentType: "image/png", upsert: true });
    if (error) return json({ error: `No se pudo guardar la imagen. Revisa que exista el bucket "${BUCKET}" en Storage.` }, 500);
    const v = Date.now();
    const { error: e2 } = await db.from("users").update({ avatar_v: v }).eq("id", u.id);
    if (e2) return json({ error: e2.message }, 500);
    return json({ ok: true, avatar_v: v });
  }

  // Leer la foto de cualquier usuario (se muestra en Usuarios conectados, Perfil, etc.)
  if (b.action === "get") {
    const id = Number(b.id);
    if (!Number.isInteger(id) || id < 1) return json({ error: "Usuario inválido" }, 400);
    const { data: row } = await db.from("users").select("avatar_v").eq("id", id).maybeSingle();
    if (!row?.avatar_v) return json({ image: null });
    const { data, error } = await db.storage.from(BUCKET).download(`${id}.png`);
    if (error || !data) return json({ image: null });
    return json({ image: toB64(new Uint8Array(await data.arrayBuffer())), avatar_v: row.avatar_v });
  }

  return json({ error: "Acción desconocida" }, 400);
});
