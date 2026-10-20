"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Briefcase, Building2, Gamepad2, Sparkles, Trophy, type LucideIcon } from "lucide-react";
import { useGame } from "./game-context";
import { Button } from "./ui";

const KEY = "bayhan.onboarded.v1";

const STEPS: { icon: LucideIcon; hue: string; title: string; body: string }[] = [
  { icon: Sparkles, hue: "#2f7bff", title: "ob1_title", body: "ob1_body" },
  { icon: Briefcase, hue: "#38bdf8", title: "ob2_title", body: "ob2_body" },
  { icon: Building2, hue: "#06b6d4", title: "ob3_title", body: "ob3_body" },
  { icon: Gamepad2, hue: "#a855f7", title: "ob4_title", body: "ob4_body" },
  { icon: Trophy, hue: "#ffc94d", title: "ob5_title", body: "ob5_body" },
];

/** First-run tour for new players (shown once per device). */
export function Onboarding() {
  const { t, snapshot } = useGame();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!snapshot || snapshot.level > 3) return;
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      // storage blocked: skip the tour rather than show it on every visit
    }
  }, [snapshot]);

  function finish(go?: string) {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
    if (go) router.push(go);
  }

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[65] grid place-items-center bg-black/75 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="panel relative w-full max-w-md overflow-hidden p-7 text-center"
            role="dialog"
            aria-modal="true"
          >
            <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full blur-3xl" style={{ background: `${s.hue}55` }} />
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.22 }} className="relative">
                <motion.div
                  className="mx-auto grid h-20 w-20 place-items-center rounded-3xl"
                  style={{ background: `${s.hue}22`, color: s.hue, boxShadow: `0 0 40px ${s.hue}44` }}
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 2.4, repeat: Infinity }}
                >
                  <s.icon size={38} />
                </motion.div>
                <h2 className="font-display mt-6 text-2xl font-semibold">{t(s.title)}</h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[var(--muted)]">{t(s.body)}</p>
              </motion.div>
            </AnimatePresence>
            <div className="relative mt-6 flex justify-center gap-1.5">
              {STEPS.map((_, i) => (
                <button key={i} onClick={() => setStep(i)} aria-label={`${i + 1}`} className="h-1.5 rounded-full transition-all" style={{ width: i === step ? 22 : 8, background: i === step ? s.hue : "var(--surface-3)" }} />
              ))}
            </div>
            <div className="relative mt-6 flex gap-2">
              {!last && (
                <Button variant="ghost" className="flex-1" onClick={() => finish()}>
                  {t("ob_skip")}
                </Button>
              )}
              <Button className="flex-1" onClick={() => (last ? finish("/work") : setStep(step + 1))}>
                {last ? t("ob_start") : t("ob_next")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
