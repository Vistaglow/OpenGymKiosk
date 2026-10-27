// phonon streams its WAV, so it cannot know the length when it writes the header: the RIFF size
// (offset 4) and the data chunk size are both 0xFFFFFFFF. Safari refuses a file like that, so
// the sizes are filled in from the bytes that actually arrived before the file is cached.

export function fixWavSizes(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file')
  }
  buf.writeUInt32LE(buf.length - 8, 4)
  // Walk the chunks to the data chunk rather than assume it sits at 36: a fmt chunk with an
  // extension, or a LIST chunk, would move it.
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'data') {
      // An odd trailing byte would be half a 16-bit sample; leave it out of the count.
      const bytes = buf.length - off - 8
      buf.writeUInt32LE(bytes - (bytes % 2), off + 4)
      return buf
    }
    if (size === 0xFFFFFFFF) break
    off += 8 + size + (size & 1)
  }
  throw new Error('WAV has no data chunk')
}
