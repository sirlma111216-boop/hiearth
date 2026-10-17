# 자산 감사표

원본 PNG 7종은 `public/images/`에 보존하고, `npm run images:optimize`(sharp)로 WebP(품질 82)·AVIF(품질 55)·960px WebP 미리보기를 생성했습니다. 리사이즈 없이 형식만 바꿨습니다(좌표 기준 이미지가 아닌 장식 전용이므로 안전). 결과는 `public/images/optimization-report.json`.

| 파일 | 크기 | PNG | WebP | AVIF | 사용 위치 |
| --- | --- | --- | --- | --- | --- |
| landing-desktop | 1672×941 | 2.05MB | 136KB | 81KB | `/` 데스크톱 히어로 배경(`<picture>`, object-position 65%) |
| landing-mobile | 941×1672 | 2.08MB | 133KB | 77KB | `/` 모바일(≤760px) 히어로 배경 |
| workspace-atmosphere | 1672×941 | 1.67MB | 39KB | 26KB | 작업 공간 배경(불투명도 0.55 + 어두운 그라데이션), 랜딩 장면 2 카드 |
| lobby-observatory | 1672×941 | 1.94MB | 93KB | 57KB | `/join` 배경, 교사 대기실(QR 옆), 시연 모드 입장 장면 |
| evidence-seismic | 1448×1086 | 2.37MB | 187KB | 102KB | 증거 서랍 커버(960px), 랜딩 장면 1 카드 |
| evidence-volcano | 1448×1086 | 2.41MB | 156KB | 95KB | 화산 공개 카드, 랜딩 장면 3 카드 |
| report-cover | 1536×1024 | 1.95MB | 110KB | 64KB | 보고서 표지(인쇄 시 90px 머리띠), 판 경계 공개 카드 |

- 모든 장식 이미지는 `alt=""` + `aria-hidden`. 의미 있는 이미지(QR, 증거 캡처, 보고서 지도)는 구체적 대체 텍스트.
- 랜딩 이미지는 `fetchpriority="high"`, 나머지는 `loading="lazy"`. 이미지에 글자·버튼을 굽지 않았습니다.
- 지도·해안선·진원·화산·판 경계는 이미지가 아닌 실제 자료로 그립니다.
- 음원: `public/audio/`(현재 비어 있음, README 포함). 파일명은 `src/audio/manifest.json` 기준.
- 글꼴: `public/fonts/PretendardVariable.woff2` + `LICENSE-Pretendard.txt`.

## 랜딩 3D 지구 텍스처 (`public/textures/`)

| 파일 | 크기 | 용도 | 출처 |
| --- | --- | --- | --- |
| earth-4096.webp | 4096×2048, 823KB | 데스크톱 지구 표면 | NASA Blue Marble Next Generation (Dec 2004, topography+bathymetry), 5400×2700 원본을 리사이즈 |
| earth-2048.webp | 2048×1024, 231KB | 모바일(<760px) 지구 표면 | 동일 |
| clouds-2048.webp | 2048×1024, 413KB | 데스크톱 구름 알파 마스크 | NASA Blue Marble cloud cover (cloud_combined_2048) |
| clouds-1024.webp | 1024×512, 113KB | 모바일 구름 | 동일 |

출처 URL·이용 조건·처리 내용은 `public/textures/README.txt`. 지표 텍스처에는 구름이 없어 별도 구름층과 이중으로 보이지 않는다. 텍스처는 첫 화면이 정적 이미지로 그려진 뒤(idle) 지연 로딩되며 실패하면 정적 배경을 유지한다.
