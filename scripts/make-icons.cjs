// Generate the app icons (build/icon.png, icon.ico, icon.icns) from the
// SVG source (build/app-icon.svg). The generated files are git-ignored —
// this script runs in CI before electron-builder, and locally through
// `npm run icons` (chained into `npm run dist` / `npm run pack`).
'use strict'

const fs = require('fs')
const path = require('path')

async function main() {
  const sharp = require('sharp')
  const png2icons = require('png2icons')
  const buildDir = path.join(__dirname, '..', 'build')
  const svg = path.join(buildDir, 'app-icon.svg')

  const tmp1024 = path.join(buildDir, 'icon-1024.png')
  await sharp(svg, { density: 300 }).resize(1024, 1024).png().toFile(tmp1024)
  await sharp(svg, { density: 300 })
    .resize(512, 512)
    .png()
    .toFile(path.join(buildDir, 'icon.png'))

  const input = fs.readFileSync(tmp1024)
  const ico = png2icons.createICO(input, png2icons.BILINEAR, 0, true, true)
  if (!ico) throw new Error('ICO generation failed')
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico)

  const icns = png2icons.createICNS(input, png2icons.BILINEAR, 0)
  if (!icns) throw new Error('ICNS generation failed')
  fs.writeFileSync(path.join(buildDir, 'icon.icns'), icns)

  fs.unlinkSync(tmp1024)
  console.log('Icons generated: build/icon.png, build/icon.ico, build/icon.icns')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
