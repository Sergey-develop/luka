import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const probe: { contexts: AudioContext[]; output?: AnalyserNode; peak: number; stops: { loop: boolean; duration: number; delay: number }[]; starts: { loop: boolean; buffer: AudioBuffer | null }[] } = { contexts: [], peak: 0, stops: [], starts: [] }
    ;(window as unknown as { audioProbe: typeof probe }).audioProbe = probe
    const NativeContext = window.AudioContext
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options)
        probe.contexts.push(this)
      }
    }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      probe.starts.push({ loop: this.loop, buffer: this.buffer })
      return start.apply(this, args)
    }
    const stop = AudioBufferSourceNode.prototype.stop
    AudioBufferSourceNode.prototype.stop = function (when = 0) {
      probe.stops.push({ loop: this.loop, duration: this.buffer?.duration ?? 0, delay: when - this.context.currentTime })
      return stop.call(this, when)
    }
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (...args: unknown[]) {
      if (args[0] instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser()
        analyser.fftSize = 2048
        connect.call(this, analyser)
        probe.output = analyser
        const samples = new Float32Array(analyser.fftSize)
        setInterval(() => {
          analyser.getFloatTimeDomainData(samples)
          probe.peak = Math.max(probe.peak, ...samples.map(Math.abs))
        }, 5)
      }
      return Reflect.apply(connect, this, args)
    } as typeof AudioNode.prototype.connect
  })
})

test('stadium is silent in menus and audio is always enabled after interaction', async ({ page }) => {
  await page.goto('/')
  const contexts = () => page.evaluate(() => (window as unknown as { audioProbe: { contexts: AudioContext[] } }).audioProbe.contexts.length)
  const level = () => page.evaluate(() => {
    const output = (window as unknown as { audioProbe: { output?: AnalyserNode } }).audioProbe.output
    if (!output) return 0
    const samples = new Float32Array(output.fftSize)
    output.getFloatTimeDomainData(samples)
    return Math.max(...samples.map(Math.abs))
  })
  expect(await contexts()).toBe(0)
  await page.getByRole('button', { name: 'START GAME', exact: true }).click()
  await expect.poll(contexts).toBe(1)
  // Let the short button click finish; there must be no ambient source in menus.
  await page.waitForTimeout(400)
  await expect.poll(level).toBeLessThan(.000001)
  expect(await page.evaluate(() => (window as unknown as { audioProbe: { starts: { loop: boolean }[] } }).audioProbe.starts.some(s => s.loop))).toBe(false)
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click()
  await page.getByRole('textbox', { name: 'CoinW UID' }).fill('123456')
  await page.getByRole('button', { name: 'START GAME', exact: true }).click()
  await expect.poll(level, { timeout: 10000 }).toBeGreaterThan(.00001)
  const loopLength = await page.evaluate(() => (window as unknown as { audioProbe: { starts: { loop: boolean; buffer: AudioBuffer }[] } }).audioProbe.starts.find(s => s.loop)?.buffer.duration ?? 0)
  expect(loopLength).toBeGreaterThanOrEqual(55)
  // A visibility change must not suspend audio or stop the stadium loop.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(300)
  const stoppedLoops = await page.evaluate(() => (window as unknown as { audioProbe: { stops: { loop: boolean }[] } }).audioProbe.stops.filter(stop => stop.loop).length)
  // Read AudioContext state in the page because it cannot be serialized.
  expect(await page.evaluate(() => (window as unknown as { audioProbe: { contexts: AudioContext[] } }).audioProbe.contexts[0].state)).toBe('running')
  expect(stoppedLoops).toBe(0)
  await expect.poll(level).toBeGreaterThan(.00001)
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const home = page.getByRole('button', { name: 'Home', exact: true })
  await expect(home).toBeEnabled({ timeout: 6000 })
  await home.click()
  await page.waitForTimeout(500)
  await expect.poll(level).toBeLessThan(.000001)
  await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveCount(0)
  // Old saved mute preferences must no longer silence the kiosk.
  await page.evaluate(() => localStorage.setItem('coinw-football-muted', 'true'))
  await page.reload()
  await page.getByRole('button', { name: 'START GAME', exact: true }).click()
  await expect.poll(contexts).toBe(1)
  await page.waitForTimeout(400)
  await expect.poll(level).toBeLessThan(.000001)
})


test('a kick uses a recording and goal and miss trigger different crowd recordings', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'START GAME', exact: true }).click()
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click()
  await page.getByRole('textbox', { name: 'CoinW UID' }).fill('123456')
  await page.getByRole('button', { name: 'START GAME', exact: true }).click()
  const ball = page.getByRole('button', { name: 'Swipe from the ball to shoot' })
  for (const [dx, dy, label] of [[254, -375, 'GOAL'], [260, -250, 'MISS']] as const) {
    await expect(ball).toBeEnabled({ timeout: 6000 })
    await page.mouse.move(270, 726)
    await page.mouse.down()
    await page.mouse.move(270 + dx, 726 + dy, { steps: 1 })
    await page.mouse.up()
    await expect(page.getByRole('status').getByText(label, { exact: true })).toBeVisible()
  }
  const observed = await page.evaluate(() => {
    const starts = (window as unknown as { audioProbe: { starts: { loop: boolean; buffer: AudioBuffer }[] } }).audioProbe.starts
    const reactions = starts.filter(s => !s.loop && s.buffer.duration > 1.5)
    const kicks = starts.filter(s => !s.loop && Math.abs(s.buffer.duration - .55) < .02)
    return { kicks: kicks.length, reactions: reactions.length, distinct: reactions[0]?.buffer !== reactions[1]?.buffer, suppliedMiss: Math.abs((reactions[1]?.buffer.duration ?? 0) - 3.05) < .05 }
  })
  expect(observed).toEqual({ kicks: 2, reactions: 2, distinct: true, suppliedMiss: true })
})


test('menu clicks are audible without waiting for stadium files', async ({ page }) => {
  // A stalled crowd download must never delay or suppress a menu click.
  await page.route('**/assets/audio/stadium.mp3', route => route.abort())
  await page.goto('/')
  const resetPeak = () => page.evaluate(() => { (window as unknown as { audioProbe: { peak: number } }).audioProbe.peak = 0 })
  const peak = () => page.evaluate(() => (window as unknown as { audioProbe: { peak: number } }).audioProbe.peak)
  await page.getByRole('button', { name: 'START GAME', exact: true }).click()
  await expect.poll(peak, { timeout: 2000, intervals: [20, 50, 100] }).toBeGreaterThan(.02)
  await page.waitForTimeout(400)
  await resetPeak()
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click()
  await expect.poll(peak).toBeGreaterThan(.02)
  await page.waitForTimeout(400)
  await resetPeak()
  await page.getByRole('button', { name: '1', exact: true }).click()
  await expect.poll(peak).toBeGreaterThan(.02)
  await page.waitForTimeout(400)
  await resetPeak()
  await page.getByRole('button', { name: 'BACK', exact: true }).click()
  await expect.poll(peak).toBeGreaterThan(.02)
  const loops = await page.evaluate(() => (window as unknown as { audioProbe: { starts: { loop: boolean }[] } }).audioProbe.starts.filter(s => s.loop).length)
  expect(loops).toBe(0)
})


test('the final goal fades out on the result screen instead of being cut off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'START GAME', exact: true }).click()
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click()
  await page.getByRole('textbox', { name: 'CoinW UID' }).fill('123456')
  await page.getByRole('button', { name: 'START GAME', exact: true }).click()
  const ball = page.getByRole('button', { name: 'Swipe from the ball to shoot' })
  for (let i = 0; i < 5; i++) {
    await expect(ball).toBeEnabled({ timeout: 6000 })
    await page.mouse.move(270, 726)
    await page.mouse.down()
    await page.mouse.move(i % 2 ? 16 : 524, 351, { steps: 1 })
    await page.mouse.up()
    await expect(page.getByRole('status').getByText('GOAL', { exact: true })).toBeVisible()
  }
  await expect(page.getByText('Your result', { exact: true })).toBeVisible()
  const stops = await page.evaluate(() => (window as unknown as { audioProbe: { stops: { loop: boolean; duration: number; delay: number }[] } }).audioProbe.stops.filter(s => !s.loop && s.duration > 4))
  expect(stops.length).toBeGreaterThanOrEqual(6)
  expect(stops.at(-1)!.delay).toBeGreaterThan(.85)
  expect(stops.at(-1)!.delay).toBeLessThanOrEqual(.96)
})


test.describe('mobile playback', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('touch starts sound without requiring Ogg support', async ({ page }) => {
    await page.addInitScript(() => {
      const decode = AudioContext.prototype.decodeAudioData
      AudioContext.prototype.decodeAudioData = function (data: ArrayBuffer, ...callbacks: unknown[]) {
        if (new Uint8Array(data, 0, 4).every((byte, i) => byte === [79, 103, 103, 83][i])) {
          return Promise.reject(new DOMException('Ogg unsupported', 'EncodingError'))
        }
        return Reflect.apply(decode, this, [data, ...callbacks])
      } as typeof decode
      Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } })
    })
    const audioRequests: string[] = []
    page.on('request', request => { if (request.resourceType() === 'fetch' && /\.(ogg|mp3)(\?|$)/.test(request.url())) audioRequests.push(request.url()) })
    await page.goto('/')
    await page.getByRole('button', { name: 'START GAME', exact: true }).tap()
    await expect.poll(() => page.evaluate(() => (window as unknown as { audioProbe: { peak: number } }).audioProbe.peak)).toBeGreaterThan(.001)
    expect(await page.evaluate(() => (navigator as Navigator & { audioSession: { type: string } }).audioSession.type)).toBe('playback')
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    await page.getByRole('textbox', { name: 'CoinW UID', exact: true }).fill('123456')
    await page.getByRole('button', { name: 'START GAME', exact: true }).tap()
    await expect.poll(() => page.evaluate(() => (window as unknown as { audioProbe: { starts: { loop: boolean }[] } }).audioProbe.starts.some(s => s.loop))).toBe(true)
    expect(audioRequests.length).toBe(5)
    expect(audioRequests.every(url => url.endsWith('.mp3'))).toBe(true)
  })
})
