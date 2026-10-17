// 지구 탐사대 — 실제 공공 자료 스냅샷 수집 스크립트
// 실행: node scripts/fetch-data.mjs [--skip-earthquakes] [--skip-volcanoes] [--skip-plates] [--skip-land]
// 결과: public/data/*.json + public/data/manifest.json
// 이 스크립트는 개발 시점에 한 번 실행한다. 앱 실행 중에는 호출하지 않는다.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'public', 'data')
mkdirSync(OUT, { recursive: true })

const args = new Set(process.argv.slice(2))
const retrievedAt = new Date().toISOString()
const log = (...a) => console.log('[fetch-data]', ...a)

// ---- 수업용 지진 자료 조건 (확정값은 README/DATA_SOURCES에 동일하게 기록) ----
const EQ = {
  start: '2015-01-01T00:00:00',
  end: '2025-01-01T00:00:00',
  minMagnitude: 5.0,
  years: Array.from({ length: 10 }, (_, i) => 2015 + i),
}

const USGS_FDSN = 'https://earthquake.usgs.gov/fdsnws/event/1'
const USGS_PLATES = 'https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer/1'
const GVP_WFS = 'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows'
const GVP_TYPE = 'GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes'

async function fetchJson(url, tries = 4) {
  let delay = 1500
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'earth-expedition-data-script/1.0' }, signal: AbortSignal.timeout(120_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return await res.json()
    } catch (e) {
      if (i === tries - 1) throw e
      log('재시도', i + 1, String(e).slice(0, 120))
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
    }
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const round = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)

function writeJson(name, obj) {
  const text = JSON.stringify(obj)
  const file = join(OUT, name)
  writeFileSync(file, text)
  const gz = gzipSync(Buffer.from(text)).length
  log(`${name}: ${(text.length / 1024).toFixed(0)} KB (gzip ${(gz / 1024).toFixed(0)} KB)`)
  return { path: `data/${name}`, bytes: text.length, gzipBytes: gz, sha256: sha256(text) }
}

const manifestPath = join(OUT, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { schema: 'earth-expedition-manifest-v1', datasets: {} }

// ---- 지진 ----
async function earthquakes() {
  const files = []
  const seen = new Set()
  const rejected = { outOfRange: 0, badTime: 0, duplicate: 0, noId: 0 }
  let total = 0, expected = 0, withNullMag = 0, withNullDepth = 0
  let minTime = Infinity, maxTime = -Infinity
  for (const y of EQ.years) {
    const start = `${y}-01-01T00:00:00`, end = `${y + 1}-01-01T00:00:00`
    const q = `format=geojson&starttime=${start}&endtime=${end}&minmagnitude=${EQ.minMagnitude}&orderby=time-asc`
    const count = await fetchJson(`${USGS_FDSN}/count?${q}`)
    if (count.count > count.maxAllowed) throw new Error(`${y}: ${count.count}건은 요청 한도(${count.maxAllowed}) 초과 — 분할 필요`)
    expected += count.count
    const fc = await fetchJson(`${USGS_FDSN}/query?${q}`)
    const rows = []
    for (const f of fc.features) {
      const p = f.properties || {}
      const id = f.id
      if (!id) { rejected.noId++; continue }
      if (seen.has(id)) { rejected.duplicate++; continue }
      const [lon, lat, depth] = f.geometry?.coordinates ?? []
      if (typeof lon !== 'number' || typeof lat !== 'number' || lon < -180 || lon > 180 || lat < -90 || lat > 90) { rejected.outOfRange++; continue }
      if (typeof p.time !== 'number' || !Number.isFinite(p.time)) { rejected.badTime++; continue }
      seen.add(id)
      const mag = typeof p.mag === 'number' ? round(p.mag, 2) : null
      const dep = typeof depth === 'number' ? round(depth, 1) : null
      if (mag == null) withNullMag++
      if (dep == null) withNullDepth++
      minTime = Math.min(minTime, p.time); maxTime = Math.max(maxTime, p.time)
      // columns: id, time(ms UTC), lon, lat, mag, depth(km), place, url
      rows.push([id, p.time, round(lon, 3), round(lat, 3), mag, dep, p.place ?? null, p.url ?? null])
    }
    total += rows.length
    log(`${y}: API count ${count.count}, 수신 ${fc.features.length}, 보존 ${rows.length}`)
    const info = writeJson(`earthquakes-${y}.json`, {
      schema: 'eq-compact-v1',
      columns: ['id', 'time', 'lon', 'lat', 'mag', 'depth', 'place', 'url'],
      year: y,
      apiCount: count.count,
      rows,
    })
    files.push({ year: y, apiCount: count.count, recordCount: rows.length, ...info })
  }
  manifest.datasets.earthquakesLesson = {
    id: 'usgs-lesson-2015-2025-m5',
    kind: 'observation',
    provider: 'USGS Earthquake Hazards Program (FDSN Event Web Service)',
    sourceUrl: `${USGS_FDSN}/`,
    retrievedAt,
    coverageStart: '2015-01-01T00:00:00Z',
    coverageEnd: '2025-01-01T00:00:00Z',
    filters: { minmagnitude: EQ.minMagnitude, region: 'global', orderby: 'time-asc', splitBy: 'year' },
    datasetVersion: `usgs-fdsn-${retrievedAt.slice(0, 10)}`,
    recordCount: total,
    expectedCount: expected,
    rejected,
    nullMagnitudeCount: withNullMag,
    nullDepthCount: withNullDepth,
    firstEventTime: new Date(minTime).toISOString(),
    lastEventTime: new Date(maxTime).toISOString(),
    license: 'U.S. Government work, public domain. Citation: U.S. Geological Survey Earthquake Hazards Program, Earthquake Catalog (ComCat).',
    note: 'USGS ComCat은 관측망·수록 기준에 따라 수록 범위가 다르며 모든 지진의 완전한 기록이 아니다. 수업용으로 규모 5.0 이상만 포함한다.',
    files,
  }
}

// ---- 화산 (GVP WFS) ----
async function volcanoes() {
  const pageSize = 1000
  let startIndex = 0, numberMatched = null
  const seen = new Set()
  const rows = []
  const rejected = { outOfRange: 0, duplicate: 0, noNumber: 0 }
  for (;;) {
    const url = `${GVP_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=${encodeURIComponent(GVP_TYPE)}&outputFormat=application/json&count=${pageSize}&startIndex=${startIndex}&sortBy=Volcano_Number`
    const fc = await fetchJson(url)
    numberMatched = fc.numberMatched ?? numberMatched
    const n = fc.features?.length ?? 0
    for (const f of fc.features ?? []) {
      const p = f.properties || {}
      const num = p.Volcano_Number
      if (typeof num !== 'number') { rejected.noNumber++; continue }
      if (seen.has(num)) { rejected.duplicate++; continue }
      const coords = f.geometry?.coordinates
      const lon = typeof p.Longitude === 'number' ? p.Longitude : coords?.[0]
      const lat = typeof p.Latitude === 'number' ? p.Latitude : coords?.[1]
      if (typeof lon !== 'number' || typeof lat !== 'number' || lon < -180 || lon > 180 || lat < -90 || lat > 90) { rejected.outOfRange++; continue }
      seen.add(num)
      // columns: number, name, lon, lat, country, region, type, lastEruptionYear, elevation
      rows.push([num, p.Volcano_Name ?? null, round(lon, 3), round(lat, 3), p.Country ?? null, p.Region ?? null, p.Primary_Volcano_Type ?? null, typeof p.Last_Eruption_Year === 'number' ? p.Last_Eruption_Year : null, typeof p.Elevation === 'number' ? p.Elevation : null])
    }
    log(`GVP page startIndex=${startIndex}: ${n}건 (numberMatched ${numberMatched})`)
    if (n < pageSize) break
    startIndex += pageSize
    if (startIndex > 20000) throw new Error('GVP 페이지네이션 폭주')
  }
  const info = writeJson('volcanoes.json', {
    schema: 'volcano-compact-v1',
    columns: ['number', 'name', 'lon', 'lat', 'country', 'region', 'type', 'lastEruptionYear', 'elevation'],
    rows,
  })
  manifest.datasets.volcanoes = {
    id: 'gvp-holocene',
    kind: 'catalog',
    provider: 'Smithsonian Institution, Global Volcanism Program (Volcanoes of the World, Holocene list)',
    sourceUrl: `${GVP_WFS}?service=WFS&version=2.0.0&typeName=${GVP_TYPE}`,
    typeName: GVP_TYPE,
    crs: 'EPSG:4326',
    retrievedAt,
    coverageStart: null,
    coverageEnd: null,
    filters: { epoch: 'Holocene' },
    datasetVersion: `gvp-votw-wfs-${retrievedAt.slice(0, 10)}`,
    recordCount: rows.length,
    expectedCount: numberMatched,
    rejected,
    license: 'Global Volcanism Program, 2024. [Database] Volcanoes of the World (v. 5.x). Distributed by Smithsonian Institution. Citation required per GVP terms; see https://volcano.si.edu/gvp_citation.cfm',
    note: 'Holocene(약 1만 년 이내 활동 흔적) 화산 위치 목록이다. 지금 분화 중인 화산 목록이 아니다. 지진 자료와 기간이 다르므로 같은 기간 발생 횟수로 비교하지 않는다.',
    ...info,
  }
}

// ---- 판 경계 (USGS ArcGIS) ----
async function plates() {
  const meta = await fetchJson(`${USGS_PLATES}?f=json`)
  const pageSize = Math.min(meta.maxRecordCount ?? 1000, 1000)
  const countRes = await fetchJson(`${USGS_PLATES}/query?where=1%3D1&returnCountOnly=true&f=json`)
  const expected = countRes.count
  const features = []
  const seen = new Set()
  let offset = 0
  for (;;) {
    const url = `${USGS_PLATES}/query?where=1%3D1&outFields=OBJECTID,NAME,LABEL&outSR=4326&returnGeometry=true&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${pageSize}&f=geojson`
    const fc = await fetchJson(url)
    const n = fc.features?.length ?? 0
    for (const f of fc.features ?? []) {
      const oid = f.properties?.OBJECTID ?? f.id
      if (seen.has(oid)) continue
      seen.add(oid)
      const g = f.geometry
      if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString')) continue
      const rnd = (c) => c.map(([x, y]) => [round(x, 3), round(y, 3)])
      const geometry = g.type === 'LineString' ? { type: 'LineString', coordinates: rnd(g.coordinates) } : { type: 'MultiLineString', coordinates: g.coordinates.map(rnd) }
      features.push({ type: 'Feature', id: oid, properties: { name: f.properties?.NAME ?? null, label: f.properties?.LABEL ?? null }, geometry })
    }
    const exceeded = fc.properties?.exceededTransferLimit ?? fc.exceededTransferLimit ?? false
    log(`plates offset=${offset}: ${n}건 exceededTransferLimit=${exceeded}`)
    if (n < pageSize && !exceeded) break
    if (n === 0) break
    offset += n
    if (offset > 50000) throw new Error('plates 페이지네이션 폭주')
  }
  if (features.length !== expected) log(`경고: 판 경계 ${features.length}건 수집, 서비스 count ${expected}`)
  const labels = {}
  for (const f of features) labels[f.properties.label] = (labels[f.properties.label] ?? 0) + 1
  const info = writeJson('plates.json', { type: 'FeatureCollection', features })
  manifest.datasets.plateBoundaries = {
    id: 'usgs-plate-boundaries',
    kind: 'model',
    provider: 'USGS Earthquake Hazards Program ArcGIS service eq/map_plateboundaries (layer 1 "Plates")',
    sourceUrl: `${USGS_PLATES}`,
    serviceVersion: meta.currentVersion,
    fields: (meta.fields ?? []).map((f) => f.name),
    sourceSpatialReference: meta.sourceSpatialReference?.wkid ?? null,
    requestedOutSR: 4326,
    retrievedAt,
    coverageStart: null,
    coverageEnd: null,
    filters: { where: '1=1', pageSize },
    datasetVersion: `usgs-plates-${retrievedAt.slice(0, 10)}`,
    recordCount: features.length,
    expectedCount: expected,
    labelCounts: labels,
    coordinatePrecision: 3,
    license: 'USGS public service; layer metadata carries no copyright text. Plate boundary lines are a research model, not an observation record.',
    note: '판 경계는 연구 모형이다. 기본 화면에서는 유형 구분 없이 한 종류의 선으로 표시한다. 자료에 이동 방향 정보가 없으므로 화살표를 만들지 않는다.',
    ...info,
  }
}

// ---- 육지 (Natural Earth via world-atlas) ----
function land() {
  const pkg = join(ROOT, 'node_modules', 'world-atlas')
  if (!existsSync(pkg)) { log('world-atlas 패키지가 없어 육지 자료를 건너뜀 (npm install 후 다시 실행)'); return }
  const pkgJson = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'))
  const files = []
  for (const name of ['land-110m.json', 'land-50m.json']) {
    const text = readFileSync(join(pkg, name), 'utf8')
    writeFileSync(join(OUT, name), text)
    files.push({ path: `data/${name}`, bytes: text.length, gzipBytes: gzipSync(Buffer.from(text)).length, sha256: sha256(text) })
    log(`${name}: ${(text.length / 1024).toFixed(0)} KB`)
  }
  manifest.datasets.land = {
    id: 'natural-earth-land',
    kind: 'basemap',
    provider: 'Natural Earth (public domain), packaged as TopoJSON by world-atlas',
    sourceUrl: 'https://www.naturalearthdata.com/',
    packageVersion: pkgJson.version,
    naturalEarthVersion: '4.1.0 (world-atlas 2.x 기준)',
    retrievedAt,
    datasetVersion: `world-atlas-${pkgJson.version}`,
    license: 'Natural Earth: public domain (https://www.naturalearthdata.com/about/terms-of-use/). world-atlas: ISC License.',
    note: '학습용 지구 표면은 이 실제 지리 자료로 그린다. 국가 경계와 국가 이름은 기본 숨김이며 이 묶음에 포함하지 않는다.',
    files,
  }
}

const main = async () => {
  if (!args.has('--skip-earthquakes')) await earthquakes()
  if (!args.has('--skip-volcanoes')) await volcanoes()
  if (!args.has('--skip-plates')) await plates()
  if (!args.has('--skip-land')) land()
  manifest.generatedAt = retrievedAt
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  log('manifest 저장 완료:', manifestPath)
}
main().catch((e) => { console.error('[fetch-data] 실패:', e); process.exit(1) })
