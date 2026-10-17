// 탐사실 WebSocket/HTTP 메시지 규약 (버전 1).
// 서버가 교실 상태의 권위를 갖는다. 클라이언트는 제출·명시적 공유 단위로만 보낸다.
import { z } from 'zod'
import { evidenceListSchema, explanationSchema, guessSchema, responsesSchema, screenRefSchema, stageSchema, viewStateSchema } from '../domain/schemas'
import type { InquiryRecord, ParticipantPublic, RoomMeta, SharedGuess, Stage } from '../domain/types'

export const PROTOCOL_VERSION = 1

const base = {
  v: z.literal(PROTOCOL_VERSION),
  clientMessageId: z.string().min(1).max(64),
}

export const studentMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('submitGuess'), kind: z.enum(['first', 'revised']), guess: guessSchema, idempotencyKey: z.string().min(8).max(64), datasetVersion: z.string().max(80) }),
  z.object({ ...base, type: z.literal('saveEvidence'), evidence: evidenceListSchema }),
  z.object({ ...base, type: z.literal('saveExplanation'), explanation: explanationSchema }),
  z.object({ ...base, type: z.literal('setGroup'), group: z.string().max(20).nullable() }),
  z.object({ ...base, type: z.literal('setStage'), stage: stageSchema }),
  z.object({ ...base, type: z.literal('saveResponses'), responses: responsesSchema }),
  z.object({ ...base, type: z.literal('resync') }),
])

export const teacherMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('teacher:setStage'), stage: stageSchema }),
  z.object({ ...base, type: z.literal('teacher:setScreen'), screen: screenRefSchema }),
  z.object({ ...base, type: z.literal('teacher:reveal'), what: z.enum(['firstGuesses', 'volcanoes', 'boundaries', 'nicknames']), value: z.boolean() }),
  z.object({ ...base, type: z.literal('teacher:lockInput'), locked: z.boolean() }),
  z.object({ ...base, type: z.literal('teacher:lockJoin'), locked: z.boolean() }),
  z.object({ ...base, type: z.literal('teacher:remove'), participantId: z.string().max(40) }),
  z.object({ ...base, type: z.literal('teacher:assignGroup'), participantId: z.string().max(40), group: z.string().max(20).nullable() }),
  z.object({ ...base, type: z.literal('teacher:setGroups'), groups: z.array(z.string().min(1).max(20)).max(12) }),
  z.object({ ...base, type: z.literal('teacher:highlight'), participantIds: z.array(z.string().max(40)).max(2) }),
  z.object({ ...base, type: z.literal('teacher:syncView'), view: viewStateSchema, mode: z.enum(['2d', '3d']), force: z.boolean() }),
  z.object({ ...base, type: z.literal('teacher:clearSyncView') }),
  z.object({ ...base, type: z.literal('teacher:end') }),
  z.object({ ...base, type: z.literal('resync') }),
])

export type StudentMessage = z.infer<typeof studentMessageSchema>
export type TeacherMessage = z.infer<typeof teacherMessageSchema>
export type ClientMessage = StudentMessage | TeacherMessage

export interface StudentSnapshot {
  type: 'snapshot'
  v: typeof PROTOCOL_VERSION
  role: 'student'
  serverTime: number
  roomRevision: number
  activityVersion: number
  room: RoomMeta
  me: ParticipantPublic
  record: InquiryRecord
  /** 공개 전에는 빈 배열. 공개 후에도 별명은 교사가 허용했을 때만 포함 */
  sharedGuesses: SharedGuess[]
  participantCount: number
}

export interface TeacherSnapshot {
  type: 'snapshot'
  v: typeof PROTOCOL_VERSION
  role: 'teacher'
  serverTime: number
  roomRevision: number
  activityVersion: number
  room: RoomMeta
  participants: ParticipantPublic[]
  sharedGuesses: SharedGuess[]
  highlighted: string[]
}

export type Snapshot = StudentSnapshot | TeacherSnapshot

export interface AckMessage {
  type: 'ack'
  v: typeof PROTOCOL_VERSION
  clientMessageId: string
  ok: boolean
  serverTime: number
  roomRevision: number
  /** 중복 제출이면 true (이미 저장된 것으로 처리) */
  duplicate?: boolean
  error?: { code: string; message: string }
}

export interface NoticeMessage {
  type: 'notice'
  v: typeof PROTOCOL_VERSION
  serverTime: number
  code: 'stageChanged' | 'screenChanged' | 'reveal' | 'followView' | 'inputLocked' | 'inputUnlocked' | 'ended' | 'expired' | 'removed' | 'deleted'
  stage?: Stage
  message: string
}

export type ServerMessage = Snapshot | AckMessage | NoticeMessage

export interface ErrorBody { error: { code: string; message: string } }
