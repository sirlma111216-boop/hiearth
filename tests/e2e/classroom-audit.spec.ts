import { test, expect, type Browser, type Page } from '@playwright/test'
import { LESSON_SCREENS } from '../../shared/domain/lesson'

async function openPage(browser: Browser, mobile = false) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    isMobile: mobile, hasTouch: mobile, locale: 'ko-KR',
  })
  const page = await context.newPage()
  await page.addInitScript(() => localStorage.setItem('ee.settings.v1', JSON.stringify({
    preferredMapMode: '2d', lowPower: true, soundEnabled: false, landingMotion: false,
  })))
  return page
}

const readout = (page: Page) => page.locator('.lesson-nav .readout')
async function next(page: Page) {
  const before = await readout(page).innerText()
  await page.locator('.lesson-nav').getByRole('button', { name: '다음', exact: true }).click()
  await expect(readout(page)).not.toHaveText(before)
}
async function step(page: Page, n: number, sub = 1) {
  await page.locator('.stage-list .stage-item').nth(n - 1).click()
  await expect(readout(page)).toContainText(`${n}/8 ·`)
  await expect(readout(page)).toContainText('(1/')
  for (let i = 1; i < sub; i++) await next(page)
}
async function join(page: Page, code: string, name: string) {
  await page.goto(`/join?code=${code}`)
  await page.getByLabel('별명').fill(name)
  await page.getByRole('button', { name: '입장하기' }).click()
  await expect(page.locator('.stepbar')).toBeVisible({ timeout: 60_000 })
}
async function classroom(browser: Browser) {
  const teacher = await openPage(browser), student = await openPage(browser)
  await teacher.goto('/teach')
  await teacher.getByLabel('활동 제목').fill('수업 전체 동작 점검')
  await teacher.getByRole('button', { name: '탐사실 만들기' }).click()
  const dialog = teacher.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const code = (await dialog.locator('strong.num').innerText()).trim()
  const recovery = await dialog.getByLabel('교사 복구 코드 (지금 한 번만 표시됩니다)').inputValue()
  await teacher.getByRole('button', { name: '대기실로 이동' }).click()
  await teacher.getByRole('tab', { name: '진행', exact: true }).click()
  await join(student, code, '점검학생')
  const close = async () => {
    await teacher.request.delete(`/api/teach/rooms/${code}`, { headers: { origin: 'http://localhost:5173' } })
    await teacher.context().close()
    await student.context().close()
  }
  return { teacher, student, code, recovery, close }
}
async function draw(page: Page, offset = 0, touch = false) {
  const canvas = page.locator('.workspace-map canvas')
  await canvas.scrollIntoViewIfNeeded()
  const b = (await canvas.boundingBox())!
  const x = b.x + b.width * .35 + offset, y = b.y + b.height * .4
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 3, y: y + i * 5 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  } else {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 50, y + 70, { steps: 12 })
    await page.mouse.up()
  }
}
async function submit(page: Page, revised = false) {
  await page.getByRole('button', { name: revised ? '수정 추론 제출' : '최초 추론 제출', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '제출', exact: true }).click()
  await expect(page.getByText(`${revised ? '수정' : '최초'} 추론이 서버에 저장되었습니다.`)).toBeVisible()
}

test('시간 관찰 진입 시 교사와 학생이 시작 시점부터 보고 발표 전환은 재생 위치를 유지한다', async ({ browser }) => {
  const { teacher, student, close } = await classroom(browser)
  try {
    await step(teacher, 3, 2)
    for (const page of [teacher, student]) {
      const slider = page.getByLabel('시간 슬라이더')
      await expect(slider).toBeVisible()
      await expect(slider).toHaveValue((await slider.getAttribute('min'))!)
      await expect(page.getByLabel('시간 보기 방식')).toHaveValue('cumulative')
    }
    const slider = teacher.getByLabel('시간 슬라이더')
    const min = Number(await slider.getAttribute('min'))
    const max = String(min + Math.floor((Number(await slider.getAttribute('max')) - min) / 86400000) * 86400000)
    await slider.fill(max)
    await teacher.getByRole('button', { name: '전체화면 발표', exact: true }).first().click()
    await expect(slider).toHaveValue(max)
    await teacher.getByRole('button', { name: '발표 모드 종료' }).click()
    await expect(slider).toHaveValue(max)
    await next(teacher)
    for (const page of [teacher, student]) {
      await expect(page.getByLabel('시간 보기 방식')).toHaveValue('all')
      await expect(page.getByLabel('시간 슬라이더')).toHaveValue(max)
    }
  } finally { await close() }
})

test('최초 추론 12개를 복사해도 수정 추론을 더 그리고 서버에 저장할 수 있다', async ({ browser }) => {
  const { teacher, student, code, close } = await classroom(browser)
  try {
    await step(teacher, 4, 2)
    for (let i = 0; i < 12; i++) await draw(student, i * 9)
    await submit(student)
    await step(teacher, 6, 2)
    for (const page of [teacher, student]) await page.getByRole('button', { name: '지도에서 확인하기' }).click()
    for (let i = 0; i < 3; i++) await next(teacher)
    await expect(student.getByRole('heading', { name: '수정 추론 그리기', exact: true })).toBeVisible()
    await draw(student, 120)
    await expect(student.getByText(/그린 선 13\//)).toBeVisible()
    await student.getByRole('button', { name: '꼭짓점 찍기', exact: true }).click()
    const canvas = student.locator('.workspace-map canvas')
    await canvas.scrollIntoViewIfNeeded()
    await canvas.click({ position: { x: 100, y: 250 } })
    await canvas.click({ position: { x: 170, y: 290 } })
    await student.getByRole('button', { name: '선 완료', exact: true }).click()
    await expect(student.getByText(/그린 선 14\//)).toBeVisible()
    await submit(student, true)
    const record = (await (await student.request.get(`/api/rooms/${code}/me`)).json()).record
    expect(record.firstGuess.guess.lines).toHaveLength(12)
    expect(record.revisedGuess.guess.lines).toHaveLength(14)
    await student.reload()
    await expect(student.getByText(/그린 선 14\//)).toBeVisible({ timeout: 60_000 })
  } finally { await close() }
})

test('교사와 학생은 공개된 추론 레이어를 독립적으로 비교하고 강조 선도 숨길 수 있다', async ({ browser }, testInfo) => {
  const { teacher, student, close } = await classroom(browser)
  try {
    await step(teacher, 4, 2)
    await draw(student)
    await submit(student)
    await step(teacher, 6, 2)
    for (const page of [teacher, student]) await page.getByRole('button', { name: '지도에서 확인하기' }).click()
    for (let i = 0; i < 3; i++) await next(teacher)
    await expect(student.getByRole('heading', { name: '수정 추론 그리기', exact: true })).toBeVisible()
    await draw(student, 60)
    await submit(student, true)
    await step(teacher, 7, 2)
    for (const page of [teacher, student]) await page.getByRole('button', { name: '지도에서 확인하기' }).click()
    await teacher.getByRole('button', { name: '점검학생', exact: true }).click()
    const controls = teacher.getByRole('group', { name: '지도 레이어' })
    const studentControls = student.getByRole('group', { name: '지도 레이어' })
    await controls.getByRole('button', { name: '지도만 보기', exact: true }).click()
    const whitePixels = () => teacher.locator('.workspace-map canvas').evaluate((canvas: HTMLCanvasElement) => {
      const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let n = 0
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i] > 220 && rgba[i + 1] > 220 && rgba[i + 2] > 220) n++
      return n
    })
    await expect.poll(whitePixels).toBe(0)
    await expect(studentControls.getByRole('button', { name: '내 최초 선', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await controls.getByRole('button', { name: '학생 최초 선', exact: true }).click()
    await expect.poll(whitePixels).toBeGreaterThan(10)
    await controls.getByRole('button', { name: '학생 최초 선', exact: true }).click()
    await expect.poll(whitePixels).toBe(0)
    await studentControls.getByRole('button', { name: '지도만 보기', exact: true }).click()
    await controls.getByRole('button', { name: '판의 경계', exact: true }).click()
    await teacher.getByRole('button', { name: '전체화면 발표', exact: true }).first().click()
    await expect(controls.getByRole('button', { name: '판의 경계', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(studentControls.getByRole('button', { name: '판의 경계', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await teacher.screenshot({ path: testInfo.outputPath('teacher-plate-layer.png'), fullPage: true })
    await teacher.getByRole('button', { name: '발표 모드 종료' }).click()
  } finally { await close() }
})

test('관찰 메모: 다른 교실 상태가 도착해도 저장 대기 중인 입력을 잃지 않는다', async ({ browser }) => {
  const { teacher, student, code, close } = await classroom(browser)
  try {
    await step(teacher, 3)
    const note = student.getByPlaceholder('한두 문장이면 충분합니다.')
    await expect(note).toBeVisible()
    // 실제 교사 조작으로 학생에게 새로운 서버 스냅샷을 보낸다.
    let snapshots = 0
    student.on('websocket', ws => ws.on('framereceived', f => {
      if (String(f.payload).includes('"type":"snapshot"')) snapshots++
    }))
    await student.reload()
    await expect(note).toBeVisible()
    await expect.poll(() => snapshots).toBeGreaterThan(0)
    await note.fill('지진은 띠처럼 모인다')
    const before = snapshots
    await teacher.getByRole('button', { name: '별명 공개', exact: true }).click()
    await expect.poll(() => snapshots, { intervals: [20] }).toBeGreaterThan(before)
    expect(await note.inputValue()).toBe('지진은 띠처럼 모인다')
    await note.press('End')
    await note.pressSequentially('.')
    await expect.poll(async () => (await (await student.request.get(`/api/rooms/${code}/me`)).json()).record.responses?.['observe-world']?.text).toBe('지진은 띠처럼 모인다.')
    await student.getByRole('button', { name: '증거 서랍 열기/닫기' }).click()
    await student.getByRole('button', { name: '지금 화면 담기' }).click()
    const evidenceNote = student.getByLabel('증거 1 메모')
    await evidenceNote.fill('지진의 띠')
    const beforeEvidence = snapshots
    await teacher.getByRole('button', { name: '별명 공개', exact: true }).click()
    await expect.poll(() => snapshots, { intervals: [20] }).toBeGreaterThan(beforeEvidence)
    expect(await evidenceNote.inputValue()).toBe('지진의 띠')
    await expect.poll(async () => (await (await student.request.get(`/api/rooms/${code}/me`)).json()).record.evidence[0]?.note).toBe('지진의 띠')
  } finally { await close() }
})

test('교사 입력 잠금이 관찰 응답·설명·한계에도 적용된다', async ({ browser }) => {
  const { teacher, student, close } = await classroom(browser)
  try {
    await step(teacher, 3)
    await expect(student.getByPlaceholder('한두 문장이면 충분합니다.')).toBeVisible()
    await student.getByRole('button', { name: '증거 서랍 열기/닫기' }).click()
    await student.getByRole('button', { name: '지금 화면 담기' }).click()
    await expect(student.getByLabel('증거 1 메모')).toBeVisible()
    await teacher.getByRole('button', { name: '입력 열림', exact: true }).click()
    await expect(teacher.getByRole('button', { name: '입력 잠김', exact: true })).toBeVisible()
    await expect.soft(student.getByPlaceholder('한두 문장이면 충분합니다.')).toBeDisabled()
    await expect.soft(student.locator('.choice input').first()).toBeDisabled()
    await expect.soft(student.getByLabel('증거 1 메모')).toBeDisabled({ timeout: 2000 })
    await expect.soft(student.getByLabel('증거 1 제목')).toBeDisabled({ timeout: 2000 })
    await expect.soft(student.locator('.evidence-item').getByRole('button', { name: '삭제', exact: true })).toBeDisabled({ timeout: 2000 })
    await step(teacher, 8)
    await expect.soft(student.getByLabel(/나의 설명/)).toBeDisabled()
    await next(teacher)
    await expect.soft(student.getByLabel('내 말로 쓰기')).toBeDisabled()
    await expect.soft(student.locator('.choice input').first()).toBeDisabled()
    await teacher.getByRole('button', { name: '입력 잠김', exact: true }).click()
    await expect(student.getByLabel('내 말로 쓰기')).toBeEnabled()
  } finally { await close() }
})

test('수정 추론 제출 후 새로고침하면 최신 수정 선에서 이어 쓴다', async ({ browser }) => {
  const { teacher, student, close } = await classroom(browser)
  try {
    await step(teacher, 4, 2)
    await expect(student.getByText('그린 선 0/64')).toBeVisible()
    await draw(student)
    await submit(student)
    await step(teacher, 6, 5)
    await expect(student.getByText('그린 선 1/64')).toBeVisible()
    await draw(student, 100)
    await submit(student, true)
    await expect(student.getByText('그린 선 2/64')).toBeVisible()
    await student.reload()
    await expect(student.getByText('그린 선 2/64')).toBeVisible({ timeout: 60_000 })
  } finally { await close() }
})

test('교사·학생 24개 화면, 터치 그리기, 복구·결과·종료', async ({ browser }, info) => {
  test.setTimeout(360_000)
  const { teacher, student, code, recovery, close } = await classroom(browser)
  const mobile = await openPage(browser, true), recovered = await openPage(browser)
  const errors: string[] = []
  for (const p of [teacher, student, mobile]) p.on('pageerror', e => errors.push(e.message))
  try {
    await teacher.getByRole('button', { name: '입장 열림', exact: true }).click()
    await mobile.goto(`/join?code=${code}`)
    await mobile.getByLabel('별명').fill('터치학생')
    await expect(mobile.getByRole('button', { name: '입장하기' })).toBeDisabled()
    await teacher.getByRole('button', { name: '입장 잠김', exact: true }).click()
    await expect(mobile.getByRole('button', { name: '입장하기' })).toBeEnabled()
    await mobile.getByRole('button', { name: '입장하기' }).click()
    await expect(mobile.locator('.stepbar')).toBeVisible({ timeout: 60_000 })
    for (const [i, screen] of LESSON_SCREENS.entries()) {
      if (i) await next(teacher)
      for (const p of [teacher, student, mobile]) {
        await expect(readout(p)).toContainText(`· ${i + 1}/24`)
        await expect(p.getByText('이 화면을 그리지 못했습니다')).toHaveCount(0)
        const reveal = p.getByRole('button', { name: '지도에서 확인하기' })
        if (screen.id === 'volcano-open' || screen.id === 'plate-open') {
          await expect(reveal).toBeVisible()
          await reveal.click()
        }
      }
      if (screen.id === 'observe-world') {
        await student.locator('.choice').first().click()
        await student.getByPlaceholder('한두 문장이면 충분합니다.').fill('가장자리에 모여 있다')
        await expect.poll(async () => (await (await student.request.get(`/api/rooms/${code}/me`)).json()).record.responses?.['observe-world']?.text).toBe('가장자리에 모여 있다')
        await teacher.getByRole('button', { name: '전체화면 발표', exact: true }).first().click()
        await expect(teacher.getByRole('button', { name: '발표 모드 종료' })).toBeVisible()
        await teacher.getByRole('button', { name: '발표 모드 종료' }).click()
        await expect(teacher.locator('.stage-list')).toBeVisible()
      }
      if (screen.id === 'observe-time') {
        const controls = student.getByRole('group', { name: '시간 재생 컨트롤' })
        await controls.getByRole('button', { name: '재생', exact: true }).click()
        await expect(controls.getByLabel('시간 보기 방식')).toHaveValue('cumulative')
        await controls.getByRole('button', { name: '일시정지', exact: true }).click()
        await controls.getByLabel('시간 보기 방식').selectOption('window')
        await controls.getByLabel('시간창 길이').selectOption('90')
        await expect(controls.getByLabel('시간창 길이')).toHaveValue('90')
        await controls.getByRole('button', { name: '처음으로', exact: true }).click()
        await controls.getByLabel('시간 보기 방식').selectOption('all')
        await student.locator('.lesson-nav').getByRole('button', { name: '이전', exact: true }).click()
        await student.getByRole('button', { name: '따라가기 꺼짐', exact: true }).click()
        await expect(readout(student)).toContainText('(2/3)')
      }
      if (screen.id === 'observe-close') {
        await student.getByRole('button', { name: '증거 서랍 열기/닫기' }).click()
        await student.getByRole('button', { name: '지금 화면 담기' }).click()
        await student.getByLabel('증거 1 제목').fill('관찰한 띠')
        await student.getByLabel('증거 1 메모').fill('길게 이어지는 분포')
        await expect.poll(async () => (await (await student.request.get(`/api/rooms/${code}/me`)).json()).record.evidence[0]?.note).toBe('길게 이어지는 분포')
      }
      if (screen.id === 'guess-draw' || screen.id === 'revise-draw') {
        const revised = screen.id === 'revise-draw'
        await draw(student, revised ? 90 : 0)
        await submit(student, revised)
        await mobile.getByRole('button', { name: '추론', exact: true }).click()
        await mobile.getByRole('button', { name: '그리기', exact: true }).click()
        await expect(mobile.locator('.sheet')).not.toHaveClass(/is-open/)
        await draw(mobile, revised ? 50 : 0, true)
        await mobile.getByRole('button', { name: '추론', exact: true }).click()
        await expect(mobile.locator('.sheet').getByText(`그린 선 ${revised ? 2 : 1}/64`)).toBeVisible()
        await submit(mobile, revised)
        await student.screenshot({ path: info.outputPath(`${screen.id}-desktop.png`) })
        await mobile.screenshot({ path: info.outputPath(`${screen.id}-touch.png`) })
      }
      if (screen.id === 'explain-write') {
        await student.getByLabel(/나의 설명/).fill('지진과 화산의 띠를 근거로 판 경계를 추론했다.')
        await student.getByRole('button', { name: '설명 저장' }).click()
        await expect(student.locator('.response').getByText('저장됨', { exact: true })).toBeVisible()
      }
      if (screen.id === 'explain-limits') {
        await student.locator('.choice').first().click()
        await student.getByLabel('내 말로 쓰기').fill('자료에 작은 지진이 빠져 있다.')
        await student.getByRole('button', { name: '한계 저장' }).click()
        await expect(student.locator('.response').getByText('저장됨', { exact: true })).toBeVisible()
      }
    }
    await student.getByRole('link', { name: '탐구 카드 열기' }).click()
    await expect(student.locator('.report')).toContainText('가장자리에 모여 있다')
    await expect(student.locator('.report')).toContainText('자료에 작은 지진이 빠져 있다.')
    await expect(student.locator('.report-map img')).toHaveCount(2)
    await student.screenshot({ path: info.outputPath('report.png'), fullPage: true })
    await recovered.goto('/teach')
    await recovered.getByLabel('입장 코드', { exact: true }).fill(code)
    await recovered.getByLabel('복구 코드', { exact: true }).fill(recovery)
    await recovered.getByRole('button', { name: '복구하기', exact: true }).click()
    await expect(recovered).toHaveURL(new RegExp(`/teach/${code}$`))
    await recovered.getByRole('tab', { name: '결과', exact: true }).click()
    await expect(recovered.locator('table.data tbody tr')).toHaveCount(2)
    const exported = await recovered.request.get(`/api/teach/rooms/${code}/export?format=csv`)
    expect(await exported.text()).toContain('자료에 작은 지진이 빠져 있다.')
    await teacher.getByRole('button', { name: '탐사실 종료', exact: true }).click()
    await teacher.getByRole('dialog').getByRole('button', { name: '종료', exact: true }).click()
    await expect(teacher.getByRole('button', { name: '탐사실 종료', exact: true })).toHaveCount(0)
    await mobile.getByRole('link', { name: '탐구 카드 열기' }).click()
    await expect(mobile.locator('.report-map img')).toHaveCount(2)
    expect(errors).toEqual([])
  } finally {
    await mobile.context().close()
    await recovered.context().close()
    await close()
  }
})

test('교사 3D 지도는 학생이 같은 개수의 선을 다시 제출해도 새 위치를 즉시 표시한다', async ({ browser }, info) => {
  const { teacher, student, code, close } = await classroom(browser)
  try {
    await step(teacher, 4, 2)
    await expect(student.getByText('그린 선 0/64')).toBeVisible()
    await draw(student)
    await submit(student)
    await step(teacher, 6, 5)
    await expect(student.getByText('그린 선 1/64')).toBeVisible()
    await submit(student, true)
    await teacher.getByRole('button', { name: '3D 지구본으로 전환' }).click()
    const canvas = teacher.locator('.workspace-map[data-map-mode="3d"] canvas')
    await expect(canvas).toBeVisible({ timeout: 30_000 })
    await teacher.getByRole('button', { name: '점검학생', exact: true }).click()
    await expect(teacher.locator('.participant').getByRole('button', { name: '점검학생', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await canvas.scrollIntoViewIfNeeded()
    const before = await canvas.screenshot({ path: info.outputPath('3d-before.png') })
    const previous = (await (await student.request.get(`/api/rooms/${code}/me`)).json()).record.revisedGuess
    await student.getByRole('button', { name: '전체 지우기', exact: true }).click()
    await student.getByRole('button', { name: '모두 지우기', exact: true }).click()
    await draw(student, 180)
    await submit(student, true)
    await expect.poll(async () => (await (await teacher.request.get(`/api/teach/rooms/${code}/state`)).json()).sharedGuesses.find((g: { kind: string }) => g.kind === 'revised')?.guess.lines[0].points).not.toEqual(previous.guess.lines[0].points)
    const updated = (await (await student.request.get(`/api/rooms/${code}/me`)).json()).record.revisedGuess
    expect(updated.guess.lines[0].points.length).toBe(previous.guess.lines[0].points.length)
    await expect.poll(async () => (await canvas.screenshot()).equals(before), { timeout: 4000 }).toBe(false)
    await canvas.screenshot({ path: info.outputPath('3d-after.png') })
  } finally { await close() }
})

test('교사 발표 모드 진입·종료 때 보고 있던 지도 위치를 유지한다', async ({ browser }) => {
  const { teacher, code, close } = await classroom(browser)
  try {
    await step(teacher, 3)
    await teacher.getByLabel('탐구 위치 프리셋').selectOption('japan')
    const sharedView = async () => (await (await teacher.request.get(`/api/teach/rooms/${code}/state`)).json()).room.followView?.view
    await teacher.getByRole('button', { name: '모두 이곳 보기', exact: true }).click()
    await expect.poll(sharedView).toEqual({ center: [138, 36], zoom: 5.5 })
    await teacher.getByRole('button', { name: '전체화면 발표', exact: true }).first().click()
    await expect(teacher.getByRole('button', { name: '발표 모드 종료' })).toBeVisible()
    await teacher.getByRole('button', { name: '모두 이곳 보기', exact: true }).click()
    await expect.poll(sharedView, { timeout: 2000 }).toEqual({ center: [138, 36], zoom: 5.5 })
    await teacher.getByRole('button', { name: '발표 모드 종료' }).click()
    await teacher.getByRole('button', { name: '모두 이곳 보기', exact: true }).click()
    await expect.poll(sharedView).toEqual({ center: [138, 36], zoom: 5.5 })
  } finally { await close() }
})

test('수업을 중간에 종료해도 학생이 작성한 결과를 열 수 있다', async ({ browser }) => {
  const { teacher, student, code, close } = await classroom(browser)
  try {
    await step(teacher, 3)
    await student.getByPlaceholder('한두 문장이면 충분합니다.').fill('수업 종료 전 관찰')
    await expect.poll(async () => (await (await student.request.get(`/api/rooms/${code}/me`)).json()).record.responses?.['observe-world']?.text).toBe('수업 종료 전 관찰')
    await student.getByRole('button', { name: '선생님 따라가는 중', exact: true }).click()
    await teacher.getByRole('button', { name: '탐사실 종료', exact: true }).click()
    await teacher.getByRole('dialog').getByRole('button', { name: '종료', exact: true }).click()
    await expect(student.getByRole('link', { name: '탐구 카드 열기' })).toBeVisible({ timeout: 3000 })
    await student.getByRole('link', { name: '탐구 카드 열기' }).click()
    await expect(student.locator('.report')).toContainText('수업 종료 전 관찰')
  } finally { await close() }
})
