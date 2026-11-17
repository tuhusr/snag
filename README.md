<img src="src/renderer/logo.svg" width="72" alt="Snag logo">

# Snag

Desktop video downloader for YouTube, TikTok, Instagram, X, Facebook, Reddit, Twitch and 1,800+ other sites. Electron UI on top of [yt-dlp](https://github.com/yt-dlp/yt-dlp) and FFmpeg.

## Run

Double-click **Snag** on the Desktop, or:

```
npm start
```

## Build and release

```
npm run dist      # build only: dist\Snag-Setup-<version>.exe + dist\Snag-<version>.zip
npm run release   # build + publish to GitHub Releases
```

To ship an update: raise `version` in `package.json` (0.1.0 → 0.1.1), then `npm run release`. Everyone with Snag installed sees "Snag 0.1.1 is available" the next time they open it, and updates with one click.

The installer is per-user, lets you pick the folder, and adds Desktop and Start Menu shortcuts. The installer is unsigned, so Windows SmartScreen shows "Windows protected your PC": click **More info**, then **Run anyway**.

## How it works

- `src/engine.js`: finds or installs yt-dlp (kept in `%APPDATA%\snag\bin`, auto-updated daily), probes links, runs downloads and parses live progress.
- `src/main.js`: window, download queue (3 at a time by default), settings and history.
- `src/renderer/`: the UI. Swiss minimal: monochrome with one cobalt accent, Inter, follows the Windows light/dark theme.

## Formats

| Choice | What you get |
|---|---|
| MP4 (Best quality) | Highest resolution, then fps, then bitrate. May be VP9/AV1/HEVC inside MP4. |
| MP4 H.264 | Best H.264 + AAC. Plays on any device and editor. |
| MP3 | Best audio converted to MP3 (VBR, top quality). |
| M4A | Best audio as AAC/M4A. |

Cover art, title, channel and chapters are embedded by default. Instagram, private, members-only and age-restricted videos need **Settings → Use browser sign-in**.

Downloads go to `Downloads\Snag` unless changed in Settings.
