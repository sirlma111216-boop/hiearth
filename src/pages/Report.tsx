import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { InquiryRecord } from '@shared/domain/types'
import { useLesson, LoadingScreen } from '../data/useLesson'
import { loadLocalRecord, loadRoomInfo, loadRoomRecord, saveLocalRecord } from '../inquiry/localStore'
import { api, ApiError } from '../realtime/api'
import { ReportView } from '../report/ReportView'
import { parseRecordJson } from '../report/exports'
import { TopBar } from '../ui/TopBar'
import { useToast } from '../ui/Toast'

export default function Report() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const toast = useToast()
  const { data, error, progress, retry } = useLesson()
  const [loaded, setLoaded] = useState<{ record: InquiryRecord; nickname: string; title: string; roomCode?: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const isLocal = id === 'local'
  const pid = params.get('p')
  const preferLocal = params.get('local') === '1'

  useEffect(() => {
    let alive = true
    if (isLocal) {
      const r = loadLocalRecord()
      if (r) setLoaded({ record: r, nickname: '혼자 탐사', title: '지구 탐사대 탐구 카드' })
      else setLoadError('이 기기에 저장된 혼자 탐사 기록이 없습니다. 혼자 탐사를 진행하거나 JSON을 가져오세요.')
      return
    }
    const code = (id ?? '').toUpperCase()
    const local = loadRoomInfo(code)
    const useLocalCopy = () => {
      const r = loadRoomRecord(code)
      if (r) setLoaded({ record: r, nickname: local?.nickname ?? '참가자', title: local?.title ?? '지구 탐사대 탐구 카드', roomCode: code })
      else setLoadError('이 보고서를 볼 권한이 없고, 이 기기에 임시 사본도 없습니다.')
    }
    if (!pid) { setLoadError('참가자 정보가 없습니다.'); return }
    if (preferLocal) { useLocalCopy(); return }
    api.report(code, pid).then((r) => { if (alive) setLoaded({ record: r.record, nickname: r.participant.nickname, title: r.room.title, roomCode: code }) })
      .catch((e) => { if (!alive) return; if (local?.participantId === pid) useLocalCopy(); else setLoadError(e instanceof ApiError ? e.message : '보고서를 받지 못했습니다.') })
    return () => { alive = false }
  }, [id, pid, isLocal, preferLocal])

  const onImport = (file: File) => {
    file.text().then((t) => {
      const r = parseRecordJson(t)
      if (!r) { toast.push('올바른 탐구 JSON 파일이 아닙니다.', 'danger'); return }
      saveLocalRecord(r)
      setLoaded({ record: r, nickname: '가져온 기록', title: '지구 탐사대 탐구 카드' })
      setLoadError(null)
      toast.push('기록을 가져와 이 기기에 저장했습니다.', 'success')
    })
  }

  if (!data) return <LoadingScreen progress={progress} error={error} onRetry={retry} title="보고서를 준비하는 중" />
  return (
    <>
      <TopBar center={<span className="status-pill"><strong>탐구 카드</strong></span>} />
      {loadError && !loaded ? (
        <div className="page page-narrow"><div className="card stack"><h1 style={{ fontSize: 22 }}>보고서를 열 수 없습니다</h1><p className="error-text">{loadError}</p>
          {isLocal ? <label className="btn btn-secondary"><input type="file" accept="application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f) }} />JSON 가져오기</label> : null}
          <Link className="btn btn-quiet" to="/">처음으로</Link></div></div>
      ) : loaded ? (
        <ReportView data={data} record={loaded.record} nickname={loaded.nickname} title={loaded.title} roomCode={loaded.roomCode} onImport={isLocal ? onImport : undefined} backHref={isLocal ? '/explore' : loaded.roomCode ? `/room/${loaded.roomCode}` : '/'} />
      ) : <div className="page"><p className="muted">불러오는 중…</p></div>}
    </>
  )
}
