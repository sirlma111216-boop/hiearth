// 이 기기의 로컬 탐구 기록 — 혼자 탐사 저장, 탐사실 임시 사본.
import type { InquiryRecord } from '@shared/domain/types'

const LOCAL_KEY = 'ee.local.inquiry.v1'
const ROOM_PREFIX = 'ee.room.'

export function loadLocalRecord(): InquiryRecord | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as InquiryRecord
    if (r?.version !== 1) return null
    return r
  } catch {
    return null
  }
}

export function saveLocalRecord(record: InquiryRecord) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(record)) } catch { /* 용량 초과 등은 무시 */ }
}

export function clearLocalRecord() {
  try { localStorage.removeItem(LOCAL_KEY) } catch { /* noop */ }
}

export interface RoomLocalInfo { code: string; participantId: string; nickname: string; joinedAt: number; title?: string }

export function saveRoomInfo(info: RoomLocalInfo) {
  try { localStorage.setItem(ROOM_PREFIX + info.code, JSON.stringify(info)) } catch { /* noop */ }
}
export function loadRoomInfo(code: string): RoomLocalInfo | null {
  try {
    const raw = localStorage.getItem(ROOM_PREFIX + code)
    return raw ? (JSON.parse(raw) as RoomLocalInfo) : null
  } catch {
    return null
  }
}
export function listRoomInfos(): RoomLocalInfo[] {
  const out: RoomLocalInfo[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(ROOM_PREFIX) && !k.startsWith(ROOM_PREFIX + 'record.')) {
        const raw = localStorage.getItem(k)
        if (raw) out.push(JSON.parse(raw) as RoomLocalInfo)
      }
    }
  } catch { /* noop */ }
  return out.sort((a, b) => b.joinedAt - a.joinedAt)
}

/** 탐사실의 내 기록 임시 사본 (오프라인 복구용) */
export function saveRoomRecord(code: string, record: InquiryRecord) {
  try { localStorage.setItem(ROOM_PREFIX + 'record.' + code, JSON.stringify(record)) } catch { /* noop */ }
}
export function loadRoomRecord(code: string): InquiryRecord | null {
  try {
    const raw = localStorage.getItem(ROOM_PREFIX + 'record.' + code)
    return raw ? (JSON.parse(raw) as InquiryRecord) : null
  } catch {
    return null
  }
}

export interface TeacherRoomInfo { code: string; title: string; createdAt: number; expiresAt: number }
const TEACHER_KEY = 'ee.teacher.rooms.v1'
export function listTeacherRooms(): TeacherRoomInfo[] {
  try { return (JSON.parse(localStorage.getItem(TEACHER_KEY) ?? '[]') as TeacherRoomInfo[]).filter((r) => r.expiresAt > Date.now()) } catch { return [] }
}
export function rememberTeacherRoom(info: TeacherRoomInfo) {
  const list = listTeacherRooms().filter((r) => r.code !== info.code)
  list.unshift(info)
  try { localStorage.setItem(TEACHER_KEY, JSON.stringify(list.slice(0, 8))) } catch { /* noop */ }
}
export function forgetTeacherRoom(code: string) {
  try { localStorage.setItem(TEACHER_KEY, JSON.stringify(listTeacherRooms().filter((r) => r.code !== code))) } catch { /* noop */ }
}

/** 이 기기의 모든 탐사 기록 지우기 (서버 사본과는 별개) */
export function clearAllLocal() {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('ee.')) keys.push(k) }
    for (const k of keys) if (k !== 'ee.settings.v1') localStorage.removeItem(k)
  } catch { /* noop */ }
}
