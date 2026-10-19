"use client";

import { motion } from "motion/react";
import { useRef, useState } from "react";
import { Check, ImagePlus, Trash2 } from "lucide-react";
import { useGame } from "./game-context";
import { Button } from "./ui";
import { BACKGROUNDS, BACKGROUND_CSS, mediaUrl, removeMedia, updateAppearance, uploadMedia, type BackgroundPreset } from "@/lib/profile";

/** Edits bio and background; avatar/background images upload straight from here or from the banner. */
export function AppearanceEditor() {
  const { t, snapshot, refresh, toast, toastError } = useGame();
  const [bio, setBio] = useState(snapshot?.bio ?? "");
  const [bg, setBg] = useState<BackgroundPreset>((snapshot?.background as BackgroundPreset) ?? "default");
  const [busy, setBusy] = useState<string | null>(null);
  const bgInput = useRef<HTMLInputElement>(null);
  if (!snapshot) return null;

  const customUrl = mediaUrl(snapshot.user_id, "background", snapshot.background_version);
  const changed = bio.trim() !== snapshot.bio || bg !== snapshot.background;

  async function act(id: string, fn: () => Promise<void>, msg: string) {
    setBusy(id);
    try {
      await fn();
      toast(msg, "success");
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel mb-5 space-y-5 p-5 md:p-6">
      <p className="text-sm font-semibold">{t("editProfile")}</p>

      <label className="block">
        <span className="mb-2 flex justify-between text-xs text-[var(--muted)]">
          <span>{t("bioLabel")}</span>
          <span className={`tabular ${bio.length > 200 ? "text-[var(--danger)]" : ""}`}>{bio.length}/200</span>
        </span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={200}
          rows={3}
          placeholder={t("bioPlaceholder")}
          className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>

      <div>
        <p className="mb-2 text-xs text-[var(--muted)]">{t("profileBackground")}</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-10">
          {BACKGROUNDS.map((b) => (
            <motion.button
              key={b}
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => setBg(b)}
              className={`relative aspect-[4/3] overflow-hidden rounded-xl ring-2 transition ${bg === b ? "ring-[var(--accent)]" : "ring-transparent hover:ring-[var(--border-strong)]"}`}
              style={{ background: BACKGROUND_CSS[b] }}
              title={t(`bg_${b}`)}
            >
              <span className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 text-[10px] font-semibold">{t(`bg_${b}`)}</span>
              {bg === b && <Check size={14} className="absolute right-1 top-1" />}
            </motion.button>
          ))}
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => (customUrl ? setBg("custom") : bgInput.current?.click())}
            className={`relative grid aspect-[4/3] place-items-center overflow-hidden rounded-xl border border-dashed border-[var(--border-strong)] ring-2 transition ${bg === "custom" ? "ring-[var(--accent)]" : "ring-transparent"}`}
            style={customUrl ? { background: `center / cover url("${customUrl}")` } : undefined}
            title={t("bg_custom")}
          >
            {!customUrl && <ImagePlus size={18} className="text-[var(--muted)]" />}
            <span className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 text-[10px] font-semibold">{t("bg_custom")}</span>
            {bg === "custom" && <Check size={14} className="absolute right-1 top-1" />}
          </motion.button>
        </div>
        <input
          ref={bgInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) act("bg-upload", () => uploadMedia(snapshot.user_id, "background", f), t("backgroundUpdated")).then(() => setBg("custom"));
          }}
        />
        <p className="mt-2 text-[11px] text-[var(--dim)]">{t("imageHint")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={!changed || busy !== null} loading={busy === "save"} onClick={() => act("save", () => updateAppearance(bio, bg), t("profileSaved"))}>
          {t("saveProfile")}
        </Button>
        <Button variant="ghost" disabled={busy !== null} loading={busy === "bg-upload"} onClick={() => bgInput.current?.click()}>
          <ImagePlus size={15} /> {t("uploadBackground")}
        </Button>
        {snapshot.avatar_version && (
          <Button variant="ghost" disabled={busy !== null} loading={busy === "rm-avatar"} onClick={() => act("rm-avatar", () => removeMedia(snapshot.user_id, "avatar"), t("removeAvatar"))}>
            <Trash2 size={15} /> {t("removeAvatar")}
          </Button>
        )}
        {snapshot.background_version && (
          <Button variant="ghost" disabled={busy !== null} loading={busy === "rm-bg"} onClick={() => act("rm-bg", () => removeMedia(snapshot.user_id, "background"), t("removeBackground")).then(() => setBg("default"))}>
            <Trash2 size={15} /> {t("removeBackground")}
          </Button>
        )}
      </div>
    </div>
  );
}
