// The Go types as the page uses them, typed as Wails v2 typed them (#854). The bindings are generated
// as interfaces (make bindings, `-i`), so a reply is Go's JSON as it is, as in v2, and Svelte's $state
// makes it reactive (it does not with class instances). Those interfaces type a Go slice or map as
// `X | null`; v2 typed them without the null, which the page is written for, so they drop it here (a nil
// slice or map still arrives as null at run time, as it did in v2). Pointers stay `X | null`, and a map
// keeps Wails' key and value types (read it through lib/wails/maps.ts).

/** A Go value: a struct with its slice and map fields typed without null, recursively. */
export type V2<T> = T extends readonly (infer E)[] ? V2Value<E>[] : T extends object ? { [K in keyof T]: V2Value<T[K]> } : T

/** A field or a reply: as V2, and a slice or a map without its null. */
export type V2Value<F> = [Exclude<F, null | undefined>] extends [readonly unknown[]] ? V2<Exclude<F, null>> : IsMap<Exclude<F, null | undefined>> extends true ? V2<Exclude<F, null>> : V2<F>

/** Whether T is a Go map (keyed by any string or any number), not a struct. */
type IsMap<T> = [T] extends [object] ? (string extends keyof T ? true : `${number}` extends keyof T ? true : false) : false
