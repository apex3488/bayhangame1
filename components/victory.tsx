"use client";

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatUsd } from "./ui";

export interface Victory {
  amount: number;
  multiplier?: number;
}

const Ctx = createContext<(v: Victory) => void>(() => {});

/** Full-screen "ПОБЕДА" celebration; `celebrate()` is available everywhere inside the provider. */
export function VictoryProvider({ children, labels }: { children: ReactNode; labels: { win: string; mega: string; tap: string } }) {
  const [v, setV] = useState<(Victory & { id: number }) | null>(null);
  const celebrate = useCallback((x: Victory) => setV({ ...x, id: Date.now() }), []);

  useEffect(() => {
    if (!v) return;
    const id = setTimeout(() => setV(null), 3200);
    return () => clearTimeout(id);
  }, [v]);

  return (
    <Ctx.Provider value={celebrate}>
      {children}
      <AnimatePresence>{v && <Overlay key={v.id} v={v} labels={labels} onClose={() => setV(null)} />}</AnimatePresence>
    </Ctx.Provider>
  );
}

export const useCelebrate = () => useContext(Ctx);

function CountUp({ value }: { value: number }) {
  // Start at 60% so the amount is readable from the first frame, then count up.
  const mv = useMotionValue(value * 0.6);
  const text = useTransform(mv, (x) => `+${formatUsd(x)}`);
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span>{text}</motion.span>;
}

function Overlay({ v, labels, onClose }: { v: Victory; labels: { win: string; mega: string; tap: string }; onClose: () => void }) {
  const reduce = useReducedMotion();
  const mega = (v.multiplier ?? 0) >= 10;
  const sparks = useMemo(
    () =>
      Array.from({ length: reduce ? 0 : mega ? 90 : 56 }, (_, i) => {
        const a = Math.random() * Math.PI * 2;
        const d = 180 + Math.random() * 520;
        return { x: Math.cos(a) * d, y: Math.sin(a) * d, s: 4 + Math.random() * 9, delay: Math.random() * 0.35, hue: i % 4 };
      }),
    [mega, reduce],
  );
  const colors = ["#ffc94d", "#fff3b0", "#5aa2ff", "#ff8a3d"];

  return (
    <motion.div
      className="fixed inset-0 z-[70] grid cursor-pointer place-items-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      onClick={onClose}
      role="dialog"
      aria-label={mega ? labels.mega : labels.win}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
      {/* Rotating light rays */}
      <motion.div
        className="absolute h-[160vmax] w-[160vmax]"
        style={{
          background: `repeating-conic-gradient(from 0deg, ${mega ? "rgba(255,201,77,.16)" : "rgba(255,201,77,.10)"} 0deg 8deg, transparent 8deg 22deg)`,
          maskImage: "radial-gradient(circle, black 10%, transparent 60%)",
        }}
        animate={reduce ? {} : { rotate: 360 }}
        transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        className="absolute h-[60vmin] w-[60vmin] rounded-full blur-[90px]"
        style={{ background: mega ? "#ff8a3d" : "#ffc94d" }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.3, 1], opacity: [0, 0.65, 0.45] }}
        transition={{ duration: 1.2 }}
      />
      {sparks.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-sm"
          style={{ width: p.s, height: p.s * 0.55, background: colors[p.hue] }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y + 160, opacity: 0, rotate: 540 }}
          transition={{ duration: 2.2, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
      <div className="relative flex flex-col items-center px-6 text-center">
        <motion.p
          className="font-display text-[clamp(56px,13vw,180px)] font-black uppercase leading-none tracking-tight"
          style={{
            background: mega ? "linear-gradient(180deg,#fff3b0,#ffc94d 45%,#ff6b2c)" : "linear-gradient(180deg,#ffffff,#ffe08a 50%,#ffb020)",
            WebkitBackgroundClip: "text",
            color: "transparent",
            filter: "drop-shadow(0 0 40px rgba(255,190,60,.55))",
          }}
          initial={{ scale: 0.2, rotate: -8, opacity: 0 }}
          animate={{ scale: [0.2, 1.18, 1], rotate: [-8, 3, 0], opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          {mega ? labels.mega : labels.win}
        </motion.p>
        <motion.p
          className="font-display mt-4 text-[clamp(28px,6vw,64px)] font-bold tabular text-white"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, type: "spring", stiffness: 200, damping: 16 }}
        >
          <CountUp value={v.amount} />
        </motion.p>
        {v.multiplier !== undefined && v.multiplier > 0 && (
          <motion.span
            className="font-display mt-3 rounded-full bg-white/10 px-5 py-1.5 text-xl font-bold text-[#ffe08a] ring-1 ring-[#ffc94d]/40"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.25, type: "spring" }}
          >
            ×{v.multiplier}
          </motion.span>
        )}
        <motion.p className="mt-8 text-xs uppercase tracking-[0.3em] text-white/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}>
          {labels.tap}
        </motion.p>
      </div>
    </motion.div>
  );
}
