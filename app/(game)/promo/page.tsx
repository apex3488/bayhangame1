"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Ticket } from "lucide-react";
import { useGame } from "@/components/game-context";
import { useAction } from "@/components/use-action";
import { TextForm } from "@/components/forms";
import { Burst, PageTitle, Reveal, formatUsd } from "@/components/ui";
import { redeemPromo } from "@/lib/economy";

export default function PromoPage() {
  const { t } = useGame();
  const { busy, run } = useAction();
  const [win, setWin] = useState<{ n: number; text: string } | null>(null);
  return (
    <div className="mx-auto max-w-lg">
      <PageTitle title={t("promo")} subtitle={t("promoSubtitle")} />
      <Reveal>
        <div className="panel relative overflow-hidden p-6">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-[#f43f5e]/20 blur-3xl" />
          <motion.div animate={{ rotate: [0, -8, 8, 0] }} transition={{ duration: 3, repeat: Infinity }} className="relative mb-5 inline-grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#f43f5e] to-[#7a1fff]">
            <Ticket size={26} />
          </motion.div>
          <TextForm
            label={t("enterCode")}
            action={t("redeem")}
            maxLength={32}
            busy={busy === "promo"}
            onSubmit={async (code) => {
              const r = await run("promo", () => redeemPromo(code), () => t("promoDone"));
              if (r) {
                const parts = [Number(r.usd) > 0 ? `+${formatUsd(Number(r.usd))}` : "", Number(r.btc) > 0 ? `+${Number(r.btc)} ₿` : ""].filter(Boolean);
                setWin({ n: Date.now(), text: parts.join(" · ") });
              }
              return r;
            }}
          />
          {win && (
            <motion.p key={win.n} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-display relative mt-6 text-center text-3xl font-bold text-[var(--success)]">
              <Burst trigger={win.n} />
              {win.text}
            </motion.p>
          )}
        </div>
      </Reveal>
    </div>
  );
}
