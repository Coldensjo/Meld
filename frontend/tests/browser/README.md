# Browser checks

These run the terrain renderer and paint rules in a real browser, since the shader needs WebGL.
They're not part of `bun run check`; run them after changing the terrain, paint or palette code.
Run commands from frontend/. These standalone pages do not share the Wails backend used by live-app
probes. Software-rendered shader checks and pure Bun rules do not establish desktop GPU performance
or in-game fidelity. Do not run the examples' disabled browser sandbox against untrusted content;
use a disposable browser process for these local test pages only.

```sh
bun --bun vite --port 5199 --strictPort     # serve the frontend (leave it running)
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

The pure rules have Bun tests too (no WebGL or live desktop session):

```sh
bun test tests/chunkPaint.test.ts tests/tileImport.test.ts
```
