import { test, expect, type Page } from '@playwright/test'
import sharp from 'sharp'

const next = (page: Page) => page.locator('.lesson-nav').getByRole('button', { name: '다음', exact: true }).click()
const step = (page: Page, n: number) => page.locator('.stepbar button').nth(n - 1).click()

async function draw(page: Page, offset = 0) {
  const canvas = page.locator('.workspace-map canvas')
  await canvas.scrollIntoViewIfNeeded()
  const b = (await canvas.boundingBox())!
  await page.mouse.move(b.x + b.width * .4, b.y + b.height * .4 + offset)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * .47, b.y + b.height * .5 + offset, { steps: 12 })
  await page.mouse.up()
}

async function submit(page: Page, revised: boolean, mobile: boolean) {
  if (mobile) await page.locator('.mobile-tabs').getByRole('button', { name: '추론', exact: true }).click()
  await page.getByRole('button', { name: revised ? '수정 추론 제출' : '최초 추론 제출', exact: true }).click()
  await page.getByRole('dialog', { name: revised ? '수정 추론을 제출할까요?' : '최초 추론을 제출할까요?' }).getByRole('button', { name: '제출', exact: true }).click()
}

async function canvasState(page: Page) {
  return page.locator('.workspace-map canvas').evaluate((canvas: HTMLCanvasElement) => {
    const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let hash = 2166136261, red = 0, blue = 0, white = 0
    for (let i = 0; i < rgba.length; i += 4) {
      const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]]
      hash = Math.imul(hash ^ r, 16777619)
      hash = Math.imul(hash ^ g, 16777619)
      hash = Math.imul(hash ^ b, 16777619)
      if (r > 200 && g < 120 && b > 65 && b < 180) red++
      if (r < 130 && g > 160 && b > 220) blue++
      if (r > 220 && g > 220 && b > 220) white++
    }
    return { hash, red, blue, white }
  })
}

for (const mobile of [false, true]) test.describe(mobile ? '휴대전화' : '데스크톱', () => {
  test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1100 }, isMobile: mobile, hasTouch: mobile })
  test('판 경계와 내 선을 구별하고 다섯 레이어를 독립적으로 겹치거나 뺀다', async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem('ee.settings.v1', JSON.stringify({ preferredMapMode: '2d', lowPower: true, soundEnabled: false, landingMotion: false })))
    await page.goto('/explore')
    await expect(page.locator('.stepbar')).toBeVisible({ timeout: 60_000 })
    await step(page, 3)
    await expect(page.getByRole('group', { name: '지도 레이어' }).getByRole('button', { name: '판의 경계', exact: true })).toBeDisabled()
    await step(page, 4)
    await next(page)
    await draw(page)
    await submit(page, false, mobile)
    await step(page, 6)
    await next(page)
    await page.getByRole('button', { name: '지도에서 확인하기' }).click()
    for (let i = 0; i < 3; i++) await next(page)
    await draw(page, 45)
    await submit(page, true, mobile)
    await step(page, 7)
    await next(page)
    await page.getByRole('button', { name: '지도에서 확인하기' }).click()

    const controls = page.getByRole('group', { name: '지도 레이어' })
    const base = controls.getByRole('button', { name: '지도만 보기', exact: true })
    await base.click()
    const baseline = await canvasState(page)
    expect(baseline.red).toBe(0)
    expect(baseline.blue).toBe(0)
    expect(baseline.white).toBe(0)
    for (const label of ['지진 기록', '화산 기록', '내 최초 선', '내 수정 선', '판의 경계']) {
      const button = controls.getByRole('button', { name: label, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(async () => (await canvasState(page)).hash).not.toBe(baseline.hash)
      if (label === '판의 경계') await expect.poll(async () => (await canvasState(page)).red).toBeGreaterThan(100)
      if (label === '내 수정 선') await expect.poll(async () => (await canvasState(page)).blue).toBeGreaterThan(10)
      if (label === '내 최초 선') await expect.poll(async () => (await canvasState(page)).white).toBeGreaterThan(10)
      await button.click()
      await expect.poll(async () => (await canvasState(page)).hash).toBe(baseline.hash)
    }
    for (const label of ['지진 기록', '화산 기록', '내 최초 선', '내 수정 선', '판의 경계']) await controls.getByRole('button', { name: label, exact: true }).click()
    const controlsBox = (await controls.boundingBox())!
    const canvasBox = (await page.locator('.workspace-map canvas').boundingBox())!
    expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(canvasBox.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('separated-layers-2d.png'), fullPage: true })

    if (!mobile) {
      await page.getByRole('button', { name: '3D 지구본으로 전환' }).click()
      await expect(page.locator('.workspace-map')).toHaveAttribute('data-map-mode', '3d')
      const redPixels = async () => {
        const { data, info } = await sharp(await page.locator('.workspace-map canvas').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true })
        let n = 0
        for (let i = 0; i < data.length; i += info.channels) if (data[i] > 200 && data[i + 1] < 120 && data[i + 2] > 65 && data[i + 2] < 180) n++
        return n
      }
      await expect.poll(redPixels).toBeGreaterThan(100)
      await controls.getByRole('button', { name: '판의 경계', exact: true }).click()
      await expect.poll(redPixels).toBe(0)
      await controls.getByRole('button', { name: '판의 경계', exact: true }).click()
      await expect.poll(redPixels).toBeGreaterThan(100)
      await page.screenshot({ path: testInfo.outputPath('separated-layers-3d.png'), fullPage: true })
      await page.getByRole('button', { name: '2D 지도로 전환' }).click()
      await expect(page.locator('.workspace-map')).toHaveAttribute('data-map-mode', '2d')
      await expect.poll(async () => (await canvasState(page)).red).toBeGreaterThan(100)
    }
    // 지도 표시를 바꿔도 제출한 기록은 남는다.
    await step(page, 8)
    for (let i = 0; i < 3; i++) await next(page)
    await expect(page.locator('tr', { hasText: '최초 추론' })).toContainText('선 1개')
    await expect(page.locator('tr', { hasText: '수정 추론' })).toContainText('선 2개')
  })
})
