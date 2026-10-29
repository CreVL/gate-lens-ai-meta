# Scene and local OCR

Three.js supplies a walkable synthetic checkpoint and current-view image evidence. The standalone page uses an HTML inspection display. `/glasses` composes the same scene around the installed official Meta preview.

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm run prepare-assets
pnpm test
pnpm run test:vision
```

Pixel/browser tests require a Playwright Chromium installation. Start the Go service before `test:browser` / `test:meta`; set `GATELENS_TEST_URL` and, for Meta, `META_EXTENSION_PATH`. Tests reset the target demo session. See [verification](../../docs/verification.md).

`scripts/seal-vision.mjs` receives PNG pixels only. It reads a known yellow SEAL label using Tesseract.js and the pinned local English model. It never reads the fixture catalogue. [Recognition boundaries](../../docs/recognition.md).

Movement: WASD + mouse; Shift faster; Esc releases the mouse; G moves to the label; R returns to front; keys 1–6 select jobs. Assignment loading is a synthetic proximity/view trigger, not plate OCR. The standalone scene contains no real camera feed or access-control hardware.
