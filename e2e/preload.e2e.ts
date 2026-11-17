import { expect, test } from '@playwright/test'

test('all screens and a second round work offline after the first load', async ({ page, context }) => {
  test.setTimeout(60000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'START GAME', exact: true })).toBeVisible({ timeout: 15000 })
  expect(await page.locator('.pixi-host canvas').count()).toBe(1)
  await page.locator('.pixi-host canvas').evaluate(canvas => canvas.setAttribute('data-original-canvas', 'yes'))
  const lateRequests: string[] = []
  page.on('request', request => { if (/\.(png|webp|mp3|woff2)(\?|$)/.test(request.url())) lateRequests.push(request.url()) })
  await context.setOffline(true)
  const openGame = async () => {
    await page.getByRole('button', { name: 'START GAME', exact: true }).click()
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).click()
    await page.getByRole('textbox', { name: 'CoinW UID', exact: true }).fill('123456')
    await page.getByRole('button', { name: 'START GAME', exact: true }).click()
    await expect(page.locator('.ball-control')).toBeEnabled({ timeout: 6000 })
  }
  await openGame()
  for (let shot = 0; shot < 5; shot++) {
    await expect(page.locator('.ball-control')).toBeEnabled()
    await page.locator('.ball-control').press('Enter')
    await expect(page.getByRole('status').getByText('SAVED', { exact: true })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: 'Your result', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'VIEW LEADERBOARD', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: 'PLAYER', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'NEW GAME', exact: true }).click()
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click()
  await page.getByRole('textbox', { name: 'CoinW UID', exact: true }).fill('123456')
  await page.getByRole('button', { name: 'START GAME', exact: true }).click()
  await expect(page.locator('.ball-control')).toBeEnabled({ timeout: 6000 })
  await expect(page.locator('.shot-counter')).toContainText('1/5')
  await expect(page.locator('.pixi-host canvas')).toHaveAttribute('data-original-canvas', 'yes')
  expect(lateRequests).toEqual([])
})

test('initial loading failure can be retried', async ({ page }) => {
  let fail = true
  await page.route('**/result-hero.webp', route => fail ? route.abort() : route.continue())
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'TRY AGAIN', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'START GAME', exact: true })).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'TRY AGAIN', exact: true }).click()
  await expect(page.getByRole('button', { name: 'START GAME', exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.startup-loader')).toHaveCount(0)
})
