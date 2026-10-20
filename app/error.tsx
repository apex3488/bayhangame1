"use client";

import { useEffect } from "react";

/** Any unexpected client error: a friendly screen with a retry instead of a blank page. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[var(--danger-soft)] text-3xl">⚠️</div>
        <h1 className="font-display mt-5 text-2xl font-semibold">Что-то пошло не так</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted)]">
          Ваш баланс и прогресс в безопасности — все операции проверяет сервер. Попробуйте ещё раз.
        </p>
        {error.digest && <p className="mt-2 font-mono text-[11px] text-[var(--dim)]">код: {error.digest}</p>}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button onClick={reset} className="rounded-2xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-2)]">
            Повторить
          </button>
          {/* A plain link: a full reload also recovers from a broken client state. */}
          <a href="/" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm font-semibold">
            На главную
          </a>
        </div>
      </div>
    </main>
  );
}
