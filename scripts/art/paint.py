"""Small painting toolkit for the game's illustrations (Pillow + numpy).

Everything is drawn at 2x and downscaled with Lanczos for clean anti-aliased edges.
"""
import math
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SS = 2  # supersampling factor


def hex2rgb(h):
    if not isinstance(h, str):
        return tuple(int(v) for v in h[:3])
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    c1, c2 = (hex2rgb(c) if isinstance(c, str) else c for c in (c1, c2))
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(3))


def soft_blur(img, radius):
    """Gaussian blur in premultiplied-alpha space: no dark fringes around soft shapes."""
    a = np.asarray(img.split()[-1]).astype(np.float32) / 255
    rgb = np.asarray(img.convert("RGB")).astype(np.float32) * a[..., None]
    f = ImageFilter.GaussianBlur(radius)
    rgb_b = np.stack([np.asarray(Image.fromarray(np.clip(rgb[..., i], 0, 255).astype(np.uint8)).filter(f)).astype(np.float32) for i in range(3)], -1)
    a_b = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(f)).astype(np.float32)
    out = np.where(a_b[..., None] > 0, rgb_b * 255 / np.maximum(a_b[..., None], 1), 0)
    res = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    res.putalpha(Image.fromarray(a_b.astype(np.uint8)))
    return res


def smooth(pts, rounds=3, closed=True):
    """Chaikin corner cutting: turns a rough polygon into an organic outline."""
    for _ in range(rounds):
        out = []
        n = len(pts)
        rng = range(n) if closed else range(n - 1)
        for i in rng:
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
            out += [(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1), (0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)]
        pts = out if closed else [pts[0]] + out + [pts[-1]]
    return pts


class Canvas:
    def __init__(self, w=1200, h=750, seed=1):
        self.W, self.H = w * SS, h * SS
        self.out = (w, h)
        self.img = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 255))
        self.rng = random.Random(seed)

    # -- coordinates are given in output pixels and scaled here
    def s(self, v):
        return v * SS

    def pts(self, pts):
        return [(x * SS, y * SS) for x, y in pts]

    def layer(self):
        return Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))

    def put(self, layer, blur=0, opacity=1.0):
        if blur:
            layer = soft_blur(layer, blur * SS)
        if opacity < 1:
            a = layer.split()[-1].point(lambda v: int(v * opacity))
            layer.putalpha(a)
        self.img.alpha_composite(layer)

    # ------------------------------------------------------------ fills
    def vgrad(self, stops, box=None, mask=None):
        """Vertical gradient with stops [(t, color), ...] inside box (x0,y0,x1,y1)."""
        x0, y0, x1, y1 = [int(v * SS) for v in (box or (0, 0, self.out[0], self.out[1]))]
        h = max(1, y1 - y0)
        t = np.linspace(0, 1, h)[:, None]
        cols = np.zeros((h, 3))
        ss = [(a, np.array(hex2rgb(c) if isinstance(c, str) else c, float)) for a, c in stops]
        for i in range(len(ss) - 1):
            (ta, ca), (tb, cb) = ss[i], ss[i + 1]
            m = (t[:, 0] >= ta) & (t[:, 0] <= tb)
            k = ((t[m] - ta) / max(tb - ta, 1e-6))
            cols[m] = ca + (cb - ca) * k
        cols[t[:, 0] < ss[0][0]] = ss[0][1]
        cols[t[:, 0] > ss[-1][0]] = ss[-1][1]
        arr = np.repeat(cols[:, None, :], x1 - x0, axis=1).astype(np.uint8)
        g = Image.fromarray(arr, "RGB").convert("RGBA")
        lay = self.layer()
        if mask is None:
            lay.paste(g, (x0, y0))
        else:
            m2 = Image.new("L", (self.W, self.H), 0)
            m2.paste(mask.crop((x0, y0, x1, y1)), (x0, y0))
            full = self.layer()
            full.paste(g, (x0, y0))
            lay = Image.composite(full, lay, m2)
        self.img.alpha_composite(lay)

    def glow(self, cx, cy, r, color, strength=1.0, power=2.2):
        y, x = np.mgrid[0 : self.H, 0 : self.W]
        d = np.sqrt((x - cx * SS) ** 2 + (y - cy * SS) ** 2) / (r * SS)
        a = np.clip(1 - d, 0, 1) ** power * 255 * strength
        lay = Image.new("RGBA", (self.W, self.H), (*hex2rgb(color), 0))
        lay.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
        self.img.alpha_composite(lay)

    def poly(self, pts, fill, blur=0, opacity=1.0, outline=None, width=1):
        lay = self.layer()
        d = ImageDraw.Draw(lay)
        f = (hex2rgb(fill) + (255,)) if isinstance(fill, str) else fill
        d.polygon(self.pts(pts), fill=f, outline=(hex2rgb(outline) + (255,)) if outline else None, width=int(width * SS))
        self.put(lay, blur, opacity)

    def poly_grad(self, pts, stops, box=None):
        m = Image.new("L", (self.W, self.H), 0)
        ImageDraw.Draw(m).polygon(self.pts(pts), fill=255)
        xs, ys = zip(*pts)
        self.vgrad(stops, box or (min(xs), min(ys), max(xs) + 1, max(ys) + 1), mask=m)

    def rect(self, box, fill, radius=0, blur=0, opacity=1.0):
        lay = self.layer()
        d = ImageDraw.Draw(lay)
        f = (hex2rgb(fill) + (255,)) if isinstance(fill, str) else fill
        b = [v * SS for v in box]
        if radius:
            d.rounded_rectangle(b, radius * SS, fill=f)
        else:
            d.rectangle(b, fill=f)
        self.put(lay, blur, opacity)

    def rect_grad(self, box, stops, radius=0):
        m = Image.new("L", (self.W, self.H), 0)
        b = [v * SS for v in box]
        ImageDraw.Draw(m).rounded_rectangle(b, radius * SS, fill=255) if radius else ImageDraw.Draw(m).rectangle(b, fill=255)
        self.vgrad(stops, box, mask=m)

    def ellipse(self, box, fill, blur=0, opacity=1.0):
        lay = self.layer()
        f = (hex2rgb(fill) + (255,)) if isinstance(fill, str) else fill
        ImageDraw.Draw(lay).ellipse([v * SS for v in box], fill=f)
        self.put(lay, blur, opacity)

    def line(self, pts, color, width=1, blur=0, opacity=1.0):
        lay = self.layer()
        c = (hex2rgb(color) + (255,)) if isinstance(color, str) else color
        ImageDraw.Draw(lay).line(self.pts(pts), fill=c, width=max(1, int(width * SS)), joint="curve")
        self.put(lay, blur, opacity)

    # ------------------------------------------------------------ nature
    def stars(self, n, y_max, seed=3):
        r = random.Random(seed)
        lay = self.layer()
        d = ImageDraw.Draw(lay)
        for _ in range(n):
            x, y = r.uniform(0, self.out[0]), r.uniform(0, y_max) ** 1.15 / y_max ** 0.15
            s = r.choice([0.6, 0.8, 1.0, 1.4])
            a = r.randint(120, 255)
            d.ellipse([(x - s) * SS, (y - s) * SS, (x + s) * SS, (y + s) * SS], fill=(255, 255, 255, a))
        self.put(lay)

    def clouds(self, items, color="#ffffff", opacity=0.85, blur=6, shade="#b9cbe0"):
        """items: (cx, cy, width, height) — fluffy clouds: shaded base + bright puffy top."""
        for layer_i, (col, dy, sc) in enumerate([(shade, 0.12, 1.0), (color, -0.08, 0.86)]):
            lay = self.layer()
            d = ImageDraw.Draw(lay)
            c = hex2rgb(col) + (255,)
            for cx, cy, w, h in items:
                r = random.Random(int(cx * 7 + cy))
                for _ in range(int(w / 16) + 5):
                    ex = cx + r.uniform(-w / 2, w / 2) * sc
                    ey = cy + r.uniform(-h / 3, h / 5) + dy * h
                    rr = r.uniform(h * 0.32, h * 0.7) * sc
                    d.ellipse([(ex - rr * 1.3) * SS, (ey - rr) * SS, (ex + rr * 1.3) * SS, (ey + rr * 0.7) * SS], fill=c)
                d.rectangle([(cx - w / 2 * sc) * SS, (cy + dy * h) * SS, (cx + w / 2 * sc) * SS, (cy + h * 0.25 + dy * h) * SS], fill=c)
            self.put(lay, blur, opacity)

    def birds(self, items, color="#1b2a3a"):
        for x, y, s in items:
            self.line([(x - 9 * s, y - 3 * s), (x - 4 * s, y - 5 * s), (x, y), (x + 4 * s, y - 5 * s), (x + 9 * s, y - 3 * s)], color, 1.6 * s, opacity=0.8)

    def hills(self, y, amp, color, seed=1, step=40, opacity=1.0, blur=0, rough=0.5):
        r = random.Random(seed)
        pts = [(0, self.out[1])]
        x, phase = -step, r.uniform(0, 6)
        while x <= self.out[0] + step:
            yy = y - amp * (0.5 + 0.5 * math.sin(x / 210 + phase)) - amp * rough * r.uniform(0, 0.6)
            pts.append((x, yy))
            x += step
        pts.append((self.out[0], self.out[1]))
        self.poly(pts, color, blur=blur, opacity=opacity)

    def palm(self, x, y, h, lean=0.25, color="#0d3b2e", trunk="#6b4a2b", fronds=7, scale=1.0, seed=1):
        """Palm tree rooted at (x, y), height h."""
        r = random.Random(seed)
        top = (x + lean * h, y - h)
        lay = self.layer()
        d = ImageDraw.Draw(lay)
        segs = 14
        for i in range(segs):
            t0, t1 = i / segs, (i + 1) / segs
            bend = lambda t: (x + lean * h * (t ** 1.6), y - h * t)
            (ax, ay), (bx, by) = bend(t0), bend(t1)
            w = (9 - 5 * t0) * scale
            d.line([(ax * SS, ay * SS), (bx * SS, by * SS)], fill=hex2rgb(trunk) + (255,), width=int(w * SS))
            # trunk rings
            d.line([((ax - w / 2) * SS, ay * SS), ((ax + w / 2) * SS, ay * SS)], fill=hex2rgb(mix(trunk, "#000000", 0.35)) + (255,), width=max(1, int(1.2 * SS)))
        tx, ty = top
        for k in range(fronds):
            ang = -math.pi / 2 + (k - (fronds - 1) / 2) * (math.pi * 1.25 / fronds) + r.uniform(-0.12, 0.12)
            L = h * r.uniform(0.42, 0.55) * scale
            pts_up, pts_dn = [], []
            for i in range(13):
                t = i / 12
                droop = (t ** 2) * L * 0.55
                px = tx + math.cos(ang) * L * t
                py = ty + math.sin(ang) * L * t * 0.55 + droop
                wdt = math.sin(math.pi * t) * L * 0.13
                nx, ny = -math.sin(ang), math.cos(ang)
                pts_up.append((px + nx * wdt, py + ny * wdt * 0.5 - wdt * 0.6))
                pts_dn.append((px - nx * wdt, py - ny * wdt * 0.5 + wdt * 0.6))
            leaf = pts_up + pts_dn[::-1]
            shade = mix(color, "#000000", r.uniform(0, 0.3)) if k % 2 else mix(color, "#3aa86b", 0.25)
            d.polygon([(px * SS, py * SS) for px, py in leaf], fill=hex2rgb(shade) if isinstance(shade, str) else shade + (255,))
        d.ellipse([(tx - 6 * scale) * SS, (ty - 3) * SS, (tx + 6 * scale) * SS, (ty + 7 * scale) * SS], fill=(70, 45, 20, 255))
        self.put(lay)

    def bush(self, cx, cy, w, h, color="#1f5a3a", seed=1, highlight="#3f8f5c"):
        r = random.Random(seed)
        for k, col in ((0, color), (1, highlight)):
            lay = self.layer()
            d = ImageDraw.Draw(lay)
            for _ in range(int(w / 8) + 3):
                ex, ey = cx + r.uniform(-w / 2, w / 2), cy + r.uniform(-h / 2, 0) - k * h * 0.15
                rr = r.uniform(h * 0.25, h * 0.5) * (0.7 if k else 1)
                d.ellipse([(ex - rr) * SS, (ey - rr) * SS, (ex + rr) * SS, (ey + rr) * SS], fill=hex2rgb(col) + (255,))
            self.put(lay, opacity=1.0 if k == 0 else 0.55)

    def windows(self, box, cols, rows, lit=0.5, warm="#ffd27a", dark="#1b2236", pad=0.25, seed=1, glow=True, radius=0):
        r = random.Random(seed)
        x0, y0, x1, y1 = box
        cw, rh = (x1 - x0) / cols, (y1 - y0) / rows
        lay = self.layer()
        d = ImageDraw.Draw(lay)
        lights = []
        for i in range(cols):
            for j in range(rows):
                wx0 = x0 + i * cw + cw * pad / 2
                wy0 = y0 + j * rh + rh * pad / 2
                wx1, wy1 = wx0 + cw * (1 - pad), wy0 + rh * (1 - pad)
                on = r.random() < lit
                col = mix(warm, "#ffffff", r.uniform(0, 0.3)) if on else dark
                if radius:
                    d.rounded_rectangle([wx0 * SS, wy0 * SS, wx1 * SS, wy1 * SS], radius * SS, fill=hex2rgb(col) + (255,) if isinstance(col, str) else col + (255,))
                else:
                    d.rectangle([wx0 * SS, wy0 * SS, wx1 * SS, wy1 * SS], fill=hex2rgb(col) + (255,) if isinstance(col, str) else col + (255,))
                if on:
                    lights.append(((wx0 + wx1) / 2, (wy0 + wy1) / 2, max(cw, rh)))
        self.put(lay)
        if glow and lights:
            g = self.layer()
            gd = ImageDraw.Draw(g)
            for lx, ly, s in lights:
                s = min(s * 0.75, 22)  # tight halo: big windows must not turn into blurry blobs
                gd.ellipse([(lx - s) * SS, (ly - s) * SS, (lx + s) * SS, (ly + s) * SS], fill=hex2rgb(warm) + (42,))
            self.put(g, blur=4)

    def water(self, y, stops, shimmer="#ffffff", seed=5, density=60, highlight_x=None):
        """Sea from y to the bottom, with sparkling horizontal streaks."""
        self.vgrad(stops, (0, y, self.out[0], self.out[1]))
        r = random.Random(seed)
        lay = self.layer()
        d = ImageDraw.Draw(lay)
        for _ in range(density):
            yy = r.uniform(y + 2, self.out[1])
            k = (yy - y) / (self.out[1] - y)
            cx = highlight_x if highlight_x is not None and r.random() < 0.6 else r.uniform(0, self.out[0])
            cx += r.uniform(-60, 60) * (1 + k * 3)
            w = r.uniform(8, 40) * (0.4 + k * 1.6)
            d.line([((cx - w) * SS, yy * SS), ((cx + w) * SS, yy * SS)], fill=hex2rgb(shimmer) + (int(r.uniform(40, 150)),), width=max(1, int((0.8 + k * 1.5) * SS)))
        self.put(lay, blur=0.6)

    def reflect(self, y0, y1, horizon, opacity=0.35, blur=4):
        """Mirror the band [y0, horizon] below the horizon (water reflection)."""
        band = self.img.crop((0, int(y0 * SS), self.W, int(horizon * SS))).transpose(Image.FLIP_TOP_BOTTOM)
        band = band.filter(ImageFilter.GaussianBlur(blur * SS))
        h = min(band.height, int((y1 - horizon) * SS))
        band = band.crop((0, 0, self.W, h))
        fade = np.linspace(opacity, 0, h)[:, None] * 255
        a = Image.fromarray(np.repeat(fade, self.W, axis=1).astype(np.uint8))
        band.putalpha(ImageChops.multiply(band.split()[-1], a))
        self.img.alpha_composite(band, (0, int(horizon * SS)))

    def vignette(self, strength=0.45):
        y, x = np.mgrid[0 : self.H, 0 : self.W]
        d = np.sqrt(((x - self.W / 2) / (self.W * 0.7)) ** 2 + ((y - self.H / 2) / (self.H * 0.75)) ** 2)
        a = (np.clip(d - 0.45, 0, 1) * 255 * strength * 2).clip(0, 255).astype(np.uint8)
        v = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        v.putalpha(Image.fromarray(a))
        self.img.alpha_composite(v)

    def grain(self, amount=5):
        n = np.random.default_rng(7).normal(0, amount, (self.H, self.W, 1))
        arr = np.asarray(self.img.convert("RGB")).astype(float) + n
        self.img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert("RGBA")

    def save(self, path, quality=84):
        out = self.img.convert("RGB").resize(self.out, Image.LANCZOS)
        out.save(path, "WEBP", quality=quality, method=6)
        return out
