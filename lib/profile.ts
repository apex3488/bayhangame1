// Profile appearance: avatar / background images in Supabase Storage, bio and preset backgrounds.
import { getSupabase } from "./supabase";

const BUCKET = "profile-media";
export type MediaKind = "avatar" | "background";

export const BACKGROUNDS = ["default", "aurora", "sunset", "ocean", "gold", "neon", "space", "carbon", "royal"] as const;
export type BackgroundPreset = (typeof BACKGROUNDS)[number] | "custom";

/** CSS for each preset background. */
export const BACKGROUND_CSS: Record<Exclude<BackgroundPreset, "custom">, string> = {
  default: "linear-gradient(135deg, #10131c 0%, #1a2033 55%, #0b0e16 100%)",
  aurora: "radial-gradient(120% 140% at 10% 0%, #2fe0a0 0%, transparent 45%), radial-gradient(120% 140% at 90% 10%, #2f7bff 0%, transparent 50%), linear-gradient(135deg, #061a24, #0b0e1f)",
  sunset: "linear-gradient(135deg, #ff6b2c 0%, #d6006e 55%, #3b0a5c 100%)",
  ocean: "linear-gradient(160deg, #00b4ff 0%, #0057ff 45%, #021034 100%)",
  gold: "radial-gradient(120% 120% at 20% 0%, #fff3b0 0%, transparent 40%), linear-gradient(135deg, #b8860b 0%, #6b4a00 55%, #1a1200 100%)",
  neon: "linear-gradient(135deg, #ff2bd6 0%, #7a1fff 45%, #00e5ff 100%)",
  space: "radial-gradient(2px 2px at 20% 30%, #fff 50%, transparent 51%), radial-gradient(1.5px 1.5px at 70% 60%, #fff 50%, transparent 51%), radial-gradient(1px 1px at 40% 80%, #fff 50%, transparent 51%), radial-gradient(120% 120% at 80% 20%, #4c1d95 0%, transparent 55%), linear-gradient(160deg, #020617, #0b0730)",
  carbon: "repeating-linear-gradient(45deg, #0d0f14 0 6px, #151821 6px 12px)",
  royal: "radial-gradient(120% 120% at 50% 0%, #ffc94d55 0%, transparent 45%), linear-gradient(135deg, #3b0764 0%, #1e1b4b 60%, #0b0618 100%)",
};

export function mediaUrl(userId: string, kind: MediaKind, version: number | null | undefined): string | null {
  if (!version) return null;
  const { data } = getSupabase().storage.from(BUCKET).getPublicUrl(`${userId}/${kind}`);
  return `${data.publicUrl}?v=${version}`;
}

/** CSS background for a profile: custom image if set, otherwise its preset. */
export function profileBackground(p: { user_id?: string; id?: string; background: string; background_version: number | null }): string {
  const id = p.user_id ?? p.id;
  if (p.background === "custom" && id) {
    const url = mediaUrl(id, "background", p.background_version);
    if (url) return `center / cover no-repeat url("${url}")`;
  }
  return BACKGROUND_CSS[(p.background in BACKGROUND_CSS ? p.background : "default") as Exclude<BackgroundPreset, "custom">];
}

/**
 * Crops ("cover") and resizes an image in the browser and re-encodes it as WebP.
 * Re-encoding drops EXIF metadata such as GPS location and keeps uploads small.
 */
export async function processImage(file: File, kind: MediaKind): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("image_invalid");
  if (file.size > 20 * 1024 * 1024) throw new Error("image_too_big");
  const [w, h] = kind === "avatar" ? [512, 512] : [1600, 600];
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image_invalid"));
      i.src = url;
    });
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / scale;
    const sh = h / scale;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("image_invalid");
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
    for (const q of [0.88, 0.75, 0.6]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", q));
      if (blob && blob.size < 3.9 * 1024 * 1024) return blob;
    }
    throw new Error("image_too_big");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadMedia(userId: string, kind: MediaKind, file: File): Promise<void> {
  const blob = await processImage(file, kind);
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).upload(`${userId}/${kind}`, blob, {
    upsert: true,
    contentType: "image/webp",
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
  const { error: rpcError } = await supabase.rpc("set_profile_media", { p_kind: kind, p_present: true });
  if (rpcError) throw new Error(rpcError.message);
}

export async function removeMedia(userId: string, kind: MediaKind): Promise<void> {
  const supabase = getSupabase();
  const { error: rpcError } = await supabase.rpc("set_profile_media", { p_kind: kind, p_present: false });
  if (rpcError) throw new Error(rpcError.message);
  await supabase.storage.from(BUCKET).remove([`${userId}/${kind}`]);
}

export async function updateAppearance(bio: string, background: BackgroundPreset): Promise<void> {
  const { error } = await getSupabase().rpc("update_profile_appearance", { p_bio: bio, p_background: background });
  if (error) throw new Error(error.message);
}

export interface PublicProfile {
  id: string;
  game_name: string;
  public_id: number;
  level: number;
  created_at: string;
  bio: string;
  avatar_version: number | null;
  background: string;
  background_version: number | null;
  status: string;
  capital: number;
  loadout: Record<string, { code: string; icon: string; rarity: string; style: Record<string, string | boolean> }>;
  vip: number | null;
  corporation: string | null;
  partner: string | null;
  stats: { games_played: number; games_won: number; achievements: number; cars: number; luxury: number };
}

export async function fetchPublicProfile(name: string): Promise<PublicProfile | null> {
  const { data, error } = await getSupabase().rpc("public_profile", { p_game_name: name });
  if (error) throw new Error(error.message);
  return (data as PublicProfile | null) ?? null;
}

/** Moderation: hide a player's media, then delete the file through the Storage API. */
export async function adminClearMedia(userId: string, what: "avatar" | "background" | "bio", reason: string): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("admin_clear_profile_media", { p_user: userId, p_what: what, p_reason: reason });
  if (error) throw new Error(error.message);
  const path = (data as { path?: string | null })?.path;
  if (path) await supabase.storage.from(BUCKET).remove([path]);
}
