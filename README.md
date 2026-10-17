# 지구 탐사대 — 사라진 판의 경계를 찾아라

중학교 과학 [9과09-05]의 "지진·화산 분포와 판의 경계 관련성"을 실제 관측 자료로 탐구하는 학생 참여형 웹앱입니다.
교사가 탐사실을 열고 QR을 보여 주면 학생은 별명만으로 입장해 지진 분포를 관찰하고, 판의 경계가 있을 것 같은 곳에 선을 그린 뒤, 화산 자료와 판 경계 연구 모형을 보며 추론을 수정하고 설명을 씁니다. 혼자서도 같은 흐름을 끝까지 할 수 있습니다.

- 프런트엔드: React 19 + TypeScript + Vite 8, Three.js(3D 지구본), d3-geo(2D 지도), Natural Earth 육지 자료
- 백엔드: Cloudflare Workers + 탐사실당 SQLite 기반 Durable Object 1개 + WebSocket Hibernation
- 데이터: USGS 지진(FDSN Event API, 요약 피드), USGS 판 경계 서비스, Smithsonian GVP Holocene 화산 목록
- 생성형 AI 런타임·Firebase·유료 지도 키·외부 로그인 없음

## 실행

```bash
npm install
cp .dev.vars.example .dev.vars   # TEACHER_SECRET 값을 채운다 (교사 탐사실 생성용)
npm run dev                       # http://localhost:5173  (Worker + Durable Object 로컬 실행)
```

`.dev.vars`가 없거나 `TEACHER_SECRET`이 비어 있으면 혼자 탐사는 되지만 탐사실 생성은 "서버에 교사 비밀 값이 설정되어 있지 않습니다"로 거부됩니다.

## 빌드·검사·테스트

```bash
npm run typecheck      # 앱, Worker, Workers 테스트 세 tsconfig
npm run lint
npm test               # 단위 테스트 (vitest, node)
npm run test:workers   # Durable Object·권한·만료 테스트 (vitest + @cloudflare/vitest-plugin, workerd)
npm run test:e2e       # Playwright E2E (교사 1 + 학생 2, 분리된 브라우저 컨텍스트). 최초 1회 `npx playwright install chromium`
npm run build          # vite build → dist/client (정적 자산) + dist/earth_expedition (Worker)
```

E2E는 `npm run dev` 서버를 자동으로 띄우며, `.dev.vars`의 `TEACHER_SECRET`이 `local-dev-teacher-secret-2026`이 아니면 `TEACHER_SECRET=... npm run test:e2e`로 값을 넘깁니다.

## 데이터 스냅샷 갱신

```bash
npm run data:fetch     # USGS/GVP/Natural Earth → public/data/*.json + manifest.json
```

실행 중 앱은 외부 API를 직접 호출하지 않고(최근 피드 제외) 저장된 스냅샷을 씁니다. 자세한 조건과 한계는 [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Cloudflare 배포 (GitHub 연결)

1. 저장소를 GitHub에 올린 뒤 Cloudflare 대시보드 → Workers & Pages → Create → **Workers** → Import a repository.
2. 빌드 설정: Build command `npm run build`, Deploy command `npx wrangler deploy`.
3. 배포 전 비밀 값 설정: `npx wrangler secret put TEACHER_SECRET` (또는 대시보드 Settings → Variables and Secrets).
4. `wrangler.jsonc`에 Durable Object 바인딩(`ROOM` → `RoomDO`)과 SQLite 마이그레이션(`new_sqlite_classes`)이 포함되어 있어 첫 배포에서 자동 적용됩니다.
5. 로컬에서 수동 배포하려면 `npx wrangler login` 후 `npm run deploy`.

정적 자산(SPA deep link 포함)은 Workers Static Assets가 처리하고, `/api/*`만 Worker가 먼저 받습니다(`run_worker_first`). Pages 설정과 섞지 않습니다.

무료 요금제 범위: Durable Objects는 SQLite 저장 클래스를 쓰면 Workers Free에서도 동작하지만, 요청·저장 한도는 Cloudflare 가격 페이지의 현재 값을 따릅니다. 검토일 2026-10-17: https://developers.cloudflare.com/durable-objects/platform/pricing/ , https://developers.cloudflare.com/workers/platform/pricing/ . 이 프로젝트는 결제 설정이나 자동 유료 전환을 하지 않으며 "무료 무제한"을 보장하지 않습니다. 한도를 넘으면 탐사실 기능이 실패하고, 혼자 탐사와 저장 자료는 정적 자산이 제공되는 범위에서 유지됩니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | 핵심 불변 조건과 명령 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 구조, 상태 전이, 실시간 규약, 보안 |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | 자료 출처·조건·갱신·한계 |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | 색·타이포·버튼·모션 |
| [docs/ASSET_MANIFEST.md](docs/ASSET_MANIFEST.md) | 이미지 7종 사용 위치와 최적화 결과 |
| [docs/AUDIO_SETUP.md](docs/AUDIO_SETUP.md) | ElevenLabs 음원 파일 넣는 법 |
| [docs/CLASSROOM_GUIDE.md](docs/CLASSROOM_GUIDE.md) | 교사용 수업 운영법 |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | 실행·검증 결과와 미검증 사항 |
| [docs/CHECKLIST.md](docs/CHECKLIST.md) | 요구 사항 ↔ 구현 위치 |

## 저장소에 넣지 않는 것

`.dev.vars`, `.wrangler/`, 계정 토큰, 학생 응답·내보내기 파일. 학생 응답은 탐사실 Durable Object에만 24시간(설정값) 보관되고 만료·삭제 시 정리됩니다.
