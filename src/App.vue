<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { gameAudio } from './audio/gameAudio'
import KioskScreens from './components/KioskScreens.vue'
import GameScene from './game/rendering/GameScene.vue'
import { GameEngine } from './game/engine'
import { gameConfig } from './config/game'
import { getDubaiDay, LocalResultsRepository, playerKey, publicPlayerName } from './repositories/results'
import type { GameResult, Player, Shot, Swipe } from './types/game'

const engine = reactive(new GameEngine())
const repository = new LocalResultsRepository()
const { timing } = gameConfig
const shot = ref<(Shot & { id: number }) | null>(null)
const countdownRemainingMs = ref(0)
const countdown = computed(() => engine.phase === 'countdown'
  ? Math.max(1, Math.ceil(countdownRemainingMs.value / 1000)) : null)
const secondsLeft = ref(Math.ceil(timing.gameTimeoutMs / 1000))
const timedOut = ref(false)
const timeoutSeconds = ref<number | null>(null)
const saveMessage = ref('')
const resultRank = ref<number>()
const currentResultId = ref<string | null>(null)
const leaderboardStatus = ref<'loading' | 'success' | 'empty' | 'error'>('empty')
const leaderboard = ref<{ id: string; playerId: string; score: number; goals: number; rank: number; date: string }[]>([])

let shotId = 0
let roundToken = 0
let requestId = 0
let lastActivity = Date.now()
let phaseStarted = lastActivity
let leaderboardDay = ''
let completedResult: GameResult | undefined
let timer: number | undefined
let countdownFrame: number | undefined

function resetActivity(now = Date.now()) {
  lastActivity = now
  timedOut.value = false
  timeoutSeconds.value = null
  secondsLeft.value = Math.ceil(timing.gameTimeoutMs / 1000)
}

watch(() => engine.phase, (phase) => {
  gameAudio.setPlaying(['countdown', 'aiming', 'shooting', 'resolving', 'shot-result'].includes(phase))
  phaseStarted = Date.now()
  resetActivity(phaseStarted)
  if (countdownFrame !== undefined) cancelAnimationFrame(countdownFrame)
  countdownFrame = undefined
  countdownRemainingMs.value = phase === 'countdown' ? timing.countdownMs : 0
  if (phase === 'countdown') countdownFrame = requestAnimationFrame(updateCountdown)
}, { flush: 'sync' })

function updateCountdown() {
  if (engine.phase !== 'countdown') return
  countdownRemainingMs.value = Math.max(0, timing.countdownMs - (Date.now() - phaseStarted))
  if (countdownRemainingMs.value === 0) engine.start()
  else countdownFrame = requestAnimationFrame(updateCountdown)
}

function noteActivity() {
  if (!timedOut.value) resetActivity()
}

function tick() {
  const now = Date.now()

  if (engine.phase === 'countdown') {
    const remaining = timing.countdownMs - (now - phaseStarted)
    if (remaining <= 0) engine.start()
    return
  }

  if (engine.phase === 'finished') {
    if (now - phaseStarted >= timing.resultReturnMs) home()
    return
  }

  if (engine.phase === 'leaderboard' && getDubaiDay(new Date(now)) !== leaderboardDay) {
    void refreshLeaderboard(new Date(now))
  }

  const aiming = engine.phase === 'aiming'
  const inMenu = engine.phase === 'instructions' || engine.phase === 'registration' || engine.phase === 'leaderboard'
  if (!aiming && !inMenu) return

  const elapsed = now - lastActivity
  const deadline = aiming ? timing.gameTimeoutMs : timing.menuTimeoutMs
  const warning = aiming ? timing.gameWarningMs : timing.menuWarningMs
  const remaining = Math.ceil((deadline - elapsed) / 1000)
  if (remaining <= 0) {
    home()
    return
  }
  if (aiming) secondsLeft.value = remaining
  if (elapsed >= warning) {
    timedOut.value = true
    timeoutSeconds.value = remaining
  }
}

onMounted(() => {
  gameAudio.mount()
  window.addEventListener('pointerdown', noteActivity)
  window.addEventListener('keydown', noteActivity)
  window.addEventListener('input', noteActivity)
  timer = window.setInterval(tick, 100)
  console.info('[CoinW kiosk] Ready')
})

onBeforeUnmount(() => {
  gameAudio.dispose()
  window.removeEventListener('pointerdown', noteActivity)
  window.removeEventListener('keydown', noteActivity)
  window.removeEventListener('input', noteActivity)
  window.clearInterval(timer)
  if (countdownFrame !== undefined) cancelAnimationFrame(countdownFrame)
})

function clearRound() {
  roundToken++
  requestId++
  shot.value = null
  completedResult = undefined
  saveMessage.value = ''
  resultRank.value = undefined
  currentResultId.value = null
  leaderboard.value = []
}

function home() {
  clearRound()
  engine.home()
  resetActivity()
}

function openInstructions() {
  clearRound()
  engine.openInstructions()
}

function fire(swipe: Swipe) {
  if (engine.phase !== 'aiming' || timedOut.value) return
  const prepared = engine.shoot(swipe)
  if (prepared) shot.value = { ...prepared, id: ++shotId }
}

async function complete() {
  if (engine.phase !== 'shooting') return
  engine.resolveShot()
  engine.next()
  shot.value = null
  if (engine.shots.length !== gameConfig.maxShots) return

  const token = roundToken
  let result: GameResult
  try {
    result = engine.result()
    await repository.saveResult(result)
  } catch {
    console.error('[CoinW kiosk] Result storage failed')
    if (token === roundToken) saveMessage.value = 'Could not save result on this kiosk'
    return
  }
  if (token !== roundToken) return
  completedResult = result
  saveMessage.value = 'Result saved on this kiosk'
  try {
    const rows = await repository.getLeaderboard()
    if (token !== roundToken) return
    const position = rows.findIndex(row => playerKey(row) === playerKey(result))
    if (position >= 0) resultRank.value = position + 1
  } catch {
    console.error('[CoinW kiosk] Result rank unavailable')
    if (token === roundToken) saveMessage.value = 'Result saved on this kiosk; leaderboard position temporarily unavailable'
  }
}

async function refreshLeaderboard(now = new Date()) {
  const id = ++requestId
  leaderboardDay = getDubaiDay(now)
  leaderboardStatus.value = 'loading'
  try {
    const dailyResults = await repository.getLeaderboard(now)
    if (id !== requestId) return
    const currentKey = completedResult && playerKey(completedResult)
    const currentIndex = currentKey ? dailyResults.findIndex(row => playerKey(row) === currentKey) : -1
    currentResultId.value = currentIndex >= 0 ? dailyResults[currentIndex].id : null

    const toRow = (row: GameResult, index: number) => ({
      id: row.id,
      playerId: publicPlayerName(row),
      score: row.score,
      goals: row.goals,
      rank: index + 1,
      date: row.date,
    })
    leaderboard.value = dailyResults.slice(0, 10).map(toRow)
    if (currentIndex >= 10) leaderboard.value.push(toRow(dailyResults[currentIndex], currentIndex))
    leaderboardStatus.value = leaderboard.value.length ? 'success' : 'empty'
  } catch {
    console.error('[CoinW kiosk] Daily leaderboard unavailable')
    if (id === requestId) {
      leaderboard.value = []
      currentResultId.value = null
      leaderboardStatus.value = 'error'
    }
  }
}

function showLeaderboard() {
  if (engine.phase !== 'idle' && engine.phase !== 'finished') return
  engine.leaderboard()
  void refreshLeaderboard()
}

function register(player: Player) {
  if (timedOut.value) return
  engine.register(player)
}
</script>

<template>
  <KioskScreens
    :screen="engine.phase"
    :score="engine.score"
    :goals="engine.goals"
    :shots="engine.shots.length"
    :save-message="saveMessage"
    :rank="resultRank"
    :leaderboard="leaderboard"
    :leaderboard-status="leaderboardStatus"
    :current-result-id="currentResultId"
    :allow-alternative="gameConfig.alternativeRegistration"
    :timed-out="timedOut"
    :timeout-seconds="timeoutSeconds"
    @start="openInstructions"
    @register="register"
    @continue="engine.openRegistration()"
    @back="engine.back()"
    @finish="home"
    @resume="resetActivity()"
    @new-game="openInstructions"
    @leaderboard="showLeaderboard"
  >
    <GameScene
      :shot="shot"
      :countdown="countdown"
      :countdown-progress="countdownRemainingMs / timing.countdownMs"
      :seconds-left="secondsLeft"
      :disabled="engine.phase !== 'aiming' || timedOut"
      :score="engine.score"
      :goals="engine.goals"
      :shots="engine.shots.length"
      @swipe="fire"
      @complete="complete"
      @home="home"
    />
  </KioskScreens>
</template>
