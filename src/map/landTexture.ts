// 3D 지구본용 표면 텍스처 — Natural Earth 육지 자료를 정거원통 도법으로 그린다.
import { geoEquirectangular, geoPath, geoGraticule } from 'd3-geo'
import { MAP_COLORS } from './colors'
import type { LandData } from './types'

let cached: { key: string; canvas: HTMLCanvasElement } | null = null

export function buildLandTexture(land: LandData, width = 4096): HTMLCanvasElement {
  const key = `${width}`
  if (cached && cached.key === key) return cached.canvas
  const height = width / 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const projection = geoEquirectangular().scale(width / (2 * Math.PI)).translate([width / 2, height / 2])
  const path = geoPath(projection, ctx)
  // 바다: 약간의 깊이감
  const grad = ctx.createLinearGradient(0, 0, 0, height)
  grad.addColorStop(0, '#0a2034')
  grad.addColorStop(0.5, MAP_COLORS.ocean)
  grad.addColorStop(1, '#0a2034')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)
  ctx.beginPath()
  path(geoGraticule().step([30, 30])())
  ctx.strokeStyle = 'rgba(168,188,196,0.12)'
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.beginPath()
  path(land.high)
  ctx.fillStyle = MAP_COLORS.land
  ctx.fill()
  ctx.strokeStyle = MAP_COLORS.landEdge
  ctx.lineWidth = 1.6
  ctx.stroke()
  cached = { key, canvas }
  return canvas
}
