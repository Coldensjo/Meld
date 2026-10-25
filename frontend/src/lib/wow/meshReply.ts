import type { AnimBone, MeshEffect, MeshEmitter, MeshGroup, MeshRibbon, WowMesh } from './api'

// The model and collision endpoints' binary replies decoded, kept apart from api.ts so they can be
// tested: frontend/tests/wire.test.ts decodes the fixtures Go's encoders write (#520).

/**
 * The model endpoint's reply (Go's `Mesh.Encode`): a u32 header length, the JSON header (padded to
 * 4 bytes), then pos, normal, uv, [colour], index (u32), [bone indices u8x4, bone weights u8x4],
 * [rooms u16x2], [liquid pos, uv, info u8x4, body u8x4, rooms u16x2, index (u32)].
 */
export function parseMesh(buf: ArrayBuffer): WowMesh {
	const dv = new DataView(buf)
	const hdrLen = dv.getUint32(0, true)
	const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hdrLen))) as {
		verts: number
		indices: number
		colors: boolean
		groups: MeshGroup[]
		bbox: number[]
		bones?: AnimBone[]
		effects?: MeshEffect[]
		emitters?: MeshEmitter[]
		ribbons?: MeshRibbon[]
		rooms?: boolean
		liquidVerts?: number
		liquidIndices?: number
	}
	let o = 4 + hdrLen
	const take = <T>(ctor: new (b: ArrayBuffer, o: number, n: number) => T, n: number, bytes: number) => {
		const v = new ctor(buf, o, n)
		o += n * bytes
		return v
	}
	const positions = take(Float32Array, hdr.verts * 3, 4)
	const normals = take(Float32Array, hdr.verts * 3, 4)
	const uvs = take(Float32Array, hdr.verts * 2, 4)
	const colors = hdr.colors ? take(Uint8Array, hdr.verts * 4, 1) : null
	const indices = take(Uint32Array, hdr.indices, 4)
	const mesh: WowMesh = { positions, normals, uvs, colors, indices, groups: hdr.groups ?? [], bbox: hdr.bbox, effects: hdr.effects ?? [], emitters: hdr.emitters ?? [], ribbons: hdr.ribbons ?? [] }
	if (hdr.bones?.length) {
		mesh.bones = hdr.bones
		mesh.boneIdx = take(Uint8Array, hdr.verts * 4, 1)
		mesh.boneW = take(Uint8Array, hdr.verts * 4, 1)
	}
	if (hdr.rooms) mesh.rooms = take(Uint16Array, hdr.verts * 2, 2)
	const lv = hdr.liquidVerts ?? 0
	if (lv > 0) {
		mesh.liquid = {
			positions: take(Float32Array, lv * 3, 4),
			uvs: take(Float32Array, lv * 2, 4),
			info: take(Uint8Array, lv * 4, 1),
			body: take(Uint8Array, lv * 4, 1),
			rooms: take(Uint16Array, lv * 2, 2),
			indices: take(Uint32Array, hdr.liquidIndices ?? 0, 4),
		}
	}
	return mesh
}

/** A model's collision faces, each group's triangle count and its liquids (`fetchCollision`). */
export interface CollisionReply {
	tris: Float32Array
	groups: Uint32Array
	liquid: { verts: Float32Array; idx: Uint32Array; types: Uint32Array } | null
}

/**
 * The collision endpoint's reply (Go's `collision.encode`): the face count and the faces (nine
 * floats each), the group count and each group's triangle count, the liquid's vertex count and its
 * vertices, then its triangle count, the triangles' indices and their liquid types.
 */
export function parseCollision(buf: ArrayBuffer): CollisionReply {
	const v = new DataView(buf)
	const n = v.getUint32(0, true)
	let at = 4 + n * 36
	const groups = new Uint32Array(v.getUint32(at, true))
	for (let g = 0; g < groups.length; g++) groups[g] = v.getUint32(at + 4 + g * 4, true)
	at += 4 + groups.length * 4
	const nv = v.getUint32(at, true)
	const nt = v.getUint32(at + 4 + nv * 12, true)
	const verts = new Float32Array(buf, at + 4, nv * 3)
	const idx = new Uint32Array(buf, at + 8 + nv * 12, nt * 3)
	const types = new Uint32Array(buf, at + 8 + nv * 12 + nt * 12, nt)
	return { tris: new Float32Array(buf, 4, n * 9), groups, liquid: nt > 0 ? { verts, idx, types } : null }
}
