"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useGame } from "./game-context";
import { useCelebrate } from "./victory";
import { BetInput, Burst, Button, ResultBanner, formatUsd } from "./ui";
import {
  fetchGameHistory,
  fetchGameSettings,
  newIdempotencyKey,
  playGame,
  type GameId,
  type GameRoundRow,
  type GameSettings,
  type RoundResult,
} from "@/lib/game";

export interface Outcome {
  state: "win" | "lose";
  amount: number;
  multiplier: number;
}

/**
 * Round lifecycle for one-shot games: validate → server round → animation → reveal.
 * `animMs` lets each game finish its animation before the result banner appears.
 */
export function useRound<R>(game: GameId) {
  const { refresh, toastError, snapshot } = useGame();
  const celebrate = useCelebrate();
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [history, setHistory] = useState<GameRoundRow[]>([]);
  const [bet, setBet] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [burst, setBurst] = useState(0);
  const pendingKey = useRef<string | null>(null);

  const loadHistory = useCallback(() => {
    fetchGameHistory(game).then(setHistory).catch(() => {});
  }, [game]);

  useEffect(() => {
    fetchGameSettings(game)
      .then((s) => {
        setSettings(s);
        setBet((b) => Math.max(Number(s.min_bet), Math.min(Number(s.max_bet), b)));
      })
      .catch(() => {});
    loadHistory();
  }, [game, loadHistory]);

  /** Starts a round. Returns the server result, or null if it was rejected. */
  const play = useCallback(
    async (choice: Record<string, unknown>): Promise<RoundResult<R> | null> => {
      setBusy(true);
      setOutcome(null);
      pendingKey.current ??= newIdempotencyKey();
      try {
        const res = await playGame<R>(game, bet, choice, pendingKey.current);
        pendingKey.current = null;
        return res;
      } catch (e) {
        // A definite rejection gets a fresh key next time; an unknown failure keeps it so a retry cannot double-charge.
        if (e instanceof Error && !e.message.includes("fetch")) pendingKey.current = null;
        toastError(e);
        setBusy(false);
        return null;
      }
    },
    [game, bet, toastError],
  );

  /** Call when the animation has landed. */
  const reveal = useCallback(
    (res: RoundResult<R>) => {
      const payout = Number(res.payout);
      const win = payout > Number(res.bet);
      // Net result, as in the bot: a round is "won" only when the payout exceeds the bet.
      setOutcome({ state: win ? "win" : "lose", amount: Math.round((payout - Number(res.bet)) * 100) / 100, multiplier: Number(res.multiplier) });
      if (win) {
        setBurst(Date.now());
        celebrate({ amount: payout - Number(res.bet), multiplier: Number(res.multiplier) });
      }
      setBusy(false);
      refresh();
      loadHistory();
    },
    [refresh, loadHistory, celebrate],
  );

  return {
    settings,
    history,
    bet,
    setBet,
    busy,
    setBusy,
    outcome,
    setOutcome,
    burst,
    setBurst,
    play,
    reveal,
    loadHistory,
    balance: snapshot ? Number(snapshot.cash) : 0,
  };
}

/** The parts of a round the room renders; independent of the game's result type. */
type RoomRound = Pick<ReturnType<typeof useRound>, "settings" | "history" | "bet" | "setBet" | "busy" | "outcome" | "burst" | "balance">;

export function GameRoom({
  game,
  stage,
  controls,
  action,
  round,
  accent = "#2f7bff",
}: {
  game: GameId;
  stage: ReactNode;
  controls?: ReactNode;
  action: ReactNode;
  round: RoomRound;
  accent?: string;
}) {
  const { t } = useGame();
  const [rulesOpen, setRulesOpen] = useState(false);
  const s = round.settings;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <Link
          href="/games"
          className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:text-white"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-semibold">{t(`game_${game}`)}</h1>
          <p className="text-xs text-[var(--muted)]">{t(`gamed_${game}`)}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="panel relative overflow-hidden p-3 md:p-5"
          style={{ boxShadow: `0 30px 80px -40px ${accent}88` }}
        >
          <div className="absolute inset-0 opacity-40" style={{ background: `radial-gradient(60% 50% at 50% 0%, ${accent}33, transparent)` }} />
          <div className="relative">{stage}</div>
          <Burst trigger={round.burst} count={40} />
        </motion.div>

        <div className="space-y-4">
          <div className="panel space-y-4 p-5">
            {s ? (
              <BetInput
                value={round.bet}
                onChange={round.setBet}
                min={Number(s.min_bet)}
                max={Number(s.max_bet)}
                balance={round.balance}
                disabled={round.busy}
                label={t("bet")}
              />
            ) : (
              <div className="skeleton h-20" />
            )}
            {controls}
            {action}
            <ResultBanner
              state={round.outcome?.state ?? null}
              winLabel={t("youWon")}
              loseLabel={t("lose")}
              amount={round.outcome?.amount ?? 0}
              multiplier={round.outcome?.multiplier ?? 0}
            />
          </div>

          <div className="panel overflow-hidden">
            <button onClick={() => setRulesOpen((v) => !v)} className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold">
              {t("rules")}
              <motion.span animate={{ rotate: rulesOpen ? 180 : 0 }}>
                <ChevronDown size={16} />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {rulesOpen && (
                <motion.p
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="px-5 pb-4 text-sm leading-relaxed text-[var(--muted)]"
                >
                  {t(`rules_${game}`)}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="panel p-5">
            <p className="mb-3 text-sm font-semibold">{t("recentRounds")}</p>
            {round.history.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("empty")}</p>
            ) : (
              <ul className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {round.history.slice(0, 8).map((h) => {
                    const won = Number(h.payout) > Number(h.bet);
                    return (
                      <motion.li
                        key={h.id}
                        layout
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-between rounded-xl bg-[var(--bg-2)] px-3 py-2 text-xs"
                      >
                        <span className="tabular text-[var(--muted)]">{formatUsd(Number(h.bet), 0)}</span>
                        <span className={`tabular font-semibold ${won ? "text-[var(--success)]" : "text-[var(--dim)]"}`}>
                          ×{Number(h.multiplier)}
                        </span>
                        <span className={`tabular font-semibold ${won ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                          {Number(h.payout) - Number(h.bet) >= 0 ? "+" : "−"}
                          {formatUsd(Math.abs(Number(h.payout) - Number(h.bet)), 0)}
                        </span>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Primary play button with consistent styling. */
export function PlayButton({ onClick, busy, label, disabled }: { onClick: () => void; busy: boolean; label: string; disabled?: boolean }) {
  return (
    <Button onClick={onClick} disabled={busy || disabled} loading={busy} className="shine w-full py-4 text-base">
      {label}
    </Button>
  );
}
