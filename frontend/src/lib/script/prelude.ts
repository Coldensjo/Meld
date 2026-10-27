// The Lua side of the script API (#28): Noggit Red's script functions (vec, the math globals,
// select_origin and select_between, verts, models, add_m2 and add_wmo, random_from_seed...) written in
// Lua over the few host functions `ScriptHost` gives (scriptApi.ts), so a script's per-vertex work stays
// inside Lua and crosses into JavaScript a block at a time. Noggit Red is GPL: this matches the API's
// names and behaviour (its scripts/global.d.ts), and none of its code.
//
// Heights: `sel:verts()` reads the selection's vertex block once; `vert:set_height` writes into that copy,
// and the block goes back to the map on `sel:apply()`, before any model call (a model's height is read
// against the ground), before another block is read, and when the script (or a brush event) ends. The
// prelude ends by loading and running the script (`H.code()`), so a script is one chunk under one time
// limit; a script that made brushes keeps its state, and each brush event calls `__meld_event`.

export const PRELUDE = String.raw`
local H = __host
__host = nil
local mfloor, mceil, msqrt, mmin, mmax, mabs = math.floor, math.ceil, math.sqrt, math.min, math.max, math.abs
local select, tostring, setmetatable, type, error, concat = select, tostring, setmetatable, type, error, table.concat

-- Lua 5.1 names that 5.4 dropped, so older scripts run.
unpack = unpack or table.unpack
loadstring = loadstring or load
math.pow = math.pow or function(a, b) return a ^ b end
math.mod = math.mod or math.fmod
table.getn = table.getn or function(t) return #t end

function print(...)
	local n = select('#', ...)
	local parts = {}
	for i = 1, n do parts[i] = tostring((select(i, ...))) end
	H.print(concat(parts, '\t'))
end

local function missing(name)
	return function() error(name .. ' is not in Meld yet', 2) end
end

-- vector_3d: x and z across the ground, y up, in yards.
local vec_mt = {}
vec_mt.__index = vec_mt
vec_mt.__tostring = function(v) return string.format('vec(%g, %g, %g)', v.x, v.y, v.z) end
vec_mt.__add = function(a, b) return vec(a.x + b.x, a.y + b.y, a.z + b.z) end
vec_mt.__sub = function(a, b) return vec(a.x - b.x, a.y - b.y, a.z - b.z) end
vec_mt.__eq = function(a, b) return a.x == b.x and a.y == b.y and a.z == b.z end
function vec(x, y, z)
	return setmetatable({ x = x or 0, y = y or 0, z = z or 0 }, vec_mt)
end
local function copy(v) return vec(v.x, v.y, v.z) end
local function need_vec(v, what)
	if type(v) ~= 'table' or type(v.x) ~= 'number' or type(v.z) ~= 'number' then error(what .. ': expected a vec(x, y, z)', 3) end
end

-- The math globals.
function round(a) return mfloor(a + 0.5) end
function pow(a, b) return a ^ b end
function log10(a) return math.log(a, 10) end
function log(a) return math.log(a) end
function ceil(a) return mceil(a) end
function floor(a) return mfloor(a) end
function exp(a) return math.exp(a) end
function cbrt(a) return a < 0 and -((-a) ^ (1 / 3)) or a ^ (1 / 3) end
function acosh(a) return math.log(a + msqrt(a * a - 1)) end
function asinh(a) return math.log(a + msqrt(a * a + 1)) end
function atanh(a) return 0.5 * math.log((1 + a) / (1 - a)) end
function cosh(a) return (math.exp(a) + math.exp(-a)) / 2 end
function sinh(a) return (math.exp(a) - math.exp(-a)) / 2 end
function tanh(a) local e = math.exp(2 * a) return (e - 1) / (e + 1) end
acos, asin, atan, cos, sin, tan = math.acos, math.asin, math.atan, math.cos, math.sin, math.tan
function sqrt(a) return msqrt(a) end
function abs(a) return mabs(a) end
function lerp(from, to, ratio) return from + ratio * (to - from) end
function dist_2d(a, b)
	local dx, dz = a.x - b.x, a.z - b.z
	return msqrt(dx * dx + dz * dz)
end
function dist_2d_compare(a, b, d)
	local dx, dz = a.x - b.x, a.z - b.z
	local s, c = dx * dx + dz * dz, d * d
	return s > c and 1 or (s == c and 0 or -1)
end
function rotate_2d(p, o, angle)
	local r = angle * math.pi / 180
	local s, c = math.sin(r), math.cos(r)
	local lx, lz = p.x - o.x, p.z - o.z
	return vec(lx * c - lz * s + o.x, p.y, lx * s + lz * c + o.z)
end

-- random: a seeded generator (mulberry32 over an FNV-1a hash of the seed string).
local rand_mt = {}
rand_mt.__index = rand_mt
local function hash(s)
	local h = 2166136261
	for i = 1, #s do h = ((h ~ s:byte(i)) * 16777619) & 0xffffffff end
	return h
end
local function next01(r)
	local t = (r._s + 0x6D2B79F5) & 0xffffffff
	r._s = t
	t = ((t ~ (t >> 15)) * (t | 1)) & 0xffffffff
	t = (t ~ (t + (((t ~ (t >> 7)) * (t | 61)) & 0xffffffff))) & 0xffffffff
	return ((t ~ (t >> 14)) & 0xffffffff) / 4294967296
end
function rand_mt:integer(low, high)
	if low == high then return low end
	if low > high then error('random lower bound ' .. low .. ' >= higher bound ' .. high, 2) end
	return mfloor(low + next01(self) * (high - low))
end
function rand_mt:real(low, high)
	if low == high then return low end
	return low + next01(self) * (high - low)
end
function random_from_seed(seed)
	return setmetatable({ _s = hash(tostring(seed)) }, rand_mt)
end
function random_from_time()
	return random_from_seed(tostring(H.now()))
end

-- The terrain: a grid of vertices cell yards apart, verts a side, and the paint's texels, TEX a side, TS
-- yards apart; chunks of CHUNK cells, CS a side (read again for each brush event, as the map painted may
-- be another).
local V, CELL, TEX, TS, CS
local CHUNK = 8
local function read_terrain()
	local info = H.terrain()
	V, CELL, TEX = info.verts, info.cell, info.tex
	TS = CELL * (V - 1) / TEX
	CS = (V - 1) // CHUNK
end
read_terrain()

-- Vertex blocks (sel:verts(), hs the heights) and texel blocks (sel:tex(), a four alphas a texel) with
-- edits not yet written back.
local pending = {}
local function flush()
	for b in pairs(pending) do
		if b.hs then H.set_heights(b.x0, b.z0, b.w, b.h, b.hs) else H.set_alphas(b.x0, b.z0, b.w, b.h, b.a) end
		pending[b] = nil
	end
end

-- What Meld can't keep, said once a run or brush rather than raised, so Noggit Red's scripts go on.
local noted = {}
local function note(text)
	if noted[text] then return end
	noted[text] = true
	H.print(text)
end

local vert_mt = {}
vert_mt.__index = vert_mt
function vert_mt:get_pos() return vec(self._x, self._b.hs[self._k], self._z) end
function vert_mt:set_height(y)
	self._b.hs[self._k] = y
	pending[self._b] = true
end
function vert_mt:add_height(y) self:set_height(self._b.hs[self._k] + y) end
function vert_mt:sub_height(y) self:set_height(self._b.hs[self._k] - y) end
local function vert_block(x0, z0, x1, z1)
	return { x0 = x0, z0 = z0, w = x1 - x0 + 1, h = z1 - z0 + 1, hs = H.heights(x0, z0, x1, z1) }
end
local function make_vert(b, xi, zi)
	local vx, vz = b.x0 + xi, b.z0 + zi
	return setmetatable({ _b = b, _k = zi * b.w + xi + 1, _vx = vx, _vz = vz, _x = vx * CELL, _z = vz * CELL }, vert_mt)
end

-- Texture layers: 0 the base, up to 3; a texel's layers are its chunk's.
local function need_layer(i, what)
	if type(i) ~= 'number' or i < 0 or i > 3 or i % 1 ~= 0 then error(what .. ': invalid texture layer: ' .. tostring(i), 3) end
end
local function tex_block(x0, z0, x1, z1)
	return { x0 = x0, z0 = z0, w = x1 - x0 + 1, h = z1 - z0 + 1, a = H.alphas(x0, z0, x1, z1) }
end
-- The texels nearest a vertex: those whose middles are within half a cell of it.
local function vert_texels(v)
	local per = TEX // (V - 1)
	local half = per // 2
	return mmax(0, v._vx * per - half), mmax(0, v._vz * per - half), mmin(TEX - 1, v._vx * per + half - 1), mmin(TEX - 1, v._vz * per + half - 1)
end
function vert_mt:set_alpha(i, a)
	need_layer(i, 'vert:set_alpha')
	if i == 0 then return end
	flush()
	local x0, z0, x1, z1 = vert_texels(self)
	local b = tex_block(x0, z0, x1, z1)
	for k = 0, b.w * b.h - 1 do b.a[k * 4 + i + 1] = tonumber(a) or 0 end
	H.set_alphas(b.x0, b.z0, b.w, b.h, b.a)
end
function vert_mt:get_alpha(i)
	need_layer(i, 'vert:get_alpha')
	if i == 0 then return 1 end
	flush()
	local x0, z0, x1, z1 = vert_texels(self)
	local b = tex_block(x0, z0, x1, z1)
	local n, sum = b.w * b.h, 0
	for k = 0, n - 1 do sum = sum + b.a[k * 4 + i + 1] end
	return n > 0 and sum / n or 0
end
-- Holes: the 2 by 2 cell block of the cell the vertex is the first corner of, as a 1.12 tile keeps them.
function vert_mt:set_hole(on)
	flush()
	H.set_hole(self._vx, self._vz, on and true or false)
end
-- Every vertex of Meld's grid is a corner of the liquid's cells, so every one takes water.
function vert_mt:is_water_aligned() return true end
function vert_mt:set_water(kind, height)
	flush()
	H.set_water(self._vx, self._vz, tonumber(kind) or 0, tonumber(height) or self._b.hs[self._k])
end
-- 1.12 tiles have no vertex colours (MCCV came with later clients).
function vert_mt:set_color() note('vert:set_color: 1.12 tiles have no vertex colours, so Meld keeps none.') end
function vert_mt:get_color() return vec(1, 1, 1) end

local tex_mt = {}
tex_mt.__index = tex_mt
function tex_mt:get_alpha(i)
	need_layer(i, 'tex:get_alpha')
	return self._b.a[self._k + i + 1]
end
function tex_mt:set_alpha(i, v)
	need_layer(i, 'tex:set_alpha')
	self._b.a[self._k + i + 1] = tonumber(v) or 0
	pending[self._b] = true
end
-- The texel's corner, as Noggit Red gives it.
function tex_mt:get_pos_2d() return vec(self._x, 0, self._z) end
local function make_tex(b, xi, zi)
	local tx, tz = b.x0 + xi, b.z0 + zi
	return setmetatable({ _b = b, _k = (zi * b.w + xi) * 4, _x = tx * TS, _z = tz * TS }, tex_mt)
end

-- Models: m2 and wmo placements, rotations in degrees as Noggit Red gives them (y the yaw).
local model_mt = {}
model_mt.__index = model_mt
local function norm(name) return (tostring(name):lower():gsub('\\', '/')) end
local function wrap(m)
	return setmetatable({ _m = m }, model_mt)
end
local function live(self, what)
	if self._m.removed then error(what .. ': the model was removed', 3) end
	return self._m
end
local function write(self)
	flush()
	local m = self._m
	H.set_model(m.id, m.x, m.y, m.z, m.rx, m.ry, m.rz, m.scale)
end
function model_mt:get_pos() local m = live(self, 'get_pos') return vec(m.x, m.y, m.z) end
function model_mt:set_pos(p)
	need_vec(p, 'set_pos')
	local m = live(self, 'set_pos')
	m.x, m.y, m.z = p.x, p.y or m.y, p.z
	write(self)
end
function model_mt:get_rot() local m = live(self, 'get_rot') return vec(m.rx, m.ry, m.rz) end
function model_mt:set_rot(r)
	need_vec(r, 'set_rot')
	local m = live(self, 'set_rot')
	m.rx, m.ry, m.rz = r.x or 0, r.y or 0, r.z or 0
	write(self)
end
function model_mt:get_scale() return live(self, 'get_scale').scale end
function model_mt:set_scale(s)
	local m = live(self, 'set_scale')
	m.scale = s
	write(self)
end
function model_mt:get_uid() return self._m.id end
function model_mt:get_filename() return norm(self._m.file) end
function model_mt:has_filename(name) return norm(name) == norm(self._m.file) end
function model_mt:remove()
	if self._m.removed then return end
	flush()
	H.remove_model(self._m.id)
	self._m.removed = true
end
function model_mt:replace(file)
	local m = live(self, 'replace')
	if norm(file) == norm(m.file) then return end
	flush()
	local n = H.replace_model(m.id, tostring(file))
	if type(n) == 'string' then error(n, 2) end
	self._m = n
end

-- Selections: a box over the ground from min to max.
local sel_mt = {}
sel_mt.__index = sel_mt
local function selection(a, b)
	need_vec(a, 'selection')
	need_vec(b, 'selection')
	local lo = vec(mmin(a.x, b.x), mmin(a.y or 0, b.y or 0), mmin(a.z, b.z))
	local hi = vec(mmax(a.x, b.x), mmax(a.y or 0, b.y or 0), mmax(a.z, b.z))
	local size = hi - lo
	return setmetatable({ _min = lo, _max = hi, _size = size, _center = vec(lo.x + size.x / 2, lo.y + size.y / 2, lo.z + size.z / 2) }, sel_mt)
end
function sel_mt:center() return copy(self._center) end
function sel_mt:min() return copy(self._min) end
function sel_mt:max() return copy(self._max) end
function sel_mt:size() return copy(self._size) end
function sel_mt:verts()
	flush()
	local e = 1e-6
	local x0 = mmax(0, mceil(self._min.x / CELL - e))
	local z0 = mmax(0, mceil(self._min.z / CELL - e))
	local x1 = mmin(V - 1, mfloor(self._max.x / CELL + e))
	local z1 = mmin(V - 1, mfloor(self._max.z / CELL + e))
	local list = {}
	if x0 > x1 or z0 > z1 then return list end
	local b = vert_block(x0, z0, x1, z1)
	for zi = 0, b.h - 1 do
		for xi = 0, b.w - 1 do list[#list + 1] = make_vert(b, xi, zi) end
	end
	return list
end
-- The texels whose corners lie in the selection, read as one block.
function sel_mt:tex()
	flush()
	local e = 1e-6
	local x0 = mmax(0, mceil(self._min.x / TS - e))
	local z0 = mmax(0, mceil(self._min.z / TS - e))
	local x1 = mmin(TEX - 1, mfloor(self._max.x / TS + e))
	local z1 = mmin(TEX - 1, mfloor(self._max.z / TS + e))
	local list = {}
	if x0 > x1 or z0 > z1 then return list end
	local b = tex_block(x0, z0, x1, z1)
	for zi = 0, b.h - 1 do
		for xi = 0, b.w - 1 do list[#list + 1] = make_tex(b, xi, zi) end
	end
	return list
end
local chunk_at
-- The chunks the selection reaches.
function sel_mt:chunks()
	local span = CELL * CHUNK
	local x0, z0 = mmax(0, mfloor(self._min.x / span)), mmax(0, mfloor(self._min.z / span))
	local x1, z1 = mmin(CS - 1, mfloor(self._max.x / span)), mmin(CS - 1, mfloor(self._max.z / span))
	local list = {}
	for cz = z0, z1 do
		for cx = x0, x1 do list[#list + 1] = chunk_at(cx, cz) end
	end
	return list
end
function sel_mt:models()
	flush()
	local list = {}
	for i, m in ipairs(H.models(self._min.x, self._min.z, self._max.x, self._max.z)) do list[i] = wrap(m) end
	return list
end
function sel_mt:apply() flush() end

function select_between(a, b) return selection(a, b) end
function select_origin(o, xr, zr)
	need_vec(o, 'select_origin')
	if not zr or zr <= 0 then zr = xr end
	return selection(vec(o.x - xr, 0, o.z - zr), vec(o.x + xr, 0, o.z + zr))
end

-- Chunks (#760): 8 by 8 cells, an MCNK of the client's tile. Its texture layers are its paint's textures
-- in order (0 the base, at most 4).
local chunk_mt = {}
chunk_mt.__index = chunk_mt
chunk_at = function(cx, cz) return setmetatable({ _c = cz * CS + cx, _cx = cx, _cz = cz }, chunk_mt) end
function get_chunk(p)
	need_vec(p, 'get_chunk')
	local span = CELL * CHUNK
	local cx, cz = mfloor(p.x / span), mfloor(p.z / span)
	if cx < 0 or cz < 0 or cx >= CS or cz >= CS then error(string.format('get_chunk: (%g, %g) is off the map', p.x, p.z), 2) end
	return chunk_at(cx, cz)
end
local function need_index(i, what, name)
	if type(i) ~= 'number' or i < 0 or i > 3 or i % 1 ~= 0 then error(what .. ': invalid ' .. name .. ' index, must be between 0-3', 3) end
end
-- After a change to the layers, the chunk's texel block (get_tex) is read again.
local function relayer(self) self._tb = nil end
function chunk_mt:get_texture_count() flush() return #H.chunk_textures(self._c) end
function chunk_mt:get_texture(i)
	need_index(i, 'chunk:get_texture', 'texture')
	flush()
	local list = H.chunk_textures(self._c)
	if i >= #list then error('chunk:get_texture: texture index out of range', 2) end
	return norm(list[i + 1])
end
-- effect: -2 (the default) leaves it, -1 clears it, 0 or more sets it. Returns the layer, -1 for a full chunk.
function chunk_mt:add_texture(file, effect)
	flush()
	relayer(self)
	local r = H.chunk_add_texture(self._c, tostring(file))
	if type(r) == 'string' then error(r, 2) end
	effect = tonumber(effect) or -2
	if r >= 0 and effect >= -1 then self:set_effect(r, effect) end
	return r
end
function chunk_mt:remove_texture(i)
	need_index(i, 'chunk:remove_texture', 'texture')
	flush()
	relayer(self)
	H.chunk_remove_texture(self._c, i)
end
function chunk_mt:clear_textures()
	flush()
	relayer(self)
	H.chunk_clear_textures(self._c)
end
function chunk_mt:get_effect(i) return H.chunk_effect(self._c, tonumber(i) or 0) end
-- Meld keeps a ground effect per texture (for the map, a zone or a tile), not per chunk layer.
function chunk_mt:set_effect() note("chunk:set_effect: Meld keeps one ground effect per texture (Texture Properties), not per chunk layer, so the effect didn't change.") end
function chunk_mt:set_hole(on)
	flush()
	H.chunk_set_hole(self._c, on and true or false)
end
function chunk_mt:clear_colors() note('chunk:clear_colors: 1.12 tiles have no vertex colours, so Meld keeps none.') end
function chunk_mt:apply() flush() end
chunk_mt.apply_all = chunk_mt.apply
chunk_mt.apply_textures = chunk_mt.apply
chunk_mt.apply_heightmap = chunk_mt.apply
chunk_mt.apply_vertex_color = chunk_mt.apply
function chunk_mt:set_impassable(on) H.chunk_set_impassable(self._c, on and true or false) end
function chunk_mt:get_area_id() return H.chunk_area(self._c) end
function chunk_mt:set_area_id(id) H.chunk_set_area(self._c, mfloor(tonumber(id) or 0)) end
function chunk_mt:to_selection()
	local span = CELL * CHUNK
	return selection(vec(self._cx * span, 0, self._cz * span), vec((self._cx + 1) * span, 0, (self._cz + 1) * span))
end
-- Noggit Red's 64 by 64 texels a chunk: Meld's paint has fewer, so neighbouring indices share a texel.
function chunk_mt:get_tex(i)
	if type(i) ~= 'number' or i < 0 or i > 4095 then error('chunk:get_tex: index must be between 0-4095', 2) end
	local per = TEX // CS
	if not self._tb then
		flush()
		self._tb = tex_block(self._cx * per, self._cz * per, self._cx * per + per - 1, self._cz * per + per - 1)
	end
	return make_tex(self._tb, mfloor((i % 64) * per / 64), mfloor(mfloor(i / 64) * per / 64))
end
-- Noggit Red's 145 vertices a chunk, rows of 9 outer and 8 inner by turns: Meld's grid has only the
-- outer ones, so an inner vertex is the corner before it.
function chunk_mt:get_vert(i)
	if type(i) ~= 'number' or i < 0 or i > 144 then error('chunk:get_vert: index must be between 0-144', 2) end
	if not self._vb then
		flush()
		self._vb = vert_block(self._cx * CHUNK, self._cz * CHUNK, self._cx * CHUNK + CHUNK, self._cz * CHUNK + CHUNK)
	end
	i = mfloor(i)
	local row, r = i // 17, i % 17
	return make_vert(self._vb, r < 9 and r or r - 9, row)
end

-- Noggit Red's procedures: paint_texture adds an image's red, turned by angle degrees about the
-- selection's middle and fading to its edge, to texture layer layer of the selection's texels.
procedures = {}
function procedures.paint_texture(a, ...)
	-- Noggit Red's scripts call it as procedures:paint_texture(sel, ...).
	if a == procedures then return procedures.paint_texture(...) end
	local sel, img, layer, pressure, angle = a, ...
	if type(sel) ~= 'table' or getmetatable(sel) ~= sel_mt then error('procedures:paint_texture: expected a selection', 2) end
	need_layer(layer, 'procedures:paint_texture')
	pressure, angle = tonumber(pressure) or 1, tonumber(angle) or 0
	local center = sel:center()
	local outer = (sel._max.x - sel._min.x) / 2
	if outer <= 0 then return end
	local w, h = img:width(), img:height()
	local hw, hh = w / 2, h / 2
	for _, t in ipairs(sel:tex()) do
		local p = t:get_pos_2d()
		local dist = dist_2d(p, center) / outer
		p = rotate_2d(p, center, angle)
		local rx, rz = (p.x - center.x) / outer, (p.z - center.z) / outer
		if rx >= -1 and rx <= 1 and rz >= -1 and rz <= 1 then
			local ix, iz = round(hw + hw * rx), round(hh + hh * rz)
			if ix >= 0 and ix < w and iz >= 0 and iz < h then
				t:set_alpha(layer, t:get_alpha(layer) + img:get_red(ix, iz) * pressure * (1 - dist))
			end
		end
	end
end

local function add(kind, file, pos, scale, rot, what)
	need_vec(pos, what)
	flush()
	rot = rot or vec(0, 0, 0)
	local m = H.add_model(kind, tostring(file), pos.x, pos.y or 0, pos.z, rot.x or 0, rot.y or 0, rot.z or 0, scale or 1)
	if type(m) == 'string' then error(m, 3) end
	return wrap(m)
end
-- Not tail calls, so add's error level 3 is the script's line.
function add_m2(file, pos, scale, rot) local m = add('m2', file, pos, scale, rot, 'add_m2') return m end
function add_wmo(file, pos, rot) local m = add('wmo', file, pos, 1, rot, 'add_wmo') return m end

-- The camera and the map.
function camera_pos() local c = H.camera() return vec(c.x, c.y, c.z) end
function cam_pitch() return H.camera().pitch end
function cam_yaw() return H.camera().yaw end
function get_map_id() return H.map_id() end
function get_area_id(p) need_vec(p, 'get_area_id') return H.area_id(p.x, p.z) end

-- Keys and buttons held: what a brush event was sent with; none for a script run from the Scripts window.
function holding_alt() return H.holding('alt') end
function holding_shift() return H.holding('shift') end
function holding_ctrl() return H.holding('ctrl') end
function holding_space() return H.holding('space') end
function holding_left_mouse() return H.holding('left') end
function holding_right_mouse() return H.holding('right') end

-- Meld's own: the spot the camera looks at, and the area the Select tool selected (nil for none).
function target_pos() local t = H.target() return vec(t.x, t.y, t.z) end
function selected_area()
	local a = H.area()
	if not a then return nil end
	return selection(vec(a.x0, 0, a.z0), vec(a.x1, 0, a.z1))
end

-- Noise maps (#29): a grid of values over whole yards from (sx, sz), kept on the JavaScript side
-- (scriptNoise.ts) and freed when Lua collects the map.
local noise_mt = {}
noise_mt.__index = noise_mt
noise_mt.__gc = function(m) H.noise_free(m._id) end
local function noisemap(sx, sz, w, h, freq, algo, seed)
	sx, sz, w, h = mfloor(sx), mfloor(sz), mfloor(w), mfloor(h)
	local id = H.noise_make(sx, sz, w, h, tonumber(freq) or 1, tostring(algo), tostring(seed))
	if type(id) == 'string' then error('make_noise: ' .. id, 3) end
	return setmetatable({ _id = id, _sx = sx, _sz = sz, _w = w, _h = h }, noise_mt)
end
local function noise_out(m, what, x, z)
	error(string.format('%s: noise coordinates out of bounds: x=%d z=%d width=%d height=%d', what, x, z, m._w, m._h), 3)
end
function noise_mt:get(p)
	need_vec(p, 'noisemap:get')
	local x, z = round(p.x) - self._sx, round(p.z) - self._sz
	local v = H.noise_get(self._id, x, z)
	if v == nil then noise_out(self, 'noisemap:get', x, z) end
	return v
end
function noise_mt:is_highest(p, r)
	need_vec(p, 'noisemap:is_highest')
	local res = H.noise_highest(self._id, round(p.x) - self._sx, round(p.z) - self._sz, mfloor(r or 0))
	if type(res) == 'string' then error('noisemap:is_highest: ' .. res, 2) end
	return res
end
function noise_mt:set(x, z, v)
	if not H.noise_set(self._id, x, z, v) then noise_out(self, 'noisemap:set', x, z) end
end
function noise_mt:width() return self._w end
function noise_mt:height() return self._h end
function noise_mt:start() return vec(self._sx, 0, self._sz) end
function make_noise(sx, sz, w, h, freq, algo, seed) local m = noisemap(sx, sz, w, h, freq, algo, seed) return m end
-- Padded by 2 yards all round, as Noggit Red pads it, so rounding never reads past its edge.
function sel_mt:make_noise(freq, algo, seed)
	local m = noisemap(mfloor(self._min.x) - 2, mfloor(self._min.z) - 2, mceil(self._size.x) + 4, mceil(self._size.z) + 4, freq, algo, seed)
	return m
end

-- Images (#29): RGBA pixels kept on the JavaScript side, channels read and written as 0..1.
local image_mt = {}
image_mt.__index = image_mt
image_mt.__gc = function(m) H.image_free(m._id) end
local function wrap_image(id, w, h) return setmetatable({ _id = id, _w = w, _h = h }, image_mt) end
local function channel(img, x, y, c, what)
	local v = H.image_get(img._id, x, y, c)
	if v == nil then error(string.format('%s: image coordinates out of bounds: x=%s y=%s width=%d height=%d', what, tostring(x), tostring(y), img._w, img._h), 3) end
	return v
end
function image_mt:get_pixel(x, y) return channel(self, x, y, -1, 'image:get_pixel') end
function image_mt:get_red(x, y) return channel(self, x, y, 0, 'image:get_red') end
function image_mt:get_green(x, y) return channel(self, x, y, 1, 'image:get_green') end
function image_mt:get_blue(x, y) return channel(self, x, y, 2, 'image:get_blue') end
function image_mt:get_alpha(x, y) return channel(self, x, y, 3, 'image:get_alpha') end
function image_mt:set_pixel_floats(x, y, r, g, b, a)
	if not H.image_set(self._id, x, y, r or 0, g or 0, b or 0, a or 1) then channel(self, x, y, 0, 'image:set_pixel_floats') end
end
-- The pixel packed as get_pixel gives it: red in the top byte, alpha in the bottom one.
function image_mt:set_pixel(x, y, v)
	v = mfloor(v or 0)
	local r, g, b, a = (v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255
	if not H.image_set(self._id, x, y, r / 255, g / 255, b / 255, a / 255) then channel(self, x, y, 0, 'image:set_pixel') end
end
function image_mt:gradient_scale(rel)
	if type(rel) ~= 'number' or rel < 0 or rel >= 1 then error('image:gradient_scale: relative image coordinate out of bounds: ' .. tostring(rel) .. ' (should be >= 0 and < 1)', 2) end
	return channel(self, mfloor(rel * self._w), 0, 0, 'image:gradient_scale')
end
function image_mt:width() return self._w end
function image_mt:height() return self._h end
image_mt.save = missing('image:save (writing files, #761)')
function create_image(w, h)
	w, h = mfloor(tonumber(w) or 0), mfloor(tonumber(h) or 0)
	local id = H.image_new(w, h)
	if type(id) == 'string' then error('create_image: ' .. id, 2) end
	return wrap_image(id, w, h)
end
-- A path relative to the scripts folder, or a whole one. The app reads the file, so the script waits for it.
function load_png(path)
	local r = H.image_load(tostring(path)):await()
	if type(r) == 'string' then error(r, 2) end
	return wrap_image(r.id, r.w, r.h)
end

-- Script brushes (#29): brush(name) makes a brush for the Script Brush tool, with tags (its settings,
-- whose values the tool's options bar sets) and on_left_click, on_left_hold and on_left_release (and
-- the right ones) called as a stroke goes. The app keeps this Lua state while the brush is loaded.
local brushes = {}
local brush_mt = {}
brush_mt.__index = brush_mt
local tag_mt = {}
tag_mt.__index = tag_mt
function tag_mt:get() return H.tag(self._b, self._t) end
local function tag(b, kind, label, low, high, def, digits, values)
	local t = H.add_tag(b._i, kind, tostring(label or ''), tonumber(low) or 0, tonumber(high) or 0, def, tonumber(digits) or 0, values or '')
	return setmetatable({ _b = b._i, _t = t }, tag_mt)
end
function brush_mt:add_int_tag(item, low, high, def) return tag(self, 'int', item, low, high, tonumber(def) or tonumber(low) or 0, 0) end
function brush_mt:add_real_tag(item, low, high, def, zeros) return tag(self, 'real', item, low, high, tonumber(def) or tonumber(low) or 0, zeros or 2) end
function brush_mt:add_string_tag(item, def) return tag(self, 'string', item, 0, 0, def == nil and '' or tostring(def)) end
function brush_mt:add_bool_tag(item, def) return tag(self, 'bool', item, 0, 0, def == true) end
function brush_mt:add_string_list_tag(item, ...)
	local vs = { ... }
	for k, v in ipairs(vs) do vs[k] = tostring(v) end
	return tag(self, 'list', item, 0, 0, vs[1] or '', 0, concat(vs, string.char(31)))
end
function brush_mt:add_null_tag() tag(self, 'null', '', 0, 0, '') end
function brush_mt:add_description(text) tag(self, 'description', text, 0, 0, '') end
function brush_mt:set_name(name)
	self._name = tostring(name)
	H.brush_name(self._i, self._name)
end
function brush_mt:get_name() return self._name end
function brush(name)
	name = tostring(name)
	local i = H.add_brush(name)
	local b = setmetatable({ _i = i, _name = name }, brush_mt)
	brushes[i] = b
	return b
end

local evt_mt = {}
evt_mt.__index = evt_mt
function evt_mt:pos() return copy(self._p) end
function evt_mt:outer_radius() return self._o end
function evt_mt:inner_radius() return self._in end
function evt_mt:dt() return self._dt end
function evt_mt:set_outer_radius(v)
	self._o = tonumber(v) or self._o
	H.set_radius(self._o, self._in)
end
function evt_mt:set_inner_radius(v)
	self._in = tonumber(v) or self._in
	H.set_radius(self._o, self._in)
end
local EVENTS = { 'left_click', 'left_hold', 'left_release', 'right_click', 'right_hold', 'right_release' }

-- Called by the app for each event of a stroke (ScriptSession.event); i counts brushes from 0.
function __meld_event(i, kind, x, y, z, outer, inner, dt)
	local b = brushes[i]
	local f = b and rawget(b, 'on_' .. kind)
	if not f then return end
	read_terrain()
	f(b, setmetatable({ _p = vec(x, y, z), _o = outer, _in = inner, _dt = dt }, evt_mt))
	flush()
end

-- Not in Meld yet: files (#761).
write_file = missing('write_file')
append_file = missing('append_file')
read_file = missing('read_file')
path_exists = missing('path_exists')

-- The script itself, then whatever its blocks still hold.
local chunk, err = load(H.code(), '=' .. H.name(), 't')
if not chunk then error(err, 0) end
chunk()
flush()
-- Which events each brush handles, for the tool.
for i, b in pairs(brushes) do
	local list = {}
	for _, k in ipairs(EVENTS) do
		if rawget(b, 'on_' .. k) then list[#list + 1] = k end
	end
	H.brush_handles(i, concat(list, ','))
end
`
