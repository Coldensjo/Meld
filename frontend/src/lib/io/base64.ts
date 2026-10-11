// Fast-ish base64 for large typed arrays (the Wails bridge speaks JSON).

type B64Uint8 = Uint8Array & { toBase64?: () => string }
type B64Ctor = typeof Uint8Array & { fromBase64?: (s: string) => Uint8Array }

export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as B64Uint8).toBase64
  if (native) return native.call(bytes)
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[])
  }
  return btoa(s)
}

export function base64ToBytes(b64: string): Uint8Array {
  const native = (Uint8Array as B64Ctor).fromBase64
  if (native) return native(b64)
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
