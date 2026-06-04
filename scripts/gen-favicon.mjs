// One-off: regenerate app/favicon.ico from app/icon.svg so the browser-tab icon
// matches the (now recentered) SVG mark. ICO with embedded PNGs (Vista+).
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = await readFile(join(root, 'app', 'icon.svg'))
const sizes = [16, 32, 48, 64, 128, 256]

const pngs = await Promise.all(
  sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer()),
)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(sizes.length, 4) // image count

const entries = []
let offset = 6 + 16 * sizes.length
sizes.forEach((size, i) => {
  const png = pngs[i]
  const e = Buffer.alloc(16)
  e.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 = 256)
  e.writeUInt8(size >= 256 ? 0 : size, 1) // height
  e.writeUInt8(0, 2) // palette
  e.writeUInt8(0, 3) // reserved
  e.writeUInt16LE(1, 4) // color planes
  e.writeUInt16LE(32, 6) // bits per pixel
  e.writeUInt32LE(png.length, 8) // size of image data
  e.writeUInt32LE(offset, 12) // offset of image data
  offset += png.length
  entries.push(e)
})

const ico = Buffer.concat([header, ...entries, ...pngs])
await writeFile(join(root, 'app', 'favicon.ico'), ico)
console.log(`favicon.ico: ${ico.length} bytes, sizes ${sizes.join('/')}`)
