# CLAUDE.md — 지구 탐사대

## 명령
- `npm run dev` 로컬 실행(Worker+DO 포함, 포트 5173) · `npm run build` · `npm run typecheck` · `npm run lint`
- `npm test`(단위) · `npm run test:workers`(workerd에서 DO) · `npm run test:e2e`(Playwright, dev 서버 자동)
- `npm run data:fetch` 스냅샷 갱신 · `npm run images:optimize` WebP/AVIF 재생성

## 불변 조건
- 좌표는 항상 `[lng, lat]`. 추론 선은 픽셀이 아니라 경위도 배열로 저장한다.
- 최초 추론(`first`)은 제출 후 바뀌지 않는다. 서버는 두 번째 `first`를 duplicate로 응답한다. 수정 추론(`revised`)만 덮어쓴다.
- 서버(RoomDO)가 교실 상태의 권위다. 클라이언트는 스냅샷을 통째로 받아들인다(필드별 재구성 금지).
- 공개 전에는 다른 학생의 선을 학생 스냅샷에 넣지 않는다(`sharedGuesses`는 `revealed.firstGuesses`가 true일 때만).
- 수업 생성은 공용 암호 없이 허용한다. 생성자에게만 서버가 세션 쿠키(HttpOnly)를 발급하며 교사 권한은 세션 또는 복구 코드로 검증한다. 입장 코드는 권한이 아니다. 생성 제한·Origin 검증·만료를 유지한다.
- null 규모·깊이는 null로 유지한다(0 치환 금지). 제외 건수는 manifest와 /sources에 드러낸다.
- 소리는 기본 꺼짐. 음원 파일이 없으면 무음. 랜딩 지구본은 지연 로딩한다. 탐구 지도 첫 사용은 2D이며 사용자가 선택한 보기 방식은 유지한다.
- 화면에 개발 문서·배포 안내·API 키 입력창을 넣지 않는다. 기술 설명은 docs/ 에만.
- 학생 선을 채점·순위화하지 않는다. "의견 겹침"은 밀도·정답 확률·위험도가 아니다.
- 생성 이미지는 장식 전용. 지도·해안선·판 경계·화산·지진은 실제 자료로만 그린다.

## 구조
- `shared/` 도메인·스키마·구면 기하·시간·메시지 규약 (프런트·Worker 공용, `@shared/*`)
- `worker/` Worker 라우터(`index.ts`), 탐사실 DO(`room.ts`), 인증·쿠키(`auth.ts`), USGS 피드 프록시(`proxy.ts`)
- `src/map/` 2D(`Map2D`, `scene2d`)·3D(`Globe3D`) 렌더러와 `MapView` 전환 래퍼
- `src/inquiry/` 탐구 엔진(reducer)·로컬 저장 · `src/realtime/` WS 클라이언트·HTTP API
- `src/workspace/` 공용 작업 화면 · `src/pages/` 라우트 · `src/report/` 보고서·정적 지도·내보내기
- `public/data/` 실제 자료 스냅샷 + manifest · `public/images/` 원본 PNG + WebP/AVIF · `public/audio/` 음원 자리

## 수업 화면
- 6개 주요 화면과 4개 진행 구간을 사용한다. shared/domain/lesson.ts의 step/sub는 기존 기록 호환을 위한 식별자이며 사용자에게 숫자로 표시하지 않는다.
- 최초 선은 제출 후 편집하지 않는다. 최초·수정 초안을 분리하며, 화면 이동만으로 지우지 않는다.
- 제출 완료는 서버 ack 뒤에만 표시한다. 우리 반 선 공개는 교사가 선택하며 화산·판 경계는 해당 활동 이동과 함께 열린다.
