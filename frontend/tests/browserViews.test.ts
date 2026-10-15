// Run with: node --import ./tests/register.mjs --test tests/browserViews.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readView, writeView } from '../src/lib/wow/browserViews.ts'

test('each tab keeps its own view', () => {
  let views = writeView({}, 'm2', { zone: 'Durotar', category: 'Trees' })
  views = writeView(views, 'tex', { query: 'grass' })
  assert.deepEqual(readView(views, 'm2'), { query: '', category: 'Trees', zone: 'Durotar', scroll: 0 })
  assert.deepEqual(readView(views, 'tex'), { query: 'grass', category: '', zone: '', scroll: 0 })
  assert.deepEqual(readView(views, 'wmo'), { query: '', category: '', zone: '', scroll: 0 }, 'a tab never used starts empty')
})

test('an unchanged write keeps the same object', () => {
  const views = writeView({}, 'm2', { scroll: 120 })
  assert.equal(writeView(views, 'm2', { scroll: 120 }), views)
  assert.notEqual(writeView(views, 'm2', { scroll: 121 }), views)
})

test('anything odd in the config file reads as an empty view', () => {
  assert.equal(readView(null, 'm2').zone, '')
  assert.equal(readView([], 'm2').zone, '')
  assert.deepEqual(readView({ m2: { query: 3, zone: 'Elwynn', scroll: -5 } }, 'm2'), { query: '', category: '', zone: 'Elwynn', scroll: 0 })
  assert.equal(readView({ m2: { scroll: Number.NaN } }, 'm2').scroll, 0)
})
