// Notifications, news and broadcasts (migrations 0019–0020). Every call is checked on the server.
import { getSupabase } from "./supabase";

async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type NotificationKind = "broadcast" | "news" | "transfer_in" | "admin_credit" | "marriage_proposal" | "corp_invite";

export interface GameNotification {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  params: Record<string, string | number | null>;
  link: string | null;
  created_at: string;
  read: boolean;
}

export const fetchNotifications = (limit = 40) => rpc<{ unread: number; items: GameNotification[] }>("my_notifications", { p_limit: limit });
export const fetchUnread = () => rpc<number>("my_unread_notifications");
export const markRead = (ids?: number[]) => rpc<number>("notifications_mark_read", { p_ids: ids ?? null });

export interface NewsPost {
  id: number;
  title: string;
  body: string;
  image_path: string | null;
  pinned: boolean;
  published_at: string;
  author: string | null;
  hidden?: boolean;
  read_count?: number;
}

const NEWS_BUCKET = "news-media";

export function newsImageUrl(path: string | null): string | null {
  if (!path) return null;
  return getSupabase().storage.from(NEWS_BUCKET).getPublicUrl(path).data.publicUrl;
}

export const fetchNews = (limit = 20, before?: number) => rpc<NewsPost[]>("news_list", { p_limit: limit, p_before: before ?? null });

// ---------------------------------------------------------------- admin

export interface BroadcastRow {
  id: number;
  title: string;
  body: string;
  link: string | null;
  recipients: number;
  read_count: number;
  created_at: string;
  actor: string | null;
  target: string | null;
}

export const adminBroadcast = (title: string, body: string, link: string | null, targetUser: string | null) =>
  rpc<{ id: number; recipients: number }>("admin_broadcast", { p_title: title, p_body: body, p_link: link, p_target_user: targetUser });
export const adminListBroadcasts = () => rpc<BroadcastRow[]>("admin_list_broadcasts", { p_limit: 30 });
export const adminListNews = () => rpc<NewsPost[]>("admin_list_news", { p_limit: 100 });
export const adminUpdateNews = (p: NewsPost, patch: { pinned?: boolean; hidden?: boolean }) =>
  rpc("admin_update_news", { p_id: p.id, p_title: p.title, p_body: p.body, p_pinned: patch.pinned ?? p.pinned, p_hidden: patch.hidden ?? p.hidden ?? false });

/** Resizes the photo in the browser (max 1600 px wide, WebP; drops EXIF such as GPS) and uploads it. */
export async function uploadNewsImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("image_invalid");
  if (file.size > 20 * 1024 * 1024) throw new Error("image_too_big");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image_invalid"));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const q of [0.86, 0.72, 0.6]) {
      blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", q));
      if (blob && blob.size < 4.8 * 1024 * 1024) break;
    }
    if (!blob || blob.size >= 4.8 * 1024 * 1024) throw new Error("image_too_big");
    const path = `news/${crypto.randomUUID()}.webp`;
    const { error } = await getSupabase().storage.from(NEWS_BUCKET).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
    if (error) throw new Error(error.message);
    return path;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const adminPublishNews = (title: string, body: string, imagePath: string | null, pinned: boolean, notify: boolean) =>
  rpc<{ id: number; notified: number }>("admin_publish_news", { p_title: title, p_body: body, p_image_path: imagePath, p_pinned: pinned, p_notify: notify });

export async function adminDeleteNews(id: number): Promise<void> {
  const r = await rpc<{ path: string | null }>("admin_delete_news", { p_id: id });
  if (r?.path) await getSupabase().storage.from(NEWS_BUCKET).remove([r.path]);
}

/** Internal pages an admin may link a broadcast to (the server also rejects anything external). */
export const LINK_TARGETS = ["/news", "/", "/games", "/store", "/events", "/promo", "/quests", "/leaderboard", "/profile"];
