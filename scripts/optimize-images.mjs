// 이미지 최적화: public/images/*.png 원본은 보존하고 WebP/AVIF 변환본을 생성한다.
// 실행: node scripts/optimize-images.mjs
import sharp from 'sharp'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images')
const files = readdirSync(dir).filter((f) => f.endsWith('.png'))
const rows = []
for (const f of files) {
  const src = join(dir, f)
  const base = f.replace(/\.png$/, '')
  const meta = await sharp(src).metadata()
  // 최대 가로 2000px (원본은 1672 이하이므로 리사이즈 없음). 장식용이라 품질 82.
  await sharp(src).webp({ quality: 82, effort: 6 }).toFile(join(dir, base + '.webp'))
  await sharp(src).avif({ quality: 55, effort: 6 }).toFile(join(dir, base + '.avif'))
  // 작은 미리보기(카드/모바일용) 960px
  await sharp(src).resize({ width: 960, withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(dir, base + '-960.webp'))
  const s = (p) => statSync(p).size
  rows.push({ file: f, width: meta.width, height: meta.height, png: s(src), webp: s(join(dir, base + '.webp')), avif: s(join(dir, base + '.avif')), webp960: s(join(dir, base + '-960.webp')) })
  console.log(f, `${meta.width}x${meta.height}`, (s(src) / 1048576).toFixed(2) + 'MB →', (s(join(dir, base + '.webp')) / 1024).toFixed(0) + 'KB webp,', (s(join(dir, base + '.avif')) / 1024).toFixed(0) + 'KB avif')
}
writeFileSync(join(dir, 'optimization-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2))
