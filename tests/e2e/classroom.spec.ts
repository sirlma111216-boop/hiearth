// E2E: 교사 1 + 학생 2, 분리된 브라우저 컨텍스트. 코드 입장 → 관찰 → 추론 → 공개 → 화산 → 수정 → 경계 비교 → 보고서.
import { test, expect, type Browser, type Page } from '@playwright/test'

const TEACHER_SECRET = process.env.TEACHER_SECRET ?? 'local-dev-teacher-secret-2026'

async function newPage(browser: Browser, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR' })
  const page = await ctx.newPage()
  // 3D 대신 2D로 고정해 헤드리스에서도 안정적으로 그린다
  await page.addInitScript(() => { localStorage.setItem('ee.settings.v1', JSON.stringify({ soundEnabled: false, preferredMapMode: '2d', lowPower: true })) })
  return page
}

async function drawLine(page: Page) {
  const canvas = page.locator('.workspace-map canvas')
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const x = box.x + box.width * 0.55, y = box.y + box.height * 0.5
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 6, y + i * 10)
  await page.mouse.up()
}

test('교실 전체 흐름', async ({ browser }) => {
  test.setTimeout(240_000)
  const teacher = await newPage(browser)
  const s1 = await newPage(browser)
  const s2 = await newPage(browser, { width: 390, height: 844 })

  // ---- 교사: 탐사실 생성 ----
  await teacher.goto('/teach')
  await teacher.getByLabel('활동 제목').fill('E2E 탐사')
  await teacher.getByLabel('참여 상한').fill('5')
  await teacher.getByLabel('교사 비밀 값').fill(TEACHER_SECRET)
  await teacher.getByRole('button', { name: '탐사실 만들기' }).click()
  const dialog = teacher.getByRole('dialog')
  await expect(dialog).toContainText('입장 코드')
  const code = (await dialog.locator('strong.num').innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)
  const recovery = await dialog.getByLabel('교사 복구 코드 (지금 한 번만 표시됩니다)').inputValue()
  expect(recovery.length).toBeGreaterThan(20)
  await teacher.getByRole('button', { name: '대기실로 이동' }).click()
  await expect(teacher.locator('.room-code')).toHaveText(code)
  await expect(teacher.locator('.qr-card img')).toBeVisible()

  // ---- 학생 1·2 입장 ----
  for (const [page, nick] of [[s1, '파란고래'], [s2, '붉은여우']] as const) {
    await page.goto(`/join?code=${code}`)
    await page.getByLabel('별명').fill(nick)
    await expect(page.getByRole('button', { name: '입장하기' })).toBeEnabled()
    await page.getByRole('button', { name: '입장하기' }).click()
    await expect(page).toHaveURL(new RegExp(`/room/${code}$`))
    await expect(page.locator('.workspace-map canvas')).toBeVisible({ timeout: 60_000 })
  }

  // 교사 화면 참가 현황
  await teacher.getByRole('tab', { name: '진행' }).click()
  await expect(teacher.locator('.participant')).toHaveCount(2)
  await expect(teacher.locator('.participant').filter({ hasText: '파란고래' })).toBeVisible()

  // ---- 공개 전: 학생이 교사 이벤트를 보내도 거절되는지(브라우저 WS 직접 전송) ----
  const forged = await s1.evaluate(async (code) => {
    const ws = new WebSocket(`ws://${location.host}/api/rooms/${code}/ws?as=student`)
    await new Promise((r) => (ws.onopen = r))
    const ack = new Promise<string>((r) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'ack') r(JSON.stringify(m)) } })
    ws.send(JSON.stringify({ v: 1, clientMessageId: 'forge', type: 'teacher:setStage', stage: 'wrapUp' }))
    const res = await ack
    ws.close()
    return res
  }, code)
  expect(JSON.parse(forged).ok).toBe(false)

  // ---- 교사: 최초 추론 단계 열기 ----
  await teacher.locator('.stage-list .stage-item').nth(1).click()
  await expect(s1.locator('.stage-banner')).toContainText('최초 추론')

  // ---- 학생 1: 선 그리기와 제출 ----
  await drawLine(s1)
  await expect(s1.getByText('그린 선 1/12')).toBeVisible()
  await s1.getByRole('button', { name: '최초 추론 제출' }).click()
  await s1.getByRole('dialog').getByRole('button', { name: '제출', exact: true }).click()
  await expect(s1.getByText('최초 추론이 서버에 저장되었습니다.')).toBeVisible()
  await expect(teacher.locator('.participant').filter({ hasText: '파란고래' }).locator('.flag.on').first()).toBeVisible()

  // 학생 2 (모바일): 바텀시트로 그리기 도구 열고 제출
  await s2.getByRole('button', { name: '추론', exact: true }).click()
  await s2.getByRole('button', { name: '그리기', exact: true }).click()
  await expect(s2.locator('.sheet')).not.toHaveClass(/is-open/)
  await s2.waitForTimeout(500)
  await drawLine(s2)
  await s2.getByRole('button', { name: '추론', exact: true }).click()
  await s2.getByRole('button', { name: '최초 추론 제출' }).click()
  await s2.getByRole('dialog').getByRole('button', { name: '제출', exact: true }).click()
  await expect(s2.getByText('최초 추론이 서버에 저장되었습니다.')).toBeVisible()

  // ---- 공개 전에는 다른 학생 선이 보이지 않는다 (레이어 '공개 전' 표시) ----
  await expect(s1.locator('.layer-toggle', { hasText: '다른 사람 선' })).toContainText('공개 전')

  // ---- 교사: 추론 공개 단계 ----
  await teacher.locator('.stage-list .stage-item').nth(2).click()
  await expect(s1.locator('.stage-banner')).toContainText('추론 공개')
  await expect(s1.locator('.layer-toggle', { hasText: '다른 사람 선' })).not.toContainText('공개 전')

  // ---- 화산 공개 → 수정 추론 → 경계 비교 → 설명 ----
  await teacher.locator('.stage-list .stage-item').nth(3).click()
  await expect(s1.getByRole('dialog')).toContainText('화산의 위치')
  await s1.getByRole('button', { name: '지도에서 확인하기' }).click()
  await teacher.locator('.stage-list .stage-item').nth(4).click()
  await expect(s1.locator('.stage-banner')).toContainText('수정 추론')
  await expect(s1.getByText('그린 선 1/12')).toBeVisible() // 최초 추론이 초안으로 복사됨
  await s1.getByRole('button', { name: '수정 추론 제출' }).click()
  await s1.getByRole('dialog').getByRole('button', { name: '제출', exact: true }).click()
  await expect(s1.getByText('수정 추론이 서버에 저장되었습니다.')).toBeVisible()

  await teacher.locator('.stage-list .stage-item').nth(5).click()
  await expect(s1.getByRole('dialog')).toContainText('판 경계')
  await s1.getByRole('button', { name: '지도에서 확인하기' }).click()
  await teacher.locator('.stage-list .stage-item').nth(6).click()
  await s1.getByLabel('나의 설명').fill('태평양 가장자리를 따라 지진과 화산이 띠를 이룬다.')
  await s1.getByLabel('자료의 한계').fill('규모 5 이상만 보았다.')
  await s1.getByRole('button', { name: '설명 저장' }).click()
  await expect(s1.getByText('설명이 서버에 저장되었습니다.')).toBeVisible()

  // ---- 새로고침 후 복구 ----
  await s1.reload()
  await expect(s1.locator('.workspace-map canvas')).toBeVisible({ timeout: 60_000 })
  await expect(s1.locator('.stage-banner')).toContainText('설명 작성')

  // ---- 결과 정리와 보고서 ----
  await teacher.locator('.stage-list .stage-item').nth(7).click()
  await s1.getByRole('link', { name: '탐구 카드 보기' }).click()
  await expect(s1.locator('.report')).toContainText('처음 생각')
  await expect(s1.locator('.report-quote').first()).toContainText('태평양 가장자리')
  await expect(s1.locator('.report-map img').first()).toBeVisible()

  // 학생 2는 학생 1의 보고서를 볼 수 없다
  const s1Url = s1.url()
  await s2.goto(s1Url)
  await expect(s2.getByText('보고서를 열 수 없습니다')).toBeVisible()

  // 교사 결과 표와 CSV
  await teacher.getByRole('tab', { name: '결과' }).click()
  await expect(teacher.locator('table.data tbody tr')).toHaveCount(2)
  const csv = await teacher.request.get(`/api/teach/rooms/${code}/export?format=csv`)
  expect(csv.ok()).toBeTruthy()
  expect(await csv.text()).toContain('파란고래')

  // 다른 컨텍스트(쿠키 없음)에서는 교사 API 거부
  const anon = await browser.newContext()
  const res = await anon.request.get(`http://localhost:5173/api/teach/rooms/${code}/state`)
  expect(res.status()).toBe(401)
  await anon.close()
})

test('혼자 탐사와 로컬 보고서', async ({ browser }) => {
  const page = await newPage(browser)
  await page.goto('/explore')
  await expect(page.locator('.workspace-map canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await drawLine(page)
  await page.getByRole('button', { name: '최초 추론 제출' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '제출', exact: true }).click()
  await expect(page.getByText('최초 추론을 이 기기에 저장했습니다.')).toBeVisible()
  const closeReveal = async () => {
    const dlg = page.getByRole('button', { name: '지도에서 확인하기' })
    if (await dlg.isVisible().catch(() => false)) await dlg.click()
  }
  for (let i = 0; i < 6; i++) {
    await closeReveal()
    await page.getByRole('button', { name: '다음', exact: true }).click()
    await page.waitForTimeout(400)
  }
  await closeReveal()
  await expect(page.locator('.stage-banner')).toContainText('결과 정리')
  await page.getByRole('link', { name: '탐구 카드 보기' }).click()
  await expect(page.locator('.report')).toContainText('탐구 질문')
  await expect(page.locator('.report-map img').first()).toBeVisible()
})

test('랜딩과 출처·설정 페이지', async ({ browser }) => {
  const page = await newPage(browser, { width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('흩어진 점에서')
  await expect(page.getByRole('link', { name: '혼자 탐사하기' })).toBeVisible()
  await page.goto('/sources')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('자료 출처')
  await page.goto('/settings')
  await expect(page.getByText('파일 없음 · 무음').first()).toBeVisible()
  await page.goto('/showcase')
  await expect(page.getByText('시연 모드').first()).toBeVisible({ timeout: 60_000 })
})
