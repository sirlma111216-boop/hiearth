// 탐사실 Durable Object — 탐사실 하나 = 객체 하나 (입장 코드로 이름을 짓는다).
// SQLite에 필수 상태를 저장하고 WebSocket Hibernation으로 접속을 유지한다.
import { DurableObject } from 'cloudflare:workers'
import type { InquiryRecord, ParticipantPublic, RoomMeta, RoomSettings, SharedGuess, Stage, GuessRevision, Guess, Evidence } from '@shared/domain/types'
import { MAX_EVIDENCE } from '@shared/domain/types'
import { emptyRecord, isStage, stageIndex } from '@shared/domain/activity'
import { FIRST_SCREEN, isValidScreen, screenStage, screenLabel } from '@shared/domain/lesson'
import { csvCell, joinRequestSchema, roomSettingsSchema, sanitizeNickname } from '@shared/domain/schemas'
import { checklist } from '@shared/domain/activity'
import { studentMessageSchema, teacherMessageSchema, PROTOCOL_VERSION, type AckMessage, type NoticeMessage, type StudentSnapshot, type TeacherSnapshot, type ServerMessage } from '@shared/protocol/messages'
import { randomToken, sha256Hex } from './auth'

export interface Env {
  ROOM: DurableObjectNamespace<RoomDO>
  TEACHER_SECRET?: string
  APP_ENV?: string
}

const ACTIVITY_VERSION = 1
const MAX_MESSAGE_BYTES = 1_600_000
const BROADCAST_DELAY_MS = 150
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

interface Attachment {
  role: 'teacher' | 'student'
  participantId: string | null
  sessionHash: string
}

type ParticipantRow = {
  id: string
  nickname: string
  grp: string | null
  joined_at: number
  last_seen: number
  removed: number
  record: string
  highlighted: number
  [key: string]: string | number | null
}

type Role = 'teacher' | 'student'

export class RoomDO extends DurableObject<Env> {
  private meta: RoomMeta | null | undefined = undefined
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null
  private joinAttempts: { count: number; windowStart: number } = { count: 0, windowStart: 0 }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // 생성자는 최소 작업만: 스키마 보장. Hibernation 후에도 안전하게 재실행된다.
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY, nickname TEXT NOT NULL, grp TEXT, joined_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL, removed INTEGER NOT NULL DEFAULT 0, record TEXT NOT NULL, highlighted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY, role TEXT NOT NULL, participant_id TEXT, created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS guesses (
        participant_id TEXT NOT NULL, kind TEXT NOT NULL, idem TEXT NOT NULL, submitted_at INTEGER NOT NULL,
        dataset_version TEXT NOT NULL, guess TEXT NOT NULL, PRIMARY KEY (participant_id, kind));
      CREATE TABLE IF NOT EXISTS idem (key TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, type TEXT NOT NULL, detail TEXT);
    `)
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  // ---------- 상태 로드/저장 ----------
  private loadMeta(): RoomMeta | null {
    // 항상 저장소에서 읽는다: Hibernation·알람 이후 메모리 캐시가 오래될 수 있다
    const row = this.ctx.storage.sql.exec<{ v: string }>(`SELECT v FROM kv WHERE k = 'meta'`).toArray()[0]
    const meta = row ? (JSON.parse(row.v) as RoomMeta) : null
    // 이전 버전에서 만든 탐사실: 화면 정보가 없으면 첫 화면으로
    if (meta && !meta.screen) meta.screen = { ...FIRST_SCREEN }
    this.meta = meta
    return this.meta
  }

  private saveMeta(meta: RoomMeta) {
    this.meta = meta
    this.ctx.storage.sql.exec(`INSERT INTO kv (k, v) VALUES ('meta', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, JSON.stringify(meta))
  }

  private bump(meta: RoomMeta, patch: Partial<RoomMeta>): RoomMeta {
    const next = { ...meta, ...patch, roomRevision: meta.roomRevision + 1 }
    this.saveMeta(next)
    return next
  }

  private log(actor: string, type: string, detail?: unknown) {
    this.ctx.storage.sql.exec(`INSERT INTO log (at, actor, type, detail) VALUES (?, ?, ?, ?)`, Date.now(), actor, type, detail == null ? null : JSON.stringify(detail).slice(0, 2000))
  }

  // ---------- HTTP 진입점 (Worker 내부 호출 전용) ----------
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    try {
      if (request.headers.get('upgrade') === 'websocket') return await this.handleWebSocket(request)
      if (path === '/create' && request.method === 'POST') return await this.create(request)
      if (path === '/info') return this.info()
      if (path === '/join' && request.method === 'POST') return await this.join(request)
      if (path === '/recover' && request.method === 'POST') return await this.recover(request)
      if (path === '/me') return await this.me(request)
      if (path === '/teacher/state') return await this.teacherState(request)
      if (path === '/teacher/records') return await this.teacherRecords(request)
      if (path === '/teacher/export') return await this.teacherExport(request, url.searchParams.get('format') ?? 'json')
      if (path === '/teacher/delete' && request.method === 'POST') return await this.teacherDelete(request)
      if (path.startsWith('/report/')) return await this.report(request, path.slice('/report/'.length))
      return this.err(404, 'notFound', '없는 경로입니다.')
    } catch (e) {
      if (e instanceof RoomError) return this.err(e.status, e.code, e.message)
      console.error('RoomDO error', e)
      return this.err(500, 'internal', '탐사실 처리 중 오류가 났습니다.')
    }
  }

  private err(status: number, code: string, message: string): Response {
    return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
  }
  private ok(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
  }

  // ---------- 생성 ----------
  private async create(request: Request): Promise<Response> {
    const existing = this.loadMeta()
    const now = Date.now()
    if (existing && existing.status !== 'deleted' && existing.expiresAt > now) {
      return this.err(409, 'codeTaken', '이미 사용 중인 코드입니다.')
    }
    const body = (await request.json()) as { code: string; settings: RoomSettings }
    const parsed = roomSettingsSchema.safeParse(body.settings)
    if (!parsed.success) throw new RoomError(400, 'badSettings', '탐사실 설정이 올바르지 않습니다.')
    const s = parsed.data
    // 이전 기록이 남아 있으면 정리
    await this.wipe()
    const meta: RoomMeta = {
      code: body.code,
      title: s.title.trim(),
      datasetId: s.datasetId,
      startRegion: s.startRegion,
      maxParticipants: s.maxParticipants,
      groups: s.groups,
      createdAt: now,
      expiresAt: now + s.ttlMs,
      endedAt: null,
      status: 'open',
      stage: 'observe',
      joinLocked: false,
      inputLocked: false,
      revealed: { firstGuesses: false, volcanoes: false, boundaries: false, nicknames: false },
      followView: null,
      screen: { ...FIRST_SCREEN },
      activityVersion: ACTIVITY_VERSION,
      roomRevision: 1,
    }
    this.saveMeta(meta)
    const session = await this.issueSession('teacher', null, meta.expiresAt)
    const recoveryToken = randomToken(24)
    const recoveryHash = await sha256Hex('recover:' + recoveryToken)
    this.ctx.storage.sql.exec(`INSERT INTO kv (k, v) VALUES ('recovery', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, recoveryHash)
    await this.ctx.storage.setAlarm(meta.expiresAt)
    this.log('teacher', 'create', { title: meta.title })
    return this.ok({ meta, sessionToken: session, recoveryToken })
  }

  private async wipe() {
    const sql = this.ctx.storage.sql
    sql.exec(`DELETE FROM participants`)
    sql.exec(`DELETE FROM sessions`)
    sql.exec(`DELETE FROM guesses`)
    sql.exec(`DELETE FROM idem`)
    sql.exec(`DELETE FROM log`)
    sql.exec(`DELETE FROM kv`)
    this.meta = null
  }

  private async issueSession(role: Role, participantId: string | null, expiresAt: number): Promise<string> {
    const token = randomToken(32)
    const hash = await sha256Hex(token)
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (hash, role, participant_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      hash, role, participantId, Date.now(), Math.min(expiresAt, Date.now() + SESSION_TTL_MS),
    )
    return token
  }

  private async verifySession(token: string | null, role: Role): Promise<{ hash: string; participantId: string | null } | null> {
    if (!token) return null
    const hash = await sha256Hex(token)
    const row = this.ctx.storage.sql
      .exec<{ hash: string; role: string; participant_id: string | null; expires_at: number; revoked: number }>(`SELECT * FROM sessions WHERE hash = ?`, hash)
      .toArray()[0]
    if (!row || row.role !== role || row.revoked || row.expires_at < Date.now()) return null
    if (role === 'student' && row.participant_id) {
      const p = this.participantRow(row.participant_id)
      if (!p || p.removed) return null
    }
    return { hash, participantId: row.participant_id }
  }

  private requireLive(): RoomMeta {
    const meta = this.loadMeta()
    if (!meta || meta.status === 'deleted') throw new RoomError(404, 'noRoom', '탐사실이 없습니다. 코드를 다시 확인하세요.')
    if (meta.expiresAt <= Date.now()) throw new RoomError(410, 'expired', '탐사실이 만료되었습니다.')
    return meta
  }

  private async requireTeacher(request: Request): Promise<RoomMeta> {
    const meta = this.requireLive()
    const s = await this.verifySession(request.headers.get('x-ee-teacher-token'), 'teacher')
    if (!s) throw new RoomError(401, 'teacherAuth', '교사 권한이 없습니다. 복구 코드로 다시 들어오세요.')
    return meta
  }

  private async requireStudent(request: Request): Promise<{ meta: RoomMeta; participantId: string }> {
    const meta = this.requireLive()
    const s = await this.verifySession(request.headers.get('x-ee-participant-token'), 'student')
    if (!s || !s.participantId) throw new RoomError(401, 'participantAuth', '입장 정보가 없습니다. 코드와 별명으로 다시 입장하세요.')
    return { meta, participantId: s.participantId }
  }

  // ---------- 공개 정보 ----------
  private info(): Response {
    const meta = this.loadMeta()
    const now = Date.now()
    if (!meta || meta.status === 'deleted' || meta.expiresAt <= now) return this.err(404, 'noRoom', '탐사실이 없습니다. 코드를 다시 확인하세요.')
    return this.ok({
      code: meta.code,
      title: meta.title,
      status: meta.status,
      stage: meta.stage,
      joinLocked: meta.joinLocked,
      participantCount: this.activeParticipants().length,
      maxParticipants: meta.maxParticipants,
      groups: meta.groups,
      expiresAt: meta.expiresAt,
      startRegion: meta.startRegion,
      datasetId: meta.datasetId,
    })
  }

  // ---------- 입장 ----------
  private async join(request: Request): Promise<Response> {
    const meta = this.requireLive()
    // DO 단위 입장 시도 제한: 분당 120회
    const now = Date.now()
    if (now - this.joinAttempts.windowStart > 60_000) this.joinAttempts = { count: 0, windowStart: now }
    if (++this.joinAttempts.count > 120) throw new RoomError(429, 'tooManyJoins', '입장 시도가 너무 많습니다. 잠시 후 다시 시도하세요.')

    // 기존 세션으로 재입장(복구)
    const existing = await this.verifySession(request.headers.get('x-ee-participant-token'), 'student')
    if (existing?.participantId) {
      const p = this.participantRow(existing.participantId)
      if (p && !p.removed) {
        this.ctx.storage.sql.exec(`UPDATE participants SET last_seen = ? WHERE id = ?`, now, p.id)
        return this.ok({ participantId: p.id, nickname: p.nickname, group: p.grp, reconnected: true, sessionToken: null, expiresAt: meta.expiresAt })
      }
    }
    if (meta.status !== 'open') throw new RoomError(409, 'ended', '종료된 탐사실입니다.')
    if (meta.joinLocked) throw new RoomError(423, 'joinLocked', '선생님이 입장을 잠갔습니다.')
    const body = joinRequestSchema.safeParse(await request.json())
    if (!body.success) throw new RoomError(400, 'badJoin', '별명을 확인하세요.')
    const nickname = sanitizeNickname(body.data.nickname)
    if (!nickname) throw new RoomError(400, 'badNickname', '별명은 1~12자이며 특수문자를 쓸 수 없습니다.')
    const active = this.activeParticipants()
    if (active.length >= meta.maxParticipants) throw new RoomError(409, 'full', `참여 인원이 가득 찼습니다. (최대 ${meta.maxParticipants}명)`)
    let group = body.data.group ?? null
    if (group && !meta.groups.includes(group)) group = null
    const id = 'p_' + randomToken(9)
    const record = emptyRecord('')
    this.ctx.storage.sql.exec(
      `INSERT INTO participants (id, nickname, grp, joined_at, last_seen, removed, record, highlighted) VALUES (?, ?, ?, ?, ?, 0, ?, 0)`,
      id, nickname, group, now, now, JSON.stringify(record),
    )
    const sessionToken = await this.issueSession('student', id, meta.expiresAt)
    this.log(id, 'join', { nickname, group })
    this.touch()
    return this.ok({ participantId: id, nickname, group, reconnected: false, sessionToken, expiresAt: meta.expiresAt })
  }

  private async recover(request: Request): Promise<Response> {
    const meta = this.requireLive()
    const body = (await request.json()) as { recoveryToken?: string }
    const token = typeof body.recoveryToken === 'string' ? body.recoveryToken.trim() : ''
    if (!token) throw new RoomError(400, 'badRecovery', '복구 코드를 입력하세요.')
    const stored = this.ctx.storage.sql.exec<{ v: string }>(`SELECT v FROM kv WHERE k = 'recovery'`).toArray()[0]?.v
    const hash = await sha256Hex('recover:' + token)
    if (!stored || stored !== hash) throw new RoomError(401, 'badRecovery', '복구 코드가 맞지 않습니다.')
    const sessionToken = await this.issueSession('teacher', null, meta.expiresAt)
    this.log('teacher', 'recover')
    return this.ok({ meta, sessionToken })
  }

  private async me(request: Request): Promise<Response> {
    const { meta, participantId } = await this.requireStudent(request)
    return this.ok(this.studentSnapshot(meta, participantId))
  }

  // ---------- 참가자 조회 ----------
  private participantRow(id: string): ParticipantRow | undefined {
    return this.ctx.storage.sql.exec<ParticipantRow>(`SELECT * FROM participants WHERE id = ?`, id).toArray()[0]
  }
  private activeParticipants(): ParticipantRow[] {
    return this.ctx.storage.sql.exec<ParticipantRow>(`SELECT * FROM participants WHERE removed = 0 ORDER BY joined_at ASC`).toArray()
  }
  private guessRows(participantId?: string): { participant_id: string; kind: string; idem: string; submitted_at: number; dataset_version: string; guess: string }[] {
    const sql = this.ctx.storage.sql
    return participantId
      ? sql.exec<{ participant_id: string; kind: string; idem: string; submitted_at: number; dataset_version: string; guess: string }>(`SELECT * FROM guesses WHERE participant_id = ?`, participantId).toArray()
      : sql.exec<{ participant_id: string; kind: string; idem: string; submitted_at: number; dataset_version: string; guess: string }>(`SELECT * FROM guesses`).toArray()
  }

  private connectedIds(): Set<string> {
    const set = new Set<string>()
    for (const ws of this.ctx.getWebSockets('student')) {
      const a = ws.deserializeAttachment() as Attachment | null
      if (a?.participantId) set.add(a.participantId)
    }
    return set
  }

  private publicParticipant(p: ParticipantRow, connected: Set<string>, guesses: Map<string, { first?: GuessRevision; revised?: GuessRevision }>): ParticipantPublic {
    const rec = JSON.parse(p.record) as InquiryRecord
    const g = guesses.get(p.id)
    return {
      id: p.id,
      nickname: p.nickname,
      group: p.grp,
      joinedAt: p.joined_at,
      connected: connected.has(p.id),
      lastSeen: p.last_seen,
      hasFirst: !!g?.first,
      hasRevised: !!g?.revised,
      evidenceCount: rec.evidence.length,
      hasExplanation: !!rec.explanation?.text.trim(),
      highlighted: p.highlighted === 1,
    }
  }

  private guessMap(participantId?: string): Map<string, { first?: GuessRevision; revised?: GuessRevision }> {
    const map = new Map<string, { first?: GuessRevision; revised?: GuessRevision }>()
    for (const r of this.guessRows(participantId)) {
      const entry = map.get(r.participant_id) ?? {}
      const rev: GuessRevision = { kind: r.kind as 'first' | 'revised', guess: JSON.parse(r.guess) as Guess, submittedAt: r.submitted_at, idempotencyKey: r.idem, datasetVersion: r.dataset_version }
      if (r.kind === 'first') entry.first = rev
      else entry.revised = rev
      map.set(r.participant_id, entry)
    }
    return map
  }

  private fullRecord(p: ParticipantRow, guesses: Map<string, { first?: GuessRevision; revised?: GuessRevision }>): InquiryRecord {
    const rec = JSON.parse(p.record) as InquiryRecord
    const g = guesses.get(p.id)
    return { ...rec, firstGuess: g?.first ?? null, revisedGuess: g?.revised ?? null }
  }

  private sharedGuesses(meta: RoomMeta, forTeacher: boolean): SharedGuess[] {
    if (!forTeacher && !meta.revealed.firstGuesses) return []
    const out: SharedGuess[] = []
    const parts = this.activeParticipants()
    const guesses = this.guessMap()
    for (const p of parts) {
      const g = guesses.get(p.id)
      if (!g) continue
      const nick = forTeacher || meta.revealed.nicknames ? p.nickname : null
      if (g.first) out.push({ participantId: p.id, nickname: nick, group: p.grp, kind: 'first', guess: g.first.guess, submittedAt: g.first.submittedAt })
      if (g.revised) out.push({ participantId: p.id, nickname: nick, group: p.grp, kind: 'revised', guess: g.revised.guess, submittedAt: g.revised.submittedAt })
    }
    return out
  }

  private studentSnapshot(meta: RoomMeta, participantId: string): StudentSnapshot {
    const p = this.participantRow(participantId)
    if (!p || p.removed) throw new RoomError(404, 'removed', '탐사실에서 내보내졌습니다.')
    const guesses = this.guessMap(participantId)
    const record = this.fullRecord(p, guesses)
    const connected = this.connectedIds()
    return {
      type: 'snapshot', v: PROTOCOL_VERSION, role: 'student', serverTime: Date.now(),
      roomRevision: meta.roomRevision, activityVersion: meta.activityVersion,
      room: meta, me: this.publicParticipant(p, connected, guesses), record,
      sharedGuesses: this.sharedGuesses(meta, false),
      participantCount: this.activeParticipants().length,
    }
  }

  private teacherSnapshot(meta: RoomMeta): TeacherSnapshot {
    const connected = this.connectedIds()
    const guesses = this.guessMap()
    const parts = this.activeParticipants().map((p) => this.publicParticipant(p, connected, guesses))
    return {
      type: 'snapshot', v: PROTOCOL_VERSION, role: 'teacher', serverTime: Date.now(),
      roomRevision: meta.roomRevision, activityVersion: meta.activityVersion,
      room: meta, participants: parts, sharedGuesses: this.sharedGuesses(meta, true),
      highlighted: parts.filter((p) => p.highlighted).map((p) => p.id),
    }
  }

  // ---------- 교사 HTTP ----------
  private async teacherState(request: Request): Promise<Response> {
    const meta = await this.requireTeacher(request)
    return this.ok(this.teacherSnapshot(meta))
  }

  private async teacherRecords(request: Request): Promise<Response> {
    const meta = await this.requireTeacher(request)
    const guesses = this.guessMap()
    const connected = this.connectedIds()
    const records = this.activeParticipants().map((p) => ({ participant: this.publicParticipant(p, connected, guesses), record: this.fullRecord(p, guesses) }))
    return this.ok({ room: meta, records })
  }

  private async teacherExport(request: Request, format: string): Promise<Response> {
    const meta = await this.requireTeacher(request)
    const guesses = this.guessMap()
    const connected = this.connectedIds()
    const rows = this.activeParticipants().map((p) => ({ participant: this.publicParticipant(p, connected, guesses), record: this.fullRecord(p, guesses) }))
    if (format === 'csv') {
      const header = ['별명', '모둠', '입장시각(UTC)', '최초추론 제출', '최초 선 개수', '수정추론 제출', '수정 선 개수', '증거 수', '설명', '자료의 한계', '관찰근거 있음', '화산자료 고려', '설명 수정', '한계 작성']
      const lines = [header.map(csvCell).join(',')]
      for (const { participant: p, record: r } of rows) {
        const c = checklist(r)
        lines.push([
          p.nickname, p.group ?? '', new Date(p.joinedAt).toISOString(),
          r.firstGuess ? new Date(r.firstGuess.submittedAt).toISOString() : '', r.firstGuess?.guess.lines.length ?? 0,
          r.revisedGuess ? new Date(r.revisedGuess.submittedAt).toISOString() : '', r.revisedGuess?.guess.lines.length ?? 0,
          r.evidence.length, r.explanation?.text ?? '', r.explanation?.limitations ?? '',
          c.hasObservationEvidence ? 'Y' : 'N', c.consideredVolcanoes ? 'Y' : 'N', c.revisedExplanation ? 'Y' : 'N', c.wroteLimitations ? 'Y' : 'N',
        ].map(csvCell).join(','))
      }
      const csv = '﻿' + lines.join('\r\n')
      return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="earth-expedition-${meta.code}.csv"` } })
    }
    const exportDoc = { exportedAt: new Date().toISOString(), room: meta, records: rows.map(({ participant, record }) => ({ participant, record: { ...record, evidence: record.evidence.map((e) => ({ ...e, capture: e.capture ? '(캡처 생략)' : null })) } })) }
    return new Response(JSON.stringify(exportDoc, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="earth-expedition-${meta.code}.json"` } })
  }

  private async teacherDelete(request: Request): Promise<Response> {
    const meta = await this.requireTeacher(request)
    this.log('teacher', 'delete')
    this.closeAll(4003, 'deleted', { code: 'deleted', message: '선생님이 탐사실을 삭제했습니다.' })
    await this.wipe()
    this.saveMeta({ ...meta, status: 'deleted', roomRevision: meta.roomRevision + 1 })
    await this.ctx.storage.deleteAlarm()
    // 삭제 표식만 남기고 나머지는 모두 제거됨. 표식은 다음 생성 때 지워진다.
    return this.ok({ deleted: true })
  }

  private async report(request: Request, participantId: string): Promise<Response> {
    const meta = this.requireLive()
    const teacher = await this.verifySession(request.headers.get('x-ee-teacher-token'), 'teacher')
    const student = teacher ? null : await this.verifySession(request.headers.get('x-ee-participant-token'), 'student')
    if (!teacher && (!student || student.participantId !== participantId)) throw new RoomError(403, 'forbidden', '이 보고서를 볼 권한이 없습니다.')
    const p = this.participantRow(participantId)
    if (!p || p.removed) throw new RoomError(404, 'noParticipant', '참가자를 찾을 수 없습니다.')
    const guesses = this.guessMap(participantId)
    return this.ok({ room: meta, participant: this.publicParticipant(p, this.connectedIds(), guesses), record: this.fullRecord(p, guesses) })
  }

  // ---------- WebSocket ----------
  private async handleWebSocket(request: Request): Promise<Response> {
    const meta = this.requireLive()
    const url = new URL(request.url)
    const as = url.searchParams.get('as') === 'teacher' ? 'teacher' : 'student'
    const session = as === 'teacher'
      ? await this.verifySession(request.headers.get('x-ee-teacher-token'), 'teacher')
      : await this.verifySession(request.headers.get('x-ee-participant-token'), 'student')
    if (!session) throw new RoomError(401, 'auth', as === 'teacher' ? '교사 권한이 없습니다.' : '입장 정보가 없습니다. 다시 입장하세요.')
    if (as === 'student' && meta.status !== 'open') throw new RoomError(409, 'ended', '종료된 탐사실입니다.')

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    const attachment: Attachment = { role: as, participantId: session.participantId, sessionHash: session.hash }
    this.ctx.acceptWebSocket(server, [as, ...(session.participantId ? [session.participantId] : [])])
    server.serializeAttachment(attachment)
    if (session.participantId) this.ctx.storage.sql.exec(`UPDATE participants SET last_seen = ? WHERE id = ?`, Date.now(), session.participantId)
    // 첫 스냅샷은 즉시, 나머지 접속자에게는 참가 현황 갱신
    this.sendTo(server, as === 'teacher' ? this.teacherSnapshot(meta) : this.studentSnapshot(meta, session.participantId!))
    this.scheduleBroadcast()
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const a = ws.deserializeAttachment() as Attachment | null
    if (!a) return ws.close(4000, 'noAttachment')
    if (typeof message !== 'string') return this.ack(ws, 'unknown', false, { code: 'binary', message: '텍스트 메시지만 받습니다.' })
    if (message.length > MAX_MESSAGE_BYTES) return this.ack(ws, 'unknown', false, { code: 'tooLarge', message: '메시지가 너무 큽니다.' })
    let raw: unknown
    try {
      raw = JSON.parse(message)
    } catch {
      return this.ack(ws, 'unknown', false, { code: 'badJson', message: '메시지를 읽을 수 없습니다.' })
    }
    const cmid = (raw as { clientMessageId?: unknown })?.clientMessageId
    const clientMessageId = typeof cmid === 'string' ? cmid.slice(0, 64) : 'unknown'
    let meta: RoomMeta
    try {
      meta = this.requireLive()
    } catch (e) {
      this.ack(ws, clientMessageId, false, { code: (e as RoomError).code, message: (e as RoomError).message })
      return ws.close(4002, 'gone')
    }
    try {
      if (a.role === 'teacher') await this.handleTeacher(ws, meta, raw, clientMessageId)
      else await this.handleStudent(ws, a, meta, raw, clientMessageId)
    } catch (e) {
      if (e instanceof RoomError) this.ack(ws, clientMessageId, false, { code: e.code, message: e.message })
      else {
        console.error('ws handler error', e)
        this.ack(ws, clientMessageId, false, { code: 'internal', message: '처리 중 오류가 났습니다. 다시 시도하세요.' })
      }
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    const a = ws.deserializeAttachment() as Attachment | null
    if (a?.participantId) {
      try {
        this.ctx.storage.sql.exec(`UPDATE participants SET last_seen = ? WHERE id = ?`, Date.now(), a.participantId)
      } catch { /* 삭제된 뒤의 close는 무시 */ }
    }
    this.scheduleBroadcast()
  }

  async webSocketError(ws: WebSocket, _error: unknown) {
    try { ws.close(1011, 'error') } catch { /* noop */ }
    this.scheduleBroadcast()
  }

  private sendTo(ws: WebSocket, msg: ServerMessage) {
    try { ws.send(JSON.stringify(msg)) } catch { /* 닫힌 소켓 */ }
  }

  private ack(ws: WebSocket, clientMessageId: string, ok: boolean, error?: { code: string; message: string }, duplicate?: boolean) {
    const meta = this.loadMeta()
    const msg: AckMessage = { type: 'ack', v: PROTOCOL_VERSION, clientMessageId, ok, serverTime: Date.now(), roomRevision: meta?.roomRevision ?? 0, ...(duplicate ? { duplicate } : {}), ...(error ? { error } : {}) }
    this.sendTo(ws, msg)
  }

  private notice(targets: WebSocket[], code: NoticeMessage['code'], message: string, stage?: Stage) {
    const msg: NoticeMessage = { type: 'notice', v: PROTOCOL_VERSION, serverTime: Date.now(), code, message, ...(stage ? { stage } : {}) }
    for (const ws of targets) this.sendTo(ws, msg)
  }

  /** 변경 후 모든 접속자에게 역할별 스냅샷을 묶어서 보낸다 */
  private scheduleBroadcast() {
    if (this.broadcastTimer) return
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      this.broadcastNow()
    }, BROADCAST_DELAY_MS)
  }

  private broadcastNow() {
    const meta = this.loadMeta()
    if (!meta || meta.status === 'deleted') return
    for (const ws of this.ctx.getWebSockets('teacher')) this.sendTo(ws, this.teacherSnapshot(meta))
    for (const ws of this.ctx.getWebSockets('student')) {
      const a = ws.deserializeAttachment() as Attachment | null
      if (!a?.participantId) continue
      try {
        this.sendTo(ws, this.studentSnapshot(meta, a.participantId))
      } catch {
        ws.close(4004, 'removed')
      }
    }
  }

  private touch() {
    const meta = this.loadMeta()
    if (meta) this.bump(meta, {})
    this.scheduleBroadcast()
  }

  private closeAll(code: number, reason: string, notice?: { code: NoticeMessage['code']; message: string }) {
    for (const ws of this.ctx.getWebSockets()) {
      if (notice) this.notice([ws], notice.code, notice.message)
      try { ws.close(code, reason) } catch { /* noop */ }
    }
  }

  // ---------- 학생 메시지 ----------
  private async handleStudent(ws: WebSocket, a: Attachment, meta: RoomMeta, raw: unknown, clientMessageId: string) {
    const parsed = studentMessageSchema.safeParse(raw)
    if (!parsed.success) throw new RoomError(400, 'badMessage', '메시지 형식이 올바르지 않습니다.')
    const msg = parsed.data
    const pid = a.participantId!
    const p = this.participantRow(pid)
    if (!p || p.removed) {
      this.ack(ws, clientMessageId, false, { code: 'removed', message: '탐사실에서 내보내졌습니다.' })
      return ws.close(4004, 'removed')
    }
    const now = Date.now()
    this.ctx.storage.sql.exec(`UPDATE participants SET last_seen = ? WHERE id = ?`, now, pid)

    switch (msg.type) {
      case 'resync':
        this.sendTo(ws, this.studentSnapshot(meta, pid))
        return this.ack(ws, clientMessageId, true)
      case 'submitGuess': {
        if (meta.status !== 'open') throw new RoomError(409, 'ended', '종료된 탐사실입니다.')
        if (meta.inputLocked) throw new RoomError(423, 'inputLocked', '선생님이 입력을 잠갔습니다. 잠시 기다려 주세요.')
        // idempotency: 같은 키는 한 번만
        const idemKey = `${pid}:${msg.kind}:${msg.idempotencyKey}`
        const dup = this.ctx.storage.sql.exec<{ key: string }>(`SELECT key FROM idem WHERE key = ?`, idemKey).toArray()[0]
        if (dup) return this.ack(ws, clientMessageId, true, undefined, true)
        const existing = this.guessRows(pid).find((g) => g.kind === msg.kind)
        if (msg.kind === 'first' && existing) {
          // 최초 추론은 불변 — 덮어쓰지 않고 이미 제출된 것으로 응답
          return this.ack(ws, clientMessageId, true, undefined, true)
        }
        if (msg.kind === 'revised' && stageIndex(meta.stage) < stageIndex('revise')) throw new RoomError(409, 'tooEarly', '아직 수정 추론 단계가 아닙니다.')
        if (msg.kind === 'first' && stageIndex(meta.stage) < stageIndex('firstGuess')) throw new RoomError(409, 'tooEarly', '아직 추론 그리기 단계가 아닙니다.')
        this.ctx.storage.sql.exec(`INSERT INTO idem (key, created_at) VALUES (?, ?)`, idemKey, now)
        this.ctx.storage.sql.exec(
          `INSERT INTO guesses (participant_id, kind, idem, submitted_at, dataset_version, guess) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(participant_id, kind) DO UPDATE SET idem = excluded.idem, submitted_at = excluded.submitted_at, dataset_version = excluded.dataset_version, guess = excluded.guess`,
          pid, msg.kind, msg.idempotencyKey, now, msg.datasetVersion, JSON.stringify(msg.guess),
        )
        this.log(pid, 'submitGuess', { kind: msg.kind, lines: msg.guess.lines.length })
        this.bump(meta, {})
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'saveEvidence': {
        if (meta.inputLocked) throw new RoomError(423, 'inputLocked', '선생님이 입력을 잠갔습니다.')
        const rec = JSON.parse(p.record) as InquiryRecord
        rec.evidence = msg.evidence.slice(0, MAX_EVIDENCE) as Evidence[]
        this.ctx.storage.sql.exec(`UPDATE participants SET record = ? WHERE id = ?`, JSON.stringify(rec), pid)
        this.bump(meta, {})
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'saveExplanation': {
        if (meta.inputLocked) throw new RoomError(423, 'inputLocked', '선생님이 입력을 잠갔습니다.')
        const rec = JSON.parse(p.record) as InquiryRecord
        rec.explanation = { text: msg.explanation.text, limitations: msg.explanation.limitations, updatedAt: now }
        this.ctx.storage.sql.exec(`UPDATE participants SET record = ? WHERE id = ?`, JSON.stringify(rec), pid)
        this.bump(meta, {})
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'setGroup': {
        const group = msg.group && meta.groups.includes(msg.group) ? msg.group : null
        this.ctx.storage.sql.exec(`UPDATE participants SET grp = ? WHERE id = ?`, group, pid)
        this.bump(meta, {})
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'saveResponses': {
        if (meta.inputLocked) throw new RoomError(423, 'inputLocked', '선생님이 입력을 잠갔습니다.')
        const rec = JSON.parse(p.record) as InquiryRecord
        rec.responses = msg.responses
        this.ctx.storage.sql.exec(`UPDATE participants SET record = ? WHERE id = ?`, JSON.stringify(rec), pid)
        this.bump(meta, {})
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'setStage': {
        // 학생은 교사가 연 단계 이하에서만 자기 화면 단계를 바꿀 수 있다
        if (stageIndex(msg.stage) > stageIndex(meta.stage)) throw new RoomError(409, 'stageLocked', '선생님이 아직 다음 활동을 열지 않았습니다.')
        const rec = JSON.parse(p.record) as InquiryRecord
        if (rec.stage !== msg.stage) {
          rec.stage = msg.stage
          rec.history = [...rec.history, { stage: msg.stage, at: now }]
          this.ctx.storage.sql.exec(`UPDATE participants SET record = ? WHERE id = ?`, JSON.stringify(rec), pid)
        }
        return this.ack(ws, clientMessageId, true)
      }
    }
  }

  // ---------- 교사 메시지 ----------
  private async handleTeacher(ws: WebSocket, meta: RoomMeta, raw: unknown, clientMessageId: string) {
    const parsed = teacherMessageSchema.safeParse(raw)
    if (!parsed.success) throw new RoomError(400, 'badMessage', '메시지 형식이 올바르지 않습니다.')
    const msg = parsed.data
    const students = this.ctx.getWebSockets('student')
    switch (msg.type) {
      case 'resync':
        this.sendTo(ws, this.teacherSnapshot(meta))
        return this.ack(ws, clientMessageId, true)
      case 'teacher:setScreen': {
        if (!isValidScreen(msg.screen)) throw new RoomError(400, 'badScreen', '없는 화면입니다.')
        const stage = screenStage(msg.screen)
        // 화면이 가리키는 활동 상태로 맞추되, 이미 지나간 공개는 되돌리지 않는다
        const revealed = { ...meta.revealed }
        if (stageIndex(stage) >= stageIndex('firstReveal')) revealed.firstGuesses = true
        if (stageIndex(stage) >= stageIndex('volcanoReveal')) revealed.volcanoes = true
        if (stageIndex(stage) >= stageIndex('boundaryCompare')) revealed.boundaries = true
        const next = this.bump(meta, { screen: { step: msg.screen.step, sub: msg.screen.sub }, stage, revealed })
        for (const p of this.activeParticipants()) {
          const rec = JSON.parse(p.record) as InquiryRecord
          if (rec.stage !== stage) {
            rec.stage = stage
            rec.history = [...rec.history, { stage, at: Date.now() }]
            this.ctx.storage.sql.exec(`UPDATE participants SET record = ? WHERE id = ?`, JSON.stringify(rec), p.id)
          }
        }
        this.log('teacher', 'setScreen', msg.screen)
        this.notice(students, 'screenChanged', `선생님이 '${screenLabel(msg.screen)}' 화면으로 이동했습니다.`, next.stage)
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:setStage': {
        if (!isStage(msg.stage)) throw new RoomError(400, 'badStage', '없는 단계입니다.')
        const revealed = { ...meta.revealed }
        // 단계가 열리면 해당 증거는 자동 공개, 되돌아가도 이미 공개된 것은 유지한다
        if (stageIndex(msg.stage) >= stageIndex('firstReveal')) revealed.firstGuesses = true
        if (stageIndex(msg.stage) >= stageIndex('volcanoReveal')) revealed.volcanoes = true
        if (stageIndex(msg.stage) >= stageIndex('boundaryCompare')) revealed.boundaries = true
        const next = this.bump(meta, { stage: msg.stage, revealed })
        // 학생의 개인 단계도 새 단계로 맞춘다 (기록은 보존)
        for (const p of this.activeParticipants()) {
          const rec = JSON.parse(p.record) as InquiryRecord
          if (rec.stage !== msg.stage) {
            rec.stage = msg.stage
            rec.history = [...rec.history, { stage: msg.stage, at: Date.now() }]
            this.ctx.storage.sql.exec(`UPDATE participants SET record = ? WHERE id = ?`, JSON.stringify(rec), p.id)
          }
        }
        this.log('teacher', 'setStage', { stage: msg.stage })
        this.notice(students, 'stageChanged', `선생님이 '${msg.stage}' 활동을 열었습니다.`, next.stage)
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:reveal': {
        const revealed = { ...meta.revealed, [msg.what]: msg.value }
        this.bump(meta, { revealed })
        this.log('teacher', 'reveal', { what: msg.what, value: msg.value })
        if (msg.value) this.notice(students, 'reveal', '새로운 자료가 공개되었습니다.')
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:lockInput': {
        this.bump(meta, { inputLocked: msg.locked })
        this.notice(students, msg.locked ? 'inputLocked' : 'inputUnlocked', msg.locked ? '선생님이 입력을 잠갔습니다.' : '입력이 다시 열렸습니다.')
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:lockJoin': {
        this.bump(meta, { joinLocked: msg.locked })
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:remove': {
        const p = this.participantRow(msg.participantId)
        if (!p) throw new RoomError(404, 'noParticipant', '참가자를 찾을 수 없습니다.')
        this.ctx.storage.sql.exec(`UPDATE participants SET removed = 1 WHERE id = ?`, p.id)
        this.ctx.storage.sql.exec(`UPDATE sessions SET revoked = 1 WHERE participant_id = ?`, p.id)
        for (const s of this.ctx.getWebSockets(p.id)) {
          this.notice([s], 'removed', '선생님이 탐사실에서 내보냈습니다.')
          try { s.close(4004, 'removed') } catch { /* noop */ }
        }
        this.log('teacher', 'remove', { participantId: p.id })
        this.bump(meta, {})
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:assignGroup': {
        const group = msg.group && meta.groups.includes(msg.group) ? msg.group : null
        this.ctx.storage.sql.exec(`UPDATE participants SET grp = ? WHERE id = ?`, group, msg.participantId)
        this.bump(meta, {})
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:setGroups': {
        this.bump(meta, { groups: msg.groups })
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:highlight': {
        this.ctx.storage.sql.exec(`UPDATE participants SET highlighted = 0`)
        for (const id of msg.participantIds) this.ctx.storage.sql.exec(`UPDATE participants SET highlighted = 1 WHERE id = ?`, id)
        this.bump(meta, {})
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:syncView': {
        this.bump(meta, { followView: { view: msg.view, mode: msg.mode, requestedAt: Date.now(), force: msg.force } })
        if (msg.force) this.notice(students, 'followView', '선생님이 "모두 이곳 보기"를 요청했습니다.')
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:clearSyncView': {
        this.bump(meta, { followView: null })
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
      case 'teacher:end': {
        this.bump(meta, { status: 'ended', endedAt: Date.now(), stage: 'wrapUp' })
        this.log('teacher', 'end')
        this.notice(students, 'ended', '탐사실이 종료되었습니다. 개인 결과는 저장할 수 있습니다.')
        this.ack(ws, clientMessageId, true)
        return this.scheduleBroadcast()
      }
    }
  }

  // ---------- 만료 ----------
  async alarm() {
    const meta = this.loadMeta()
    if (!meta) return
    if (meta.expiresAt > Date.now()) {
      await this.ctx.storage.setAlarm(meta.expiresAt)
      return
    }
    this.closeAll(4001, 'expired', { code: 'expired', message: '탐사실 보관 기간(24시간)이 끝나 접속이 닫혔습니다.' })
    await this.wipe()
    this.saveMeta({ ...meta, status: 'deleted', expiresAt: meta.expiresAt, roomRevision: meta.roomRevision + 1 })
  }
}

class RoomError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}
