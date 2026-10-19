"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useGame } from "@/components/game-context";
import { GROUPS } from "@/components/nav";
import { Money, PageTitle, Reveal } from "@/components/ui";

export default function CityPage() {
  const { t, snapshot } = useGame();
  let i = 0;
  return (
    <div>
      <PageTitle
        title={t("city")}
        subtitle={t("citySubtitle")}
        right={
          snapshot && (
            <div className="panel px-5 py-3 text-right">
              <p className="text-[11px] uppercase tracking-widest text-[var(--muted)]">{t("capital")}</p>
              <Money value={Number(snapshot.total_capital)} className="font-display text-xl font-semibold" />
            </div>
          )
        }
      />
      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.key}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">{t(g.key)}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {g.items
                .filter((s) => s.href !== "/city")
                .map((s) => {
                  const Icon = s.icon;
                  return (
                    <Reveal key={s.href} delay={0.03 * i++}>
                      <Link href={s.href}>
                        <motion.div
                          whileHover={{ y: -4 }}
                          whileTap={{ scale: 0.97 }}
                          className="group relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4"
                        >
                          <div
                            className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-30 blur-2xl transition-opacity group-hover:opacity-60"
                            style={{ background: s.hue }}
                          />
                          <div className="relative grid h-11 w-11 place-items-center rounded-2xl" style={{ background: `${s.hue}22`, color: s.hue }}>
                            <Icon size={21} />
                          </div>
                          <p className="relative mt-6 text-sm font-semibold">{t(s.key)}</p>
                        </motion.div>
                      </Link>
                    </Reveal>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
