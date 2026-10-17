// HTTP API 호출 — 오류는 한국어 메시지로 변환한다.
import type { RoomMeta, RoomSettings, InquiryRecord, ParticipantPublic } from '@shared/domain/types'
import type { StudentSnapshot, TeacherSnapshot } from '@shared/protocol/messages'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })
  } catch {
    throw new ApiError(0, 'network', '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.')
  }
  const text = await res.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { /* 비 JSON 응답 */ }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } })?.error
    throw new ApiError(res.status, err?.code ?? 'http', err?.message ?? `요청에 실패했습니다 (${res.status}).`)
  }
  return body as T
}

export interface RoomInfo { code: string; title: string; status: string; stage: string; joinLocked: boolean; participantCount: number; maxParticipants: number; groups: string[]; expiresAt: number; startRegion: string; datasetId: string }

export const api = {
  roomInfo: (code: string) => call<RoomInfo>(`/api/rooms/${code}`),
  join: (code: string, nickname: string, group: string | null) => call<{ code: string; participantId: string; nickname: string; group: string | null; reconnected: boolean; expiresAt: number }>(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ nickname, group }) }),
  me: (code: string) => call<StudentSnapshot>(`/api/rooms/${code}/me`),
  leave: (code: string) => call<{ left: boolean }>(`/api/rooms/${code}/leave`, { method: 'POST' }),
  report: (code: string, participantId: string) => call<{ room: RoomMeta; participant: ParticipantPublic; record: InquiryRecord }>(`/api/rooms/${code}/report/${participantId}`),
  createRoom: (teacherKey: string, settings: RoomSettings) => call<{ code: string; meta: RoomMeta; recoveryToken: string }>(`/api/teach/rooms`, { method: 'POST', headers: { 'x-teacher-key': teacherKey }, body: JSON.stringify({ settings }) }),
  recover: (code: string, recoveryToken: string) => call<{ code: string; meta: RoomMeta }>(`/api/teach/rooms/${code}/recover`, { method: 'POST', body: JSON.stringify({ recoveryToken }) }),
  teacherState: (code: string) => call<TeacherSnapshot>(`/api/teach/rooms/${code}/state`),
  teacherRecords: (code: string) => call<{ room: RoomMeta; records: { participant: ParticipantPublic; record: InquiryRecord }[] }>(`/api/teach/rooms/${code}/records`),
  deleteRoom: (code: string) => call<{ deleted: boolean }>(`/api/teach/rooms/${code}`, { method: 'DELETE' }),
  exportUrl: (code: string, format: 'csv' | 'json') => `/api/teach/rooms/${code}/export?format=${format}`,
}
