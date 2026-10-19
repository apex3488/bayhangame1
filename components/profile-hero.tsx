"use client";

import { motion } from "motion/react";
import { useRef, type ReactNode } from "react";
import { Camera, Crown, ImagePlus } from "lucide-react";
import { Avatar, StyledName, TitleChip } from "./cosmetic-view";
import type { Loadout } from "@/lib/economy";
import { mediaUrl, profileBackground } from "@/lib/profile";

export interface HeroData {
  id: string;
  game_name: string;
  bio: string;
  avatar_version: number | null;
  background: string;
  background_version: number | null;
}

/**
 * Profile banner: background (custom image or preset), avatar with frame, name with cosmetics and bio.
 * When `onPickAvatar` / `onPickBackground` are given, camera buttons let the owner upload images.
 */
export function ProfileHero({
  data,
  loadout,
  vipLevel,
  meta,
  right,
  children,
  busy,
  onPickAvatar,
  onPickBackground,
  labels,
}: {
  data: HeroData;
  loadout: Loadout;
  vipLevel?: number | null;
  meta?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  busy?: "avatar" | "background" | null;
  onPickAvatar?: (f: File) => void;
  onPickBackground?: (f: File) => void;
  labels?: { avatar: string; background: string };
}) {
  const avatarInput = useRef<HTMLInputElement>(null);
  const bgInput = useRef<HTMLInputElement>(null);
  const bg = profileBackground(data);
  const avatar = mediaUrl(data.id, "avatar", data.avatar_version);

  const pick = (e: React.ChangeEvent<HTMLInputElement>, fn?: (f: File) => void) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f && fn) fn(f);
  };

  return (
    <div className="panel panel-glow relative mb-5 overflow-hidden">
      <motion.div
        className="relative h-40 md:h-56"
        style={{ background: bg }}
        initial={{ opacity: 0, scale: 1.04 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--surface)] via-black/10 to-transparent" />
        {onPickBackground && (
          <>
            <button
              onClick={() => bgInput.current?.click()}
              disabled={!!busy}
              className="absolute right-4 top-4 flex items-center gap-2 rounded-xl bg-black/50 px-3 py-2 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-black/70 disabled:opacity-60"
            >
              {busy === "background" ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <ImagePlus size={14} />}
              {labels?.background}
            </button>
            <input ref={bgInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e, onPickBackground)} />
          </>
        )}
      </motion.div>

      <div className="relative -mt-14 px-6 pb-6 md:-mt-16 md:px-8">
        <div className="flex flex-wrap items-end gap-5">
          <motion.div className="relative" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 16, delay: 0.1 }}>
            <div className="rounded-full bg-[var(--surface)] p-1.5">
              <Avatar name={data.game_name} loadout={loadout} size={112} src={avatar} />
            </div>
            {onPickAvatar && (
              <>
                <button
                  onClick={() => avatarInput.current?.click()}
                  disabled={!!busy}
                  aria-label={labels?.avatar}
                  title={labels?.avatar}
                  className="absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full bg-[var(--accent)] text-white shadow-lg ring-4 ring-[var(--surface)] transition-transform hover:scale-110 disabled:opacity-60"
                >
                  {busy === "avatar" ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Camera size={16} />}
                </button>
                <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e, onPickAvatar)} />
              </>
            )}
          </motion.div>
          <div className="min-w-[240px] flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-3">
              <StyledName name={data.game_name} loadout={loadout} className="font-display text-3xl font-semibold" />
              <TitleChip loadout={loadout} />
              {vipLevel ? (
                <span className="flex items-center gap-1 rounded-full bg-gradient-to-r from-[#ffc94d] to-[#f97316] px-2.5 py-0.5 text-[11px] font-bold text-black">
                  <Crown size={12} /> VIP {vipLevel}
                </span>
              ) : null}
            </div>
            {meta && <div className="mt-1 text-sm text-[var(--muted)]">{meta}</div>}
          </div>
          {right}
        </div>
        {data.bio && (
          <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="mt-4 max-w-2xl whitespace-pre-line break-words text-sm leading-relaxed text-[var(--text)]/90">
            {data.bio}
          </motion.p>
        )}
        {children}
      </div>
    </div>
  );
}
