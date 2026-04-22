# VTJMetrics Chrome Extension (GitHub)

This extension adds a `VTJMetrics` tab in the GitHub repository navigation bar.

From that tab, users can:

1. Enter a source path inside the repository (for example: `src`).
2. Click `Calculate metrics`.
3. Run available JTMetrics metrics directly in the extension.
4. Download the result as JSON.
5. Visualize coupling metrics (`file-coupling`, `class-coupling`, `function-coupling`) with interactive precedence.

## Coupling visualization

- Select one or more coupling metrics.
- Reorder precedence on-the-fly (`Up` / `Down` / `Remove`).
- Set a per-metric `Min lines` threshold to filter noisy elements.
- Drag and drop circles to manually rearrange the view.
- Single click any circle for contextual actions:
  - Remove element from graph.
  - Go to source line on GitHub.
  - Show snapshot statistics.
- Choose coupling display mode:
  - Show all selected coupling levels (recommended).
  - Show only last precedence coupling.
- Fan-Out (red) and Fan-In (blue) are rendered with distinct line colors, explicit legend, and directional pins.

## Load in Chrome

1. Go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `chrome-extension`.

## Configure

1. Open extension options.
2. Optionally set a GitHub token (recommended for private repos / rate limits).
