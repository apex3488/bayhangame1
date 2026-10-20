import Link from "next/link";

export const metadata = {
  title: "Правила и конфиденциальность",
  description: "Правила BAYHAN GAME: игровая валюта, честная игра, аккаунт и данные игроков.",
};

const UPDATED = "20.10.2026";

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "Об игре",
    items: [
      "BAYHAN GAME — развлекательная экономическая онлайн-игра. Всё, что происходит в игре, — виртуально.",
      "Все расчёты (зарплаты, ставки, доход, покупки) выполняет сервер. Результат каждой игры определяется на сервере случайно и одинаково честно для всех.",
    ],
  },
  {
    title: "Игровая валюта",
    items: [
      "Игровые доллары и Bitcoin существуют только внутри игры и не имеют реальной стоимости.",
      "Их нельзя купить за реальные деньги, продать или вывести. Игры со ставками в BAYHAN — это игры на виртуальную валюту, а не азартные игры на деньги.",
      "Если кто-то предлагает купить или продать игровую валюту, аккаунт или предметы — это мошенничество. Сообщите нам.",
    ],
  },
  {
    title: "Честная игра",
    items: [
      "Запрещены: несколько аккаунтов для фарма бонусов и переводов самому себе, боты и автокликеры, использование ошибок игры.",
      "Нашли ошибку — напишите нам, мы быстро исправим.",
      "Запрещены оскорбления, обман других игроков и неприемлемые аватары, фоны и описания профиля. Их удаляет модерация.",
      "За нарушения аккаунт может быть ограничен или заблокирован. Все действия администрации записываются в журнал.",
    ],
  },
  {
    title: "Аккаунт",
    items: [
      "Вы отвечаете за сохранность своего логина и пароля. Администрация никогда не спрашивает ваш пароль.",
      "Удалить аккаунт и данные можно по запросу в нашем Telegram-канале.",
    ],
  },
  {
    title: "Какие данные мы храним",
    items: [
      "Логин, игровое имя, игровую статистику и историю операций — чтобы игра работала и была честной.",
      "Аватар, фон и описание профиля — только если вы сами их добавили. Фото пересжимаются, данные о месте съёмки удаляются.",
      "Пароль хранится только в зашифрованном виде у провайдера авторизации (Supabase). Мы не видим ваш пароль.",
      "Мы не продаём и не передаём данные игроков третьим лицам и не показываем рекламу других компаний.",
    ],
  },
];

export default function RulesPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 md:py-16">
      <Link href="/" className="text-sm text-[var(--muted)] hover:text-white">
        ← BAYHAN GAME
      </Link>
      <h1 className="font-display mt-4 text-3xl font-semibold md:text-4xl">Правила и конфиденциальность</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">Обновлено {UPDATED}. Играя, вы соглашаетесь с этими правилами.</p>
      <div className="mt-8 space-y-5">
        {SECTIONS.map((s) => (
          <section key={s.title} className="panel p-5 md:p-6">
            <h2 className="font-display text-lg font-semibold">{s.title}</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--text)]/90">
              {s.items.map((it) => (
                <li key={it} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section className="panel p-5 md:p-6">
          <h2 className="font-display text-lg font-semibold">Связь с нами</h2>
          <p className="mt-3 text-sm">
            Вопросы, жалобы и предложения — в Telegram-канале{" "}
            <a href="https://t.me/bayhan_studio" target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--accent-2)] hover:underline">
              t.me/bayhan_studio
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
