"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownUp, Bitcoin, Landmark, PiggyBank, Timer, Wallet } from "lucide-react";
import { useGame } from "@/components/game-context";
import { useAction } from "@/components/use-action";
import { AmountForm, Tabs } from "@/components/forms";
import { Button, Money, PageTitle, Reveal, formatUsd, useCountdown } from "@/components/ui";
import {
  bankDeposit,
  bankWithdraw,
  btcBuy,
  btcSell,
  depositClaim,
  depositOpen,
  fetchBankTerms,
  fetchDeposits,
  type BankDeposit,
} from "@/lib/economy";

type Tab = "account" | "deposits" | "exchange";

export default function BankPage() {
  const { t, snapshot } = useGame();
  const [tab, setTab] = useState<Tab>("account");
  const cash = Number(snapshot?.cash ?? 0);
  const bank = Number(snapshot?.bank ?? 0);
  const btc = Number(snapshot?.btc ?? 0);

  return (
    <div>
      <PageTitle title={t("bank")} subtitle={t("bankSubtitle")} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <BalanceCard icon={Wallet} label={t("wallet")} value={<Money value={cash} />} hue="#2f7bff" delay={0} />
        <BalanceCard icon={Landmark} label={t("bankAccount")} value={<Money value={bank} />} hue="#10b981" delay={0.05} />
        <BalanceCard
          icon={Bitcoin}
          label={t("btc")}
          value={<span className="tabular">{btc.toFixed(8)} ₿</span>}
          sub={snapshot ? `≈ ${formatUsd(btc * Number(snapshot.btc_rate))}` : undefined}
          hue="#f59e0b"
          delay={0.1}
        />
      </div>
      <Tabs
        id="bank"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "account", label: t("bankAccount") },
          { id: "deposits", label: t("deposits") },
          { id: "exchange", label: t("exchange") },
        ]}
      />
      {tab === "account" && <AccountTab cash={cash} bank={bank} />}
      {tab === "deposits" && <DepositsTab cash={cash} />}
      {tab === "exchange" && <ExchangeTab cash={cash} btc={btc} rate={Number(snapshot?.btc_rate ?? 0)} />}
    </div>
  );
}

function BalanceCard({ icon: Icon, label, value, sub, hue, delay }: { icon: typeof Wallet; label: string; value: React.ReactNode; sub?: string; hue: string; delay: number }) {
  return (
    <Reveal delay={delay}>
      <div className="panel relative overflow-hidden p-5">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-25 blur-3xl" style={{ background: hue }} />
        <div className="relative flex items-center gap-2 text-xs text-[var(--muted)]">
          <Icon size={15} style={{ color: hue }} /> {label}
        </div>
        <p className="font-display relative mt-2 text-2xl font-semibold">{value}</p>
        {sub && <p className="relative mt-1 text-xs text-[var(--muted)]">{sub}</p>}
      </div>
    </Reveal>
  );
}

function AccountTab({ cash, bank }: { cash: number; bank: number }) {
  const { t } = useGame();
  const { busy, run } = useAction();
  return (
    <Reveal>
      <div className="panel grid gap-6 p-6 md:grid-cols-[1fr_auto_1fr] md:items-end">
        <AmountForm label={t("toBank")} action={t("toBank")} max={cash} busy={busy === "in"}
          onSubmit={(a) => run("in", (k) => bankDeposit(a, k), () => `${t("toBank")}: ${formatUsd(a)}`)} />
        <div className="hidden justify-center pb-3 text-[var(--dim)] md:flex">
          <ArrowDownUp size={20} />
        </div>
        <AmountForm label={t("fromBank")} action={t("fromBank")} max={bank} busy={busy === "out"} variant="outline"
          onSubmit={(a) => run("out", (k) => bankWithdraw(a, k), () => `${t("fromBank")}: ${formatUsd(a)}`)} />
      </div>
    </Reveal>
  );
}

function DepositsTab({ cash }: { cash: number }) {
  const { t } = useGame();
  const { busy, run } = useAction();
  const [terms, setTerms] = useState<{ days: number; rate_percent: number }[]>([]);
  const [days, setDays] = useState(30);
  const [list, setList] = useState<BankDeposit[] | null>(null);

  const load = useCallback(() => {
    fetchDeposits().then(setList).catch(() => setList([]));
  }, []);
  useEffect(() => {
    fetchBankTerms().then(setTerms).catch(() => {});
    load();
  }, [load]);

  const rate = Number(terms.find((x) => x.days === days)?.rate_percent ?? 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <Reveal>
        <div className="panel space-y-5 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <PiggyBank size={18} className="text-[var(--success)]" /> {t("openDeposit")}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {terms.map((term) => (
              <motion.button
                key={term.days}
                whileTap={{ scale: 0.95 }}
                onClick={() => setDays(term.days)}
                className={`rounded-2xl p-3 text-center transition-colors ${
                  days === term.days ? "bg-[var(--success)] text-black" : "bg-[var(--surface-3)] text-[var(--muted)] hover:text-white"
                }`}
              >
                <p className="font-display text-lg font-bold">{term.days}</p>
                <p className="text-[11px]">{t("days")}</p>
                <p className="mt-1 text-sm font-bold">{Number(term.rate_percent)}%</p>
              </motion.button>
            ))}
          </div>
          <AmountForm
            label={t("amount")}
            action={t("openDeposit")}
            max={cash}
            variant="success"
            busy={busy === "open"}
            hint={(a) => `${t("youGet")}: ${formatUsd(a + Math.round(a * rate) / 100)} · ${days} ${t("days")}`}
            onSubmit={async (a) => {
              const r = await run("open", (k) => depositOpen(a, days, k), () => t("depositOpened"));
              load();
              return r;
            }}
          />
        </div>
      </Reveal>
      <Reveal delay={0.05}>
        <div className="panel p-6">
          <p className="mb-4 text-sm font-semibold">{t("activeDeposits")}</p>
          {list === null ? (
            <div className="skeleton h-24" />
          ) : list.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("noDeposits")}</p>
          ) : (
            <ul className="space-y-2">
              {list.map((d) => (
                <DepositRow
                  key={d.id}
                  d={d}
                  busy={busy === `claim-${d.id}`}
                  onClaim={async () => {
                    await run(`claim-${d.id}`, () => depositClaim(d.id), (r) => `+${formatUsd(Number(r.payout))}`);
                    load();
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </Reveal>
    </div>
  );
}

function DepositRow({ d, busy, onClaim }: { d: BankDeposit; busy: boolean; onClaim: () => void }) {
  const { t } = useGame();
  const { left, label } = useCountdown(d.claimed ? null : d.ends_at);
  const total = new Date(d.ends_at).getTime() - new Date(d.starts_at).getTime();
  const pct = d.claimed ? 100 : Math.min(100, ((total - left * 1000) / total) * 100);
  const interest = Math.round(Number(d.amount) * Number(d.rate_percent)) / 100;
  return (
    <li className="rounded-2xl bg-[var(--bg-2)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold tabular">{formatUsd(Number(d.amount))}</p>
          <p className="text-xs text-[var(--muted)]">
            {d.days} {t("days")} · {Number(d.rate_percent)}% · +{formatUsd(interest)}
          </p>
        </div>
        {d.claimed ? (
          <span className="text-xs text-[var(--dim)]">{t("closed")}</span>
        ) : left === 0 ? (
          <Button variant="success" onClick={onClaim} loading={busy} disabled={busy} className="py-2">
            {t("claim")}
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <Timer size={13} /> <span className="tabular">{left > 86400 ? `${Math.ceil(left / 86400)} ${t("days")}` : label}</span>
          </span>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <motion.div className="h-full rounded-full bg-[var(--success)]" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1 }} />
      </div>
    </li>
  );
}

function ExchangeTab({ cash, btc, rate }: { cash: number; btc: number; rate: number }) {
  const { t } = useGame();
  const { busy, run } = useAction();
  return (
    <Reveal>
      <div className="panel p-6">
        <div className="mb-6 flex items-center justify-between rounded-2xl bg-gradient-to-r from-[#f59e0b22] to-transparent p-4">
          <div className="flex items-center gap-3">
            <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 3, repeat: Infinity }} className="grid h-11 w-11 place-items-center rounded-full bg-[#f59e0b] text-black">
              <Bitcoin size={22} />
            </motion.div>
            <div>
              <p className="text-xs text-[var(--muted)]">{t("btcRate")}</p>
              <p className="font-display text-xl font-semibold tabular">{formatUsd(rate)}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <AmountForm label={t("buyBtc")} action={t("buyBtc")} max={cash} busy={busy === "buy"} variant="success"
            hint={(a) => `${t("youGet")}: ${(Math.floor((a / rate) * 1e8) / 1e8).toFixed(8)} ₿`}
            onSubmit={(a) => run("buy", (k) => btcBuy(a, k), (r) => `+${Number(r.btc).toFixed(8)} ₿`)} />
          <AmountForm label={t("sellBtc")} action={t("sellBtc")} prefix="₿" decimals={8} max={btc} busy={busy === "sell"} variant="outline"
            hint={(a) => `${t("youGet")}: ${formatUsd(Math.floor(a * rate * 100) / 100)}`}
            onSubmit={(a) => run("sell", (k) => btcSell(a, k), (r) => `+${formatUsd(Number(r.usd))}`)} />
        </div>
      </div>
    </Reveal>
  );
}
