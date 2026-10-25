// P.texture (#317): a client texture as a picture for P.save and P.diff; the alpha view differs from the colour view.
// touches: frontend/probes/lib.js, internal/wow/blp.go
const path = 'Textures\\Weather\\RainDropSplash01.blp'
const color = await P.texture(path)
const alpha = await P.texture(path, { alpha: true })
const small = await P.texture(path, { size: 64 })
P.save(color, 'color')
P.save(alpha, 'alpha')
const d = P.diff(color, alpha)
let grey = true
for (let i = 0; i < alpha.px.length; i += 4) if (alpha.px[i] !== alpha.px[i + 1] || alpha.px[i] !== alpha.px[i + 2]) grey = false
return {
	ok: color.w > 0 && color.h > 0 && color.px.length === color.w * color.h * 4 && small.w === 64 && small.h === 64 && grey && d.off > 0,
	size: [color.w, color.h],
	lit: [color.lit, alpha.lit],
	diff: d,
}
