# Still

A lightweight meditation timer that runs in any modern browser. No build step, no dependencies, no audio files: every bell and ambient sound is synthesized live with the Web Audio API. The whole app is under 100 KB, uncompressed.

## Features

- **Any length you want.** Drag the ring (one lap is 60 minutes, keep going for longer sits, up to 10 hours), use the mouse wheel or arrow keys, tap a preset, or tap the time to type exact hours, minutes and seconds.
- **Bells.** Singing bowl, temple bell, gong, chimes and tingsha for the start and end, with an optional three-strike ending.
- **Interval bells.** A softer bell every 1–20 minutes, shown as dots on the progress ring.
- **Ambience.** Rain, ocean, wind, brown noise or a warm drone, with its own volume. Tap an option in Settings to preview it.
- **Breathing guide.** The orb expands and contracts to Calm 4·6, Coherent 5.5, Box 4·4·4·4 or 4·7·8 breathing, with optional breath tones.
- **Settle-in countdown** before the first bell.
- **Immersive mode.** Controls fade away while you sit; tap anywhere to bring them back.
- **Pause and resume.** Scheduled bells are cancelled and rescheduled accurately.
- **Progress.** Current and longest streak, total mindful time, a 7-day chart, and recent sessions with an optional mood and note.
- **Themes.** Night, Dawn, Forest, or match your device.
- **Works offline** and can be installed to your home screen (PWA). The screen stays awake during a session where the browser supports it, and phones can vibrate with each bell.

## Run it

Opening `index.html` directly works. For offline/install support, serve the folder over HTTP:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host (GitHub Pages, Netlify, Vercel) works too.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Begin, pause or resume |
| ← → ↑ ↓ | Adjust the dial by 1 minute (when focused) |
| Page Up / Down | Adjust the dial by 5 minutes |
| Esc | Close a panel |

## How timing stays accurate

The timer tracks elapsed time from timestamps, not by counting ticks. Bells are scheduled up to 90 seconds ahead on the audio clock, so they ring on time even when the browser throttles timers in a background tab.

## Files

```
index.html            markup
css/style.css         styles and themes
js/audio.js           synthesized bells, ambience and interface sounds
js/app.js             dial, session engine, settings and stats
sw.js                 offline cache
manifest.webmanifest  install metadata
icons/icon.svg        app icon
```

History and settings are stored in `localStorage` on your device only.
