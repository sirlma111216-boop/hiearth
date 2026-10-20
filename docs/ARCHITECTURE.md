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
- 자유 곡선은 Douglas–Peucker로 단순화하고 `rawPointCount`로 원본과 구분합니다. 선 64개·선당 400점 상한은 스키마(zod)와 reducer 양쪽에서 강제됩니다. 최초 추론의 선을 복사한 뒤에도 수정 추론을 추가할 여유를 둡니다.

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

- 교사 생성: 공용 암호 없이 생성하되 Origin·요청 제한·설정을 검증한다. DO가 생성자에게 32바이트 세션을 발급하고 해시만 저장, 쿠키 `eet_<CODE>`(HttpOnly, SameSite=Lax, https면 Secure).
- 교사 복구 토큰은 생성 시 한 번 표시, 해시로 저장, 세션 발급에만 사용. 공개 입장 URL에는 들어가지 않습니다.
- 참가자 세션 쿠키 `eep_<CODE>`. 모든 HTTP/WS에서 역할과 방을 검증. 다른 방 쿠키·추측 ID·학생의 교사 이벤트는 거부됩니다(테스트: `tests/workers/room.test.ts`).
- Origin/Sec-Fetch-Site 확인(상태 변경·WS), 메모리 토큰 버킷(생성 5/분, 입장 12/분, API 2/초) + DO 입장 시도 120/분, 메시지 1.6MB·본문 크기 제한, 별명 정리, CSV 수식 주입 방지.
- 공개 자료의 클라이언트 숨김을 시험 보안으로 주장하지 않습니다. 공개 전 비노출은 서버가 스냅샷을 만들 때 결정합니다.

## 수업 흐름 (`shared/domain/lesson.ts`, `src/lesson/`)

학생이 처음부터 지도에 던져지지 않도록, 앱은 **8단계 24화면**의 수업 흐름으로 진행됩니다. 차시 구분은 두지 않으며, 교사가 수업 시간에 맞춰 어느 화면에서든 멈추고 이어갑니다. 단계·화면 번호의 단일 출처는 `LESSON_STEPS`/`LESSON_SCREENS` 표이며, 번호를 다른 곳에 적지 않습니다. 각 화면은 `kind`(narrative/content/activity/reflect/write/summary)와 연결된 활동 상태 `stage`를 갖습니다.

- `LessonShell`: 단계 표시줄(완료 표시·잠김), 화면 카드, 이전/다음/건너뛰기, 소단계 점. 혼자 탐사·학생·교사가 같은 셸을 씁니다.
- `screens.tsx`: 화면 id별 본문(설명·자기 분석·쓰기·결론)과 활동 화면의 과제 정의(`ACTIVITY_TASKS`: 질문·힌트·할 일·보이는 패널·초기 레이어·공개 카드·관찰 메모·선택 응답·교사 팁).
- `ActivityFrame`: 과제 머리 + 끼워 넣은 `Workspace`(embedded, 패널 선택, `stageOverride`로 화면이 활동 상태를 정함) + 응답 입력.
- 응답은 `InquiryRecord.responses[screenId]`에 저장되고(탐사실은 `saveResponses`로 서버에), 보고서 "관찰 기록과 자기 분석"에 실립니다.
- 교실: 교사의 `teacher:setScreen`이 `RoomMeta.screen`과 활동 상태·공개를 함께 바꿉니다. 학생은 교사 화면까지만 갈 수 있고(`maxScreen`), 기본은 "따라가기"이며 끌 수 있습니다. 활동 화면에서 각자 작업 중에도 교사가 화면을 넘기면 따라가므로, 교사는 참가 현황의 제출 표시를 보고 넘깁니다.
- 이동 조건: 최초 추론 그리기 화면은 제출 후, 수정 추론 그리기 화면은 제출 후에만 다음으로 갑니다(화면 번호는 표에서만 관리). 설명 위주 화면은 건너뛰기가 있습니다.
