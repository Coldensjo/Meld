# Browser checks

These run the terrain renderer and paint rules in a real browser, since the shader needs WebGL.
They're not part of `pnpm check`; run them after changing the terrain, paint or palette code.

```
pnpm exec vite --port 5199 --strictPort     # serve the frontend (leave it running)
chrome --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
  --dump-dom http://localhost:5199/tests/browser/terrain.html
chrome --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
  --dump-dom http://localhost:5199/tests/browser/paint.html
```

- `terrain.html` compiles the terrain shader and renders it. It should print `PROGRAMS 1`, no
  `CONSOLE_ERROR` lines, and `LIT_PIXELS` close to the whole canvas. Adding `?break=1` breaks the
  fragment shader on purpose, which must print a shader error.
- `paint.html` checks the four-texture rule, undo and redo, copy and paste across palettes, and
  auto-paint on a 512-cell map. It should end with `ALL_PASSED`.

The pure rules have Node tests too: `node --test tests/chunkPaint.test.ts`.
