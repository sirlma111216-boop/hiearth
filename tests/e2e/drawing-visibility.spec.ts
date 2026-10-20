import { test, expect, type Locator } from '@playwright/test'

/** 실제 2D 캔버스의 선택된 선(민트색) 픽셀을 확인한다. 선 개수만으로는 렌더링 누락을 잡지 못한다. */
async function selectedLinePixels(canvas: Locator) {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const rgba = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data
    let count = 0
    for (let i = 0; i < rgba.length; i += 4) {
      const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]]
      if (r > 110 && g > 190 && b > 160 && g - r > 30) count++
    }
    return count
  })
}

test('2D: 첫 선이 그리는 중·완료 직후 보이고, 선택·되돌리기에도 사라지지 않는다', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript(() => localStorage.setItem('ee.settings.v1', JSON.stringify({ preferredMapMode: '2d', lowPower: true, soundEnabled: false, landingMotion: false })))
  await page.goto('/explore')
  await expect(page.locator('.stepbar')).toBeVisible({ timeout: 60000 })
  await page.locator('.stepbar button').nth(3).click()
  await page.getByRole('button', { name: '설명 건너뛰기' }).click()
  const canvas = page.locator('.workspace-map[data-map-mode="2d"] canvas')
  await expect(canvas).toBeVisible()
  await canvas.scrollIntoViewIfNeeded()
  const b = (await canvas.boundingBox())!
  const x = b.x + b.width * .4, y = b.y + b.height * .3
  await expect.poll(() => selectedLinePixels(canvas)).toBe(0)
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 4, y + i * 5)
  await expect.poll(() => selectedLinePixels(canvas)).toBeGreaterThan(100)
  await page.mouse.up()
  await expect(page.getByText('그린 선 1/64')).toBeVisible()
  // 다음 선이나 별도의 클릭 없이, 방금 완성한 선택 선이 남아 있어야 한다.
  await expect.poll(() => selectedLinePixels(canvas)).toBeGreaterThan(100)
  await canvas.screenshot({ path: testInfo.outputPath('first-line-visible.png') })

  const tools = page.locator('aside[aria-label="추론 도구"]')
  const line = tools.locator('.stage-item').first()
  await line.click() // 선택 해제 → 최초 선의 흰색
  await expect.poll(() => selectedLinePixels(canvas)).toBe(0)
  await line.click() // 다시 선택해도 선이 사라지면 안 된다.
  await expect.poll(() => selectedLinePixels(canvas)).toBeGreaterThan(100)
  await tools.getByRole('button', { name: '되돌리기', exact: true }).click()
  await expect(page.getByText('그린 선 0/64')).toBeVisible()
  await expect.poll(() => selectedLinePixels(canvas)).toBe(0)
  await tools.getByRole('button', { name: '다시 실행', exact: true }).click()
  await expect(page.getByText('그린 선 1/64')).toBeVisible()
  await tools.locator('.stage-item').first().click()
  await expect.poll(() => selectedLinePixels(canvas)).toBeGreaterThan(100)
})
