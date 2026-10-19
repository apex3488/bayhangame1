import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android app = a native shell around the live game.
 * The game is server-authoritative (Next.js on Vercel + Supabase), so the app loads the
 * production site instead of bundling a copy: login, progress and economy stay on the server,
 * and every Vercel deploy reaches the app without a new APK.
 */
const config: CapacitorConfig = {
  appId: "app.bayhan.game",
  appName: "BAYHAN GAME",
  // Local fallback only: shown when the phone is offline (see server.errorPath).
  webDir: "mobile/www",
  server: {
    url: "https://bayhangame1.vercel.app",
    errorPath: "offline.html",
    androidScheme: "https",
  },
  android: {
    backgroundColor: "#05060a",
    allowMixedContent: false,
  },
  plugins: {
    // Back button is handled in MainActivity (history back, then minimise the app).
    App: { disableBackButtonHandler: true },
    // Insets are applied natively in MainActivity (the WebView sits between the system bars),
    // so the live site needs no changes. Light bar icons on the dark game background.
    SystemBars: { insetsHandling: "disable", style: "DARK" },
  },
};

export default config;
