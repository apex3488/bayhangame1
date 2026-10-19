"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { LANGS, type Lang } from "@/lib/i18n";

/** Split-screen frame for login and sign-up: animated brand panel + form. */
export function AuthLayout({
  title,
  hint,
  lang,
  setLang,
  children,
}: {
  title: string;
  hint: string;
  lang: Lang;
  setLang: (l: Lang) => void;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-[var(--border)] lg:block">
        <div className="grid-bg absolute inset-0 opacity-70" />
        {[
          { c: "#2f7bff", x: "20%", y: "25%", s: 420, d: 14 },
          { c: "#7a3cff", x: "65%", y: "60%", s: 360, d: 18 },
          { c: "#00b4ff", x: "35%", y: "80%", s: 280, d: 12 },
        ].map((o, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full blur-[90px]"
            style={{ background: o.c, width: o.s, height: o.s, left: o.x, top: o.y, opacity: 0.35 }}
            animate={{ x: [0, 40, -30, 0], y: [0, -30, 20, 0] }}
            transition={{ duration: o.d, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent)] font-display font-bold shadow-[0_0_40px_var(--accent-glow)]">B</div>
            <span className="font-display text-lg font-semibold tracking-wide">BAYHAN GAME</span>
          </div>
          <div>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="font-display max-w-md text-5xl font-semibold leading-[1.05]"
            >
              Build your empire.
              <span className="block bg-gradient-to-r from-[var(--accent-2)] to-[#a78bfa] bg-clip-text text-transparent">Play to win.</span>
            </motion.h2>
            <div className="mt-10 grid max-w-md grid-cols-3 gap-3">
              {[
                ["$50K", "start"],
                ["10", "games"],
                ["8", "jobs"],
              ].map(([v, l], i) => (
                <motion.div
                  key={l}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur"
                >
                  <p className="font-display text-2xl font-semibold">{v}</p>
                  <p className="text-xs uppercase tracking-widest text-[var(--muted)]">{l}</p>
                </motion.div>
              ))}
            </div>
          </div>
          <p className="text-xs text-[var(--dim)]">© BAYHAN GAME 2.0</p>
        </div>
      </div>

      <div className="relative flex flex-col justify-center px-6 py-12 sm:px-12">
        <select
          aria-label="Language"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          className="absolute right-6 top-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs font-semibold"
        >
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto w-full max-w-sm"
        >
          <div className="mb-8 lg:hidden">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--accent)] font-display font-bold shadow-[0_0_40px_var(--accent-glow)]">B</div>
          </div>
          <h1 className="font-display text-3xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{hint}</p>
          <div className="mt-8">{children}</div>
        </motion.div>
      </div>
    </div>
  );
}
