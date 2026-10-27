// Run with: bun test tests/texturePack.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kindOf, packPalette, type TextureUse } from '../src/lib/wow/texturePack.ts'

// The shares ZoneTextures read from a 1.12 client (TestRealZoneTextures), the seabed left out.
const TANARIS: TextureUse[] = [
	['Tileset\\Tanaris\\TanarisSandStones.blp', 0.295],
	['Tileset\\Tanaris\\TanarisSandBase01.blp', 0.222],
	['Tileset\\Tanaris\\TanarisRockBaseBurn.blp', 0.188],
	['Tileset\\Tanaris\\TanarisRockBase01.blp', 0.14],
	['Tileset\\Feralas\\FeralasDirt.blp', 0.041],
	['Tileset\\Tanaris\\TanarisCrackedGround.blp', 0.026],
	['Tileset\\Silithis\\SilithisSandDetail.blp', 0.019],
	['Tileset\\Wetlands\\Wetlandsdirtmoss01.blp', 0.019],
	['Tileset\\Tanaris\\TanarisPurpleBug01.blp', 0.012],
	['Tileset\\Tanaris\\TanarisPurpleBug03.blp', 0.008],
].map(([path, share]) => ({ path: path as string, share: share as number }))

const DUSKWOOD: TextureUse[] = [
	['Tileset\\Duskwood\\DuskwoodDirt.blp', 0.31],
	['Tileset\\Duskwood\\DuskwoodGrassBase.blp', 0.273],
	['Tileset\\Duskwood\\DuskwoodRock.blp', 0.146],
	['Tileset\\Duskwood\\DuskwoodRockGravel.blp', 0.092],
	['Tileset\\Elwynn\\ElwynnGrassBase.blp', 0.038],
	['Tileset\\Kalidar\\KalidarFerns.blp', 0.025],
	['Tileset\\Duskwood\\DuskwoodGrassBase02.blp', 0.022],
	['Tileset\\Kalidar\\KalidarRock.blp', 0.017],
	['Tileset\\Elwynn\\ElwynnDirtBase2.blp', 0.012],
	['Tileset\\Duskwood\\DuskwoodCobblestone.blp', 0.011],
].map(([path, share]) => ({ path: path as string, share: share as number }))

const file = (p: string) => p.slice(p.lastIndexOf('\\') + 1)

test('a tileset is sorted by its file name, not its folder', () => {
	assert.equal(kindOf('Tileset\\Tanaris\\TanarisSandStones.blp'), 'sand')
	assert.equal(kindOf('Tileset\\Duskwood\\DuskwoodCobblestone.blp'), 'road')
	assert.equal(kindOf('Tileset\\Duskwood\\DuskwoodRockGravel.blp'), 'rock')
	assert.equal(kindOf('Tileset\\Winterspring Grove\\WinterspringSnow.blp'), 'snow')
	assert.equal(kindOf('Tileset\\Grass\\Something.blp'), 'other')
})

test('Tanaris paints its main sand as the ground, another sand for the lush patches, its rock on slopes and on peaks', () => {
	const p = packPalette(TANARIS)!.map(file)
	assert.equal(p.length, 8)
	assert.equal(p[0], 'TanarisSandStones.blp')
	assert.equal(p[1], 'TanarisSandBase01.blp', 'no grass: the lush patches are more sand')
	assert.equal(p[3], 'TanarisRockBaseBurn.blp')
	assert.equal(p[4], 'SilithisSandDetail.blp')
	assert.equal(p[5], p[3], 'no snow: the peaks take the rock')
	assert.equal(p[2], 'FeralasDirt.blp')
	assert.ok(!p.some((x) => x.includes('PurpleBug03')), 'a detail under 1% is never a role')
})

test('Duskwood keeps its dirt as the ground, its grass as the lush patches and its cobblestones', () => {
	const p = packPalette(DUSKWOOD)!.map(file)
	assert.equal(p[0], 'DuskwoodDirt.blp')
	assert.equal(p[1], 'DuskwoodGrassBase.blp')
	assert.equal(p[3], 'DuskwoodRock.blp')
	assert.equal(p[6], 'DuskwoodCobblestone.blp')
	assert.equal(p[4], p[2], 'no sand: the shore takes the dirt')
	assert.equal(p[5], p[3], 'no snow: the peaks take the rock')
})

test('a zone of one texture paints everything with it, and none gives no pack', () => {
	assert.deepEqual(packPalette([{ path: 'Tileset\\X\\XRock.blp', share: 1 }]), new Array(8).fill('Tileset\\X\\XRock.blp'))
	assert.equal(packPalette([]), null)
})
