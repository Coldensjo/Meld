// A world view's map ID (#754): a world tab answers openMapId with its own map's Map.dbc ID, by its folder as a region's is, so Kalimdor's world view takes 1 (not Azeroth's 0) and Client Lighting reads Kalimdor's Light.dbc lights; Azeroth's stays 0. The other world-view probes all open Azeroth's, where 0 was right by luck.
// touches: frontend/src/lib/engine/Engine.ts
const { editor, prefs } = await P.state()
const e = P.e
const { openWorldView } = await P.app('/src/lib/io/region.ts')
const was = prefs.clientLighting
const r = {}
const open = async (name, at) => {
	openWorldView(e, name, at)
	await P.until(() => (editor.worldMap === name && e.worldTiles()?.size ? true : null), 30000, `${name}'s world tab`)
	// Wrapped, since P.until waits on a falsy answer and Azeroth's ID is 0.
	return (await P.until(() => (e.openMapId() === null ? null : [e.openMapId()]), 10000, `${name}'s map ID`))[0]
}
prefs.clientLighting = true
// Kalimdor around Orgrimmar, Azeroth around Elwynn.
r.kalimdor = await open('Kalimdor', { x: 39, y: 27, size: 3 })
r.kalimdorLights = (await P.until(() => (e.clientLightsMap === r.kalimdor ? [e.clientLightsMap] : null), 30000, "Kalimdor's client lights"))[0]
r.azeroth = await open('Azeroth', { x: 31, y: 48, size: 3 })
r.azerothLights = (await P.until(() => (e.clientLightsMap === r.azeroth ? [e.clientLightsMap] : null), 30000, "Azeroth's client lights"))[0]
prefs.clientLighting = was
r.ok = r.kalimdor === 1 && r.kalimdorLights === 1 && r.azeroth === 0 && r.azerothLights === 0
return r
