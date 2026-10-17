import type { InquiryRecord } from '@shared/domain/types'

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function exportRecordJson(record: InquiryRecord, meta: { nickname?: string; roomCode?: string; title?: string }) {
  const doc = { schema: 'earth-expedition-inquiry-v1', exportedAt: new Date().toISOString(), ...meta, record }
  downloadBlob(`earth-expedition-${meta.roomCode ?? 'local'}-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
}

export function parseRecordJson(text: string): InquiryRecord | null {
  try {
    const doc = JSON.parse(text) as { schema?: string; record?: InquiryRecord }
    if (doc.schema !== 'earth-expedition-inquiry-v1' || !doc.record || doc.record.version !== 1) return null
    const r = doc.record
    if (!Array.isArray(r.evidence) || !Array.isArray(r.history) || typeof r.stage !== 'string') return null
    return r
  } catch {
    return null
  }
}

/** 탐구 카드 PNG — 보고서의 핵심 정보와 두 지도를 한 장으로 */
export async function exportCardPng(opts: { title: string; nickname: string; firstImg: string | null; revisedImg: string | null; explanation: string; limitations: string; evidenceCount: number; datasetLine: string; sourcesLine: string }): Promise<Blob | null> {
  const W = 1400, H = 1000
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#07151e'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#d2af75'; ctx.font = '600 20px "Pretendard Variable", Pretendard, sans-serif'; ctx.fillText('EARTH ATELIER · 탐구 카드', 56, 64)
  ctx.fillStyle = '#f3f0e7'; ctx.font = '700 40px "Pretendard Variable", Pretendard, sans-serif'; ctx.fillText(opts.title, 56, 116)
  ctx.fillStyle = '#a8bcc4'; ctx.font = '400 20px "Pretendard Variable", Pretendard, sans-serif'; ctx.fillText(`${opts.nickname} · ${opts.datasetLine}`, 56, 150)
  const load = (src: string | null) => new Promise<HTMLImageElement | null>((res) => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src })
  const [a, b] = await Promise.all([load(opts.firstImg), load(opts.revisedImg)])
  const boxW = 630, boxH = 394
  const draw = (im: HTMLImageElement | null, x: number, label: string) => {
    ctx.fillStyle = '#0b2238'; ctx.fillRect(x, 190, boxW, boxH)
    if (im) ctx.drawImage(im, x, 190, boxW, boxH)
    ctx.strokeStyle = 'rgba(243,240,231,0.3)'; ctx.strokeRect(x + 0.5, 190.5, boxW - 1, boxH - 1)
    ctx.fillStyle = '#f3f0e7'; ctx.font = '600 20px "Pretendard Variable", Pretendard, sans-serif'; ctx.fillText(label, x, 614)
  }
  draw(a, 56, '처음 생각 (최초 추론)'); draw(b, 714, '수정한 생각 (수정 추론)')
  const wrap = (text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) => {
    ctx.font = '400 20px "Pretendard Variable", Pretendard, sans-serif'
    const words = text.replace(/\s+/g, ' ').trim()
    let line = '', lines = 0
    for (const ch of words) {
      const test = line + ch
      if (ctx.measureText(test).width > maxW) { ctx.fillText(line, x, y + lines * lineH); lines++; line = ch; if (lines >= maxLines) { ctx.fillText('…', x + ctx.measureText(line).width, y + (lines - 1) * lineH); return } }
      else line = test
    }
    if (line) ctx.fillText(line, x, y + lines * lineH)
  }
  ctx.fillStyle = '#d2af75'; ctx.font = '600 18px "Pretendard Variable", Pretendard, sans-serif'; ctx.fillText('나의 설명', 56, 672)
  ctx.fillStyle = '#f3f0e7'; wrap(opts.explanation || '아직 작성하지 않음', 56, 702, 1288, 30, 5)
  ctx.fillStyle = '#d2af75'; ctx.font = '600 18px "Pretendard Variable", Pretendard, sans-serif'; ctx.fillText('자료의 한계', 56, 872)
  ctx.fillStyle = '#f3f0e7'; wrap(opts.limitations || '아직 작성하지 않음', 56, 900, 1288, 28, 2)
  ctx.fillStyle = '#a8bcc4'; ctx.font = '400 15px "Pretendard Variable", Pretendard, sans-serif'; ctx.fillText(`관찰 증거 ${opts.evidenceCount}개 · ${opts.sourcesLine}`, 56, 972)
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
}
