"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Bomb, Gem, KeyRound } from "lucide-react";
import { useAsk, useGame } from "@/components/game-context";
import { useCelebrate } from "@/components/victory";
import { GameRoom, useRound } from "@/components/game-room";
import { Button, formatUsd, Fit } from "@/components/ui";
import { minesActive, minesCashout, minesOpen, minesReveal, minesStart, newIdempotencyKey, type MinesState } from "@/lib/game";

export default function MinesPage() {
  const { t, refresh, toast, toastError } = useGame();
  const round = useRound("mines");
  const [state, setState] = useState<MinesState | null>(null);
  // Mine positions shown by the secret code, for the round they belong to.
  const [revealed, setRevealed] = useState<{ round: string; mines: number[] } | null>(null);
  const ask = useAsk();
  const celebrate = useCelebrate();
  const [mines, setMines] = useState(3);
  const [pendingCell, setPendingCell] = useState<number | null>(null);
  const startKey = useRef<string | null>(null);

  // Resume an unfinished round after a reload.
  useEffect(() => {
    minesActive()
      .then((s) => s && setState(s))
      .catch(() => {});
  }, []);

  const active = state?.status === "active";
  const seen = active && revealed?.round === state?.round_id ? revealed.mines : [];

  async function enterSecret() {
    if (!state || !active) return;
    const code = await ask(t("secretCode"), { message: t("secretHint"), input: { placeholder: "••••", minLength: 1 } });
    if (typeof code !== "string") return;
    try {
      const r = await minesReveal(state.round_id, code);
      if (r.status === "ok" && r.mine_positions) {
        setRevealed({ round: state.round_id, mines: r.mine_positions });
        toast(t("minesRevealed"), "success");
      } else {
        toast(`${t("wrongCode")}: ${Math.max(0, r.attempts_left ?? 0)}`, "error");
      }
    } catch (e) {
      toastError(e);
    }
  }
  const settled = state?.status === "settled";

  async function start() {
    round.setOutcome(null);
    round.setBusy(true);
    startKey.current ??= newIdempotencyKey();
    try {
      const s = await minesStart(round.bet, mines, startKey.current);
      startKey.current = null;
      setState(s);
      refresh();
    } catch (e) {
      startKey.current = null;
      toastError(e);
    } finally {
      round.setBusy(false);
    }
  }

  async function open(cell: number) {
    if (!state || !active || pendingCell !== null || state.opened.includes(cell)) return;
    setPendingCell(cell);
    try {
      const s = await minesOpen(state.round_id, cell);
      setState(s);
      if (s.status === "settled") finish(s);
    } catch (e) {
      toastError(e);
    } finally {
      setPendingCell(null);
    }
  }

  async function cashout() {
    if (!state) return;
    round.setBusy(true);
    try {
      const s = await minesCashout(state.round_id);
      setState(s);
      finish(s);
    } catch (e) {
      toastError(e);
    } finally {
      round.setBusy(false);
    }
  }

  function finish(s: MinesState) {
    const net = Number(s.payout) - Number(s.bet);
    round.setOutcome({ state: net > 0 ? "win" : "lose", amount: Math.round(net * 100) / 100, multiplier: Number(s.current_multiplier) });
    if (net > 0) {
      round.setBurst(Date.now());
      celebrate({ amount: net, multiplier: Number(s.current_multiplier) });
    }
    refresh();
    round.loadHistory();
  }

  const stage = (
    <div className="mx-auto max-w-[520px] py-4">
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <Info label={t("multiplier")} value={state ? `×${Number(state.current_multiplier).toFixed(2)}` : "×0.00"} />
        <Info label={t("nextMultiplier")} value={state?.next_multiplier && active ? `×${Number(state.next_multiplier).toFixed(2)}` : "—"} accent />
        <Info label={t("cashout")} value={state && active ? formatUsd(Number(state.cashout_value), 0) : "—"} />
      </div>
      <div className="grid grid-cols-5 gap-2 md:gap-2.5">
        {Array.from({ length: 25 }, (_, i) => {
          const opened = state?.opened.includes(i);
          const isMine = settled && state?.mine_positions?.includes(i);
          const exploded = isMine && state?.hit === i;
          const face = opened ? "gem" : isMine ? "mine" : null;
          return (
            <motion.button
              key={`${state?.round_id ?? "idle"}-${i}`}
              onClick={() => open(i)}
              disabled={!active || opened || pendingCell !== null}
              whileHover={active && !opened ? { scale: 1.05, y: -2 } : {}}
              whileTap={active && !opened ? { scale: 0.92 } : {}}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, rotateY: face ? 180 : 0 }}
              transition={{ delay: face ? (opened ? 0 : 0.02 * i) : 0.012 * i, type: "spring", stiffness: 300, damping: 22 }}
              style={{ transformStyle: "preserve-3d", perspective: 600 }}
              className="relative aspect-square"
            >
              <span
                className={`absolute inset-0 grid place-items-center rounded-2xl border ${
                  active ? "border-[#2f7bff]/40 bg-gradient-to-b from-[#1a2440] to-[#101729] shadow-[inset_0_-4px_0_rgba(0,0,0,.35)]" : "border-[var(--border)] bg-[var(--surface-2)]"
                }`}
                style={{ backfaceVisibility: "hidden" }}
              >
                {seen.includes(i) && !opened && (
                  <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-[var(--danger)]/80">
                    <Bomb size={20} />
                  </motion.span>
                )}
                {pendingCell === i && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
              </span>
              <span
                className={`absolute inset-0 grid place-items-center rounded-2xl ${
                  face === "gem"
                    ? "bg-gradient-to-b from-[#0e3a2c] to-[#06221a] text-[var(--success)] ring-1 ring-[var(--success)]/40"
                    : exploded
                      ? "bg-gradient-to-b from-[#ff4d61] to-[#7f1d1d] text-white"
                      : "bg-[#1a0b10] text-[var(--danger)] opacity-70"
                }`}
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              >
                {face === "gem" ? <Gem size={26} /> : face === "mine" ? <Bomb size={24} /> : null}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );

  const controls = !active ? (
    <div>
      <p className="mb-2 text-xs text-[var(--muted)]">{t("minesCount")}</p>
      <div className="grid grid-cols-3 gap-2">
        {[3, 5, 10].map((n) => (
          <motion.button
            key={n}
            whileTap={{ scale: 0.94 }}
            onClick={() => setMines(n)}
            disabled={round.busy}
            className={`font-display rounded-xl py-3 font-bold transition-colors ${
              mines === n ? "bg-[#2f7bff] text-white shadow-[0_8px_24px_-8px_#2f7bff]" : "bg-[var(--surface-3)] text-[var(--muted)] hover:text-white"
            }`}
          >
            {n}
          </motion.button>
        ))}
      </div>
    </div>
  ) : null;

  const action = active ? (
    <div className="flex gap-2">
    <Button
      variant="ghost"
      onClick={enterSecret}
      aria-label={t("secretCode")}
      title={t("secretCode")}
      className="shrink-0 px-4 py-4"
    >
      <KeyRound size={18} />
    </Button>
    <Button
      variant="success"
      onClick={cashout}
      loading={round.busy}
      disabled={round.busy || pendingCell !== null || (state?.opened.length ?? 0) === 0}
      className="w-full py-4 text-base"
    >
      {t("cashout")} {state && state.opened.length > 0 ? formatUsd(Number(state.cashout_value)) : ""}
    </Button>
    </div>
  ) : (
    <Button onClick={start} loading={round.busy} disabled={round.busy} className="shine w-full py-4 text-base">
      {settled ? t("newRound") : t("play")}
    </Button>
  );

  return <GameRoom game="mines" round={round} accent="#00b4ff" stage={stage} controls={controls} action={action} />;
}

function Info({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl bg-[var(--bg-2)] px-2 py-2.5">
      <p className="truncate text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <Fit className={`font-display mt-0.5 text-sm font-bold tabular md:text-base ${accent ? "text-[var(--success)]" : ""}`}>{value}</Fit>
    </div>
  );
}
