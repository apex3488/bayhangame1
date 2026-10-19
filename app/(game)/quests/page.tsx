"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Award, Check, Target } from "lucide-react";
import { useGame } from "@/components/game-context";
import { useAction } from "@/components/use-action";
import { Tabs } from "@/components/forms";
import { Burst, Button, PageTitle, Reveal, Skeleton, formatCompact, formatUsd } from "@/components/ui";
import { claimAchievement, claimQuest, fetchAchievements, fetchQuests, type AchievementRow, type QuestRow } from "@/lib/economy";

const MONEY_TYPES = new Set(["earn_usd", "total_wagered", "total_won", "capital"]);

export default function QuestsPage() {
  const { t } = useGame();
  const { busy, run } = useAction();
  const [tab, setTab] = useState<"quests" | "achievements">("quests");
  const [quests, setQuests] = useState<QuestRow[] | null>(null);
  const [achievements, setAchievements] = useState<AchievementRow[] | null>(null);
  const [burst, setBurst] = useState<{ code: string; n: number } | null>(null);

  const load = useCallback(() => {
    fetchQuests().then(setQuests).catch(() => setQuests([]));
    fetchAchievements().then(setAchievements).catch(() => setAchievements([]));
  }, []);
  useEffect(load, [load]);

  const rows =
    tab === "quests"
      ? (quests ?? []).map((q) => ({ code: q.code, title: t(`quest_${q.code}`), sub: null as string | null, type: q.quest_type, target: Number(q.target), progress: Number(q.progress), reward: Number(q.reward_usd), claimed: q.claimed }))
      : (achievements ?? []).map((a) => ({ code: a.code, title: t(`ach_${a.code}`), sub: t(`achd_${a.condition_type}`), type: a.condition_type, target: Number(a.condition_value), progress: Number(a.progress), reward: Number(a.reward_usd), claimed: a.claimed }));

  async function claim(code: string) {
    const r = await run(code, () => (tab === "quests" ? claimQuest(code) : claimAchievement(code)), (res) => `+${formatUsd(Number(res.reward))}`);
    if (r) setBurst({ code, n: Date.now() });
    load();
  }

  const loading = tab === "quests" ? quests === null : achievements === null;

  return (
    <div>
      <PageTitle title={t("quests")} subtitle={t("questsSubtitle")} />
      <Tabs id="quests" value={tab} onChange={setTab} tabs={[{ id: "quests", label: t("quests") }, { id: "achievements", label: t("achievements") }]} />
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r, i) => {
            const pct = Math.min(100, (r.progress / r.target) * 100);
            const done = pct >= 100;
            const fmt = (v: number) => (MONEY_TYPES.has(r.type) ? `$${formatCompact(v)}` : String(Math.floor(v)));
            return (
              <Reveal key={r.code} delay={i * 0.04}>
                <div className={`panel relative overflow-hidden p-5 ${done && !r.claimed ? "panel-glow" : ""}`}>
                  {burst?.code === r.code && <Burst trigger={burst.n} count={24} />}
                  <div className="flex items-start gap-4">
                    <div
                      className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
                        r.claimed ? "bg-[var(--success-soft)] text-[var(--success)]" : done ? "bg-[var(--gold)]/20 text-[var(--gold)]" : "bg-[var(--surface-3)] text-[var(--muted)]"
                      }`}
                    >
                      {r.claimed ? <Check size={22} /> : tab === "quests" ? <Target size={22} /> : <Award size={22} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">{r.title}</p>
                          {r.sub && (
                            <p className="text-xs text-[var(--muted)]">
                              {r.sub}: {fmt(r.target)}
                            </p>
                          )}
                        </div>
                        <span className="font-display shrink-0 text-sm font-semibold text-[var(--gold)] tabular">+{formatUsd(r.reward, 0)}</span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <motion.div
                          className={`h-full rounded-full ${done ? "bg-gradient-to-r from-[var(--gold)] to-[#ff8a3d]" : "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]"}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 1, delay: 0.1 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-[var(--muted)] tabular">
                          {fmt(r.progress)} / {fmt(r.target)}
                        </span>
                        {r.claimed ? (
                          <span className="text-xs font-semibold text-[var(--success)]">{t("claimed")}</span>
                        ) : (
                          <Button className="px-4 py-1.5 text-xs" disabled={!done || busy !== null} loading={busy === r.code} onClick={() => claim(r.code)}>
                            {t("claimReward")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      )}
    </div>
  );
}
