# 구조

## 한 장 요약

```
브라우저 (React, Vite 8)
  ├─ /            랜딩 (정적 이미지, 3D 미로딩)
  ├─ /explore     혼자 탐사  ──┐
  ├─ /room/:code  학생 탐사실 ─┼─ Workspace (같은 탐구 엔진·지도·데이터 형식)
  ├─ /teach/:code 교사 진행   ──┘
  ├─ /report/:id  보고서 (HTML 인쇄, PNG 카드, JSON)
  └─ /showcase    시연 모드 (가상 참가자 표시)
        │ HTTP /api/*  +  WebSocket /api/rooms/:code/ws
Cloudflare Worker (worker/index.ts)
  ├─ 정적 자산: Workers Static Assets (SPA fallback)
  ├─ /api/feed/recent → USGS 요약 피드 프록시 (Cache API 10분, 동시 요청 병합)
  └─ /api/rooms, /api/teach → RoomDO (입장 코드 = idFromName)
Durable Object RoomDO (worker/room.ts, SQLite)
  kv(meta) · participants · sessions(해시) · guesses(first/revised) · idem · log
```

## 활동 상태

`shared/domain/activity.ts`가 단계 정의·전이·안내 문구의 단일 출처입니다.

관찰 → 최초 추론 → 최초 추론 공개 → 화산 증거 공개 → 수정 추론 → 판 경계 비교 → 설명 작성 → 결과 정리

- 혼자 탐사: 사용자가 `다음`으로 진행. 최초 추론을 제출해야 다음으로 갑니다.
- 탐사실: 교사가 `teacher:setStage`로 엽니다. 학생은 교사가 연 단계 이하에서만 자기 화면 단계를 움직일 수 있습니다(서버가 거부).
- 단계를 되돌려도 `InquiryRecord.history`에 이동이 남고 제출된 리비전은 유지됩니다.
- 단계가 열리면 해당 증거는 자동 공개(`revealed.*`)되고, 교사가 개별로 켜고 끌 수도 있습니다.

## 탐구 엔진 (`src/inquiry/engine.ts`)

- `record`(제출된 것): `firstGuess`, `revisedGuess`, `evidence[]`(최대 3), `explanation`, `history`.
- `draft`(그리는 중): 선 목록, 진행 중 꼭짓점, 되돌리기/다시 실행 스택, 선택 선.
- `submit`: `idle → pending → saved | queued | error`. 서버 ack 전에는 "저장됨"으로 표시하지 않습니다.
- 자유 곡선은 Douglas–Peucker로 단순화하고 `rawPointCount`로 원본과 구분합니다. 선 12개·선당 400점 상한은 스키마(zod)와 reducer 양쪽에서 강제됩니다.

## 지도 (`src/map/`)

- `MapRenderer` 인터페이스를 2D(`Map2D` + `scene2d.ts`)와 3D(`Globe3D`)가 구현합니다. `MapView`가 전환·WebGL 미지원·컨텍스트 유실 시 2D 전환을 처리하며, 시점(`ViewState { center:[lng,lat], zoom }`)·레이어·시간창·선택·초안은 두 모드가 공유합니다.
- 2D: 정거원통 도법(d3-geo). 육지는 land-110m/50m TopoJSON. 선은 화면에서 반 바퀴 이상 점프하면 끊어 날짜 변경선 문제를 막습니다.
- 3D: 구 텍스처는 같은 TopoJSON을 4096×2048 캔버스에 그린 것. 지진·화산은 `THREE.Points` + 셰이더로 시간·규모 필터를 GPU에서 처리합니다(17,003점을 샘플링 없이). 뒷면 점은 셰이더에서 숨기고, 선은 대원 보간 후 표면 위 1.003~1.006 반지름에 둡니다. 사용자 선은 Line2(굵은 선, 점선 지원).
- `zoom` ↔ 카메라 거리: `d = 1 + 2.7/zoom`.

## 실시간 규약 (`shared/protocol/messages.ts`)

- 클라이언트→서버: `{ v:1, clientMessageId, type, ... }`. 학생 6종, 교사 11종. zod로 검증, 실패 시 `ack.ok=false, code='badMessage'`.
- 서버→클라이언트: `snapshot`(역할별 전체 상태, `roomRevision`·`activityVersion`·`serverTime` 포함), `ack`, `notice`.
- 변경 후 150ms 묶음 브로드캐스트. 학생 스냅샷에는 자기 기록 + 공개된 선만, 교사 스냅샷에는 참가 현황·모든 선.
- 제출은 `idempotencyKey`로 중복을 거릅니다. 재전송·재연결·새로고침에도 한 번만 저장됩니다.
- 클라이언트(`RoomClient`)는 지수 백오프 재연결, 미확인 메시지 재전송(12초), 오래된 스냅샷 무시, `4001/4002/4003/4004` 종료 코드(만료/종료/삭제/내보냄)에서는 재연결하지 않습니다.
- 지도 카메라·스트로크는 서버로 보내지 않습니다. 제출·증거·설명·단계 변경만 전송합니다.

## 저장과 수명

- 모든 필수 상태는 SQLite. Hibernation·알람 뒤에도 `kv.meta`를 매번 읽어 복구합니다(메모리 캐시 없음).
- TTL 기본 24시간(교사 설정 1~24시간). 만료 알람에서 접속을 닫고 `deleteAll` 수준으로 정리합니다. 종료(`teacher:end`)는 제출을 막되 만료까지 자료를 남겨 내려받을 수 있게 합니다. 삭제는 즉시 정리합니다.
- 로컬: 혼자 탐사 기록과 탐사실 임시 사본은 localStorage. 설정 화면의 "이 기기 기록 지우기"가 정리합니다.

## 보안

- 교사 생성: Origin·생성 요청 제한·설정 검증 후 누구나 새 수업 생성 가능. DO가 32바이트 세션을 발급하고 해시만 저장, 쿠키 `eet_<CODE>`(HttpOnly, SameSite=Lax, https면 Secure).
- 교사 복구 토큰은 생성 시 한 번 표시, 해시로 저장, 세션 발급에만 사용. 공개 입장 URL에는 들어가지 않습니다.
- 참가자 세션 쿠키 `eep_<CODE>`. 모든 HTTP/WS에서 역할과 방을 검증. 다른 방 쿠키·추측 ID·학생의 교사 이벤트는 거부됩니다(테스트: `tests/workers/room.test.ts`).
- Origin/Sec-Fetch-Site 확인(상태 변경·WS), 메모리 토큰 버킷(생성 5/분, 입장 12/분, API 2/초) + DO 입장 시도 120/분, 메시지 1.6MB·본문 크기 제한, 별명 정리, CSV 수식 주입 방지.
- 공개 자료의 클라이언트 숨김을 시험 보안으로 주장하지 않습니다. 공개 전 비노출은 서버가 스냅샷을 만들 때 결정합니다.

## 수업 흐름 (`shared/domain/lesson.ts`, `src/lesson/`)

학생이 처음부터 지도에 던져지지 않도록, 앱은 **4개 진행 구간과 6개 주요 화면**의 수업 흐름으로 진행됩니다. 차시 구분은 두지 않으며, 교사가 수업 시간에 맞춰 어느 화면에서든 멈추고 이어갑니다. 단계·화면 번호의 단일 출처는 `LESSON_STEPS`/`LESSON_SCREENS` 표이며, 번호를 다른 곳에 적지 않습니다. 각 화면은 `kind`(narrative/content/activity/reflect/write/summary)와 연결된 활동 상태 `stage`를 갖습니다.

- `LessonShell`: 현재 구간을 표시하고 역할에 맞게 이동을 제공한다. 학생은 교사보다 앞서 갈 수 없고, 제출 후에는 기다리는 안내를 본다. 교사는 다음 활동 이름이 적힌 버튼으로 이동한다.
- `screens.tsx`: 지진 관찰, 첫 추론, 화산을 보고 수정, 판 경계 비교, 설명·한계 작성, 결과. 이전 관찰 화면의 응답은 보고서에 보존한다.
- `ActivityFrame`과 embedded `Workspace`: 지도 위에 패널을 겹치지 않는다. 그리기 조작은 지도 아래, 보기·자료 설정과 시간 설정은 접힌 영역에 둔다. 공개 카드는 생략한다.
- 학생의 첫 선은 제출 후 편집하지 못하며 수정 초안은 별도로 보존한다. 설명 초안은 탭의 sessionStorage에 보존해 교사의 화면 이동으로 사라지지 않게 한다.
- 단계 이동은 관련 자료를 열고 이전 활동의 입력 잠금을 해제한다. 다른 학생의 선은 별도의 교사 공개 동작에서만 열린다.
- step/sub 식별자는 기존 저장 기록과 호환되도록 유지한다. 화면 위치가 폐지된 경우 대응하는 새 활동으로 매핑한다.
