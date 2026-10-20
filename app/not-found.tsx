import Link from "next/link";

export const metadata = { title: "Страница не найдена" };

export default function NotFound() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-6 text-center">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[var(--accent)] opacity-20 blur-[140px]" />
      <div className="relative">
        <p className="font-display bg-gradient-to-b from-white to-[var(--accent-2)] bg-clip-text text-[120px] font-black leading-none text-transparent md:text-[160px]">404</p>
        <h1 className="font-display mt-4 text-2xl font-semibold">Такой страницы нет</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted)]">Возможно, ссылка устарела или в адресе опечатка. Page not found.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="rounded-2xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_var(--accent-glow)] transition-colors hover:bg-[var(--accent-2)]">
            На главную
          </Link>
          <Link href="/games" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm font-semibold transition-colors hover:border-[var(--border-strong)]">
            Игровой зал
          </Link>
        </div>
      </div>
    </main>
  );
}
