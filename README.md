# Ultrahand Wallpaper

[![platform](https://img.shields.io/badge/platform-web-3b82f6)](https://ppkantorski.github.io/Ultrahand-Wallpaper/)
[![PWA](https://img.shields.io/badge/PWA-installable-22ff66)](https://ppkantorski.github.io/Ultrahand-Wallpaper/)
[![GPLv2 License](https://img.shields.io/badge/license-GPLv2-189c11.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![GitHub issues](https://img.shields.io/github/issues/ppkantorski/Ultrahand-Wallpaper?color=222222)](https://github.com/ppkantorski/Ultrahand-Wallpaper/issues)
[![GitHub stars](https://img.shields.io/github/stars/ppkantorski/Ultrahand-Wallpaper)](https://github.com/ppkantorski/Ultrahand-Wallpaper/stargazers)

A browser-based wallpaper designer for [Ultrahand Overlay](https://github.com/ppkantorski/Ultrahand-Overlay). Crop, adjust, and export ready-to-drop wallpapers at the exact 448×720 dimensions Ultrahand expects — still images as `.rgba` / `.png`, videos as animated `.uaw` wallpapers — no installation, no signup, no server. Everything runs locally in your browser.

**[→ Open the designer](https://ppkantorski.github.io/Ultrahand-Wallpaper/)**

---

## Features

- **Drop, paste, or browse** any image (PNG, JPG, WEBP), video (MP4, MOV, WEBM — whatever your browser plays), animated GIF, or an existing `.uaw` — files never leave your device
- **Animated wallpapers** — position, zoom, rotate and adjust a video exactly like an image, preview it playing or paused, pick the part to loop, the frame rate and the quality, and export a `.uaw`
- **Frame & position** — fit, pan, zoom, and resize via handles, scroll wheel, or pinch gestures
- **Light adjustments** — exposure, brightness, highlights, shadows, contrast, black point
- **Color adjustments** — saturation, vibrance, warmth, tint
- **Detail adjustments** — sharpness, definition, vignette
- **Background control** — real transparent alpha or any solid color
- **Overlay preview** — toggle the on-device frame so you can see how the wallpaper looks behind Ultrahand
- **RGBA8888 / RGBA4444 preview** — the canvas shows full colour by default (what Ultrahand displays on 8 MB heaps and up); one click previews RGBA4444, the banding you get on smaller heaps. Exports are always 8-bit
- **Export `.rgba`, `.png` or `.uaw`** — raw RGBA8888 or PNG for stills (for a video: the frame shown), `.uaw` for animated wallpapers; all go in `/config/ultrahand/wallpapers/`
- **Undo/redo** — full history navigation (`⌘Z` / `⌘⇧Z`)
- **Installable PWA** — works fully offline after the first visit

---

## Usage

1. Open the [designer](https://ppkantorski.github.io/Ultrahand-Wallpaper/).
2. Drop, paste, or browse to load an image or a video.
3. Use **Frame & Position** to crop and position inside the 448×720 frame.
4. Tweak **Light / Color / Detail** sliders to taste.
5. Click **RGBA** to download a ready-to-use `.rgba` file — or, for a video, set the **Animation** options (loop range, frame rate, quality) and click **UAW**.
6. Copy the file to `/config/ultrahand/wallpapers/` on your Switch SD card.
7. In Ultrahand, open **Settings → Wallpaper** and select your new wallpaper.

> **Note:** Wallpapers require a 6 MB+ overlay heap to display. See the [Ultrahand wiki](https://github.com/ppkantorski/Ultrahand-Overlay/wiki) for heap configuration.

---

## Output Format

| Field | Value |
|---|---|
| Encoding | RGBA8888 (4 bytes per pixel, no header) |
| Dimensions | 448 × 720 px (portrait) |
| File size | 1,290,240 bytes (~1.23 MB), always |
| Location | `/config/ultrahand/wallpapers/<name>.rgba` |

The `.rgba` format is raw pixel data with no compression or metadata — exactly what `libultrahand` reads at runtime, which is why it's a fixed size.

---

## Install as a PWA

For offline access and a dedicated app icon:

- **Desktop (Chrome / Edge):** click the install icon in the address bar
- **iOS (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** menu → *Install app*

Once installed, the designer launches in its own window and works fully offline.

---

## Building from Source

Requires Node.js 20+ and [pnpm](https://pnpm.io/).

```sh
git clone https://github.com/ppkantorski/Ultrahand-Wallpaper
cd Ultrahand-Wallpaper
pnpm install
pnpm run dev
```

The dev server runs at `http://localhost:5174`. For a production build:

```sh
pnpm run build      # outputs to dist/public/
pnpm run serve      # preview the built output locally
```

**Stack:** Vite · React 19 · TypeScript · Tailwind CSS 4 · Radix UI · vite-plugin-pwa.

---

## Contributing

Contributions are welcome. Please open an [issue](https://github.com/ppkantorski/Ultrahand-Wallpaper/issues/new) or submit a [pull request](https://github.com/ppkantorski/Ultrahand-Wallpaper/compare).

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/X8X3VR194) [![sponsor](https://github.com/ppkantorski/ppkantorski/raw/refs/heads/main/.pics/sponsor-icon.png)](https://github.com/sponsors/ppkantorski)

---

## Related

- [Ultrahand Overlay](https://github.com/ppkantorski/Ultrahand-Overlay) — the overlay menu these wallpapers are designed for
- [libultrahand](https://github.com/ppkantorski/libultrahand) — the underlying rendering library
- [Ultrahand Packages](https://github.com/ppkantorski/Ultrahand-Packages) — community packages and themes

---

## License

Licensed under [GPLv2](LICENSE).

Copyright © 2026 ppkantorski

---

## Animated wallpapers (.uaw)

Load a video, an animated GIF or an existing `.uaw` (all handled exactly like a video) and an **Animation** section appears in the side panel, with a play / pause
button and scrub bar under the preview (Space also plays / pauses).

- **Loop range** — the part of the video the wallpaper repeats. Drag the two ends, or scrub
  to a frame and use **Start here** / **End here**.
- **Frame rate** — the video's own rate (up to 30) or lower. Lower rates make smaller files.
- **Quality** — how much error a 4×4 block may keep before it is sent again. *Balanced*
  (10) matches `make_uaw.py`'s default.

**UAW** renders every frame through the same position, zoom, rotation and Light / Color /
Detail settings as the preview, and encodes it in the browser (in a worker). Empty areas
are black: `.uaw` pixels are opaque. The format is the one written by the overlay
project's `extra/make_uaw.py`; `src/lib/uaw.ts` is a port of it and documents the layout.

Checking the encoder outside the browser (raw 448×720 RGB24 frames in, `.uaw` out):

```
ffmpeg -i clip.mp4 -vf crop=448:720 -f rawvideo -pix_fmt rgb24 frames.rgb
node test/uaw-test.ts frames.rgb out.uaw
```

