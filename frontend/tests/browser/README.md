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

- `tile.html` converts a tile read from your client into paint and checks the rules on it. It
  needs a TileView as JSON at http://127.0.0.1:5210/tile.json (or `?url=`). Make that file yourself
  from `vmangos.ReadTile`, outside the repo: game data isn't committed. It should print `ALL_PASSED`.

The pure rules have Bun tests too:

```
bun test tests/chunkPaint.test.ts tests/tileImport.test.ts
```
