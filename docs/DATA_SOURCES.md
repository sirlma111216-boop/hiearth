# 자료 출처와 조건

모든 수치 자료는 `scripts/fetch-data.mjs`가 공식 서비스에서 받아 `public/data/`에 저장하고 `public/data/manifest.json`에 provider, sourceUrl, retrievedAt, coverage, filters, datasetVersion, recordCount, expectedCount, rejected, license, checksum(sha256)을 기록합니다. 사용자 화면(/sources, 증거 서랍, 보고서)은 manifest 값을 그대로 보여 줍니다.

## 지진 — USGS FDSN Event Web Service (API → 스냅샷)

- 주소: https://earthquake.usgs.gov/fdsnws/event/1/
- 확정 조건: 2015-01-01T00:00:00 ~ 2025-01-01T00:00:00 UTC, 전 지구, **규모 5.0 이상**, 연도별 분할 요청(`orderby=time-asc`).
- 확인 과정: 2015~2025 M4.5+는 73,031건으로 요청당 20,000건 한도를 넘고 모바일 전송량(원시 약 4.4MB)이 커서, M5.0+ 17,003건(연도 파일 10개, 합계 약 2.4MB / gzip 약 530KB)으로 확정했습니다. 각 연도의 `count` 응답과 수신 건수를 대조했고 제외 0건입니다.
- 보존 필드: id, time(UTC ms), lon, lat(소수 3자리), mag, depth(null 유지), place, url.
- 최근 자료: 요약 피드(4.5_month/4.5_week/2.5_week/2.5_day)를 Worker가 프록시하며 Cache API에 10분 보관, 동시 요청을 병합해 교실 40명이 USGS를 각각 호출하지 않습니다. 응답 헤더 `x-ee-fetched-at`(서버 수신), 피드 `metadata.generated`(USGS 생성)와 브라우저 수신 시각을 구분해 표시합니다.
- 라이선스: 미국 정부 저작물(public domain). 인용: USGS Earthquake Hazards Program, ComCat.

## 화산 — Smithsonian GVP WFS (API → 스냅샷)

- 주소: https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows (GetCapabilities로 확인)
- typeName `GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes`, CRS EPSG:4326, DescribeFeatureType에서 확인한 필드(Volcano_Number, Volcano_Name, Country, Region, Primary_Volcano_Type, Last_Eruption_Year, Elevation, Latitude, Longitude 등)만 사용.
- 페이지네이션: `count=1000&startIndex=...&sortBy=Volcano_Number`. numberMatched 1,214 = 수집 1,214.
- 인용: Global Volcanism Program, Volcanoes of the World, Smithsonian Institution (https://volcano.si.edu/gvp_citation.cfm 의 안내를 따릅니다).

## 판 경계 — USGS ArcGIS 서비스 (API → 스냅샷)

- 주소: https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer/1 (layer "Plates", esriGeometryPolyline, currentVersion 11.5)
- 실제 필드 OBJECTID, NAME, LABEL만 사용. `outSR=4326`, `resultOffset` 페이지(1000), `exceededTransferLimit` 처리. 서비스 count 1,175 = 수집 1,175.
- 기본 화면은 유형(LABEL) 구분 없이 한 종류의 선. 원자료에 이동 방향이 없으므로 화살표를 만들지 않습니다.

## 육지 — Natural Earth (파일)

- world-atlas 2.0.2 패키지의 land-110m.json / land-50m.json (TopoJSON). Natural Earth는 public domain, world-atlas는 ISC.
- 국가 경계·국가 이름은 포함하지 않습니다.

## 교사용 해설에 들어가는 한계 (앱 /sources·보고서·공개 카드에 표시)

- 지진은 대체로 판 경계 부근에 집중되지만 경계 밖에서도 발생합니다.
- 화산 위치 목록은 '지금 분화 중인 화산 목록'이 아닙니다.
- 지진과 화산의 자료 기간이 다르므로 같은 기간 발생 횟수로 비교하지 않습니다.
- 최근 지진이 없는 지역을 안전한 지역으로 판정하지 않습니다.
- USGS 목록은 관측망·수록 기준 때문에 완전한 기록이 아닙니다. 점의 크기는 규모 표시이며 피해 반경이 아닙니다.
- 판 경계는 연구 모형이며 학생 선을 점수로 평가하지 않습니다.
- 관측 자료 / 연구 모형 / 사용자 추론 / 장식 이미지를 화면에서 구분합니다(레이어 라벨, 범례, 공개 카드 문구).
- 재생은 관측 기록의 시간순 표시이며 예측·지진파 시뮬레이션이 아닙니다. 저장 UTC, 표시 KST+UTC.

## 갱신

`npm run data:fetch` 후 변경된 `public/data/*`와 `manifest.json`을 커밋합니다. 네트워크가 막힌 환경에서는 스크립트가 실패를 보고하고 기존 스냅샷을 유지합니다. 허구 자료로 대체하지 않습니다.
