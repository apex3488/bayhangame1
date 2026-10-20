"use client";

import { Briefcase, Gamepad2, ShieldCheck, Users, Wallet } from "lucide-react";
import { useGame } from "@/components/game-context";
import { PageTitle, Reveal } from "@/components/ui";

const SECTIONS = [
  { key: "help_money", title: "wallet", icon: Wallet, hue: "#2f7bff" },
  { key: "help_earn", title: "work", icon: Briefcase, hue: "#10b981" },
  { key: "help_games", title: "games", icon: Gamepad2, hue: "#a855f7" },
  { key: "help_social", title: "groupSocial", icon: Users, hue: "#f97316" },
  { key: "help_fair", title: "rules", icon: ShieldCheck, hue: "#64748b" },
];

export default function HelpPage() {
  const { t } = useGame();
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title={t("help")} subtitle={t("helpSubtitle")} />
      <div className="space-y-3">
        {SECTIONS.map((s, i) => {
          const Icon = s.icon;
          return (
            <Reveal key={s.key} delay={i * 0.05}>
              <div className="panel flex gap-4 p-5">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: `${s.hue}22`, color: s.hue }}>
                  <Icon size={20} />
                </div>
                <div>
                  <p className="font-semibold">{t(s.title)}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{t(s.key)}</p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
      <div className="panel mt-5 flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
        <span className="text-[var(--muted)]">{t("rulesLink")} · t.me/bayhan_studio</span>
        <div className="flex gap-2">
          <a href="/rules" className="rounded-xl border border-[var(--border)] px-4 py-2 font-semibold hover:border-[var(--border-strong)]">
            {t("rulesLink")}
          </a>
          <a href="https://t.me/bayhan_studio" target="_blank" rel="noopener noreferrer" className="rounded-xl bg-[#2aabee] px-4 py-2 font-semibold text-white">
            Telegram
          </a>
        </div>
      </div>
    </div>
  );
}
