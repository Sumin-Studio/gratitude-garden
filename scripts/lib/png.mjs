// A tiny PNG reader and writer (8-bit RGBA / RGB, non-interlaced), so the
// icon scripts need no image library.
import zlib from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** { width, height, data: Uint8Array RGBA } */
export function readPng(buf) {
  let o = 8
  let width = 0
  let height = 0
  let type = 6
  const idat = []
  while (o < buf.length) {
    const len = buf.readUInt32BE(o)
    const name = buf.toString('latin1', o + 4, o + 8)
    const body = buf.subarray(o + 8, o + 8 + len)
    if (name === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[12] !== 0) throw new Error('only 8-bit non-interlaced PNGs')
      type = body[9]
    } else if (name === 'IDAT') idat.push(body)
    o += 12 + len
  }
  const ch = type === 6 ? 4 : type === 2 ? 3 : 0
  if (!ch) throw new Error(`PNG colour type ${type} not handled`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * ch
  const px = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0
      const b = y ? px[row - stride + x] : 0
      const c = x >= ch && y ? px[row - stride + x - ch] : 0
      let v = src[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[row + x] = v & 255
    }
  }
  if (ch === 4) return { width, height, data: px }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data.set(px.subarray(i * 3, i * 3 + 3), i * 4)
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}

export function writePng({ width, height, data }) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  const chunk = (type, body) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length)
    const td = Buffer.concat([Buffer.from(type), body])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}
