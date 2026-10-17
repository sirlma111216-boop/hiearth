# 요구 사항 ↔ 구현 위치

| 요구 | 구현 | 상태 |
| --- | --- | --- |
| 라우트 /, /explore, /join, /room/:id, /teach, /teach/:id, /report/:id, /sources, /settings, /showcase | `src/main.tsx`, `src/pages/*` | 완료 |
| 랜딩: 이미지 타이틀 장면, HTML 제목·버튼, 세 장면, 자료 기관, 최근 자료 확인 상태, 3D 미로딩 | `src/pages/Landing.tsx` | 완료 |
| 혼자 탐사와 탐사실이 같은 엔진·데이터 형식 | `src/inquiry/engine.ts`, `src/workspace/Workspace.tsx` | 완료 |
| 활동 상태 8단계, 중앙 관리, 되돌아가도 최초 추론 유지 | `shared/domain/activity.ts` | 완료 (단위 테스트) |
| 3D 지구본(실제 해안선, 짙은 남색 바다, 얇은 대기) | `src/map/Globe3D.ts`, `landTexture.ts` | 완료 |
| 2D 지도 동등 기능, WebGL 미지원·유실 시 자동 전환, 상태 유지 | `src/map/MapView.tsx`, `Map2D.ts` | 완료 |
| 위치 프리셋 5종, 교사 따라가기/모두 이곳 보기 | `shared/domain/presets.ts`, Workspace, `teacher:syncView` | 완료 |
| 지진 ID·시각·좌표·규모·깊이·URL 보존, null 유지, 검증·제외 사유 | `scripts/fetch-data.mjs`, `shared/geo/normalize.ts`, manifest | 완료 |
| 최근 자료(피드) vs 장기 자료(Event API) 구분, 갱신 시각·건수 표시 | `worker/proxy.ts`, `src/data/recent.ts`, EvidenceDrawer | 완료 |
| 재생·일시정지·처음·속도·슬라이더·누적/이동창/전체, UTC/KST, 일/월 차트 | `useTimePlayback.ts`, `TimeControls.tsx`, `shared/geo/time.ts` | 완료 |
| 원/삼각형/선/실선·점선 구분, 정보 패널과 원문 링크, GPU 점 렌더링 | `colors.ts`, `scene2d.ts`, `Globe3D.ts`, `InfoPanel.tsx` | 완료 |
| 이동/그리기 분리, 자유 곡선·폴리라인, 터치·마우스·펜, 되돌리기·다시 실행·선택 삭제·전체 지우기 확인·미리보기, 키보드 입력 | `Map2D.ts`, `Globe3D.ts`, `InferencePanel.tsx` | 완료 |
| 경위도 저장, 대원 보간, 날짜 변경선 분할, 뒷면 숨김, 단순화와 원본 구분, 상한 | `shared/geo/sphere.ts`, schemas | 완료 (단위 테스트) |
| 최초 리비전 불변, 수정은 복사, idempotency, 서버 확인 전 미표시, 전송 대기 | engine, `RoomClient.ts`, `worker/room.ts` | 완료 (DO 테스트) |
| 증거 최대 3개, 조건 구조화 + 캡처 + 메모 | `Evidence` 타입, Workspace.captureEvidence | 완료 |
| 화산 공개 장면(장식 카드 + 실제 위치), GVP 범위·버전 표시 | `RevealScene.tsx` | 완료 |
| 판 경계 공개 전 근거 작성, 공개 후 레이어 토글, 점수 없음, 의견 겹침 | Workspace, EvidenceDrawer | 완료 |
| 교사 생성(제목·자료·시작 지역·상한·종료 시각), 코드·QR·링크, 별명만 입장, 모둠 | `Teach.tsx`, `TeachRoom.tsx`, `Join.tsx` | 완료 |
| 교사 기능 전부(현황·잠금·내보내기·단계·공개·필터·비교·발표·동기화·종료·삭제 확인) | `TeachRoom.tsx`, teacher 메시지 11종 | 완료 |
| 학생 기능(상태·독립 탐색·추론·증거·설명·제출 상태·재접속·다운로드) | `Room.tsx`, Workspace | 완료 |
| 발표 화면: 지구본 65%+, 저채도 + 강조 두 명, 비밀 미노출, 전체화면/Esc | `.presentation` CSS, `teacher:highlight` | 완료 |
| Worker + SQLite DO + Hibernation, 버전 메시지 규약, 스냅샷·재연결·중복·순서 | `worker/room.ts`, `shared/protocol/messages.ts` | 완료 (DO 테스트) |
| SQLite 영속, setInterval 미사용, TTL 24h 알람, 만료·종료·삭제 정리, 로컬 사본 안내·지우기 | `room.ts` alarm, Settings | 완료 |
| 교사 비밀(secret) 서버 검증, 고엔트로피 세션, HttpOnly 쿠키, Origin 검증, 복구 토큰 해시 | `worker/index.ts`, `auth.ts` | 완료 |
| 코드 충돌 재시도, 제한, 검증, 크기 제한, 정원, 만료, 타 방 차단, CSV 주입 방지 | `index.ts`, `room.ts`, schemas | 완료 (DO 테스트) |
| USGS/GVP/판 경계 실제 응답 확인, 페이지네이션, 분할, 중복 제거, 대조, manifest | `scripts/fetch-data.mjs`, `public/data/manifest.json` | 완료 |
| 프록시 허용 목록, 타임아웃·백오프·캐시·오류 응답, 실패 시 저장 자료 안내 | `worker/proxy.ts` | 완료 |
| 보고서 7부 구성, 같은 범위 지도 2장, AI 채움 없음, 인쇄 CSS, 정적 재렌더링 | `src/report/*`, `print.css` | 완료 |
| JSON 내보내기/가져오기, PNG 카드, PDF(브라우저 인쇄), 교사 CSV/JSON | `exports.ts`, `/teacher/export` | 완료 |
| 체크리스트 4항목, 자동 판정 없음 | `checklist()`, TeachRoom ResultsTable | 완료 |
| 디자인 토큰·Pretendard 로컬·버튼 4종·상태·48px·keep-all·tabular-nums | `base.css` | 완료 |
| 이미지 7종 사용, WebP/AVIF, picture, aria-hidden, 자산 감사표 | `ASSET_MANIFEST.md` | 완료 |
| 모션 시간, reduced-motion + 앱 설정, 자동 회전 없음 | `base.css`, settings | 완료 |
| 소리 기본 꺼짐, 분리 음량, 500ms 중복 방지, 파일 없으면 무음, manifest 파일명 | `src/audio/AudioManager.ts` | 완료 |
| 시연 모드(장면 이동·정지·되감기, 가상 참가자 표시, 실제 자료) | `src/pages/Showcase.tsx` | 완료 |
| 문서 9종 | `README.md`, `CLAUDE.md`, `docs/*` | 완료 |
| 영문 브랜드 디스플레이 서체 | 추가하지 않음(선택 사항) | 미적용(의도) |
| 40명 부하 검증 | 로컬 시뮬레이션 | VERIFICATION.md 참조 |
| 실제 Cloudflare 배포 | `wrangler deploy` → earth-expedition.sirlma.workers.dev, GitHub push 워크플로 | 완료 (API 토큰 secret·TEACHER_SECRET은 사용자 설정) |
