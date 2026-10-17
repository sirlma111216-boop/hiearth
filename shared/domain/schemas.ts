import { z } from 'zod'
import { MAX_EVIDENCE, MAX_LINES, MAX_NICKNAME, MAX_POINTS_PER_LINE, MAX_TEXT, STAGES } from './types'

export const lngLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

export const guessLineSchema = z.object({
  id: z.string().min(1).max(40),
  points: z.array(lngLatSchema).min(2).max(MAX_POINTS_PER_LINE),
  mode: z.enum(['freehand', 'polyline']),
  rawPointCount: z.number().int().min(0).max(100_000),
})

export const guessSchema = z.object({
  lines: z.array(guessLineSchema).min(1).max(MAX_LINES),
})

export const viewStateSchema = z.object({
  center: lngLatSchema,
  zoom: z.number().min(0.5).max(64),
})

export const layerIdSchema = z.enum(['earthquakes', 'volcanoes', 'plates', 'myFirst', 'myRevised', 'others'])

export const evidenceSchema = z.object({
  id: z.string().min(1).max(40),
  createdAt: z.number().int().nonnegative(),
  title: z.string().max(60),
  note: z.string().max(300),
  view: viewStateSchema,
  mapMode: z.enum(['2d', '3d']),
  timeWindow: z.object({ start: z.number().int(), end: z.number().int() }).nullable(),
  minMagnitude: z.number().min(0).max(10),
  layers: z.array(layerIdSchema).max(6),
  selectedEventIds: z.array(z.string().max(64)).max(20),
  datasetVersion: z.string().max(80),
  // 캡처 PNG는 최대 약 600KB (data URL)
  capture: z.string().max(800_000).nullable(),
})

export const evidenceListSchema = z.array(evidenceSchema).max(MAX_EVIDENCE)

export const explanationSchema = z.object({
  text: z.string().max(MAX_TEXT),
  limitations: z.string().max(MAX_TEXT),
})

export const stageSchema = z.enum(STAGES)

/** 별명: 공백 정리, 태그 문자 제거, 길이 제한 */
export function sanitizeNickname(raw: string): string | null {
  const cleaned = raw
    .replace(/[<>&"'`\\/]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length === 0 || cleaned.length > MAX_NICKNAME) return null
  return cleaned
}

export const nicknameSchema = z.string().min(1).max(MAX_NICKNAME * 2)

export const joinRequestSchema = z.object({
  nickname: nicknameSchema,
  group: z.string().max(20).nullable().optional(),
})

export const roomSettingsSchema = z.object({
  title: z.string().min(1).max(60),
  datasetId: z.string().min(1).max(60),
  startRegion: z.string().min(1).max(30),
  maxParticipants: z.number().int().min(1).max(60),
  ttlMs: z
    .number()
    .int()
    .min(30 * 60 * 1000)
    .max(24 * 60 * 60 * 1000),
  groups: z.array(z.string().min(1).max(20)).max(12),
})

/** CSV 수식 주입 방지: =, +, -, @, 탭, CR 로 시작하는 셀은 작은따옴표를 앞에 붙인다 */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}
