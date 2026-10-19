"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Crown, Sparkles } from "lucide-react";
import { useGame } from "@/components/game-context";
import { PageTitle, Reveal, Skeleton, useCountdown } from "@/components/ui";
import { fetchEvents, fetchVip, type EventRow } from "@/lib/economy";

export default function EventsPage() {
  const { t } = useGame();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [vip, setVip] = useState<{ level: number; active: boolean; multiplier: number; ends_at?: string } | null>(null);

  useEffect(() => {
    fetchEvents()
      .then((e) => setEvents(e.filter((x) => new Date(x.ends_at).getTime() > Date.now())))
      .catch(() => setEvents([]));
    fetchVip().then(setVip).catch(() => {});
  }, []);

  return (
    <div>
      <PageTitle title={t("events")} subtitle={t("eventsSubtitle")} />
      <Reveal>
        <div className="panel relative mb-6 overflow-hidden p-6">
          <div className="absolute inset-0 bg-gradient-to-r from-[#ffc94d22] via-transparent to-transparent" />
          <div className="relative flex flex-wrap items-center gap-5">
            <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2.4, repeat: Infinity }} className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#ffc94d] to-[#f97316] text-black">
              <Crown size={26} />
            </motion.div>
            <div className="flex-1">
              <p className="font-display text-lg font-semibold">
                {vip?.active ? `${t("vipLevel")} ${vip.level} · ×${Number(vip.multiplier)}` : t("vipNone")}
              </p>
              {vip?.active && vip.ends_at && (
                <p className="text-sm text-[var(--muted)]">
                  {t("vipUntil")} {new Date(vip.ends_at).toLocaleDateString()}
                </p>
              )}
              <p className="mt-1 text-xs text-[var(--muted)]">{t("vipInfo")}</p>
            </div>
          </div>
        </div>
      </Reveal>
      {events === null ? (
        <Skeleton className="h-32" />
      ) : events.length === 0 ? (
        <div className="panel grid place-items-center p-12 text-center text-[var(--muted)]">
          <Sparkles size={36} className="mb-3 opacity-50" />
          {t("noEvents")}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {events.map((e, i) => (
            <EventCard key={e.code} e={e} delay={i * 0.05} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ e, delay }: { e: EventRow; delay: number }) {
  const { t } = useGame();
  const started = new Date(e.starts_at).getTime() <= Date.now();
  const { label } = useCountdown(started ? e.ends_at : e.starts_at);
  return (
    <Reveal delay={delay}>
      <div className="panel panel-glow relative overflow-hidden p-6">
        <motion.div className="absolute -right-6 -top-6 text-[var(--accent)] opacity-20" animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }}>
          <Sparkles size={120} />
        </motion.div>
        <span className="relative rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-2)]">{t(`ev_${e.event_type}`)}</span>
        <p className="font-display relative mt-4 text-2xl font-bold">{e.title}</p>
        {e.description && <p className="relative mt-1 text-sm text-[var(--muted)]">{e.description}</p>}
        <div className="relative mt-5 flex items-end justify-between">
          <span className="font-display text-4xl font-bold text-[var(--gold)]">×{Number(e.multiplier)}</span>
          <span className="text-xs text-[var(--muted)]">
            {started ? t("eventEnds") : "⏳"} <span className="tabular font-semibold text-white">{label}</span>
          </span>
        </div>
      </div>
    </Reveal>
  );
}
