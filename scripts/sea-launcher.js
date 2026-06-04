'use strict'

// SEA launcher embedded into reddit-reader.exe via postject.
// At runtime: cd next to the exe and boot the Next.js standalone server.
// The standalone directory (.next/standalone/) must live beside the exe.

const path = require('path')
const fs = require('fs')

const exeDir = path.dirname(process.execPath)
const standaloneDir = path.join(exeDir, '.next', 'standalone')
const serverEntry = path.join(standaloneDir, 'server.js')

if (!fs.existsSync(serverEntry)) {
  console.error(`reddit-reader: missing ${serverEntry}`)
  console.error('Run `npm run build:exe` to (re)build the standalone bundle.')
  process.exit(1)
}

process.chdir(standaloneDir)

if (!process.env.PORT) process.env.PORT = '3000'
if (!process.env.HOSTNAME) process.env.HOSTNAME = '127.0.0.1'

console.log(`reddit-reader: starting on http://${process.env.HOSTNAME}:${process.env.PORT}`)

require(serverEntry)
