<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Application, Assets, Graphics, Sprite } from 'pixi.js'
import { gsap } from 'gsap'
import { gameAudio } from '../../audio/gameAudio'
import backgroundUrl from '../../assets/stadium-clean.webp'
import keeperIdleUrl from '../../assets/keeper-idle-clean.png'
import keeperDiveUrl from '../../assets/keeper-dive.png'
import ballUrl from '../../assets/match-ball.png'
import avatarUrl from '../../assets/match-avatar.png'
import { constrainSwipe, flightPosition, shotPower } from '../physics'
import { gameConfig } from '../../config/game'
import type { Outcome, Shot, Swipe } from '../../types/game'

type AnimatedShot = Shot & { id: number }

const props = defineProps<{
  shot: AnimatedShot | null
  disabled: boolean
  score: number
  goals: number
  shots: number
  countdown: number | null
  countdownProgress: number
  secondsLeft: number
}>()
const emit = defineEmits<{ swipe: [gesture: Swipe]; complete: []; home: [] }>()

const scene = ref<HTMLElement | null>(null)
const host = ref<HTMLElement | null>(null)
const ready = ref(false)
const loadFailed = ref(false)
const result = ref<Outcome | null>(null)
const dragging = ref(false)
const dragAim = ref<Swipe>({ dx: 0, dy: 0 })
const power = computed(() => shotPower(dragAim.value))
const aimPoint = computed(() => ({ x: ballStart.x + dragAim.value.dx, y: ballStart.y + dragAim.value.dy }))
const tensionChevrons = computed(() => {
  if (Math.hypot(dragAim.value.dx, dragAim.value.dy) < 150) return []
  const start = { x: ballStart.x, y: ballStart.y + power.value * 22 }
  const control = { x: ballStart.x + dragAim.value.dx * .25, y: ballStart.y - 160 }
  const end = aimPoint.value
  return Array.from({ length: 6 }, (_, index) => {
    // Perspective spacing and scale match the arrows in the game reference.
    const t = .33 + (1 - (1 - index / 5) ** 1.6) * .54
    const u = 1 - t
    const x = u * u * start.x + 2 * u * t * control.x + t * t * end.x
    const y = u * u * start.y + 2 * u * t * control.y + t * t * end.y
    const angle = Math.atan2(u * (control.y - start.y) + t * (end.y - control.y),
      u * (control.x - start.x) + t * (end.x - control.x)) * 180 / Math.PI + 90
    const width = 60 - index * 10
    const height = width * .36
    const thickness = width * .23
    return {
      transform: `translate(${x} ${y}) rotate(${angle})`,
      points: `${-width / 2},${height / 2} 0,${-height / 2} ${width / 2},${height / 2} ${width / 2},${height / 2 + thickness} 0,${-height / 2 + thickness} ${-width / 2},${height / 2 + thickness}`,
    }
  })
})
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const swipeHint = ref('')
const keyboardDirection = ref(0)
const keyboardHeight = ref(0)
const keyboardAiming = ref(false)
const { maxShots, animation, field, swipe } = gameConfig
const { width: stageWidth, height: stageHeight, ballStart } = field
const ballSize = 182
const enabled = computed(() => ready.value && !props.disabled && props.countdown === null)
const currentShot = computed(() => Math.min(props.shots + 1, maxShots))
const awardedPoints = computed(() => props.shot?.points ?? 0)
const displayedScore = computed(() => props.score + (result.value === 'goal' ? awardedPoints.value : 0))
const displayedGoals = computed(() => props.goals + (result.value === 'goal' ? 1 : 0))
const ballControlStyle = {
  left: (ballStart.x / stageWidth * 100) + '%',
  top: (ballStart.y / stageHeight * 100) + '%',
  width: (ballSize / stageWidth * 100) + '%',
}

const keyboardSwipe = computed<Swipe>(() => ({
  dx: keyboardDirection.value * 158,
  dy: -310 - keyboardHeight.value * 53,
}))
const reticleStyle = computed(() => {
  const aim = dragging.value ? dragAim.value : keyboardAiming.value ? keyboardSwipe.value : { dx: 0, dy: -310 }
  return {
    left: ((ballStart.x + aim.dx) / stageWidth * 100) + '%',
    top: ((ballStart.y + aim.dy) / stageHeight * 100) + '%',
  }
})

let activePointer: { id: number; x: number; y: number; startedAt: number; element: HTMLButtonElement } | undefined
let app: Application | undefined
let ball: Sprite | undefined
let idle: Sprite | undefined
let dive: Sprite | undefined
let timeline: gsap.core.Timeline | undefined
let destroyed = false
let shadow: Graphics | undefined
let trail: Graphics | undefined
let keeperRest: gsap.core.Tween | undefined
let tensionTween: gsap.core.Tween | undefined

function restKeeper() {
  if (!idle || destroyed) return
  keeperRest?.kill()
  idle.position.set(270, 455)
  idle.rotation = 0
  idle.width = 180
  idle.height = 180
  if (!reducedMotion()) keeperRest = gsap.to(idle, { y: 452, rotation: .012, duration: .85, repeat: -1, yoyo: true, ease: 'sine.inOut' })
}

function moveSwipe(event: PointerEvent) {
  if (!activePointer || event.pointerId !== activePointer.id || !enabled.value) return
  const point = pointerPoint(event)
  if (!point) return
  dragAim.value = constrainSwipe({ dx: point.x - activePointer.x, dy: point.y - activePointer.y, durationMs: Math.max(1, event.timeStamp - activePointer.startedAt) })
  if (!ball || reducedMotion()) return
  tensionTween?.kill()
  tensionTween = gsap.to(ball, {
    x: ballStart.x - Math.max(-18, Math.min(18, dragAim.value.dx * .06)),
    y: ballStart.y + power.value * 22,
    width: ballSize * (1 + power.value * .06), height: ballSize * (1 - power.value * .07),
    rotation: -dragAim.value.dx * .001, duration: .1, ease: 'power2.out',
  })
}

function pointerPoint(event: PointerEvent) {
  const rect = scene.value?.getBoundingClientRect()
  if (!rect?.width || !rect.height) return null
  return {
    x: (event.clientX - rect.left) / rect.width * stageWidth,
    y: (event.clientY - rect.top) / rect.height * stageHeight,
  }
}

function startSwipe(event: PointerEvent) {
  if (!enabled.value || activePointer || !event.isPrimary || event.button !== 0) return
  const point = pointerPoint(event)
  if (!point || Math.hypot(point.x - ballStart.x, point.y - ballStart.y) > ballSize / 2) return

  const element = event.currentTarget as HTMLButtonElement
  element.setPointerCapture(event.pointerId)
  activePointer = { id: event.pointerId, ...point, startedAt: event.timeStamp, element }
  swipeHint.value = ''
  keyboardAiming.value = false
  dragAim.value = { dx: 0, dy: 0 }
  dragging.value = true
}

function endSwipe(event: PointerEvent) {
  if (event.pointerId !== activePointer?.id) return
  const start = activePointer
  const end = pointerPoint(event)
  resetGesture()
  if (!end || !enabled.value) return

  const gesture = constrainSwipe({ dx: end.x - start.x, dy: end.y - start.y, durationMs: Math.max(1, event.timeStamp - start.startedAt) })
  if (Math.hypot(gesture.dx, gesture.dy) < swipe.minLength) {
    swipeHint.value = 'SWIPE A LITTLE FARTHER'
    return
  }
  if (-gesture.dy < swipe.minForward) {
    swipeHint.value = 'SWIPE UP FROM THE BALL'
    return
  }
  emit('swipe', gesture)
}

function cancelSwipe(event: PointerEvent) {
  if (event.pointerId === activePointer?.id) resetGesture()
}

function resetGesture() {
  tensionTween?.kill()
  if (ball && !props.shot) {
    tensionTween = gsap.to(ball, { x: ballStart.x, y: ballStart.y, width: ballSize, height: ballSize, rotation: 0,
      duration: reducedMotion() ? 0 : .25, ease: 'back.out(1.5)' })
  }
  const pointer = activePointer
  activePointer = undefined
  dragging.value = false
  if (pointer?.element.hasPointerCapture(pointer.id)) pointer.element.releasePointerCapture(pointer.id)
}

function aimWithKeys(event: KeyboardEvent) {
  if (!enabled.value) return
  switch (event.key) {
    case 'ArrowLeft':
      keyboardDirection.value = Math.max(-1, keyboardDirection.value - 1)
      break
    case 'ArrowRight':
      keyboardDirection.value = Math.min(1, keyboardDirection.value + 1)
      break
    case 'ArrowUp':
      keyboardHeight.value = Math.min(1, keyboardHeight.value + 1)
      break
    case 'ArrowDown':
      keyboardHeight.value = Math.max(-1, keyboardHeight.value - 1)
      break
    default:
      return
  }
  event.preventDefault()
  keyboardAiming.value = true
  swipeHint.value = ''
}

function shootWithKeyboard(event: MouseEvent) {
  if (event.detail !== 0 || !enabled.value || activePointer) return
  swipeHint.value = ''
  emit('swipe', keyboardSwipe.value)
}

async function init() {
  const instance = new Application()
  const screenScale = (scene.value?.clientWidth || stageWidth) / stageWidth
  const resolution = Math.max(1, Math.min(2, screenScale * (window.devicePixelRatio || 1)))
  try {
    await instance.init({
      width: stageWidth,
      height: stageHeight,
      background: 0x210b91,
      antialias: true,
      resolution,
      // CSS fits the canvas to the kiosk without Pixi setting a fixed pixel width.
      autoDensity: false,
    })
    if (destroyed) {
      instance.destroy(true)
      return
    }
    app = instance
    const [bgTex, idleTex, diveTex, ballTex] = await Promise.all(
      [backgroundUrl, keeperIdleUrl, keeperDiveUrl, ballUrl].map(url => Assets.load(url)),
    )
    if (destroyed) return

    const bg = new Sprite(bgTex)
    bg.width = stageWidth
    bg.height = stageHeight
    idle = new Sprite(idleTex)
    idle.anchor.set(.5)
    idle.position.set(270, 455)
    idle.width = 180
    idle.height = 180
    dive = new Sprite(diveTex)
    // Keep the pose pivot fixed while the extended glove reaches beyond it.
    dive.anchor.set(129 / 276, .5)
    dive.width = 276
    dive.height = 198
    dive.visible = false
    ball = new Sprite(ballTex)
    ball.anchor.set(.5)
    resetBall(ball)
    shadow = new Graphics().ellipse(0, 0, 65, 10).fill({ color: 0x100622, alpha: .35 })
    shadow.position.set(ballStart.x, ballStart.y + 60)
    trail = new Graphics()
    instance.stage.addChild(bg, idle, dive, shadow, trail, ball)
    restKeeper()
    host.value?.appendChild(instance.canvas)
    ready.value = true
  } catch {
    if (!destroyed) loadFailed.value = true
  }
}

function resetBall(sprite: Sprite) {
  sprite.position.set(ballStart.x, ballStart.y)
  sprite.width = ballSize
  sprite.height = ballSize
  sprite.rotation = 0
}

function animate(shot: AnimatedShot) {
  if (!ball || !idle || !dive) return
  const ballSprite = ball
  const idleSprite = idle
  const diveSprite = dive

  timeline?.kill()
  keeperRest?.kill()
  tensionTween?.kill()
  result.value = null
  idleSprite.alpha = 1
  diveSprite.alpha = 0
  diveSprite.visible = true
  const direction = shot.keeper.x < ballStart.x ? -1 : 1
  const hand = shot.outcome === 'saved' ? shot.target : shot.keeper
  const central = Math.abs(shot.target.x - ballStart.x) < 65
  const reduced = reducedMotion()
  // Ball flight and saves are essential gameplay, including reduced-motion mode.
  const flight = Math.max(animation.minFlightMs, shot.flightMs) / 1000
  const windup = .12
  const arrive = windup + flight
  const react = windup + shot.reactionMs / shot.flightMs * flight
  const travel = Math.max(0, arrive - react)
  const hold = animation.resultMs / 1000
  const start = { x: ballSprite.x, y: ballSprite.y, size: ballSprite.width }
  const motion = { t: 0 }
  const points: { x: number; y: number }[] = []
  const highDive = hand.y < gameConfig.keeper.start.y - 20
  const rotation = (highDive ? -.25 : .35) * direction
  const gloveX = 126 * direction
  const gloveY = -59
  const keeperX = hand.x - (gloveX * Math.cos(rotation) - gloveY * Math.sin(rotation))
  const keeperY = hand.y - (gloveX * Math.sin(rotation) + gloveY * Math.cos(rotation))
  diveSprite.width = 276
  diveSprite.height = 198
  diveSprite.scale.x = Math.abs(diveSprite.scale.x) * direction
  const diveScale = { x: diveSprite.scale.x, y: diveSprite.scale.y }
  diveSprite.scale.set(diveScale.x * .72, diveScale.y * .72)
  diveSprite.position.set(270 - direction * 35, 490)
  diveSprite.rotation = -.22 * direction

  timeline = gsap.timeline({ onComplete: () => emit('complete') })
  timeline.call(() => gameAudio.kick(), [], windup)
  timeline.to(motion, { t: 1, duration: flight, ease: 'none', onUpdate: () => {
    const t = motion.t
    const position = flightPosition(shot.trajectory, t)
    ballSprite.x = position.x + (start.x - ballStart.x) * (1 - t) ** 2
    ballSprite.y = position.y + (start.y - ballStart.y) * (1 - t) ** 2
    ballSprite.width = ballSprite.height = (ballSize + (start.size - ballSize) * (1 - t)) * position.scale
    ballSprite.rotation = t * Math.PI * 2 * direction
    if (shadow) {
      shadow.x = ballSprite.x
      shadow.y = position.groundY
      shadow.scale.set(position.scale)
      shadow.alpha = 1 - t * .65
    }
    if (trail && !reduced) {
      points.push({ x: ballSprite.x, y: ballSprite.y })
      if (points.length > 9) points.shift()
      trail.clear()
      points.forEach((point, i) => {
        if (!i) return
        trail!.moveTo(points[i - 1].x, points[i - 1].y).lineTo(point.x, point.y)
          .stroke({ width: (i / points.length) * 13, color: 0xe4d0ff, alpha: (i / points.length) * .55 })
      })
    }
  } }, windup)
  // Crouch, push off, reach the simulated interception point, then land.
  timeline.to(idleSprite, { height: 165, y: 462, duration: .12, ease: 'power2.in' }, 0)
  if (central) {
    const catchY = hand.y + 22
    timeline.to(idleSprite, { x: hand.x, height: 190, rotation: .025 * direction,
      duration: travel * .45, ease: 'power2.out' }, react)
    timeline.to(idleSprite, { y: Math.min(catchY, 455) - 52,
      duration: travel * .55, ease: 'power2.out' }, react)
    timeline.to(idleSprite, { y: catchY,
      duration: travel * .45, ease: 'power1.in' }, react + travel * .55)
    timeline.to(idleSprite, { y: 466, height: 158, rotation: 0,
      duration: reduced ? 0 : .2, ease: 'power2.in' }, arrive)
    timeline.to(idleSprite, { y: 455, height: 180,
      duration: reduced ? 0 : .25, ease: 'power2.out' }, arrive + (reduced ? 0 : .2))
  } else {
    timeline.to(idleSprite, { alpha: 0, x: 270 + direction * 22, duration: .1 }, react)
    timeline.to(diveSprite, { alpha: 1, duration: .1 }, react)
    timeline.to(diveSprite.scale, { ...diveScale, duration: travel * .7, ease: 'power1.out' }, react)
    timeline.to(diveSprite, { x: keeperX, rotation, duration: travel, ease: 'power1.out' }, react)
    if (highDive) {
      // Reach a high ball at the apex; do not start falling before contact.
      timeline.to(diveSprite, { y: keeperY, duration: travel, ease: 'sine.out' }, react)
    } else {
      timeline.to(diveSprite, { y: Math.min(keeperY, 455) - 24, duration: travel * .55, ease: 'power2.out' }, react)
      timeline.to(diveSprite, { y: keeperY, duration: travel * .45, ease: 'power1.in' }, react + travel * .55)
    }
    timeline.to(diveSprite, { y: Math.max(keeperY, 477), rotation: direction * .38,
      duration: highDive ? .42 : .25, ease: 'power2.in' }, arrive)
  }
  timeline.call(() => { trail?.clear(); result.value = shot.outcome; gameAudio.result(shot.outcome) }, [], arrive)
  if (!reduced) {
    timeline.to(ballSprite, { x: shot.target.x + (shot.outcome === 'saved' ? -direction * 45 : 0),
      y: shot.outcome === 'saved' ? shot.target.y + 90 : shot.target.y + 35,
      alpha: 0, duration: .35, ease: 'power2.in' }, arrive)
  }
  timeline.to(diveSprite, { alpha: 0, duration: reduced ? 0 : .2 }, arrive + hold - .3)
  timeline.to(idleSprite, { alpha: 1, x: 270, y: 455, height: 180, rotation: 0,
    duration: reduced ? 0 : .3, ease: 'power2.out' }, arrive + hold - .3)
  timeline.call(() => {
    result.value = null
    resetBall(ballSprite)
    ballSprite.alpha = 1
    if (shadow) { shadow.position.set(ballStart.x, ballStart.y + 60); shadow.scale.set(1); shadow.alpha = 1 }
    diveSprite.visible = false
    restKeeper()
  }, [], arrive + hold)
}

onMounted(init)
watch(enabled, (canShoot) => {
  if (canShoot) return
  resetGesture()
  swipeHint.value = ''
  keyboardAiming.value = false
})
watch(() => props.shot, shot => { if (shot) animate(shot) })
onBeforeUnmount(() => {
  gameAudio.stopEffects()
  destroyed = true
  resetGesture()
  timeline?.kill()
  keeperRest?.kill()
  tensionTween?.kill()
  app?.destroy(true, { children: true })
})
</script>

<template>
  <section ref="scene" class="game-scene" :class="{ 'has-outcome': result }" aria-label="Football game">
    <div ref="host" class="pixi-host" aria-hidden="true"></div>

    <div class="game-hud">
      <div class="hud-card hud-score">
        <img class="hud-avatar" :src="avatarUrl" alt="" draggable="false">
        <div class="hud-value">
          <span class="hud-label">POINTS</span>
          <strong>{{ displayedScore }}</strong>
        </div>
      </div>
      <div class="shot-counter">
        <strong>{{ currentShot }}/{{ maxShots }}</strong>
        <span class="hud-label">SHOT</span>
      </div>
      <div class="hud-card hud-goals">
        <div class="hud-value">
          <span class="hud-label">GOALS</span>
          <span class="goal-dots" :aria-label="displayedGoals + ' goals'">
            <i v-for="n in maxShots" :key="n" :class="{ filled: n <= displayedGoals }"></i>
          </span>
        </div>
      </div>
    </div>

    <button class="game-home" type="button" aria-label="Home" :disabled="countdown !== null" @click="emit('home')">
      <span class="home-icon" aria-hidden="true"></span>
    </button>

    <div class="game-clock" :class="{ 'game-clock--urgent': secondsLeft <= 5 && countdown === null }" role="timer" aria-label="Round timer">
      <span>TIME LEFT</span>
      <strong>{{ Math.max(0, Math.ceil(secondsLeft)) }}s</strong>
    </div>

    <Transition name="outcome">
      <div v-if="result" class="shot-result" :class="result" role="status">
        <strong>{{ result.toUpperCase() }}</strong>
        <span class="shot-award">+{{ awardedPoints }}</span>
      </div>
    </Transition>

    <div v-if="countdown !== null" class="game-countdown" role="status" aria-live="polite" aria-atomic="true">
      <span class="sr-only">GET READY</span>
      <svg class="countdown-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="countdown-track" cx="50" cy="50" r="45" />
        <circle class="countdown-progress" cx="50" cy="50" r="45" pathLength="100"
          :stroke-dashoffset="100 * (1 - Math.max(0, Math.min(1, countdownProgress)))" />
      </svg>
      <strong>{{ countdown }}</strong>
    </div>

    <div v-if="enabled" class="aim-guide" :class="{ 'aim-guide--moving': dragging }" aria-hidden="true">
      <svg v-if="dragging" class="tension-line" :viewBox="`0 0 ${stageWidth} ${stageHeight}`" preserveAspectRatio="none">
        <polygon v-for="(chevron, index) in tensionChevrons" :key="index"
          :points="chevron.points" :transform="chevron.transform" />
      </svg>
      <div class="aim-reticle" :style="reticleStyle"><span></span></div>
      <div v-if="!keyboardAiming && !dragging" class="swipe-arrows"><i></i><i></i><i></i></div>
    </div>

    <div v-if="dragging" class="power-meter" aria-hidden="true">
      <span>POWER <b>{{ Math.round(power * 100) }}%</b></span>
      <div><i :style="{ transform: `scaleX(${power})` }"></i></div>
    </div>

    <button
      class="ball-control"
      type="button"
      :class="{ 'ball-control--dragging': dragging }"
      :style="ballControlStyle"
      :disabled="!enabled"
      aria-label="Swipe from the ball to shoot"
      aria-describedby="game-keyboard-help"
      @pointerdown="startSwipe"
      @pointermove="moveSwipe"
      @pointerup="endSwipe"
      @pointercancel="cancelSwipe"
      @lostpointercapture="cancelSwipe"
      @click="shootWithKeyboard"
      @keydown="aimWithKeys"
    ></button>
    <p id="game-keyboard-help" class="game-keyboard-help">Use the arrow keys to aim, then press Enter or Space to shoot.</p>

    <div v-if="enabled || loadFailed" class="game-prompt" :role="loadFailed ? 'alert' : swipeHint ? 'status' : undefined">
      {{ loadFailed ? 'GAME UNAVAILABLE. RETURN HOME TO RETRY.' : swipeHint || (dragging ? 'LENGTH + SPEED = POWER · RELEASE TO SHOOT' : 'SWIPE UP · LENGTH + SPEED CONTROL THE SHOT') }}
    </div>
  </section>
</template>

<style scoped>
.tension-line { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.tension-line polygon { fill: #fff; filter: drop-shadow(0 0 4px #ffffff80); }
.power-meter { position: absolute; left: 26%; right: 26%; bottom: 12%; pointer-events: none; }
.power-meter > span { display: flex; justify-content: space-between; margin-bottom: 1cqw; font-size: 2.3cqw; font-weight: 800; text-shadow: 0 1px 4px #000; }
.power-meter > div { height: 1.6cqw; padding: .2cqw; border-radius: 2cqw; background: #160a3bd9; box-shadow: 0 0 0 .2cqw #d7baff80; overflow: hidden; }
.power-meter i { display: block; height: 100%; border-radius: inherit; transform-origin: left; background: linear-gradient(90deg, #b99aff, #f6d8ff, #ffe889); }
.aim-guide--moving .aim-reticle { background: #6435bd66; box-shadow: 0 0 3cqw #e4a8ff; }
.game-scene {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #2509ab url('../../assets/stadium-clean.webp') center / 100% 100% no-repeat;
  color: white;
  touch-action: manipulation;
  container-type: inline-size;
}
.pixi-host {
  position: absolute;
  inset: 0;
}
.pixi-host :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.game-hud {
  position: absolute;
  top: 2.15%;
  left: 3.7%;
  right: 3.7%;
  height: 10%;
  display: grid;
  grid-template-columns: 1fr 17.8cqw 1fr;
  align-items: center;
  gap: 3.1cqw;
  pointer-events: none;
}
.hud-card {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  height: 71.8%;
  border-radius: 3.1cqw;
  translate: 0 -.37cqw;
}
.hud-card::before,
.hud-card::after {
  position: absolute;
  content: '';
  clip-path: var(--rounded-shape, polygon(var(--shape)));
  border-radius: inherit;
}
.hud-card::before {
  z-index: -2;
  inset: 0;
  background: radial-gradient(ellipse at var(--highlight) 2%, #fff 0% 11%, #d1acff 25%, transparent 44%), #8560ec;
}
.hud-card::after {
  z-index: -1;
  inset: .2cqw;
  background: radial-gradient(ellipse at 35% 130%, #4f26db, transparent 86%), linear-gradient(150deg, #3011b7, #3812c8 55%, #2d10bd);
}
.hud-score {
  --shape: 0 17%, 7% 0, 83% 0, 100% 47%, 100% 78%, 93% 100%, 7% 100%, 0 84%;
  --highlight: 81%;
  justify-content: flex-start;
  gap: 1.35cqw;
  padding: 0 1.7cqw;
}
.hud-goals {
  --shape: 0 47%, 17% 0, 93% 0, 100% 17%, 100% 84%, 93% 100%, 7% 100%, 0 78%;
  --highlight: 19%;
  justify-content: center;
}
@supports (clip-path: shape(from 0 0, line to 100% 100%, close)) {
  .hud-score {
    --rounded-shape: shape(from 4.1cqw 0, line to calc(100% - 6.9cqw) 0,
      curve to calc(100% - 5.2cqw) 6% with calc(100% - 6cqw) 0 / calc(100% - 5.6cqw) 2%,
      line to calc(100% - .85cqw) 42%, curve to 100% 53% with calc(100% - .2cqw) 48% / 100% 50%,
      line to 100% 72%, curve to calc(100% - 1cqw) 85% with 100% 79% / calc(100% - .3cqw) 81%,
      line to calc(100% - 3cqw) 97%, curve to calc(100% - 4.4cqw) 100% with calc(100% - 3.7cqw) 100%,
      line to 4cqw 100%, curve to 2.4cqw 96% with 3.4cqw 100% / 2.9cqw 99%,
      line to .75cqw 83%, curve to 0 69% with .2cqw 79% / 0 73%,
      line to 0 30%, curve to .8cqw 17% with 0 25% / .27cqw 21%,
      line to 2.6cqw 5%, curve to 4.1cqw 0 with 3.1cqw 2% / 3.4cqw 0, close);
  }
  .hud-goals {
    --rounded-shape: shape(from calc(100% - 4.1cqw) 0, line to 6.9cqw 0,
      curve to 5.2cqw 6% with 6cqw 0 / 5.6cqw 2%,
      line to .85cqw 42%, curve to 0 53% with .2cqw 48% / 0 50%,
      line to 0 72%, curve to 1cqw 85% with 0 79% / .3cqw 81%,
      line to 3cqw 97%, curve to 4.4cqw 100% with 3.7cqw 100%,
      line to calc(100% - 4cqw) 100%, curve to calc(100% - 2.4cqw) 96% with calc(100% - 3.4cqw) 100% / calc(100% - 2.9cqw) 99%,
      line to calc(100% - .75cqw) 83%, curve to 100% 69% with calc(100% - .2cqw) 79% / 100% 73%,
      line to 100% 30%, curve to calc(100% - .8cqw) 17% with 100% 25% / calc(100% - .27cqw) 21%,
      line to calc(100% - 2.6cqw) 5%, curve to calc(100% - 4.1cqw) 0 with calc(100% - 3.1cqw) 2% / calc(100% - 3.4cqw) 0, close);
  }
}
.hud-avatar {
  display: block;
  width: 9.1cqw;
  aspect-ratio: 1;
  object-fit: cover;
  border: .18cqw solid #b69bfa;
  border-radius: 50%;
}
.hud-value,
.shot-counter {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.hud-score .hud-value {
  flex-basis: 16cqw;
}
.hud-label {
  color: #baabff;
  font-size: 1.67cqw;
  line-height: 1.15;
}
.hud-score strong,
.shot-counter strong {
  font-size: 5.22cqw;
  line-height: .98;
  letter-spacing: -.04em;
}
.hud-score strong {
  margin-top: .6cqw;
}
.shot-counter {
  position: relative;
  aspect-ratio: 1;
  border: .35cqw solid #bda5f5;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 18%, #6136f5, #491ad0 58%, #3712c0);
  box-shadow: inset 0 -.45cqw 1.75cqw #9076ed, inset 0 .65cqw 1.1cqw #dfcdfc;
}
.shot-counter::before {
  position: absolute;
  inset: .76cqw;
  background: conic-gradient(from 180deg, #e6d7ff 0% 45%, #fff 48%, #ffeefe 73%, #f3e7ff 93% 98%, transparent 99%);
  mask-image: radial-gradient(circle closest-side, transparent calc(100% - .65cqw), #000 calc(100% - .5cqw), #000 calc(100% - .45cqw), transparent);
  border-radius: inherit;
  filter: drop-shadow(0 0 .4cqw #edd4ff);
  content: '';
}
.shot-counter::after {
  position: absolute;
  left: 50%;
  bottom: .4cqw;
  width: 1.17cqw;
  aspect-ratio: 1;
  translate: -50%;
  border: .17cqw solid #e8d6ff;
  border-radius: 50%;
  background: radial-gradient(circle, #f1dcff 0 20%, #5a29ec 25%);
  box-shadow: 0 0 .75cqw #ab81fd;
  content: '';
}
.has-outcome .shot-counter::before {
  background: conic-gradient(from 180deg, #e8d5ff 0 49.5%, transparent 50% 87%, #ffecff 88% 99%, transparent);
}
.shot-counter .hud-label {
  margin-top: .65cqw;
}
.goal-dots {
  display: flex;
  gap: 2cqw;
  margin-top: 1.6cqw;
}
.goal-dots i {
  width: 3.15cqw;
  aspect-ratio: 1;
  border: .19cqw solid #7543f5;
  border-radius: 50%;
}
.goal-dots i.filled {
  background: white;
  border-color: #f2e5ff;
  box-shadow: 0 0 1.2cqw #e2c3ff;
}
.game-home {
  position: absolute;
  z-index: 3;
  top: 11.65%;
  left: 4%;
  display: grid;
  place-items: center;
  width: 8.25%;
  aspect-ratio: 1;
  padding: 0;
  border: .18cqw solid #c9b6ff;
  border-radius: 50%;
  color: white;
  background: radial-gradient(circle at 50% 17%, #673bf0, #4314ce 58%, #3312a4);
  box-shadow: inset 0 0 1.35cqw #a98afd, 0 0 2.7cqw #be94ffb3;
}
.home-icon {
  display: block;
  width: 33%;
  aspect-ratio: 1;
  background: currentColor;
  clip-path: polygon(50% 0, 68% 16%, 68% 5%, 81% 5%, 81% 28%, 100% 48%, 87% 52%, 87% 100%, 60% 100%, 60% 69%, 40% 69%, 40% 100%, 13% 100%, 13% 52%, 0 48%);
}
.ball-control {
  position: absolute;
  z-index: 2;
  padding: 0;
  aspect-ratio: 1;
  border: 0;
  border-radius: 50%;
  translate: -50% -50%;
  background: transparent;
  touch-action: none;
  cursor: grab;
  transition: box-shadow .14s ease;
}
.ball-control--dragging {
  cursor: grabbing;
  box-shadow: 0 0 2.4cqw #eee0ffb3, inset 0 0 1.55cqw #dfbbff9c;
}
.ball-control:disabled {
  visibility: hidden;
}
.aim-guide {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.aim-reticle {
  position: absolute;
  display: grid;
  place-items: center;
  width: 10.4cqw;
  aspect-ratio: 1;
  border: .25cqw solid #d1a8f0a8;
  border-radius: 50%;
  translate: -50% -50%;
  color: white;
  background: radial-gradient(circle at 34% 26%, #704cb4, #3c1b7d 48%, #130b45 82%);
  box-shadow: 0 0 2cqw #e49efa91, inset 0 0 1.4cqw #d8aafb9e;
}
.aim-reticle::before {
  position: absolute;
  inset: 21%;
  border: .35cqw solid white;
  border-radius: 50%;
  box-shadow: 0 0 .7cqw #efbeff;
  content: '';
}
.aim-reticle span {
  width: 11%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: white;
  box-shadow: 0 0 .8cqw #efbeff;
}
.aim-reticle::after {
  position: absolute;
  inset: 10%;
  background: currentColor;
  clip-path: polygon(48% 0, 52% 0, 52% 29%, 48% 29%, 48% 0, 48% 48%, 0 48%, 0 52%, 29% 52%, 29% 48%, 71% 48%, 71% 52%, 100% 52%, 100% 48%, 52% 48%, 52% 71%, 52% 100%, 48% 100%, 48% 71%, 52% 71%, 52% 48%);
  content: '';
}
.swipe-arrows {
  position: absolute;
  top: 56.4%;
  left: 50%;
  display: grid;
  gap: 2.3cqw;
  justify-items: center;
  translate: -50%;
  filter: drop-shadow(0 0 .75cqw #fbffde);
}
.swipe-arrows i {
  display: block;
  width: 5.1cqw;
  height: 3.2cqw;
  clip-path: polygon(0 72%, 50% 0, 100% 72%, 100% 100%, 50% 28%, 0 100%);
  background: #fff;
  opacity: .7;
  animation: swipe-cue 1.65s ease-in-out infinite;
}
.swipe-arrows i:nth-child(1) { width: 4.2cqw; animation-delay: .2s; }
.swipe-arrows i:nth-child(2) { width: 4.75cqw; animation-delay: .1s; }
.aim-guide--moving .swipe-arrows { opacity: .48; }
@keyframes swipe-cue {
  0%, 100% { opacity: .48; }
  50% { opacity: .97; }
}
.game-home {
  transition: transform .14s ease, box-shadow .14s ease, filter .14s ease;
}
.game-home:disabled {
  opacity: .6;
  cursor: default;
}
@media (hover: hover) and (pointer: fine) {
  .game-home:hover:not(:disabled) {
    filter: brightness(1.22);
    box-shadow: inset 0 0 1.5cqw #c6a2ff, 0 0 3cqw #cfabff;
  }
  .ball-control:hover {
    box-shadow: 0 0 1.8cqw #eee0ff8a;
  }
}
.game-home:active:not(:disabled) {
  transform: scale(.96);
}
.game-home:focus-visible,
.ball-control:focus-visible {
  outline: .42cqw solid white;
  outline-offset: .6cqw;
}
.game-keyboard-help {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.game-clock {
  position: absolute;
  top: 11.65%;
  right: 4%;
  display: flex;
  align-items: center;
  gap: 1.5cqw;
  min-height: 8.25cqw;
  padding: 0 2.6cqw;
  border: .18cqw solid #c9b6ff;
  border-radius: 5cqw;
  background: linear-gradient(150deg, #5530cc, #3111a2);
  box-shadow: inset 0 0 1.6cqw #ac8afe73, 0 0 2cqw #be94ff86;
  font-variant-numeric: tabular-nums;
}
.game-clock span {
  color: #e3d4ff;
  font-size: 1.72cqw;
  font-weight: 700;
}
.game-clock strong { font-size: 3.3cqw; }
.game-clock--urgent {
  border-color: #ffa3ac;
  background: linear-gradient(150deg, #a42e68, #5f123c);
}
.game-countdown {
  position: absolute;
  z-index: 4;
  top: 44%;
  left: 50%;
  display: grid;
  place-items: center;
  width: 30cqw;
  aspect-ratio: 1;
  translate: -50% -50%;
  border: .6cqw solid #ac91ea;
  border-radius: 50%;
  background: linear-gradient(180deg, #6222e6c9, #54209d70 57%, #7e9d3052);
  backdrop-filter: blur(.6cqw);
  -webkit-backdrop-filter: blur(.6cqw);
  box-shadow: inset 0 .4cqw .6cqw #eee5ffb8, inset 0 -.35cqw .7cqw #32126a80,
    0 .15cqw .55cqw #16063150;
  pointer-events: none;
}
.countdown-ring {
  position: absolute;
  inset: 1.2%;
  width: 97.6%;
  height: 97.6%;
  overflow: visible;
  transform: rotate(-90deg) scaleY(-1);
  fill: none;
  stroke-width: 2.5;
}
.countdown-track { stroke: #5c31aa42; }
.countdown-progress {
  stroke: #fff;
  stroke-linecap: round;
  stroke-dasharray: 100;
  filter: drop-shadow(0 0 .6px #fff9);
}
.game-countdown > strong {
  color: #fff;
  font-family: 'Satoshi Variable', Arial, sans-serif;
  font-size: 12cqw;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  letter-spacing: -.055em;
  padding-right: .35cqw;
}

.game-prompt {
  position: absolute;
  left: 6.3%;
  right: 5.3%;
  bottom: 3.92%;
  display: grid;
  min-height: 5.8%;
  place-items: center;
  padding: .6cqw 2.5cqw;
  border: .21cqw solid #cdb0ff;
  border-radius: 7cqw;
  background: linear-gradient(90deg, #6533ff, #c7b5ff);
  box-shadow: inset 0 .2cqw .6cqw #d7c8ff83, 0 0 0 2cqw #294314ba;
  color: white;
  text-align: center;
  font-size: 3.48cqw;
  font-weight: 700;
}
.shot-result {
  position: absolute;
  z-index: 4;
  top: 35.65%;
  inset-inline: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3.9cqw;
  color: white;
  pointer-events: none;
}
.shot-result strong {
  font-family: 'Arial Black', Arial, sans-serif;
  font-size: 15.45cqw;
  font-weight: 900;
  line-height: .93;
  letter-spacing: -.055em;
  -webkit-text-stroke: 1.12cqw #190740;
  paint-order: stroke fill;
  filter: drop-shadow(0 .4cqw 0 #5c2cbd) drop-shadow(0 .8cqw 0 #210b4f) drop-shadow(0 -.14cqw .18cqw #8b59fe);
}
.shot-result.miss strong,
.shot-result.saved strong {
  transform: scaleX(.82);
  -webkit-text-stroke-color: #210304;
  filter: drop-shadow(.22cqw 0 0 #ad0b1c) drop-shadow(-.22cqw 0 0 #ad0b1c)
    drop-shadow(0 -.23cqw 0 #f02330) drop-shadow(0 .68cqw 0 #930914)
    drop-shadow(0 .43cqw 0 #430209);
}
.shot-award {
  display: grid;
  width: 22cqw;
  min-height: 8.75cqw;
  place-items: center;
  border: .22cqw solid #bb9dff;
  border-radius: 6cqw;
  background: linear-gradient(#9477ff, #602bea 44%, #3910b6 100%);
  box-shadow: inset 0 0 .9cqw #c5abff, 0 .55cqw 1.5cqw #16064688;
  font-size: 6.1cqw;
  font-weight: 700;
  line-height: 1;
}
.miss .shot-award,
.saved .shot-award {
  width: 14.3cqw;
  border-color: #ff777a;
  background: linear-gradient(#ff5968, #e51f42 46%, #ad0021);
  box-shadow: inset 0 0 .9cqw #ff8a9c, 0 .55cqw 1.5cqw #46060e88;
}
.outcome-enter-active {
  transition: opacity .18s ease, transform .18s ease;
}
.outcome-enter-from {
  opacity: 0;
  transform: translateY(.8cqw) scale(.9);
}
@media (prefers-reduced-motion: reduce) {
  .game-home,
  .ball-control,
  .outcome-enter-active {
    transition: none;
  }
  .swipe-arrows i { animation: none; }
}
</style>

