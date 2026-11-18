import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const play = (page: Page) => page.getByRole('button', { name: 'START GAME', exact: true })
const continueButton = (page: Page) => page.getByRole('button', { name: /^Continue$/i })
const start = (page: Page) => page.getByRole('button', { name: /^Start Game$/i })
const ball = (page: Page) => page.getByRole('button', { name: /swipe from the ball to shoot/i })

async function openRegistration(page: Page) {
  await page.goto('/')
  await play(page).click()
  await expect(page.getByRole('region', { name: 'How to play' })).toBeVisible()
  await continueButton(page).click()
}

async function openGame(page: Page) {
  await openRegistration(page)
  await page.getByRole('textbox', { name: /CoinW UID/i }).fill('12345678')
  await start(page).click()
}

async function swipe(page: Page, dx: number, dy: number, holdMs = 0) {
  const control = ball(page)
  await expect(control).toBeEnabled({ timeout: 6000 })
  const box = (await control.boundingBox())!
  const frame = (await page.getByRole('main').boundingBox())!
  const scale = frame.width / 540
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  if (holdMs) await page.waitForTimeout(holdMs)
  await page.mouse.move(x + dx * scale, y + dy * scale, { steps: 1 })
  await page.mouse.up()
}

async function outcome(page: Page, label: string) {
  await expect(page.getByRole('status').getByText(label, { exact: true })).toBeVisible()
}

test('START GAME has hover and keyboard focus, and UID gates the start button', async ({ page }) => {
  await page.goto('/')
  const button = play(page)
  await expect(button).toBeVisible()
  const resting = await button.screenshot()
  await button.hover()
  await expect.poll(async () => (await button.screenshot()).equals(resting)).toBe(false)
  for (let i = 0; i < 4 && !(await button.evaluate(el => el.matches(':focus-visible'))); i++) {
    await page.keyboard.press('Tab')
  }
  await expect(button).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'How to play' })).toBeVisible()
  await continueButton(page).click()

  const uid = page.getByRole('textbox', { name: /CoinW UID/i })
  await expect(start(page)).toBeDisabled()
  await uid.fill('invalid')
  await expect(start(page)).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText(/UID/i)
  await uid.fill('')
  await page.getByRole('button', { name: '1', exact: true }).click()
  await expect(uid).toHaveValue('1')
  await expect(start(page)).toBeDisabled()
  await uid.fill('1234567')
  await expect(start(page)).toBeDisabled()
  await page.getByRole('button', { name: '8', exact: true }).click()
  await page.getByRole('button', { name: '9', exact: true }).click()
  await expect(uid).toHaveValue('12345678')
  await expect(start(page)).toBeEnabled()
})

test('five corner goals reach 1,000 and display the masked daily leaderboard', async ({ page }) => {
  test.setTimeout(45000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await openGame(page)
  for (const dx of [254, -254, 254, -254, 254]) {
    await swipe(page, dx, -375)
    await outcome(page, 'GOAL')
  }

  await expect(page.getByText(/^1[ ,\u00a0\u202f]?000$/)).toBeVisible()
  await expect(page.getByText('#1', { exact: true })).toBeVisible()
  await expect(ball(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible()
  await page.clock.fastForward(12_200)
  await expect(play(page)).toBeVisible()
  await page.getByRole('button', { name: /^Leaderboard$/i }).click()
  await expect(page.getByText('UID 12***78', { exact: true })).toBeVisible()
  await expect(page.getByText('12345678', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'HOME', exact: true }).click()
  await expect(play(page)).toBeVisible()
  expect(errors).toEqual([])
})

test('a reachable corner shot can be saved and a strong wide shot can score', async ({ page }) => {
  await openGame(page)
  await swipe(page, -158, -359, 700)
  await outcome(page, 'SAVED')
  await swipe(page, 215, -375)
  await outcome(page, 'GOAL')
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`repeated central shots have visible flight and can both score and be saved (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion })
    await openGame(page)
    for (const expected of ['SAVED', 'GOAL', 'SAVED']) {
      await swipe(page, 0, -310)
      // Essential flight must not collapse to an instant result in accessibility mode.
      await page.waitForTimeout(200)
      await expect(page.getByRole('status').getByText(/^(SAVED|GOAL)$/)).toHaveCount(0)
      await expect(page.locator('.ball-control')).toBeDisabled()
      await outcome(page, expected)
    }
  })
}

test('short swipes cost no attempt, a save and a miss earn zero, and aborted rounds are discarded', async ({ page }) => {
  await openGame(page)
  await swipe(page, 3, -4)
  await expect(ball(page)).toBeEnabled()
  await expect(page.getByText(/1\s*\/\s*5/)).toBeVisible()
  await swipe(page, 0, -310)
  await outcome(page, 'SAVED')
  for (const dx of [-55, 55]) {
    await swipe(page, dx, -251)
    await outcome(page, 'SAVED')
  }
  await swipe(page, 260, -250)
  await outcome(page, 'MISS')
  await page.getByRole('button', { name: /^Home$/i }).click()
  await page.getByRole('button', { name: /^Leaderboard$/i }).click()
  await expect(page.getByText(/No results/i)).toBeVisible()
})

test('warnings offer resume and abandoned screens return to the start', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await openRegistration(page)
  await page.clock.fastForward(40_000)
  let warning = page.getByRole('alertdialog')
  await expect(warning).toHaveCount(0)
  await page.clock.fastForward(5_200)
  await expect(warning).toBeVisible()
  await warning.getByRole('button', { name: /^Continue$/i }).click()
  await expect(warning).toHaveCount(0)
  await page.clock.fastForward(60_200)
  await expect(play(page)).toBeVisible()

  await openGame(page)
  await expect(page.locator('.game-countdown strong')).toHaveText('3')
  await expect(page.locator('.ball-control')).toBeDisabled()
  await page.clock.fastForward(3_200)
  await expect(ball(page)).toBeEnabled()
  await page.clock.fastForward(45_200)
  warning = page.getByRole('alertdialog')
  await expect(warning).toBeVisible()
  await expect(page.locator('.ball-control')).toBeDisabled()
  await page.clock.fastForward(15_000)
  await expect(play(page)).toBeVisible()
})

for (const [identity, publicName] of [
  ['Local player', 'Local player'],
  ['player@example.test', 'p***@example.test'],
]) {
  test(`alternate registration highlights ${publicName} below the top ten`, async ({ page }) => {
    await page.addInitScript(() => {
      const rows = Array.from({ length: 10 }, (_, index) => ({
        id: 'prior-' + index, uid: String(1000 + index), score: 1000,
        goals: 5, cornerGoals: 5, shots: 5, date: new Date().toISOString(),
      }))
      localStorage.setItem('coinw-football-results-v1', JSON.stringify(rows))
    })
    await openRegistration(page)
    await page.getByRole('button', { name: /use nickname/i }).click()
    const field = page.getByRole('textbox', { name: 'Nickname or email' })
    await expect(page.getByRole('textbox')).toHaveCount(1)
    await field.fill('invalid@')
    await expect(start(page)).toBeDisabled()
    await field.fill(identity)
    await expect(start(page)).toBeEnabled()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await start(page).click()
    for (let i = 0; i < 5; i++) await swipe(page, 0, -310)
    await expect(page.getByText('#11', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^View Leaderboard$/i }).click()
    const personalResult = page.locator('.leaderboard-result-row')
    await expect(personalResult.getByText(publicName, { exact: true })).toBeVisible()
    await expect(personalResult.getByText('11', { exact: true })).toBeVisible()
    if (identity.includes('@')) {
      expect(await page.evaluate(email => Object.values(localStorage).some(value => value.includes(email)), identity)).toBe(false)
    }
  })
}

test.describe('portrait touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' })

  test('locks a touch swipe to the ball and ignores other fingers', async ({ page, context }) => {
    await openGame(page)
    await expect(ball(page)).toBeEnabled()
    const client = await context.newCDPSession(page)
    const control = (await ball(page).boundingBox())!
    const point = { x: control.x + control.width / 2, y: control.y + control.height / 2, id: 1 }
    const second = { x: 32, y: 350, id: 2 }
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point, second] })
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ ...point, x: point.x + 254 * 2 / 3, y: point.y - 375 * 2 / 3 }, second],
    })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await outcome(page, 'GOAL')
    await expect(ball(page)).toBeEnabled()
    await expect(page.getByText(/2\s*\/\s*5/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(640)
  })
})


test('dragging outside the play area keeps the virtual aim inside the field', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 960 })
  await openGame(page)
  await expect(ball(page)).toBeEnabled({ timeout: 6000 })
  const scene = (await page.locator('.game-scene').boundingBox())!
  const control = (await ball(page).boundingBox())!
  await page.mouse.move(control.x + control.width / 2, control.y + control.height / 2)
  await page.mouse.down()
  await page.mouse.move(scene.x + scene.width + 200, scene.y + 20, { steps: 10 })
  const reticle = (await page.locator('.aim-reticle').boundingBox())!
  const x = (reticle.x + reticle.width / 2 - scene.x) / scene.width * 540
  const y = (reticle.y + reticle.height / 2 - scene.y) / scene.height * 960
  expect(x).toBeCloseTo(524, 0)
  expect(y).toBeCloseTo(270, 0)
  await page.mouse.move(scene.x - 200, scene.y + 20, { steps: 10 })
  const left = (await page.locator('.aim-reticle').boundingBox())!
  expect((left.x + left.width / 2 - scene.x) / scene.width * 540).toBeCloseTo(16, 0)
  await page.mouse.up()
  await outcome(page, 'MISS')
  await expect(ball(page)).toBeEnabled({ timeout: 6000 })
  await expect(page.getByText(/2\s*\/\s*5/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1080)
})


test('countdown ring and digits share the same three-second clock', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const time = new Date('2026-11-17T12:00:00Z')
  await page.clock.install({ time })
  await page.clock.pauseAt(time)
  await openGame(page)
  const digit = page.locator('.game-countdown strong')
  const progress = page.locator('.countdown-progress')
  await expect(digit).toHaveText('3')
  await expect(progress).toHaveAttribute('stroke-dashoffset', '0')
  await expect(page.locator('.ball-control')).toBeDisabled()
  await page.clock.runFor(1100)
  await expect(digit).toHaveText('2')
  expect(Number(await progress.getAttribute('stroke-dashoffset'))).toBeCloseTo(1100 / 30, 0)
  await page.clock.runFor(1000)
  await expect(digit).toHaveText('1')
  expect(Number(await progress.getAttribute('stroke-dashoffset'))).toBeCloseTo(70, 0)
  await page.clock.runFor(1000)
  await expect(page.locator('.game-countdown')).toHaveCount(0)
  await expect(ball(page)).toBeEnabled()
})


test('slow game assets hold the initial loader without consuming playing time', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  await page.route('**/keeper-idle-clean.png', async route => { await hold; await route.continue() })
  const startTime = new Date('2026-11-17T12:00:00Z')
  await page.clock.install({ time: startTime })
  await page.clock.pauseAt(startTime)
  await page.goto('/')
  await expect(page.getByRole('progressbar', { name: 'Game loading' })).toBeVisible()
  await expect(play(page)).toHaveCount(0)
  await page.clock.fastForward(30000)
  await expect(page.getByRole('progressbar')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('startup-loader.png') })
  release()
  await expect(play(page)).toBeVisible({ timeout: 10000 })
  await play(page).click()
  await continueButton(page).click()
  await page.getByRole('textbox', { name: /CoinW UID/i }).fill('12345678')
  await start(page).click()
  await expect(page.locator('.game-countdown strong')).toHaveText('3')
  await page.clock.runFor(3100)
  await expect(ball(page)).toBeEnabled()
  await expect(page.locator('.game-clock')).toHaveCount(0)
})
