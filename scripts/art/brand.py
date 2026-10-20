"""Site icons, PWA icons and the Open Graph preview, generated from assets/icon-only.png.

  python scripts/art/brand.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC = Image.open(ROOT / "assets" / "icon-only.png").convert("RGBA")
FONTS = Path(__file__).parent / "fonts"


def font(name, size, weight):
    f = ImageFont.truetype(str(FONTS / f"{name}.ttf"), size)
    f.set_variation_by_axes([weight])
    return f


def rounded(img, radius):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out


app = ROOT / "app"
pub = ROOT / "public"
# Next.js file conventions: app/icon.png, app/apple-icon.png, app/favicon.ico
rounded(SRC.resize((512, 512), Image.LANCZOS), 110).save(app / "icon.png")
SRC.resize((180, 180), Image.LANCZOS).convert("RGB").save(app / "apple-icon.png")
rounded(SRC.resize((256, 256), Image.LANCZOS), 56).save(app / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
# PWA icons (any + maskable with safe padding on the icon's own black)
(pub / "icons").mkdir(parents=True, exist_ok=True)
for s in (192, 512):
    rounded(SRC.resize((s, s), Image.LANCZOS), int(s * 0.21)).save(pub / "icons" / f"icon-{s}.png")
    m = Image.new("RGBA", (s, s), (0, 0, 0, 255))
    inner = int(s * 0.8)
    m.paste(SRC.resize((inner, inner), Image.LANCZOS), ((s - inner) // 2, (s - inner) // 2))
    m.save(pub / "icons" / f"maskable-{s}.png")

# Open Graph preview 1200x630: dark tech background, icon, title, tagline
W, H = 1200, 630
og = Image.new("RGBA", (W, H), (5, 6, 10, 255))
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(glow)
d.ellipse((-200, -300, 700, 600), fill=(47, 123, 255, 120))
d.ellipse((700, 250, 1500, 1000), fill=(122, 31, 255, 70))
og.alpha_composite(glow.filter(ImageFilter.GaussianBlur(120)))
grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(grid)
for x in range(0, W, 60):
    gd.line([(x, 0), (x, H)], fill=(90, 140, 255, 18))
for y in range(0, H, 60):
    gd.line([(0, y), (W, y)], fill=(90, 140, 255, 18))
og.alpha_composite(grid)
ic = rounded(SRC.resize((360, 360), Image.LANCZOS), 80)
sh = Image.new("RGBA", (440, 440), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle((40, 40, 400, 400), 80, fill=(47, 123, 255, 170))
og.alpha_composite(sh.filter(ImageFilter.GaussianBlur(30)), (40, 95))
og.alpha_composite(ic, (80, 135))
d = ImageDraw.Draw(og)
d.text((500, 170), "BAYHAN", font=font("Unbounded", 92, 900), fill=(255, 255, 255))
d.text((500, 275), "GAME", font=font("Unbounded", 92, 900), fill=(90, 160, 255))
d.text((502, 405), "Экономическая онлайн-игра", font=font("Manrope", 38, 700), fill=(220, 228, 245))
d.text((502, 456), "Работай · инвестируй · рискуй · стань №1", font=font("Manrope", 30, 600), fill=(139, 147, 167))
og.convert("RGB").save(app / "opengraph-image.png", optimize=True)
og.convert("RGB").save(app / "twitter-image.png", optimize=True)
print("brand assets ready")
