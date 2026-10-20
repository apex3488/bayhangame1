"use client";
import { useIsOwner } from "@/components/use-owner";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Rocket } from "lucide-react";
import { useAsk, useGame } from "@/components/game-context";
import { GameRoom, useRound } from "@/components/game-room";
import { useCelebrate } from "@/components/victory";
import { Button, formatUsd } from "@/components/ui";
import { parseAmount } from "@/lib/parse";
import {
  crashActive,
  crashCashout,
  crashHistory,
  crashReveal,
  crashStart,
  crashState,
  newIdempotencyKey,
  type CrashState,
} from "@/lib/game";

const W = 640;
const H = 320;
const multAt = (k: number, seconds: number) => Math.floor(100 * Math.exp(k * Math.max(seconds, 0))) / 100;

export default function CrashPage() {
  const { t, refresh, toast, toastError } = useGame();
  const isOwner = useIsOwner(); // secret code is owner-only (server enforces it too)
  const ask = useAsk();
  const celebrate = useCelebrate();
  const round = useRound("crash");
  const [state, setState] = useState<CrashState | null>(null);
  const [live, setLive] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [auto, setAuto] = useState("");
  const [secret, setSecret] = useState<{ round: string; crash: number } | null>(null);
  const [history, setHistory] = useState<{ crash: number; outcome: string }[]>([]);
  const offset = useRef(0); // server clock − client clock, ms
  const celebrated = useRef<string | null>(null);
  // useRound returns a new object each render; keep the latest in a ref so callbacks stay stable.
  const roundRef = useRef(round);
  roundRef.current = round;

  const loadHistory = useCallback(() => {
    crashHistory().then(setHistory).catch(() => {});
  }, []);

  const apply = useCallback(
    (s: CrashState) => {
      offset.current = new Date(s.server_now).getTime() - Date.now();
      setState(s);
      if (s.status === "settled") {
        const round = roundRef.current;
        round.setBusy(false);
        const net = Number(s.payout) - Number(s.bet);
        round.setOutcome({ state: net > 0 ? "win" : "lose", amount: Math.round(net * 100) / 100, multiplier: Number(s.multiplier) });
        if (net > 0 && celebrated.current !== s.round_id) {
          celebrated.current = s.round_id;
          round.setBurst(Date.now());
          celebrate({ amount: net, multiplier: Number(s.multiplier) });
        }
        refresh();
        round.loadHistory();
        loadHistory();
      }
    },
    [celebrate, refresh, loadHistory],
  );

  // Resume a flying round after reload.
  useEffect(() => {
    crashActive().then((s) => s && apply(s)).catch(() => {});
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flying = state?.status === "active";

  // Animation loop on server time.
  useEffect(() => {
    if (!flying || !state) return;
    let raf = 0;
    const start = new Date(state.started_at).getTime();
    const autoAt = state.auto !== null ? Number(state.auto) : null;
    let asked = false;
    const tick = () => {
      const secs = (Date.now() + offset.current - start) / 1000;
      const m = multAt(Number(state.k), secs);
      if (autoAt !== null && m >= autoAt) {
        // Auto cash-out reached: freeze at the target and settle right away instead of waiting for the next poll.
        setLive(autoAt);
        setElapsed(Math.log(autoAt) / Number(state.k));
        if (!asked) {
          asked = true;
          crashState(state.round_id).then(apply).catch(() => {});
        }
        return;
      }
      setElapsed(secs);
      setLive(m);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Restart only for a new round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flying, state?.round_id]);

  // Ask the server whether the rocket crashed (or auto cash-out fired).
  useEffect(() => {
    if (!flying || !state) return;
    const id = setInterval(() => {
      crashState(state.round_id).then(apply).catch(() => {});
    }, 450);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flying, state?.round_id, apply]);

  async function launch() {
    let autoValue: number | null = null;
    if (auto.trim()) {
      autoValue = parseAmount(auto);
      if (autoValue === null || autoValue < 1.01 || autoValue > 1000) return toast(`${t("err_invalid_choice")}: ${t("autoHint")}`, "error");
      autoValue = Math.round(autoValue * 100) / 100;
    }
    round.setOutcome(null);
    round.setBusy(true);
    setSecret(null);
    try {
      const s = await crashStart(round.bet, autoValue, newIdempotencyKey());
      setLive(1);
      setElapsed(0);
      apply(s);
      refresh();
    } catch (e) {
      toastError(e);
      round.setBusy(false);
    }
  }

  async function cashout() {
    if (!state) return;
    try {
      apply(await crashCashout(state.round_id));
    } catch (e) {
      toastError(e);
    }
  }

  async function enterSecret() {
    if (!state || !flying) return;
    const code = await ask(t("secretCode"), { message: t("crashSecretHint"), input: { placeholder: "••••", minLength: 1 } });
    if (typeof code !== "string") return;
    try {
      const r = await crashReveal(state.round_id, code);
      if (r.status === "ok" && r.crash) {
        setSecret({ round: state.round_id, crash: Number(r.crash) });
        toast(`${t("crashPoint")} ×${Number(r.crash).toFixed(2)}`, "success");
      } else {
        toast(`${t("wrongCode")}: ${Math.max(0, r.attempts_left ?? 0)}`, "error");
      }
    } catch (e) {
      toastError(e);
    }
  }

  // Chart geometry.
  const settled = state?.status === "settled";
  const k = Number(state?.k ?? 0.0693);
  const shownMult = flying ? live : settled ? (state?.outcome === "crashed" ? Number(state.crash) : Number(state?.multiplier)) : 1;
  const tNow = flying ? elapsed : settled && state ? Math.log(Math.max(shownMult, 1)) / k : 0;
  const secretCrash = secret && state && secret.round === state.round_id ? secret.crash : null;
  const maxT = Math.max(8, tNow * 1.15);
  const maxM = Math.max(2, shownMult * 1.25, secretCrash && flying ? secretCrash * 1.1 : 0);
  const px = (s: number) => 40 + (s / maxT) * (W - 60);
  const py = (m: number) => H - 30 - ((m - 1) / (maxM - 1)) * (H - 60);
  const pts = Array.from({ length: 60 }, (_, i) => {
    const s = (tNow * i) / 59;
    return [px(s), py(Math.exp(k * s))] as const;
  });
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${pts[pts.length - 1][0]},${H - 30} L${px(0)},${H - 30} Z`;
  const tip = pts[pts.length - 1];
  const crashed = settled && state?.outcome === "crashed";
  const won = settled && !crashed;
  const color = crashed ? "#ff4d61" : won ? "#2fe0a0" : "#5aa2ff";

  const stage = (
    <div className="py-2">
      <div className="mb-3 flex gap-1.5 overflow-hidden [mask-image:linear-gradient(to_right,black_85%,transparent)]">
        {history.slice(0, 14).map((h, i) => (
          <motion.span
            key={`${h.crash}-${i}`}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold tabular ${Number(h.crash) >= 2 ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}
          >
            ×{Number(h.crash).toFixed(2)}
          </motion.span>
        ))}
      </div>
      <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[#05070d]">
        <div className="grid-bg absolute inset-0 opacity-60" />
        {crashed && (
          <motion.div className="absolute inset-0 bg-[#ff4d61]" initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} transition={{ duration: 0.8 }} />
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className="relative block w-full">
          <defs>
            <linearGradient id="crash-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[1, 1.5, 2, 3, 5, 10, 20, 50, 100].filter((m) => m <= maxM).map((m) => (
            <g key={m}>
              <line x1="40" x2={W - 20} y1={py(m)} y2={py(m)} stroke="#141b2c" />
              <text x="6" y={py(m) + 4} fill="#5a6178" fontSize="11">×{m}</text>
            </g>
          ))}
          {secretCrash && flying && (
            <g>
              <line x1="40" x2={W - 20} y1={py(secretCrash)} y2={py(secretCrash)} stroke="#ff4d61" strokeDasharray="8 6" strokeWidth="2" />
              <text x={W - 24} y={py(secretCrash) - 6} fill="#ff4d61" fontSize="13" fontWeight="800" textAnchor="end">💥 ×{secretCrash.toFixed(2)}</text>
            </g>
          )}
          {(flying || settled) && (
            <>
              <path d={area} fill="url(#crash-fill)" />
              <path d={path} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
              {!crashed ? (
                <g transform={`translate(${tip[0]},${tip[1]}) rotate(-35)`}>
                  <motion.circle r="16" fill={color} opacity="0.25" animate={{ r: [14, 22, 14] }} transition={{ duration: 0.8, repeat: Infinity }} />
                  <text x="-12" y="8" fontSize="24">🚀</text>
                </g>
              ) : (
                <motion.g initial={{ scale: 0.2 }} animate={{ scale: [0.2, 1.6, 1] }} style={{ transformOrigin: `${tip[0]}px ${tip[1]}px` }}>
                  <text x={tip[0] - 16} y={tip[1] + 10} fontSize="30">💥</text>
                </motion.g>
              )}
            </>
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <motion.p
              key={settled ? "done" : "fly"}
              animate={crashed ? { scale: [1.3, 1], x: [0, -6, 6, -4, 0] } : {}}
              className="font-display text-6xl font-black tabular md:text-8xl"
              style={{ color, textShadow: `0 0 40px ${color}66` }}
            >
              ×{shownMult.toFixed(2)}
            </motion.p>
            <AnimatePresence>
              {settled && (
                <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-2 text-sm font-bold uppercase tracking-[0.25em]" style={{ color }}>
                  {crashed ? `${t("crashed")} @ ×${Number(state?.crash).toFixed(2)}` : `${formatUsd(Number(state?.payout))}`}
                </motion.p>
              )}
              {!state && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
                  <Rocket size={16} /> {t("launch")}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );

  const controls = !flying ? (
    <div>
      <p className="mb-2 flex justify-between text-xs text-[var(--muted)]">
        <span>{t("autoCashout")}</span>
        <span>{t("autoHint")}</span>
      </p>
      <input
        inputMode="decimal"
        value={auto}
        onChange={(e) => setAuto(e.target.value)}
        placeholder="2.00"
        className="tabular w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] px-4 py-3 font-semibold outline-none focus:border-[var(--accent)]"
      />
    </div>
  ) : null;

  const action = flying ? (
    <div className="flex gap-2">
      {isOwner && (
        <Button variant="ghost" onClick={enterSecret} aria-label={t("secretCode")} title={t("secretCode")} className="shrink-0 px-4 py-4">
          <KeyRound size={18} />
        </Button>
      )}
      <Button variant="success" onClick={cashout} className="w-full py-4 text-base">
        {t("cashout")} · {formatUsd(Number(state?.bet ?? 0) * live)}
      </Button>
    </div>
  ) : (
    <Button onClick={launch} loading={round.busy} disabled={round.busy} className="shine w-full py-4 text-base">
      <Rocket size={18} /> {settled ? t("newRound") : t("launch")}
    </Button>
  );

  return <GameRoom game="crash" round={round} accent="#ff6b2c" stage={stage} controls={controls} action={action} />;
}
