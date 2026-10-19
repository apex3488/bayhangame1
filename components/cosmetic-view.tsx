"use client";

import { motion } from "motion/react";
import type { CosmeticItem, Loadout } from "@/lib/economy";

export const RARITY_COLOR: Record<string, string> = {
  common: "#94a3b8",
  rare: "#38bdf8",
  epic: "#a855f7",
  legendary: "#f59e0b",
  mythic: "#f43f5e",
  limited: "#ffc94d",
};

/** "frame_bayhan_elite" → "Bayhan Elite". Cosmetic names are brand-style and shared by all languages. */
export function cosmeticName(code: string): string {
  return code
    .replace(/^(frame|badge|theme|ns|title|fx|box)_/, "")
    .split("_")
    .map((w) => (w === "og" || w === "top10" || w === "top100" ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Avatar with the equipped frame (gradient ring, animated for animated frames) and effect glow. */
export function Avatar({ name, loadout, size = 48, src }: { name: string; loadout: Loadout; size?: number; src?: string | null }) {
  const frame = loadout.frame?.style;
  const glow = loadout.effect?.style?.glow as string | undefined;
  const from = (frame?.from as string) ?? "var(--border-strong)";
  const to = (frame?.to as string) ?? "var(--border-strong)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ background: `conic-gradient(from 0deg, ${from}, ${to}, ${from})`, boxShadow: glow ? `0 0 18px ${glow}` : undefined }}
        animate={frame?.animated ? { rotate: 360 } : {}}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />
      <div
        className="absolute inset-[3px] grid place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[var(--surface-3)] to-[var(--bg-2)] font-display font-bold"
        style={{ fontSize: size * 0.32 }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- user images from Supabase Storage, already resized
          <img src={src} alt={name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          initials(name)
        )}
      </div>
      {loadout.badge && (
        <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--bg)] text-[11px] ring-1 ring-[var(--border)]">
          {loadout.badge.icon}
        </span>
      )}
    </div>
  );
}

/** Player name with the equipped name style and effect. */
export function StyledName({ name, loadout, className }: { name: string; loadout: Loadout; className?: string }) {
  const wrap = loadout.name_style?.style?.wrap as string | undefined;
  const glow = loadout.effect?.style?.glow as string | undefined;
  const text = wrap ? wrap.replace("{name}", name) : name;
  return (
    <span className={className} style={glow ? { textShadow: `0 0 12px ${glow}` } : undefined}>
      {text}
    </span>
  );
}

export function TitleChip({ loadout }: { loadout: Loadout }) {
  if (!loadout.title) return null;
  const color = RARITY_COLOR[loadout.title.rarity] ?? "#94a3b8";
  return (
    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: `${color}22`, color }}>
      {cosmeticName(loadout.title.code)}
    </span>
  );
}

/** Visual preview of an item inside store tiles. */
export function CosmeticPreview({ item, size = 64 }: { item: CosmeticItem; size?: number }) {
  const s = item.style;
  if (item.category === "frame") {
    return (
      <motion.div
        className="rounded-full"
        style={{ width: size, height: size, background: `conic-gradient(${s.from}, ${s.to}, ${s.from})`, padding: 4 }}
        animate={s.animated ? { rotate: 360 } : {}}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      >
        <div className="grid h-full w-full place-items-center rounded-full bg-[var(--bg-2)] text-xl">{item.icon}</div>
      </motion.div>
    );
  }
  if (item.category === "theme") {
    return (
      <div className="flex gap-1.5">
        {[s.accent, s.accent2, "#0f121b"].map((c, i) => (
          <span key={i} className="h-10 w-6 rounded-lg ring-1 ring-white/10" style={{ background: c as string }} />
        ))}
      </div>
    );
  }
  if (item.category === "name_style") {
    return <span className="font-display text-sm font-semibold">{(s.wrap as string).replace("{name}", "Name")}</span>;
  }
  if (item.category === "effect") {
    return (
      <motion.span
        className="font-display text-lg font-semibold"
        animate={{ textShadow: [`0 0 6px ${s.glow}`, `0 0 22px ${s.glow}`, `0 0 6px ${s.glow}`] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        Name
      </motion.span>
    );
  }
  return <span style={{ fontSize: size * 0.6 }}>{item.icon}</span>;
}
