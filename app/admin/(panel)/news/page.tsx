"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, ImagePlus, Pin, PinOff, Trash2, X } from "lucide-react";
import { useAsk, useGame } from "@/components/game-context";
import { ReadOnlyNote, useAdminRole } from "@/components/admin-shell";
import { Button, PageTitle, Skeleton } from "@/components/ui";
import { can } from "@/lib/admin";
import { adminDeleteNews, adminListNews, adminPublishNews, adminUpdateNews, newsImageUrl, uploadNewsImage, type NewsPost } from "@/lib/social";
import { getSupabase } from "@/lib/supabase";

const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--bg-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]";

export default function AdminNews() {
  const { t, toast, toastError } = useGame();
  const ask = useAsk();
  const role = useAdminRole();
  const editable = can.manage(role);
  const [rows, setRows] = useState<NewsPost[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [notify, setNotify] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    adminListNews().then(setRows).catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function pick(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast(t("err_image_invalid"), "error");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function publish(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) return toast(`${t("err_invalid_value")}: ${t("a_newsTitle")}`, "error");
    if (!body.trim()) return toast(`${t("err_invalid_value")}: ${t("a_newsBody")}`, "error");
    setBusy("publish");
    let uploaded: string | null = null;
    try {
      if (file) uploaded = await uploadNewsImage(file);
      const r = await adminPublishNews(title.trim(), body.trim(), uploaded, pinned, notify);
      toast(notify ? `${t("a_newsPublished")} · ${t("a_notified")}: ${r.notified}` : t("a_newsPublished"), "success");
      setTitle("");
      setBody("");
      setPinned(false);
      setFile(null);
      setPreview(null);
      load();
    } catch (err) {
      // Do not leave an orphan photo in storage if publishing failed.
      if (uploaded) await getSupabase().storage.from("news-media").remove([uploaded]).catch(() => {});
      toastError(err);
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      toast(t("a_done"), "success");
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageTitle title={t("a_news")} subtitle={t("a_newsSubtitle")} />
      <ReadOnlyNote show={!editable} />
      {editable && (
        <form onSubmit={publish} className="panel mb-5 grid gap-4 p-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <p className="text-sm font-semibold">{t("a_newsCreate")}</p>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t("a_newsTitle")} className={`${inputCls} font-semibold`} />
            <div>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={8} placeholder={t("a_newsBody")} className={`${inputCls} resize-y`} />
              <p className="mt-1 text-right text-[11px] text-[var(--dim)]">{body.length}/4000</p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                {t("a_newsPin")}
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                {t("a_newsNotify")}
              </label>
            </div>
            <Button disabled={busy !== null} loading={busy === "publish"}>
              {t("a_newsPublish")}
            </Button>
          </div>
          <div>
            <p className="mb-2 text-xs text-[var(--muted)]">{t("a_newsPhoto")}</p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pick(e.dataTransfer.files?.[0]);
              }}
              className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-2)] text-[var(--muted)] transition-colors hover:border-[var(--accent)]"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
                <img src={preview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-2 text-xs">
                  <ImagePlus size={24} /> {t("a_newsPhotoHint")}
                </span>
              )}
            </button>
            {preview && (
              <button type="button" onClick={() => { setFile(null); setPreview(null); }} className="mt-2 flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--danger)]">
                <X size={13} /> {t("a_newsPhotoRemove")}
              </button>
            )}
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </form>
      )}

      {!rows ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("a_noData")}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((n) => {
            const img = newsImageUrl(n.image_path);
            return (
              <div key={n.id} className={`panel flex flex-col gap-4 p-4 sm:flex-row ${n.hidden ? "opacity-60" : ""}`}>
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element -- uploaded news photo
                  <img src={img} alt="" className="aspect-video w-full shrink-0 rounded-xl object-cover sm:w-48" />
                ) : (
                  <div className="hidden aspect-video w-48 shrink-0 rounded-xl bg-[var(--bg-2)] sm:block" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                    {n.pinned && <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[var(--accent-2)]">{t("newsPinned")}</span>}
                    {n.hidden && <span className="rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[var(--danger)]">{t("a_newsHidden")}</span>}
                    <span>{new Date(n.published_at).toLocaleString()}</span>
                    {n.author && <span>· {n.author}</span>}
                    <span>· {t("a_readBy")}: {n.read_count ?? 0}</span>
                  </div>
                  <p className="mt-1 font-semibold">{n.title}</p>
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-[var(--muted)]">{n.body}</p>
                  {editable && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="ghost" className="py-1.5 text-xs" disabled={busy !== null} onClick={() => act(`pin${n.id}`, () => adminUpdateNews(n, { pinned: !n.pinned }))}>
                        {n.pinned ? <PinOff size={13} /> : <Pin size={13} />} {n.pinned ? t("a_newsUnpin") : t("a_newsPin")}
                      </Button>
                      <Button variant="ghost" className="py-1.5 text-xs" disabled={busy !== null} onClick={() => act(`hide${n.id}`, () => adminUpdateNews(n, { hidden: !n.hidden }))}>
                        {n.hidden ? <Eye size={13} /> : <EyeOff size={13} />} {n.hidden ? t("a_newsShow") : t("a_newsHide")}
                      </Button>
                      <Button
                        variant="outline"
                        className="py-1.5 text-xs"
                        disabled={busy !== null}
                        onClick={async () => (await ask(`${t("a_newsDelete")}?`, { danger: true, message: n.title })) && act(`del${n.id}`, () => adminDeleteNews(n.id))}
                      >
                        <Trash2 size={13} /> {t("a_newsDelete")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
