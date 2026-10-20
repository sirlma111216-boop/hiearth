// E2E: 교사 1 + 학생 2, 분리된 브라우저 컨텍스트. 수업 화면을 교사가 넘기고 학생이 따라오며 활동한다.
import { test, expect, type Browser, type Page } from '@playwright/test'

const TEACHER_SECRET = process.env.TEACHER_SECRET ?? 'local-dev-teacher-secret-2026'

async function newPage(browser: Browser, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR' })
  const page = await ctx.newPage()
  await page.addInitScript(() => { localStorage.setItem('ee.settings.v1', JSON.stringify({ soundEnabled: false, preferredMapMode: '2d', lowPower: true, landingMotion: false })) })
  return page
}

async function drawLine(page: Page) {
  const canvas = page.locator('.activity-stage canvas, .workspace-map canvas').first()
  await expect(canvas).toBeVisible()
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  const x = box.x + box.width * 0.55, y = box.y + box.height * 0.5
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 6, y + i * 10)
  await page.mouse.up()
}

const nextBtn = (page: Page) => page.locator('.lesson-nav').getByRole('button', { name: '다음', exact: true })
const readout = (page: Page) => page.locator('.lesson-nav .readout')
/** 교사: 옆 목록에서 n단계 첫 화면으로 */
async function teacherStep(page: Page, n: number) {
  await page.locator('.stage-list .stage-item').nth(n - 1).click()
  await expect(readout(page)).toContainText(n + '/8 ·')
  await expect(readout(page)).toContainText('(1/')
}
/** 교사: 다음 화면으로 넘기고 전환이 끝날 때까지 기다린다 */
async function teacherNext(page: Page) {
  const before = await readout(page).innerText()
  await nextBtn(page).click()
  await expect(readout(page)).not.toHaveText(before)
}

async function submitGuess(page: Page, label: string) {
  await page.getByRole('button', { name: label }).click()
  await page.getByRole('dialog').getByRole('button', { name: '제출', exact: true }).click()
}

test('교실 전체 흐름', async ({ browser }) => {
  test.setTimeout(300_000)
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
    await expect(page.locator('.stepbar')).toBeVisible({ timeout: 60_000 })
  }
  await expect(readout(s1)).toContainText('1/8')

  // 교사 화면 참가 현황
  await teacher.getByRole('tab', { name: '진행' }).click()
  await expect(teacher.locator('.participant')).toHaveCount(2)

  // ---- 학생이 교사 이벤트를 보내면 거절 ----
  const forged = await s1.evaluate(async (code) => {
    const ws = new WebSocket(`ws://${location.host}/api/rooms/${code}/ws?as=student`)
    await new Promise((r) => (ws.onopen = r))
    const ack = new Promise<string>((r) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'ack') r(JSON.stringify(m)) } })
    ws.send(JSON.stringify({ v: 1, clientMessageId: 'forge', type: 'teacher:setScreen', screen: { step: 10, sub: 2 } }))
    const res = await ack
    ws.close()
    return res
  }, code)
  expect(JSON.parse(forged).ok).toBe(false)

  // 학생은 교사보다 앞 화면으로 못 간다
  await expect(nextBtn(s1)).toBeDisabled()

  // ---- 교사: 3단계(관찰)로 → 학생 따라옴 ----
  await teacherStep(teacher, 3)
  await expect(readout(s1)).toContainText('3/8', { timeout: 15_000 })
  await expect(s1.locator('.activity-stage canvas')).toBeVisible({ timeout: 60_000 })
  // 관찰 응답 저장
  await s1.locator('.choice').first().click()
  await s1.getByPlaceholder('한두 문장이면 충분합니다.').fill('태평양 가장자리에 띠처럼 모여 있다')

  // ---- 교사: 4단계 추론 → 4-2 그리기 화면 ----
  await teacherStep(teacher, 4)
  await teacherNext(teacher)
  await expect(readout(s1)).toContainText('(2/2)', { timeout: 15_000 })
  await expect(s1.locator('.activity-stage canvas')).toBeVisible({ timeout: 60_000 })

  // 학생 1: 선 그리기와 제출 (다음은 제출 전까지 막힘)
  await expect(nextBtn(s1)).toBeDisabled()
  await s1.getByRole('button', { name: '그리기', exact: true }).click()
  await drawLine(s1)
  await expect(s1.getByText('그린 선 1/12')).toBeVisible()
  await submitGuess(s1, '최초 추론 제출')
  await expect(s1.getByText('최초 추론이 서버에 저장되었습니다.')).toBeVisible()
  await expect(teacher.locator('.participant').filter({ hasText: '파란고래' }).locator('.flag.on').first()).toBeVisible()

  // 학생 2 (모바일): 바텀시트로 그리기 도구 열고 제출
  await expect(s2.locator('.activity-stage canvas')).toBeVisible({ timeout: 60_000 })
  await s2.locator('.activity-stage').scrollIntoViewIfNeeded()
  await s2.getByRole('button', { name: '추론', exact: true }).click()
  await s2.getByRole('button', { name: '그리기', exact: true }).click()
  await expect(s2.locator('.sheet')).not.toHaveClass(/is-open/)
  await s2.waitForTimeout(500)
  await drawLine(s2)
  await s2.getByRole('button', { name: '추론', exact: true }).click()
  await submitGuess(s2, '최초 추론 제출')
  await expect(s2.getByText('최초 추론이 서버에 저장되었습니다.')).toBeVisible()

  // ---- 교사: 5단계 공개 → 학생에게 다른 선이 보임 ----
  await teacherStep(teacher, 5)
  await expect(readout(s1)).toContainText('5/8', { timeout: 15_000 })
  await expect(s1.locator('.layer-toggle', { hasText: '다른 사람 선' })).not.toContainText('공개 전')

  // 5-2 돌아보기 (자기 분석)
  await teacherNext(teacher)
  await expect(s1.locator('.mini-map img').first()).toBeVisible({ timeout: 20_000 })
  await s1.locator('.choice').first().click()

  // ---- 6단계 화산: 6-2에서 공개 카드 ----
  await teacherStep(teacher, 6)
  await teacherNext(teacher)
  await expect(s1.getByRole('dialog')).toContainText('화산의 위치', { timeout: 20_000 })
  await s1.getByRole('button', { name: '지도에서 확인하기' }).click()

  // ---- 6-5 수정 추론: 초안 복사·제출 ----
  await teacherNext(teacher)
  await teacherNext(teacher)
  await teacherNext(teacher)
  await expect(readout(s1)).toContainText('6/8', { timeout: 15_000 })
  await expect(readout(s1)).toContainText('(5/5)')
  await expect(s1.getByText('그린 선 1/12')).toBeVisible({ timeout: 20_000 })
  await submitGuess(s1, '수정 추론 제출')
  await expect(s1.getByText('수정 추론이 서버에 저장되었습니다.')).toBeVisible()

  // ---- 7단계 판 경계: 7-2 공개 카드, 7-3 비교 ----
  await teacherStep(teacher, 7)
  await teacherNext(teacher)
  await expect(s1.getByRole('dialog')).toContainText('판 경계', { timeout: 20_000 })
  await s1.getByRole('button', { name: '지도에서 확인하기' }).click()
  await teacherNext(teacher)
  await expect(s1.locator('.mini-map img')).toHaveCount(2, { timeout: 20_000 })

  // ---- 8단계 설명 ----
  await teacherStep(teacher, 8)
  await expect(readout(s1)).toContainText('8/8', { timeout: 15_000 })
  await s1.getByLabel(/나의 설명/).fill('태평양 가장자리를 따라 지진과 화산이 띠를 이룬다.')
  await s1.getByRole('button', { name: '설명 저장' }).click()
  await expect(s1.getByText('서버에 저장되었습니다.')).toBeVisible()
  await teacherNext(teacher)
  await s1.getByLabel('내 말로 쓰기').fill('규모 5 이상만 보았다.')
  await s1.getByRole('button', { name: '한계 저장' }).click()

  // ---- 새로고침 후 복구 (같은 화면, 기록 유지) ----
  await s1.reload()
  await expect(s1.locator('.stepbar')).toBeVisible({ timeout: 60_000 })
  await expect(readout(s1)).toContainText('8/8')

  // ---- 결론 → 보고서 (8-3, 8-4) ----
  await teacherNext(teacher)
  await teacherNext(teacher)
  await s1.getByRole('link', { name: '탐구 카드 열기' }).click()
  await expect(s1.locator('.report')).toContainText('처음 생각')
  await expect(s1.locator('.report')).toContainText('관찰 기록과 자기 분석')
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

  // 쿠키 없는 컨텍스트에서는 교사 API 거부
  const anon = await browser.newContext()
  const res = await anon.request.get(`http://localhost:5173/api/teach/rooms/${code}/state`)
  expect(res.status()).toBe(401)
  await anon.close()
})

test('혼자 탐사: 처음부터 끝까지', async ({ browser }) => {
  test.setTimeout(240_000)
  const page = await newPage(browser)
  await page.goto('/explore')
  await expect(page.locator('.stepbar')).toBeVisible({ timeout: 60_000 })
  // 내레이션을 건너뛰고 화면을 차례로 넘긴다
  const closeReveal = async () => { const b = page.getByRole('button', { name: '지도에서 확인하기' }); if (await b.isVisible().catch(() => false)) await b.click() }
  const goNext = async () => { await closeReveal(); await nextBtn(page).click(); await page.waitForTimeout(300) }
  for (let i = 0; i < 6; i++) await goNext() // → 3-2 (시간)
  await expect(readout(page)).toContainText('3/8')
  await goNext(); await goNext(); await goNext() // → 4-2 그리기
  await expect(readout(page)).toContainText('4/8')
  await expect(nextBtn(page)).toBeDisabled()
  await page.getByRole('button', { name: '그리기', exact: true }).click()
  await drawLine(page)
  await submitGuess(page, '최초 추론 제출')
  await expect(page.getByText('최초 추론을 이 기기에 저장했습니다.')).toBeVisible()
  await goNext(); await goNext() // 5-1, 5-2
  await expect(page.locator('.mini-map img').first()).toBeVisible({ timeout: 20_000 })
  await goNext(); await goNext() // 6-1, 6-2 (화산 카드)
  await expect(page.getByRole('dialog')).toContainText('화산의 위치', { timeout: 20_000 })
  await goNext(); await goNext(); await goNext() // 6-3, 6-4, 6-5
  await expect(readout(page)).toContainText('(5/5)')
  await submitGuess(page, '수정 추론 제출')
  await goNext(); await goNext() // 7-1, 7-2 (경계 카드)
  await expect(page.getByRole('dialog')).toContainText('판 경계', { timeout: 20_000 })
  await goNext(); await goNext() // 7-3, 8-1
  await page.getByLabel(/나의 설명/).fill('지진과 화산이 같은 띠 위에 있다.')
  await page.getByRole('button', { name: '설명 저장' }).click()
  await goNext(); await goNext(); await goNext() // 8-2, 8-3, 8-4
  await expect(readout(page)).toContainText('(4/4)')
  await page.getByRole('link', { name: '탐구 카드 열기' }).click()
  await expect(page.locator('.report')).toContainText('탐구 질문')
  await expect(page.locator('.report-map img').first()).toBeVisible()
  // 다시 열면 이어하기 대화상자
  await page.goto('/explore')
  await expect(page.getByRole('dialog')).toContainText('이전에 하던 탐사가 있습니다')
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
