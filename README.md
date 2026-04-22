# VTJMetrics

VTJMetrics adds interactive coupling visualization on top of JTMetrics.

## Project layout

- `chrome-extension/`: Chrome extension for GitHub repositories.
- `web-app/`: Standalone web application (GitHub URL or ZIP source input).
- `docs/`: Documentation website.
- `exports/`: Packaged extension ZIP builds.

## Shared metric runtime

Both extension and web app share the same analysis engine and metrics:

- `chrome-extension/browser-engine.js`
- `chrome-extension/metric-src/*.metric.js`

## Quick start

### Web app

```bash
npx serve .
# open http://localhost:3000/web-app/index.html
```

### Extension (developer mode)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** and select `chrome-extension/`

## Documentation

Open `docs/index.html` (or publish `docs/` with GitHub Pages).
