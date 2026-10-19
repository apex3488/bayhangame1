"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { useGame } from "@/components/game-context";
import { Button, PageTitle, Reveal, Skeleton, formatUsd } from "@/components/ui";
import { fetchReferrals } from "@/lib/economy";

type Ref = Awaited<ReturnType<typeof fetchReferrals>>;

export default function ReferralsPage() {
  const { t, toast } = useGame();
  const [data, setData] = useState<Ref | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetchReferrals().then(setData).catch(() => {});
  }, []);

  const link = data && typeof window !== "undefined" ? `${window.location.origin}/register?ref=${data.code}` : "";

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      toast(t("copied"), "success");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast(text, "info");
    }
  }

  return (
    <div>
      <PageTitle title={t("referrals")} subtitle={t("referralsSubtitle")} />
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <Reveal>
            <div className="panel relative overflow-hidden p-6">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#22c55e]/20 blur-3xl" />
              <p className="relative text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{t("yourCode")}</p>
              <div className="relative mt-3 flex items-center gap-3">
                <motion.span initial={{ letterSpacing: "0.6em", opacity: 0 }} animate={{ letterSpacing: "0.25em", opacity: 1 }} transition={{ duration: 0.8 }}
                  className="font-display text-4xl font-bold text-[var(--success)]">
                  {data.code}
                </motion.span>
                <Button variant="ghost" className="px-3 py-2" onClick={() => copy(data.code, "code")}>
                  {copied === "code" ? <Check size={16} /> : <Copy size={16} />}
                </Button>
              </div>
              <p className="relative mt-6 text-xs text-[var(--muted)]">{t("inviteLink")}</p>
              <div className="relative mt-2 flex gap-2">
                <input readOnly value={link} className="min-w-0 flex-1 rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] px-4 py-3 text-sm text-[var(--muted)]" />
                <Button onClick={() => copy(link, "link")}>{copied === "link" ? <Check size={16} /> : t("copy")}</Button>
              </div>
              <div className="relative mt-6 grid grid-cols-3 gap-3">
                <Stat label={t("invited")} value={String(data.invited)} />
                <Stat label={t("qualified")} value={String(data.qualified)} />
                <Stat label={t("earnedRef")} value={formatUsd(Number(data.earned), 0)} />
              </div>
              <p className="relative mt-4 text-xs text-[var(--muted)]">
                {t("rewardPerFriend")}: <span className="font-semibold text-[var(--gold)]">{formatUsd(Number(data.reward), 0)}</span>
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.05}>
            <div className="panel p-6">
              <p className="mb-4 text-sm font-semibold">{t("invited")}</p>
              {data.list.length === 0 ? (
                <div className="grid place-items-center py-10 text-[var(--muted)]">
                  <UserPlus size={32} className="mb-2 opacity-50" />
                  {t("empty")}
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.list.map((r) => (
                    <li key={r.game_name} className="flex items-center justify-between rounded-2xl bg-[var(--bg-2)] px-4 py-3 text-sm">
                      <span className="font-medium">{r.game_name}</span>
                      <span className={`text-xs font-semibold ${r.qualified ? "text-[var(--success)]" : "text-[var(--muted)]"}`}>
                        {r.qualified ? `✓ ${t("qualified")}` : "…"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Reveal>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[var(--bg-2)] p-3">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="font-display mt-1 text-lg font-semibold tabular">{value}</p>
    </div>
  );
}
