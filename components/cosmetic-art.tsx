"use client";

import { motion } from "motion/react";
import { useId } from "react";
import type { CosmeticItem } from "@/lib/economy";
import { cosmeticName } from "./cosmetic-view";

/** Metal of each rarity: light, mid, dark. */
const METAL: Record<string, [string, string, string]> = {
  common: ["#e2e8f0", "#94a3b8", "#475569"],
  rare: ["#bae6fd", "#38bdf8", "#075985"],
  epic: ["#f3e8ff", "#a855f7", "#581c87"],
  legendary: ["#fff7c2", "#f59e0b", "#7c2d12"],
  mythic: ["#ffe4e6", "#f43f5e", "#7f1d1d"],
  limited: ["#fffbe6", "#ffc94d", "#8a5a00"],
};

const SHINY = new Set(["legendary", "mythic", "limited"]);

/**
 * Showcase art for a store item, drawn per category:
 * frames wrap the player's own avatar, badges are medals, titles are ribbons,
 * themes are a mini interface, boxes are gift boxes. Scales with `size`.
 */
export function CosmeticArt({ item, size = 96, avatarSrc, playerName }: { item: CosmeticItem; size?: number; avatarSrc?: string | null; playerName?: string }) {
  const metal = METAL[item.rarity] ?? METAL.common;
  return (
    <div className="relative grid place-items-center" style={{ width: size * 1.6, height: size * 1.15 }}>
      <div className="pointer-events-none absolute inset-0 rounded-full blur-2xl" style={{ background: `radial-gradient(closest-side, ${metal[1]}55, transparent)` }} />
      {SHINY.has(item.rarity) && <Sparkles color={metal[0]} size={size} />}
      <div className="relative">
        {item.category === "frame" && <FrameArt item={item} size={size} avatarSrc={avatarSrc} playerName={playerName} />}
        {item.category === "badge" && <Medal item={item} size={size} metal={metal} />}
        {item.category === "title" && <Ribbon item={item} size={size} metal={metal} />}
        {item.category === "theme" && <ThemeArt item={item} size={size} />}
        {item.category === "name_style" && <NamePlate item={item} size={size} metal={metal} playerName={playerName} />}
        {item.category === "effect" && <EffectArt item={item} size={size} playerName={playerName} />}
        {item.category === "box" && <GiftBox size={size} metal={metal} />}
      </div>
    </div>
  );
}

function Sparkles({ color, size }: { color: string; size: number }) {
  const pts = [
    [0.12, 0.2, 0],
    [0.88, 0.25, 0.6],
    [0.8, 0.85, 1.2],
    [0.18, 0.8, 1.8],
    [0.5, 0.05, 2.4],
  ];
  return (
    <>
      {pts.map(([x, y, d], i) => (
        <motion.svg
          key={i}
          viewBox="0 0 10 10"
          className="pointer-events-none absolute"
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: size * 0.13, height: size * 0.13 }}
          animate={{ scale: [0, 1, 0], rotate: [0, 90] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: d, ease: "easeInOut" }}
        >
          <path d="M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z" fill={color} />
        </motion.svg>
      ))}
    </>
  );
}

function FrameArt({ item, size, avatarSrc, playerName }: { item: CosmeticItem; size: number; avatarSrc?: string | null; playerName?: string }) {
  const s = item.style;
  const from = (s.from as string) ?? "#94a3b8";
  const to = (s.to as string) ?? from;
  const initials = (playerName ?? "B").slice(0, 1).toUpperCase();
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ background: `conic-gradient(from 0deg, ${from}, ${to}, ${from})`, boxShadow: `0 0 ${size * 0.25}px ${from}88` }}
        animate={s.animated ? { rotate: 360 } : {}}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />
      <div className="absolute grid place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[var(--surface-3)] to-[var(--bg-2)] font-display font-bold" style={{ inset: size * 0.07, fontSize: size * 0.32 }}>
        {avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- the player's own avatar
          <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </div>
      <span className="absolute -bottom-1 -right-1 grid place-items-center rounded-full bg-[var(--bg)] ring-1 ring-[var(--border)]" style={{ width: size * 0.32, height: size * 0.32, fontSize: size * 0.17 }}>
        {item.icon}
      </span>
    </div>
  );
}

function Medal({ item, size, metal }: { item: CosmeticItem; size: number; metal: [string, string, string] }) {
  const id = useId();
  return (
    <motion.svg viewBox="0 0 100 110" width={size} height={size * 1.1} whileHover={{ rotateY: 18 }} className="drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]">
      <defs>
        <linearGradient id={`${id}m`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={metal[0]} />
          <stop offset="0.5" stopColor={metal[1]} />
          <stop offset="1" stopColor={metal[2]} />
        </linearGradient>
        <radialGradient id={`${id}f`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor={metal[2]} stopOpacity="0.95" />
        </radialGradient>
      </defs>
      {/* ribbon tails */}
      <path d="M30 62 L18 104 L32 96 L40 108 L48 70 Z" fill={metal[2]} />
      <path d="M70 62 L82 104 L68 96 L60 108 L52 70 Z" fill={metal[1]} />
      {/* medal */}
      <circle cx="50" cy="44" r="38" fill={`url(#${id}m)`} />
      <circle cx="50" cy="44" r="31" fill={`url(#${id}f)`} />
      <circle cx="50" cy="44" r="31" fill="none" stroke={metal[0]} strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="2 3" />
      <text x="50" y="56" textAnchor="middle" fontSize="32">
        {item.icon}
      </text>
      <path d="M22 30 A30 30 0 0 1 60 12" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="3" fill="none" strokeLinecap="round" />
    </motion.svg>
  );
}

function Ribbon({ item, size, metal }: { item: CosmeticItem; size: number; metal: [string, string, string] }) {
  const id = useId();
  const label = cosmeticName(item.code).toUpperCase();
  const w = size * 1.85;
  const crown = item.rarity === "legendary" || item.rarity === "mythic" || item.rarity === "limited";
  return (
    <svg viewBox="0 0 150 70" width={w} height={w * 0.47} className="drop-shadow-[0_8px_14px_rgba(0,0,0,0.5)]">
      <defs>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={metal[0]} />
          <stop offset="0.55" stopColor={metal[1]} />
          <stop offset="1" stopColor={metal[2]} />
        </linearGradient>
      </defs>
      <path d="M4 34 L22 30 L22 58 L4 62 L12 48 Z" fill={metal[2]} />
      <path d="M146 34 L128 30 L128 58 L146 62 L138 48 Z" fill={metal[2]} />
      <path d="M16 26 Q75 14 134 26 L134 54 Q75 42 16 54 Z" fill={`url(#${id}r)`} stroke={metal[0]} strokeOpacity="0.7" />
      {crown && <text x="75" y="18" textAnchor="middle" fontSize="16">👑</text>}
      <text x="75" y="44" textAnchor="middle" fontFamily="var(--font-unbounded), sans-serif" fontWeight="800" fontSize={label.length > 10 ? 9 : 11} fill="#ffffff" stroke="#000" strokeOpacity="0.25" strokeWidth="0.6">
        {label}
      </text>
    </svg>
  );
}

function ThemeArt({ item, size }: { item: CosmeticItem; size: number }) {
  const a = (item.style.accent as string) ?? "#2f7bff";
  const b = (item.style.accent2 as string) ?? a;
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b0e16] p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.5)]" style={{ width: size * 1.25, height: size * 0.95 }}>
      <div className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm" style={{ background: a }} />
        <span className="h-1 flex-1 rounded-full bg-white/10" />
        <span className="h-2 w-5 rounded-full" style={{ background: `linear-gradient(90deg, ${a}, ${b})` }} />
      </div>
      <div className="mt-1.5 rounded-md p-1.5" style={{ background: `linear-gradient(135deg, ${a}33, transparent)` }}>
        <div className="h-1.5 w-1/2 rounded-full bg-white/50" />
        <div className="mt-1 h-2.5 w-3/4 rounded-full" style={{ background: b }} />
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1">
        {[a, b, "#ffffff22"].map((c, i) => (
          <span key={i} className="h-4 rounded" style={{ background: c }} />
        ))}
      </div>
      <div className="mt-1.5 h-3 rounded-md text-center text-[7px] font-bold leading-3 text-white" style={{ background: a }}>
        OK
      </div>
    </div>
  );
}

function NamePlate({ item, size, metal, playerName }: { item: CosmeticItem; size: number; metal: [string, string, string]; playerName?: string }) {
  const text = ((item.style.wrap as string) ?? "{name}").replace("{name}", playerName ?? "Name");
  return (
    <div className="rounded-xl px-3 py-2 shadow-[0_8px_18px_rgba(0,0,0,0.45)]" style={{ background: `linear-gradient(135deg, ${metal[2]}, #0b0e16)`, border: `1px solid ${metal[1]}88` }}>
      <span className="whitespace-nowrap font-display font-semibold" style={{ fontSize: Math.max(10, Math.min(size * 0.17, (size * 2.2) / Math.max(6, text.length))), color: metal[0] }}>
        {text}
      </span>
    </div>
  );
}

function EffectArt({ item, size, playerName }: { item: CosmeticItem; size: number; playerName?: string }) {
  const glow = (item.style.glow as string) ?? "#2f7bff";
  return (
    <div className="relative grid place-items-center" style={{ width: size * 1.3, height: size * 0.8 }}>
      <motion.div className="absolute inset-0 rounded-full blur-xl" style={{ background: glow }} animate={{ opacity: [0.25, 0.55, 0.25], scale: [0.85, 1, 0.85] }} transition={{ duration: 2.4, repeat: Infinity }} />
      <motion.span
        className="relative font-display font-semibold text-white"
        style={{ fontSize: Math.max(12, size * 0.2) }}
        animate={{ textShadow: [`0 0 6px ${glow}`, `0 0 24px ${glow}`, `0 0 6px ${glow}`] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        {playerName ?? "Name"}
      </motion.span>
      <span className="absolute -right-1 -top-1" style={{ fontSize: size * 0.22 }}>
        {item.icon}
      </span>
    </div>
  );
}

function GiftBox({ size, metal }: { size: number; metal: [string, string, string] }) {
  const id = useId();
  return (
    <motion.svg viewBox="0 0 120 120" width={size * 1.1} height={size * 1.1} animate={{ y: [0, -4, 0] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}>
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={metal[1]} />
          <stop offset="1" stopColor={metal[2]} />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={metal[0]} />
          <stop offset="1" stopColor={metal[1]} />
        </linearGradient>
        <radialGradient id={`${id}g`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor={metal[0]} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* light escaping from under the lid */}
      <motion.g animate={{ opacity: [0.35, 0.8, 0.35] }} transition={{ duration: 2, repeat: Infinity }}>
        <path d="M60 46 L30 4 L44 4 Z M60 46 L76 2 L90 6 Z M60 46 L58 0 L66 0 Z" fill={metal[0]} opacity="0.55" />
        <ellipse cx="60" cy="46" rx="40" ry="10" fill={`url(#${id}g)`} />
      </motion.g>
      <rect x="22" y="56" width="76" height="54" rx="6" fill={`url(#${id}b)`} />
      <rect x="52" y="56" width="16" height="54" fill="#ffffff" opacity="0.85" />
      <rect x="22" y="56" width="76" height="8" fill="#000000" opacity="0.18" />
      <motion.g animate={{ y: [0, -3, 0], rotate: [0, -2, 0] }} transition={{ duration: 2, repeat: Infinity }} style={{ originX: "60px", originY: "50px" }}>
        <rect x="16" y="40" width="88" height="18" rx="5" fill={`url(#${id}l)`} />
        <rect x="52" y="40" width="16" height="18" fill="#ffffff" />
        <path d="M60 40 C46 22 30 28 38 38 C42 42 52 41 60 40 Z" fill="#ffffff" />
        <path d="M60 40 C74 22 90 28 82 38 C78 42 68 41 60 40 Z" fill="#f1f5f9" />
        <circle cx="60" cy="40" r="5" fill="#ffffff" />
      </motion.g>
      <path d="M28 66 L28 102" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="3" strokeLinecap="round" />
    </motion.svg>
  );
}
