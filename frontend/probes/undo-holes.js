// Cutting holes in a selected area cuts whole 2x2 blocks, and one undo fills them again.
// touches: frontend/src/lib/terrain/holes.ts, frontend/src/lib/state/history.ts
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
// Cells 9..13 on both axes: snapped out to the 2x2 blocks 8..13, so 6x6 = 36 cells.
editor.selection = { x0: 9, z0: 9, x1: 14, z1: 14 }
e.setHoleInSelection(true)
await P.frames(1)
const count = () => e.terrain.holes.reduce((n, v) => n + (v ? 1 : 0), 0)
const cut = count()
const size = e.terrain.size
const blocksWhole = e.terrain.holes[8 * size + 8] !== 0 && e.terrain.holes[13 * size + 13] !== 0
e.history.undo()
await P.frames(1)
const afterUndo = count()
return { ok: cut === 36 && blocksWhole && afterUndo === 0, cutCells: cut, blocksWhole, afterUndo }
