// Builds every Android launcher icon and splash image from assets/icon-only.png (the official BAYHAN GAME icon).
// Run: node scripts/android-icons.mjs   (after `npx cap add android`)
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SRC = "assets/icon-only.png";
const RES = "android/app/src/main/res";
const BG = { r: 0, g: 0, b: 0, alpha: 1 }; // the icon's own outer colour
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const out = (dir, name) => {
  mkdirSync(`${RES}/${dir}`, { recursive: true });
  return `${RES}/${dir}/${name}`;
};

for (const [d, k] of Object.entries(DENSITIES)) {
  // Legacy icon (Android 7 and launchers without adaptive icons): the artwork as is, it already has rounded corners.
  const legacy = Math.round(48 * k);
  await sharp(SRC).resize(legacy, legacy).png().toFile(out(`mipmap-${d}`, "ic_launcher.png"));

  // Legacy round icon: artwork scaled into a black circle so the circle crop keeps the logo whole.
  const inner = Math.round(legacy * 0.86);
  const round = await sharp({ create: { width: legacy, height: legacy, channels: 4, background: BG } })
    .composite([{ input: await sharp(SRC).resize(inner, inner).toBuffer(), gravity: "center" }])
    .png()
    .toBuffer();
  const mask = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`);
  await sharp(round).composite([{ input: mask, blend: "dest-in" }]).png().toFile(out(`mipmap-${d}`, "ic_launcher_round.png"));

  // Adaptive icon foreground (108dp layer, launcher masks it): artwork at ~68% so the logo and text stay inside the mask.
  const layer = Math.round(108 * k);
  const art = Math.round(layer * 0.68);
  await sharp({ create: { width: layer, height: layer, channels: 4, background: BG } })
    .composite([{ input: await sharp(SRC).resize(art, art).toBuffer(), gravity: "center" }])
    .png()
    .toFile(out(`mipmap-${d}`, "ic_launcher_foreground.png"));
}

// Splash (Android 11 and older show this image; 12+ draw the launcher icon on a black screen).
const splash = async (w, h, file) => {
  const size = Math.round(Math.min(w, h) * 0.42);
  await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([{ input: await sharp(SRC).resize(size, size).toBuffer(), gravity: "center" }])
    .png()
    .toFile(file);
};
const PORT = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [d, [w, h]] of Object.entries(PORT)) {
  await splash(w, h, out(`drawable-port-${d}`, "splash.png"));
  await splash(h, w, out(`drawable-land-${d}`, "splash.png"));
}
await splash(480, 800, out("drawable", "splash.png"));
console.log("android icons and splash generated");
