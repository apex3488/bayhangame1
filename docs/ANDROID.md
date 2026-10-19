# Android-приложение (APK)

Готовый файл: `dist/BAYHAN-GAME.apk` (release, подписан, в git не попадает).

## Как устроено

- Capacitor 8 — нативная оболочка вокруг живой игры https://bayhangame1.vercel.app.
  Игра серверная (Vercel + Supabase), поэтому приложение не содержит копию сайта: вход, прогресс и
  экономика остаются на сервере, а каждое обновление сайта сразу видно в приложении без нового APK.
- Без интернета показывается `mobile/www/offline.html` с кнопкой «Повторить».
- Кнопка «Назад» — предыдущая страница игры, на первой странице сворачивает приложение
  (`android/app/src/main/java/app/bayhan/game/MainActivity.java`).
- Отступы под строку состояния, панель навигации и клавиатуру делает приложение (там же),
  сайт для этого не менялся.
- Иконки и заставка генерируются из `assets/icon-only.png`: `node scripts/android-icons.mjs`.

## Где что лежит на этом компьютере

| Что | Где |
|---|---|
| Android SDK | `D:\bayhan-android\sdk` |
| Кэш Gradle | `D:\bayhan-android\gradle-home` |
| **Ключ подписи** | `D:\bayhan-android\signing\bayhan-release.jks` + `keystore.properties` (пароль) |
| Скрипт сборки | `D:\bayhan-android\build-apk.sh` |

**Ключ подписи нужно сохранить в надёжном месте.** Обновление приложения на телефонах ставится
поверх старого только если подписано тем же ключом. Без него придётся удалять приложение и ставить заново.

## Пересборка

Путь проекта содержит кириллицу, а инструменты Android с ней не работают, поэтому сборка идёт через
диск-псевдоним `B:` (PowerShell, из папки проекта):

```powershell
subst B: (Get-Location).Path
```

Затем (Git Bash):

```bash
npx cap sync android
bash /d/bayhan-android/build-apk.sh --max-workers=2
cp android/app/build/outputs/apk/release/app-release.apk dist/BAYHAN-GAME.apk
```

Особенности этого компьютера, уже учтённые в скрипте:

- Avast проверяет HTTPS своим сертификатом, поэтому Java берёт сертификаты из хранилища Windows
  (`-Djavax.net.ssl.trustStoreType=Windows-ROOT`).
- Временные папки Java перенесены на `D:\bayhan-android\tmp` (кириллица в пути ломает Java 21).
- Если загрузка зависимостей падает с `Tag mismatch` — это обрыв соединения через Avast, просто повторить.

При новой версии увеличьте `versionCode` и `versionName` в `android/app/build.gradle`.
