# Ultrahand Wallpaper

[![platform](https://img.shields.io/badge/platform-web-3b82f6)](https://ppkantorski.github.io/Ultrahand-Wallpaper/)
[![PWA](https://img.shields.io/badge/PWA-installable-22ff66)](https://ppkantorski.github.io/Ultrahand-Wallpaper/)
[![GPLv2 License](https://img.shields.io/badge/license-GPLv2-189c11.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![GitHub issues](https://img.shields.io/github/issues/ppkantorski/Ultrahand-Wallpaper?color=222222)](https://github.com/ppkantorski/Ultrahand-Wallpaper/issues)
[![GitHub stars](https://img.shields.io/github/stars/ppkantorski/Ultrahand-Wallpaper)](https://github.com/ppkantorski/Ultrahand-Wallpaper/stargazers)

A wallpaper designer for [Ultrahand Overlay](https://github.com/ppkantorski/Ultrahand-Overlay) that runs in your browser. Load a picture or a video, frame it inside Ultrahand's 448×720 wallpaper area, adjust it, and export a file you can copy straight to your SD card: `.rgba` or `.png` for stills, `.uaw` for animated wallpapers. Nothing is uploaded; your files stay on your device.

**[→ Open the designer](https://ppkantorski.github.io/Ultrahand-Wallpaper/)**

---

## Features

- **Drop, paste, or browse**: images (PNG, JPG, WEBP, RGBA), videos (MP4, MOV, MKV, WEBM), animated GIFs, and existing `.uaw` files
- **Animated wallpapers**: a video is framed and adjusted the same way as an image. Play or pause the preview, choose the part to loop, the frame rate and the quality, then export a `.uaw`
- **Frame & position**: fit, pan, zoom, rotate, and resize with the handles, the scroll wheel, or a pinch
- **Light adjustments**: exposure, brightness, highlights, shadows, contrast, black point
- **Color adjustments**: saturation, vibrance, warmth, tint
- **Detail adjustments**: sharpness, definition, vignette
- **Background control**: transparent, or any solid color
- **Overlay preview**: show the Ultrahand menu over your wallpaper to see how it will look on the console
- **RGBA8888 / RGBA4444 preview**: the preview is full color by default. One click shows it as RGBA4444, which is how wallpapers look on overlay heaps below 8 MB. Exports are always 8-bit
- **Export `.rgba`, `.png`, or `.uaw`**: for a video, `.rgba` and `.png` save the frame on screen
- **Undo/redo**: `⌘Z` / `⌘⇧Z`
- **Installable PWA**: works offline after the first visit

---

## Usage

1. Open the [designer](https://ppkantorski.github.io/Ultrahand-Wallpaper/).
2. Drop, paste, or browse to load an image or a video.
3. Use **Frame & Position** to place it inside the 448×720 frame.
4. Adjust the **Light / Color / Detail** sliders if you want to.
5. Click **RGBA** to download a `.rgba` file. For a video, set the **Animation** options and click **UAW** instead.
6. Copy the file to `/config/ultrahand/wallpapers/` on your Switch SD card.
7. In Ultrahand, open **Settings → Wallpaper** and select it.

> **Note:** Wallpapers require a 6 MB+ overlay heap to display. See the [Ultrahand wiki](https://github.com/ppkantorski/Ultrahand-Overlay/wiki) for heap configuration.

---

## Animated Wallpapers

Loading a video, an animated GIF, or a `.uaw` adds a play button and scrub bar under the preview (Space also plays and pauses) and an **Animation** section to the side panel:

- **Loop range**: the part of the video the wallpaper repeats. Drag either end, or scrub to a frame and press **Start here** / **End here**. Cut still intros and fades, or the loop will appear to pause.
- **Frame rate**: the video's own rate (up to 30 fps) or lower. Lower rates make smaller files.
- **Quality**: higher quality re-sends more of each frame, which means a larger file and more SD card reading while it plays. *Balanced* is a good default.

**UAW** then renders every frame with your position, zoom, rotation, and slider settings and encodes the file in the browser. This takes a while for long clips, and the tab has to stay visible while it runs. Empty areas come out black, because `.uaw` has no transparency.

Which videos load depends on your browser. MP4, MOV, and WEBM work almost everywhere. MKV works in Chrome and Edge when the video inside is H.264, VP9, or AV1. If a file won't open, convert it to MP4 first.

Opening an existing `.uaw` lets you trim or adjust it and export it again. That re-encodes it, so expect a very small loss each time.

---

## Output Format

| Field | Value |
|---|---|
| Encoding | RGBA8888 (4 bytes per pixel, no header) |
| Dimensions | 448 × 720 px (portrait) |
| File size | 1,290,240 bytes (~1.23 MB), always |
| Location | `/config/ultrahand/wallpapers/<name>.rgba` |

A `.rgba` file is raw pixel data with no compression or metadata, which is why its size never changes. It is what `libultrahand` reads at runtime.

A `.uaw` file is a 448×720 animation made of 4×4 pixel blocks, where each frame stores only the blocks that changed. Its size depends on the clip. It goes in the same folder. The layout is documented at the top of [`src/lib/uaw.ts`](src/lib/uaw.ts), and Ultrahand Overlay's `extra/make_uaw.py` writes the same format from the command line.

---

## Install as a PWA

For offline access and a dedicated app icon:

- **Desktop (Chrome / Edge):** click the install icon in the address bar
- **iOS (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** menu → *Install app*

Once installed, the designer opens in its own window and works offline.

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

The encoder and the two decoders can be checked from the command line with Node 22+:

```sh
# raw 448×720 RGB24 frames in, .uaw out
ffmpeg -i clip.mp4 -vf crop=448:720 -f rawvideo -pix_fmt rgb24 frames.rgb
node test/uaw-test.ts frames.rgb out.uaw

node test/uaw-decode-test.ts out.uaw frames.rgb24   # .uaw → raw RGB24 frames
node test/gif-test.ts clip.gif frames.rgba          # GIF → raw RGBA frames
```

**Stack:** Vite · React 19 · TypeScript · Tailwind CSS 4 · Radix UI · vite-plugin-pwa.

---

## Contributing

Contributions are welcome. Please open an [issue](https://github.com/ppkantorski/Ultrahand-Wallpaper/issues/new) or submit a [pull request](https://github.com/ppkantorski/Ultrahand-Wallpaper/compare).

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/X8X3VR194) [![sponsor](https://github.com/ppkantorski/ppkantorski/raw/refs/heads/main/.pics/sponsor-icon.png)](https://github.com/sponsors/ppkantorski)

---

## Related

- [Ultrahand Overlay](https://github.com/ppkantorski/Ultrahand-Overlay): the overlay menu these wallpapers are made for
- [libultrahand](https://github.com/ppkantorski/libultrahand): the underlying rendering library
- [Ultrahand Packages](https://github.com/ppkantorski/Ultrahand-Packages): community packages and themes

---

## License

Licensed under [GPLv2](LICENSE).

Copyright © 2026 ppkantorski
