// A WMO-only map made with New World (#272): Publish writes its building at the world's middle, so the editor's frame follows the building and Launch's spot over it is the server's 0,0, wherever the building stands in the editor; untick WMO-only and the frame is the corner's again. Nothing written.
// touches: frontend/src/lib/engine/Engine.ts, internal/vmangos/wmoonly.go, internal/vmangos/publish.go
const e = P.e
const doc = e.newVmangosDocument(1, 'flat', 0, { dir: 'ProbeWmoOnly', mapId: 1999, info: { wmoOnly: true } })
await P.frames(3)
const o = e.objects.add({ type: 'wmo:world\\wmo\\dungeon\\az_stormwindprisons\\stormwindjail.wmo', x: 266.5, z: 410, yOff: 0, rotY: 0, scale: 1 })
await P.frames(2)
const b = e.globalBuilding()
// Over the building: the camera and its orbit target straight above it, so either ground mode finds it below.
const over = async () => {
	const c = e.controller
	c.target.set(b.x, b.y, b.z)
	e.camera.position.set(b.x, b.y + 50, b.z)
	return e.playerSpot()
}
const spot = await over()
const atMiddle = Math.abs(spot.x) < 0.01 && Math.abs(spot.y) < 0.01 && spot.map === 1999
doc.meta.vmangos.info = { wmoOnly: false }
const corner = await over()
// The corner's frame: the server's X is ZeroPoint less the editor's z, its Y ZeroPoint less x.
const ZP = 32 * (533 + 1 / 3)
const atCorner = Math.abs(corner.x - (ZP - b.z)) < 0.01 && Math.abs(corner.y - (ZP - b.x)) < 0.01
e.objects.remove(o.id)
e.closeDocument(doc.id)
return {
	ok: !!b && atMiddle && atCorner,
	building: b && [b.x, b.z],
	spot: [+spot.x.toFixed(2), +spot.y.toFixed(2)],
	corner: [+corner.x.toFixed(2), +corner.y.toFixed(2)],
}
