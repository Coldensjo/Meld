import type { WorldObject } from './ObjectLayer'

/**
 * The text form of a list of models, one per line, tab-separated: type, x, z, height above the
 * ground, turn in radians, scale. Tabs (not spaces) separate the fields, because model paths can
 * contain spaces. Lines starting with '#' are comments.
 */
export const OBJECT_LIST_HEADER = '# WorldEditor object list: type, x, z, height above ground, turn (radians), scale'

/** The models that stand on their own (attached models are placed relative to their parent, so they're left out). */
export function formatObjectList(objects: Iterable<WorldObject>): string {
  const lines = [OBJECT_LIST_HEADER]
  for (const o of objects) {
    if (o.parent !== undefined) continue
    lines.push([o.type, o.x, o.z, o.yOff, o.rotY, o.scale].join('\t'))
  }
  return lines.join('\n') + '\n'
}

export interface ParsedObjectList {
  objects: Array<Omit<WorldObject, 'id'>>
  /** One message per line that couldn't be read, with its line number. */
  errors: string[]
}

export function parseObjectList(text: string): ParsedObjectList {
  const objects: Array<Omit<WorldObject, 'id'>> = []
  const errors: string[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return
    const f = raw.split('\t')
    if (f.length !== 6) {
      errors.push(`line ${i + 1}: expected 6 tab-separated fields, found ${f.length}`)
      return
    }
    const [type, x, z, yOff, rotY, scale] = f.map((s) => s.trim())
    if (!type.startsWith('m2:') && !type.startsWith('wmo:')) {
      errors.push(`line ${i + 1}: "${type}" is not a model`)
      return
    }
    const nums = [x, z, yOff, rotY, scale].map(Number)
    if (nums.some((n, k) => (k === 4 ? !(n > 0) : !Number.isFinite(n)))) {
      errors.push(`line ${i + 1}: a number is missing or not valid`)
      return
    }
    const [px, pz, py, prot, pscale] = nums
    objects.push({ type, x: px, z: pz, yOff: py, rotY: prot, scale: pscale })
  })
  return { objects, errors }
}
