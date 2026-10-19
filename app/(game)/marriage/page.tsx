"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Heart, HeartCrack } from "lucide-react";
import { useAsk, useGame } from "@/components/game-context";
import { useAction } from "@/components/use-action";
import { TextForm } from "@/components/forms";
import { Burst, Button, PageTitle, Reveal, Skeleton } from "@/components/ui";
import { fetchMarriage, marriageDivorce, marriagePropose, marriageRespond } from "@/lib/economy";

type M = Awaited<ReturnType<typeof fetchMarriage>>;

export default function MarriagePage() {
  const { t, snapshot } = useGame();
  const { busy, run } = useAction();
  const ask = useAsk();
  const [m, setM] = useState<M | null>(null);
  const [burst, setBurst] = useState(0);

  const load = useCallback(() => {
    fetchMarriage().then(setM).catch(() => {});
  }, []);
  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title={t("marriage")} subtitle={t("marriageSubtitle")} />
      {!m ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">
          <Reveal>
            <div className="panel relative overflow-hidden p-8 text-center">
              <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(251,113,133,.18),transparent)]" />
              <Burst trigger={burst} color="#fb7185" count={36} />
              {m.partner ? (
                <div className="relative">
                  <div className="flex items-center justify-center gap-6">
                    <span className="font-display text-xl font-semibold">{snapshot?.game_name}</span>
                    <motion.div animate={{ scale: [1, 1.18, 1] }} transition={{ duration: 1.2, repeat: Infinity }} className="text-[#fb7185]">
                      <Heart size={44} className="fill-current" />
                    </motion.div>
                    <Link href={`/players/${encodeURIComponent(m.partner.game_name)}`} className="font-display text-xl font-semibold hover:underline">{m.partner.game_name}</Link>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    {t("since")} {new Date(m.partner.since).toLocaleDateString()}
                  </p>
                  <button
                    onClick={async () => {
                      if (!(await ask(`${t("divorce")}?`, { danger: true }))) return;
                      await run("divorce", () => marriageDivorce());
                      load();
                    }}
                    className="mt-6 inline-flex items-center gap-1.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--danger)]"
                  >
                    <HeartCrack size={14} /> {t("divorce")}
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 2.5, repeat: Infinity }} className="mx-auto mb-4 w-fit text-[#fb7185]/60">
                    <Heart size={56} />
                  </motion.div>
                  <p className="text-[var(--muted)]">{t("notMarried")}</p>
                  <div className="mx-auto mt-6 max-w-sm text-left">
                    <TextForm
                      label={t("propose")}
                      placeholder={t("invitePlaceholder")}
                      action={t("propose")}
                      maxLength={20}
                      busy={busy === "propose"}
                      onSubmit={async (name) => {
                        const r = await run("propose", () => marriagePropose(name), () => t("proposalSent"));
                        load();
                        return r;
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </Reveal>

          <AnimatePresence>
            {m.incoming.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="panel p-5">
                <p className="mb-3 text-sm font-semibold">{t("incoming")}</p>
                <ul className="space-y-2">
                  {m.incoming.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--bg-2)] px-4 py-3">
                      <span className="flex items-center gap-2 font-medium">
                        <Heart size={15} className="text-[#fb7185]" /> {p.from}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="success"
                          className="px-3 py-1.5 text-xs"
                          disabled={busy !== null}
                          onClick={async () => {
                            const r = await run(`a-${p.id}`, () => marriageRespond(p.id, true));
                            if (r) setBurst(Date.now());
                            load();
                          }}
                        >
                          {t("accept")}
                        </Button>
                        <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={busy !== null} onClick={async () => { await run(`d-${p.id}`, () => marriageRespond(p.id, false)); load(); }}>
                          {t("decline")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>

          {m.outgoing.length > 0 && (
            <div className="panel p-5">
              <p className="mb-3 text-sm font-semibold">{t("outgoing")}</p>
              <ul className="space-y-2">
                {m.outgoing.map((p) => (
                  <li key={p.id} className="flex items-center justify-between rounded-2xl bg-[var(--bg-2)] px-4 py-3 text-sm">
                    <span>{p.to}</span>
                    <span className="text-xs text-[var(--muted)]">⏳ {new Date(p.expires_at).toLocaleTimeString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
