import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixWavSizes } from './wav.js'

// A header the way phonon streams it: both sizes unknown.
function streamed(dataBytes, { extraChunk = null } = {}) {
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'ascii'); fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10); fmt.writeUInt32LE(24000, 12)
  fmt.writeUInt32LE(48000, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22)
  const head = Buffer.alloc(12)
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(0xFFFFFFFF, 4); head.write('WAVE', 8, 'ascii')
  const data = Buffer.alloc(8)
  data.write('data', 0, 'ascii'); data.writeUInt32LE(0xFFFFFFFF, 4)
  return Buffer.concat([head, fmt, ...(extraChunk ? [extraChunk] : []), data, Buffer.alloc(dataBytes, 1)])
}

test('fills in both sizes from the bytes that arrived', () => {
  const b = fixWavSizes(streamed(1000))
  assert.equal(b.readUInt32LE(4), b.length - 8)
  assert.equal(b.readUInt32LE(40), 1000)
})

test('finds the data chunk after an extra chunk', () => {
  const list = Buffer.alloc(14)
  list.write('LIST', 0, 'ascii'); list.writeUInt32LE(6, 4)
  const b = fixWavSizes(streamed(500, { extraChunk: list }))
  assert.equal(b.toString('ascii', 50, 54), 'data')
  assert.equal(b.readUInt32LE(54), 500)
})

test('leaves an odd trailing byte out of the data size', () => {
  const b = fixWavSizes(streamed(1001))
  assert.equal(b.readUInt32LE(40), 1000)
})

test('refuses something that is not a WAV', () => {
  assert.throws(() => fixWavSizes(Buffer.from('<html>error page from a proxy</html>'.padEnd(60))), /not a WAV/)
})
