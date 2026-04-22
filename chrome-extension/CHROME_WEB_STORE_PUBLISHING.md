# Chrome Web Store Publishing Checklist

This extension is now client-side only (no localhost backend required).

## 1. Prepare package

From project root:

```sh
zip -r exports/jtmetrics-github-extension.zip chrome-extension -x "*.DS_Store" -x "*/.DS_Store"
```

## 2. Validate locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. **Load unpacked** and select `chrome-extension/`.
4. Verify:
    - Extension icon appears in Chrome.
    - On GitHub repository pages, `JTMetrics` appears near `Settings` with the icon.
    - Metrics can be calculated and JSON can be downloaded.

## 3. Create Chrome Web Store listing

In [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole):

1. Click **Add new item**.
2. Upload `exports/jtmetrics-github-extension.zip`.
3. In the Privacy section, set a direct privacy policy URL (not a homepage), for example:
    - `https://<your-github-username>.github.io/<your-repository>/privacy-policy.html`
4. Fill listing fields:
    - Name
    - Short description
    - Detailed description
    - Screenshots
    - Category
5. Provide a support URL (or repository URL).

## 4. Privacy and permissions disclosure

Current requested permissions:

- `storage`
- Host permissions:
    - `https://github.com/*`
    - `https://api.github.com/*`

Data handling notes for listing:

- Optional GitHub token is stored in Chrome `storage.sync`.
- No external backend required.
- No user metrics data is sent to your servers by design.
- A direct policy page is available at `docs/privacy-policy.html` for GitHub Pages hosting.

## 5. Publish

1. Submit for review.
2. Address any reviewer feedback (usually around permissions or disclosure).
3. Publish after approval.
