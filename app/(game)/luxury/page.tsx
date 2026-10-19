"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useAsk, useGame } from "@/components/game-context";
import { useAction } from "@/components/use-action";
import { useCelebrate } from "@/components/victory";
import { RARITY_COLOR } from "@/components/cosmetic-view";
import { Tabs } from "@/components/forms";
import { Button, Money, PageTitle, Reveal, Skeleton, formatCompact, formatUsd } from "@/components/ui";
import { assetBuy, assetSell, fetchLuxury, fetchMyLuxury, type LuxuryItem } from "@/lib/economy";

type Cat = "all" | LuxuryItem["category"];
const CATS: Cat[] = ["all", "watch", "jewelry", "art", "jet", "yacht", "space"];

export default function LuxuryPage() {
  const { t, snapshot } = useGame();
  const ask = useAsk();
  const celebrate = useCelebrate();
  const { busy, run } = useAction();
  const [items, setItems] = useState<LuxuryItem[] | null>(null);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [cat, setCat] = useState<Cat>("all");

  const load = useCallback(() => {
    Promise.all([fetchLuxury(), fetchMyLuxury()])
      .then(([i, m]) => {
        setItems(i);
        setOwned(new Set(m.map((x) => x.code)));
      })
      .catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const list = items?.filter((i) => cat === "all" || i.category === cat) ?? [];
  const collection = items?.filter((i) => owned.has(i.code)).reduce((s, i) => s + Number(i.price), 0) ?? 0;

  async function buy(i: LuxuryItem) {
    const r = await run(`buy-${i.code}`, (k) => assetBuy("luxury", i.code, k), () => `${t("bought")}: ${t(`lux_${i.code}`)}`);
    // Big purchases deserve a moment of glory too.
    if (r && Number(i.price) >= 1_000_000_000) celebrate({ amount: Number(i.price) });
    load();
  }

  async function sell(i: LuxuryItem) {
    if (!(await ask(t("confirmSell"), { danger: true, message: `${t(`lux_${i.code}`)} · ${t("sellFor")} ${formatUsd(Number(i.price) * 0.7, 0)}` }))) return;
    await run(`sell-${i.code}`, (k) => assetSell("luxury", i.code, k), (r) => `${t("soldFor")} ${formatUsd(Number(r.proceeds))}`);
    load();
  }

  return (
    <div>
      <PageTitle
        title={t("luxury")}
        subtitle={t("luxurySubtitle")}
        right={
          <div className="panel px-5 py-3 text-right">
            <p className="text-[11px] uppercase tracking-widest text-[var(--muted)]">{t("collections")}</p>
            <Money value={collection} digits={0} className="font-display text-xl font-semibold text-[var(--gold)]" />
          </div>
        }
      />
      <div className="-mx-4 overflow-x-auto px-4">
        <Tabs id="lux" value={cat} onChange={setCat} tabs={CATS.map((c) => ({ id: c, label: c === "all" ? t("luxAll") : t(`luxcat_${c}`) }))} />
      </div>
      {!items ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-80" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((i, idx) => {
            const color = RARITY_COLOR[i.rarity] ?? "#94a3b8";
            const has = owned.has(i.code);
            const afford = Number(snapshot?.cash ?? 0) >= Number(i.price);
            return (
              <Reveal key={i.code} delay={Math.min(idx, 9) * 0.04}>
                <motion.div
                  whileHover={{ y: -6 }}
                  className="group relative overflow-hidden rounded-[28px] border p-5"
                  style={{
                    borderColor: has ? color : "var(--border)",
                    background: `radial-gradient(120% 80% at 50% 0%, ${color}26, transparent 60%), linear-gradient(180deg, var(--surface-2), var(--surface))`,
                    boxShadow: has ? `0 30px 80px -40px ${color}` : undefined,
                  }}
                >
                  <div className="shine pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  <div className="flex items-center justify-between">
                    <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ background: `${color}26`, color }}>
                      {t(`rarity_${i.rarity}`)}
                    </span>
                    <span className="text-[11px] text-[var(--muted)]">{t(`luxcat_${i.category}`)}</span>
                  </div>
                  <div className="my-4 h-40">
                    <LuxuryArt category={i.category} color={color} />
                  </div>
                  <p className="font-display text-lg font-semibold leading-tight">{t(`lux_${i.code}`)}</p>
                  <p className="font-display mt-1 text-2xl font-bold tabular" style={{ color }}>
                    ${formatCompact(Number(i.price))}
                  </p>
                  <p className="text-[11px] text-[var(--muted)] tabular">{formatUsd(Number(i.price), 0)}</p>
                  <div className="mt-4">
                    {has ? (
                      <div className="flex gap-2">
                        <div className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-sm font-semibold" style={{ background: `${color}1f`, color }}>
                          <Check size={15} /> {t("owned")}
                        </div>
                        <Button variant="ghost" className="px-4 py-2.5 text-xs" disabled={busy !== null} loading={busy === `sell-${i.code}`} onClick={() => sell(i)}>
                          {t("sell")}
                        </Button>
                      </div>
                    ) : (
                      <Button className="w-full" disabled={busy !== null || !afford} loading={busy === `buy-${i.code}`} onClick={() => buy(i)}>
                        {t("buy")}
                      </Button>
                    )}
                  </div>
                </motion.div>
              </Reveal>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Animated vector art per luxury category. */
function LuxuryArt({ category, color }: { category: LuxuryItem["category"]; color: string }) {
  if (category === "watch") {
    return (
      <svg viewBox="0 0 200 160" className="h-full w-full">
        <rect x="88" y="6" width="24" height="34" rx="6" fill="#1f2937" />
        <rect x="88" y="120" width="24" height="34" rx="6" fill="#1f2937" />
        <circle cx="100" cy="80" r="46" fill="#0b1020" stroke={color} strokeWidth="6" />
        <circle cx="100" cy="80" r="38" fill="#111827" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return <line key={i} x1={100 + Math.cos(a) * 30} y1={80 + Math.sin(a) * 30} x2={100 + Math.cos(a) * 35} y2={80 + Math.sin(a) * 35} stroke="#e5e7eb" strokeWidth={i % 3 ? 1.5 : 3} />;
        })}
        <motion.line x1="100" y1="80" x2="100" y2="56" stroke="#e5e7eb" strokeWidth="3" strokeLinecap="round" style={{ transformOrigin: "100px 80px" }} animate={{ rotate: 360 }} transition={{ duration: 60, repeat: Infinity, ease: "linear" }} />
        <motion.line x1="100" y1="80" x2="100" y2="50" stroke={color} strokeWidth="1.5" strokeLinecap="round" style={{ transformOrigin: "100px 80px" }} animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }} />
        <circle cx="100" cy="80" r="3" fill={color} />
      </svg>
    );
  }
  if (category === "jewelry") {
    return (
      <div className="grid h-full place-items-center">
        <motion.svg viewBox="0 0 120 110" className="h-32 w-32" animate={{ rotateY: [0, 180, 360] }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }} style={{ filter: `drop-shadow(0 0 24px ${color})` }}>
          <path d="M20,40 L40,15 L80,15 L100,40 L60,100 Z" fill="#f9a8d4" />
          <path d="M20,40 L100,40 L60,100 Z" fill="#ec4899" opacity=".7" />
          <path d="M40,15 L50,40 L60,15 L70,40 L80,15" fill="none" stroke="#fff" strokeOpacity=".6" />
          <path d="M50,40 L60,100 L70,40" fill="none" stroke="#fff" strokeOpacity=".4" />
        </motion.svg>
      </div>
    );
  }
  if (category === "art") {
    return (
      <svg viewBox="0 0 200 160" className="h-full w-full">
        <rect x="40" y="12" width="120" height="136" rx="4" fill="#a16207" />
        <rect x="50" y="22" width="100" height="116" fill="#0b1020" />
        <motion.circle cx="100" cy="70" r="26" fill={color} opacity=".85" animate={{ r: [24, 28, 24] }} transition={{ duration: 4, repeat: Infinity }} />
        <path d="M50,138 Q80,95 100,110 T150,100 L150,138 Z" fill="#1e3a8a" opacity=".8" />
        <path d="M60,40 Q90,30 120,45" stroke="#fde68a" strokeWidth="3" fill="none" opacity=".6" />
      </svg>
    );
  }
  if (category === "jet") {
    return (
      <svg viewBox="0 0 200 160" className="h-full w-full">
        {[0, 1, 2].map((i) => (
          <motion.rect key={i} y={40 + i * 35} height="2" width="60" rx="1" fill="#ffffff22" initial={{ x: 220 }} animate={{ x: -80 }} transition={{ duration: 1.6 + i * 0.4, repeat: Infinity, ease: "linear", delay: i * 0.3 }} />
        ))}
        <motion.g animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity }}>
          <path d="M30,85 Q100,70 170,78 Q180,80 170,86 Q100,96 30,92 Z" fill="#e5e7eb" />
          <path d="M95,82 L70,45 L84,45 L120,80 Z" fill="#cbd5e1" />
          <path d="M95,90 L72,118 L86,118 L120,88 Z" fill="#94a3b8" />
          <path d="M34,86 L22,62 L34,62 L50,84 Z" fill={color} />
          {[60, 75, 90, 105, 120, 135].map((x) => <circle key={x} cx={x} cy="83" r="2" fill="#1e3a8a" />)}
        </motion.g>
      </svg>
    );
  }
  if (category === "yacht") {
    return (
      <svg viewBox="0 0 200 160" className="h-full w-full">
        <motion.g animate={{ rotate: [-1.5, 1.5, -1.5], y: [0, -3, 0] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "100px 110px" }}>
          <path d="M20,100 L180,100 L160,124 L36,124 Z" fill="#f8fafc" />
          <path d="M50,100 L60,80 L150,80 L162,100 Z" fill="#e2e8f0" />
          <path d="M75,80 L82,64 L130,64 L138,80 Z" fill="#cbd5e1" />
          <rect x="66" y="86" width="84" height="6" rx="3" fill="#1e3a8a" />
          <rect x="90" y="69" width="36" height="5" rx="2" fill="#1e3a8a" />
          <line x1="20" y1="112" x2="180" y2="112" stroke={color} strokeWidth="3" />
        </motion.g>
        {[0, 1].map((i) => (
          <motion.path key={i} d="M0,130 Q25,122 50,130 T100,130 T150,130 T200,130 T250,130 V160 H0 Z" fill="#0ea5e9" opacity={0.35 - i * 0.12}
            animate={{ x: [0, -50] }} transition={{ duration: 3 + i, repeat: Infinity, ease: "linear" }} />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 200 160" className="h-full w-full">
      {Array.from({ length: 24 }, (_, i) => (
        <motion.circle key={i} cx={(i * 47) % 200} cy={(i * 29) % 160} r={i % 3 ? 0.8 : 1.4} fill="#fff" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 2 + (i % 5), repeat: Infinity, delay: i * 0.1 }} />
      ))}
      <circle cx="100" cy="80" r="36" fill="#1e1b4b" />
      <circle cx="100" cy="80" r="36" fill={`url(#planet-${color.slice(1)})`} />
      <defs>
        <radialGradient id={`planet-${color.slice(1)}`} cx="35%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#312e81" stopOpacity=".2" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="80" rx="70" ry="16" fill="none" stroke={color} strokeOpacity=".5" strokeWidth="2" />
      <motion.g animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }} style={{ transformOrigin: "100px 80px" }}>
        <rect x="164" y="74" width="16" height="12" rx="2" fill="#e5e7eb" />
        <rect x="158" y="78" width="28" height="4" fill={color} />
      </motion.g>
    </svg>
  );
}
