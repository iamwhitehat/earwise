// Generate the Windows app icon (terracotta "Gap" mark) into build/ as both
// a PNG (window/tray) and an ICO (the packaged .exe icon).
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'build')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="3" y="3" width="18" height="18" rx="5.6" fill="none" stroke="#d97757" stroke-width="3"/>
  <circle cx="12" cy="12" r="3" fill="#1f1a17"/>
</svg>`

await mkdir(outDir, { recursive: true })

// 256px PNG for the window / tray icon.
const png = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer()
await writeFile(path.join(outDir, 'icon.png'), png)

// ICO: wrap the 256px PNG in an ICO container (valid single-image icon — PNG
// data is a legal ICO payload, so no separate rasterizer is needed).
function toIco(pngBuf) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count

  const entry = Buffer.alloc(16)
  entry[0] = 0 // width 256 → 0 means 256
  entry[1] = 0 // height 256 → 0 means 256
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8) // bytes in resource
  entry.writeUInt32LE(6 + 16, 12) // offset to image data

  return Buffer.concat([header, entry, pngBuf])
}

await writeFile(path.join(outDir, 'icon.ico'), toIco(png))

console.log('wrote build/icon.png (256px) + build/icon.ico')
