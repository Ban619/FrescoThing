# Development guide

## Local setup

From the project root:

```bash
cd client
npm install --no-audit --no-fund
npm run dev -- --host 0.0.0.0 --port 4173
```

## Available scripts

In `client/package.json`:

- `npm run dev` — start the Vite dev server
- `npm run build` — production build
- `npm run preview` — preview the production bundle

At the project root:

- `npm --prefix client run dev` — run the front-end from the root context

## Typical workflow

1. Start the dev server.
2. Open the browser at `http://localhost:4173/`.
3. Drop in a sample image.
4. Adjust style and quality settings.
5. Run OCR when needed.
6. Export the final painting.

## Notes

- The painting engine is local-only and runs in the browser.
- OCR requires the Tesseract worker to download language data once on first use.
- The app prefers no upload pipeline; all work stays on-device.
