import { expect, test } from 'bun:test'
import { insertCode } from '../src/lib/wow/textCodes'

test('insertCode puts the code at the caret', () => {
	expect(insertCode('Hello, !', 7, 7, '$N')).toEqual({ value: 'Hello, $N!', caret: 9 })
})

test('insertCode replaces a selection', () => {
	expect(insertCode('Hello, X!', 7, 8, '$N')).toEqual({ value: 'Hello, $N!', caret: 9 })
})

test('insertCode clamps a caret past the end', () => {
	expect(insertCode('Hi', 50, 50, '$B')).toEqual({ value: 'Hi$B', caret: 4 })
})
