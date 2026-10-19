"use client";

import { motion } from "motion/react";
import { BedDouble, Coffee, Cpu, Droplets, Factory, Fuel, Landmark, Music, Rocket, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { AssetKind } from "@/lib/economy";

const CAR_COLORS: Record<string, [string, string]> = {
  sedan: ["#64748b", "#334155"],
  sport_coupe: ["#ef4444", "#7f1d1d"],
  luxury_sedan: ["#1e293b", "#0f172a"],
  suv_lux: ["#f8fafc", "#94a3b8"],
  supercar: ["#facc15", "#a16207"],
  hypercar: ["#2f7bff", "#1e3a8a"],
  amg_g63: ["#111827", "#020617"],
  porsche_911: ["#e5e7eb", "#6b7280"],
  bentley_continental: ["#14532d", "#052e16"],
  mclaren_750s: ["#f97316", "#7c2d12"],
  rolls_phantom: ["#1e1b4b", "#0f0a2e"],
  ferrari_sf90: ["#dc2626", "#450a0a"],
  lambo_revuelto: ["#84cc16", "#365314"],
  koenigsegg_jesko: ["#f8fafc", "#94a3b8"],
  pagani_utopia: ["#a16207", "#422006"],
  bugatti_noire: ["#0a0a0a", "#262626"],
  rolls_boat_tail: ["#93c5fd", "#1e3a8a"],
};
const SPORTY = new Set(["sport_coupe", "supercar", "hypercar", "porsche_911", "mclaren_750s", "ferrari_sf90", "lambo_revuelto", "koenigsegg_jesko", "pagani_utopia", "bugatti_noire"]);
const TALL = new Set(["suv_lux", "amg_g63"]);

const BUSINESS: Record<string, { icon: LucideIcon; hue: string }> = {
  coffee_shop: { icon: Coffee, hue: "#c08457" },
  car_wash: { icon: Droplets, hue: "#38bdf8" },
  restaurant: { icon: UtensilsCrossed, hue: "#f97316" },
  hotel: { icon: BedDouble, hue: "#a78bfa" },
  nightclub: { icon: Music, hue: "#ec4899" },
  factory: { icon: Factory, hue: "#94a3b8" },
  tech_company: { icon: Cpu, hue: "#5aa2ff" },
  bank: { icon: Landmark, hue: "#ffc94d" },
  oil_company: { icon: Fuel, hue: "#f59e0b" },
  space_company: { icon: Rocket, hue: "#a78bfa" },
};

const REALTY_TIER: Record<string, number> = { studio: 1, apartment: 2, townhouse: 3, villa: 4, penthouse: 5, mansion: 6, island: 7, skyscraper: 8, mega_tower: 9 };

/** Illustration for a catalog item: skyline for real estate, side profile for cars, animated sign for businesses. */
export function AssetArt({ kind, code, owned }: { kind: AssetKind; code: string; owned?: boolean }) {
  if (kind === "car") return <CarArt code={code} />;
  if (kind === "business") return <BusinessArt code={code} owned={owned} />;
  return <RealtyArt code={code} />;
}

function RealtyArt({ code }: { code: string }) {
  const tier = REALTY_TIER[code] ?? 1;
  if (code === "island" || code === "resort_island") {
    return (
      <svg viewBox="0 0 200 110" className="h-full w-full">
        <defs>
          <linearGradient id="sea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#0ea5e9" stopOpacity=".5" />
            <stop offset="1" stopColor="#0c4a6e" stopOpacity=".2" />
          </linearGradient>
        </defs>
        <rect y="70" width="200" height="40" fill="url(#sea)" />
        <motion.ellipse cx="100" cy="74" rx="70" ry="10" fill="#d6b77a" animate={{ ry: [10, 11, 10] }} transition={{ duration: 3, repeat: Infinity }} />
        <path d="M95,72 Q92,40 80,30 M95,72 Q100,45 118,34" stroke="#65a30d" strokeWidth="3" fill="none" />
        <rect x="108" y="54" width="34" height="18" rx="2" fill="#f8fafc" />
        <rect x="114" y="59" width="8" height="8" fill="#38bdf8" />
        <rect x="128" y="59" width="8" height="8" fill="#38bdf8" />
        <motion.circle cx="170" cy="22" r="10" fill="#fde68a" animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 4, repeat: Infinity }} />
      </svg>
    );
  }
  const floors = Math.min(1 + tier, 9);
  const w = 26 + tier * 4;
  return (
    <svg viewBox="0 0 200 110" className="h-full w-full">
      {[30, 160].map((x, i) => (
        <rect key={i} x={x - 12} y={60 - i * 8} width="24" height={50 + i * 8} rx="2" fill="#141b2e" />
      ))}
      <g>
        <rect x={100 - w / 2} y={108 - floors * 11} width={w} height={floors * 11} rx="3" fill="#1c2540" stroke="#2f3b63" />
        {Array.from({ length: floors }, (_, f) =>
          Array.from({ length: Math.max(2, Math.floor(w / 12)) }, (_, c) => (
            <motion.rect
              key={`${f}-${c}`}
              x={100 - w / 2 + 5 + c * 11}
              y={111 - floors * 11 + f * 11}
              width="6"
              height="5"
              rx="1"
              fill="#fbbf24"
              initial={{ opacity: 0.15 }}
              animate={{ opacity: [0.15, (f + c) % 3 === 0 ? 0.95 : 0.4, 0.15] }}
              transition={{ duration: 3 + ((f * 7 + c * 3) % 5), repeat: Infinity, delay: (f + c) * 0.3 }}
            />
          )),
        )}
        {tier >= 5 && <rect x={100 - w / 2 - 4} y={104 - floors * 11} width={w + 8} height="4" rx="2" fill="#5aa2ff" />}
      </g>
      <rect y="106" width="200" height="4" fill="#0b1020" />
    </svg>
  );
}

function CarArt({ code }: { code: string }) {
  const [body, shade] = CAR_COLORS[code] ?? ["#64748b", "#334155"];
  const sporty = SPORTY.has(code);
  const tall = TALL.has(code);
  const roof = sporty ? "M58,58 Q80,36 112,36 Q140,38 156,58" : tall ? "M52,56 L64,30 L134,30 L152,56" : "M56,58 L72,38 L128,38 L148,58";
  return (
    <svg viewBox="0 0 200 110" className="h-full w-full">
      <ellipse cx="100" cy="94" rx="80" ry="6" fill="#000" opacity=".45" />
      <motion.g whileHover={{ x: 4 }}>
        <path d={`M24,${tall ? 82 : 84} Q26,${sporty ? 62 : 60} 50,58 L156,58 Q178,60 180,${sporty ? 74 : 72} L180,84 Z`} fill={body} />
        <path d={roof} fill={shade} />
        <path d={sporty ? "M70,56 Q86,42 108,42 L110,56 Z" : "M70,56 L80,43 L104,43 L104,56 Z"} fill="#0b1020" opacity=".85" />
        <path d={sporty ? "M114,56 L114,42 Q136,44 146,56 Z" : "M110,56 L110,43 L126,43 L140,56 Z"} fill="#0b1020" opacity=".85" />
        <rect x="170" y="66" width="10" height="4" rx="2" fill="#fde68a" />
        <rect x="24" y="68" width="6" height="4" rx="2" fill="#ef4444" />
        {[58, 148].map((cx) => (
          <motion.g key={cx} style={{ transformOrigin: `${cx}px 84px` }} animate={{ rotate: 360 }} transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}>
            <circle cx={cx} cy="84" r="13" fill="#0b1020" />
            <circle cx={cx} cy="84" r="7" fill="#94a3b8" />
            <path d={`M${cx - 7},84 L${cx + 7},84 M${cx},77 L${cx},91`} stroke="#334155" strokeWidth="2" />
          </motion.g>
        ))}
      </motion.g>
    </svg>
  );
}

function BusinessArt({ code, owned }: { code: string; owned?: boolean }) {
  const b = BUSINESS[code] ?? { icon: Factory, hue: "#94a3b8" };
  const Icon = b.icon;
  return (
    <div className="relative grid h-full w-full place-items-center">
      <motion.div
        className="absolute h-24 w-24 rounded-full blur-2xl"
        style={{ background: b.hue }}
        animate={{ opacity: owned ? [0.35, 0.6, 0.35] : 0.25, scale: owned ? [1, 1.15, 1] : 1 }}
        transition={{ duration: 3, repeat: Infinity }}
      />
      <motion.div
        className="relative grid h-20 w-20 place-items-center rounded-3xl border border-white/10"
        style={{ background: `linear-gradient(150deg, ${b.hue}, #0b1020)` }}
        animate={owned ? { y: [0, -4, 0] } : {}}
        transition={{ duration: 2.4, repeat: Infinity }}
      >
        <Icon size={36} className="text-white" />
      </motion.div>
      {owned &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute text-xs font-bold text-[var(--success)]"
            style={{ left: `${40 + i * 10}%` }}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: -30, opacity: [0, 1, 0] }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.7 }}
          >
            $
          </motion.span>
        ))}
    </div>
  );
}
