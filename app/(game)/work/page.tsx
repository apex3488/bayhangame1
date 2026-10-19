"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bike,
  Briefcase,
  Car,
  ChartCandlestick,
  Code2,
  Crown,
  DraftingCompass,
  Lock,
  Rocket,
  Timer,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useGame } from "@/components/game-context";
import { Burst, Button, Money, PageTitle, Reveal, Skeleton, formatCompact, useCountdown } from "@/components/ui";
import { SHIFT_MS, STAGES, WorkScene } from "@/components/work-scenes";
import { errorKey, fetchMyJobs, newIdempotencyKey, workShift, type MyJob } from "@/lib/game";
import { errorText } from "@/lib/i18n";

const JOB_LOOK: Record<string, { icon: LucideIcon; hue: string }> = {
  courier: { icon: Bike, hue: "#2f7bff" },
  taxi: { icon: Car, hue: "#ffc94d" },
  mechanic: { icon: Wrench, hue: "#ff8a3d" },
  programmer: { icon: Code2, hue: "#5aa2ff" },
  engineer: { icon: DraftingCompass, hue: "#38bdf8" },
  financier: { icon: ChartCandlestick, hue: "#2fe0a0" },
  entrepreneur: { icon: Rocket, hue: "#a855f7" },
  director: { icon: Crown, hue: "#ffc94d" },
};

export default function WorkPage() {
  const { t } = useGame();
  const [jobs, setJobs] = useState<MyJob[] | null>(null);
  const [error, setError] = useState(false);
  const [active, setActive] = useState<MyJob | null>(null);

  const load = useCallback(() => {
    setError(false);
    fetchMyJobs().then(setJobs).catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <PageTitle title={t("jobs")} subtitle={t("jobsSubtitle")} />
      {error && (
        <div className="panel flex items-center justify-between p-5 text-sm text-[var(--danger)]">
          {t("loadFailed")}
          <Button variant="ghost" onClick={load}>
            {t("retry")}
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {jobs === null && !error
          ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-60" />)
          : jobs?.map((job, i) => (
              <Reveal key={job.key} delay={i * 0.05}>
                <JobCard job={job} onStart={() => setActive(job)} />
              </Reveal>
            ))}
      </div>
      <AnimatePresence>
        {active && (
          <ShiftModal
            job={active}
            onClose={() => {
              setActive(null);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function JobCard({ job, onStart }: { job: MyJob; onStart: () => void }) {
  const { t } = useGame();
  const look = JOB_LOOK[job.key] ?? { icon: Briefcase, hue: "#2f7bff" };
  const Icon = look.icon;
  const { left, label } = useCountdown(job.next_available_at);
  const locked = !job.eligible;
  const cooling = !locked && left > 0;

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className={`panel group relative flex h-full flex-col overflow-hidden p-5 ${locked ? "opacity-70" : ""}`}
    >
      <div
        className="absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-25 blur-3xl transition-opacity group-hover:opacity-45"
        style={{ background: look.hue }}
      />
      <div className="relative flex items-start justify-between">
        <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: `${look.hue}22`, color: look.hue }}>
          <Icon size={24} />
        </div>
        {locked && (
          <span className="flex items-center gap-1 rounded-full bg-[var(--surface-3)] px-2.5 py-1 text-[11px] text-[var(--muted)]">
            <Lock size={11} /> {job.blocker === "need_car" ? t("requiresCar") : t("requiresCapital")}
          </span>
        )}
      </div>
      <h3 className="font-display relative mt-4 text-lg font-semibold">{t(`job_${job.key}`)}</h3>
      <p className="relative mt-1 text-xs text-[var(--muted)]">{t(`jobd_${job.key}`)}</p>
      <div className="relative mt-4 space-y-1.5 text-xs">
        <Row label={t("salary")} value={`$${formatCompact(Number(job.income_min))} – $${formatCompact(Number(job.income_max))}`} accent />
        <Row label={t("cooldown")} value={formatDuration(job.cooldown_seconds)} />
        {Number(job.min_capital) > 0 && <Row label={t("requiresCapital")} value={`$${formatCompact(Number(job.min_capital))}`} />}
      </div>
      <div className="relative mt-auto pt-5">
        {cooling ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-[var(--bg-2)] py-3 text-sm text-[var(--muted)]">
            <Timer size={15} /> <span className="tabular font-semibold text-white">{label}</span>
          </div>
        ) : (
          <Button onClick={onStart} disabled={locked} variant={locked ? "ghost" : "primary"} className="w-full">
            {t("startShift")}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`tabular font-semibold ${accent ? "text-[var(--success)]" : ""}`}>{value}</span>
    </div>
  );
}

function formatDuration(sec: number): string {
  if (sec >= 3600) return `${(sec / 3600).toFixed(sec % 3600 ? 1 : 0)} h`;
  return `${Math.round(sec / 60)} min`;
}

/**
 * Plays the job scene while the server pays the shift. The payout shown is the server's;
 * if the server rejects the shift, the scene stops and nothing is credited.
 */
function ShiftModal({ job, onClose }: { job: MyJob; onClose: () => void }) {
  const { t, lang, refresh, toast } = useGame();
  const [phase, setPhase] = useState<"working" | "done" | "error">("working");
  const [stage, setStage] = useState(0);
  const [pay, setPay] = useState(0);
  const [errMsg, setErrMsg] = useState("");
  const started = useRef(false);

  // One server call per modal, even if React re-runs effects (strict mode).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const timer = new Promise((r) => setTimeout(r, SHIFT_MS));
    Promise.all([workShift(job.key, newIdempotencyKey()), timer])
      .then(([res]) => {
        setPay(Number(res.salary));
        setPhase("done");
        refresh();
      })
      .catch((e: Error) => {
        setErrMsg(errorText(lang, errorKey(e.message)));
        setPhase("error");
      });
  }, [job.key, lang, refresh]);

  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setStage(Math.min(2, Math.floor((Date.now() - t0) / (SHIFT_MS / 3)))), 200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase === "error") toast(errMsg, "error");
  }, [phase, errMsg, toast]);

  const stages = STAGES[job.key]?.[lang] ?? STAGES.courier[lang];

  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 backdrop-blur-md sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ y: 40, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className="panel w-full max-w-2xl rounded-b-none p-5 sm:rounded-b-[20px] md:p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              {phase === "done" ? t("shiftDone") : t("shiftInProgress")}
            </p>
            <h2 className="font-display mt-1 text-xl font-semibold">{t(`job_${job.key}`)}</h2>
          </div>
        </div>

        <div className="relative">
          <WorkScene job={job.key} />
          <AnimatePresence>
            {phase === "done" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl bg-black/55 backdrop-blur-sm"
              >
                <Burst trigger={1} count={34} />
                <motion.p
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]"
                >
                  {t("earned")}
                </motion.p>
                <motion.div initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }}>
                  <Money value={pay} className="font-display mt-2 block text-4xl font-bold text-[var(--success)] md:text-5xl" />
                </motion.div>
                <p className="mt-2 text-sm text-[var(--muted)]">+{job.xp_reward} XP</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-5">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)]"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              style={phase === "error" ? { background: "var(--danger)" } : undefined}
              transition={{ duration: phase === "error" ? 0.2 : SHIFT_MS / 1000, ease: "linear" }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {stages.map((s, i) => (
              <div
                key={s}
                className={`rounded-xl px-2 py-2 text-center text-[11px] font-medium transition-colors duration-500 ${
                  phase === "done" || i < stage
                    ? "bg-[var(--success-soft)] text-[var(--success)]"
                    : i === stage && phase === "working"
                      ? "bg-[var(--accent-soft)] text-white"
                      : "bg-[var(--bg-2)] text-[var(--dim)]"
                }`}
              >
                {s}
              </div>
            ))}
          </div>
        </div>

        {phase === "error" && <p className="mt-4 text-sm text-[var(--danger)]">{errMsg}</p>}
        {phase !== "working" && (
          <Button onClick={onClose} variant={phase === "done" ? "success" : "ghost"} className="mt-5 w-full">
            {t("collect")}
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}
