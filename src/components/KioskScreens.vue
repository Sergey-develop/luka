<script setup lang="ts">
import IdleArtwork from './IdleArtwork.vue'
import TextKeyboard from './TextKeyboard.vue'
import { locale, setLocale, t, formatNumber } from '../i18n'
import languageEn from '../assets/art/language-en.png'
import languageRu from '../assets/art/language-ru.png'
import footballTitle from '../assets/art/football.svg'
import challengeTitle from '../assets/art/challenge.svg'

import { computed, nextTick, ref, watch } from 'vue'
import { gameConfig } from '../config/game'
import rankGold from '../assets/art/rank-gold.png'
import rankSilver from '../assets/art/rank-silver.png'
import rankBronze from '../assets/art/rank-bronze.png'
import type { Zone } from '../types/game'
import '../styles/kiosk.scss'

interface Entry {
  id?: string
  playerId: string
  score: number
  goals: number
  rank?: number
}

const props = withDefaults(defineProps<{
  screen: string
  loading?: boolean
  loadingProgress?: number
  loadFailed?: boolean
  score?: number
  goals?: number
  shots?: number
  rank?: number | null
  saveMessage?: string
  leaderboard?: Entry[]
  leaderboardCount?: number
  leaderboardStatus?: string
  allowAlternative?: boolean
  currentResultId?: string | null
  timedOut?: boolean
  timeoutSeconds?: number | null
}>(), {
  loading: false,
  loadingProgress: 0,
  loadFailed: false,
  score: 0,
  goals: 0,
  shots: 0,
  rank: null,
  saveMessage: '',
  leaderboard: () => [],
  leaderboardCount: 0,
  leaderboardStatus: 'empty',
  allowAlternative: false,
  currentResultId: null,
  timedOut: false,
  timeoutSeconds: null,
})

const emit = defineEmits<{
  retry: []
  start: []
  back: []
  register: [value: { uid: string; nickname?: string; email?: string }]
  continue: []
  finish: []
  leaderboard: []
  newGame: []
  resume: []
}>()

const uid = ref('')
const keypadOpen = ref(false)
const policyOpen = ref(false)
const nickname = ref('')
const nicknameInput = ref<HTMLInputElement | null>(null)
const alternate = ref(false)
const fieldTouched = ref(false)
const resumeButton = ref<HTMLButtonElement | null>(null)
const playerRecords = computed(() => props.leaderboard.slice(0, 10))
const currentEntry = computed(() => props.leaderboard.find(isCurrent))

const uidIsValid = computed(() => /^\d{8}$/.test(uid.value.trim()))
const emailIsValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nickname.value.trim()))
const ready = computed(() => alternate.value ? !!nickname.value.trim() && (nickname.value.includes('@') ? emailIsValid.value : nickname.value.trim().length <= 40) : uidIsValid.value)
const error = computed(() => {
  if (!fieldTouched.value) return ''
  if (alternate.value) {
    return nickname.value.includes('@') && !emailIsValid.value ? 'Enter a valid email address.' : ''
  }
  return uid.value && !uidIsValid.value ? 'Enter exactly 8 digits for your CoinW UID.' : ''
})
const currentScreen = computed(() =>
  ['countdown', 'aiming', 'shooting', 'resolving', 'shot-result'].includes(props.screen) ? 'game' : props.screen,
)
const didSaveLocally = computed(() => props.saveMessage.startsWith('Result saved on this kiosk'))
const steps = [
  { label: 'ENTER YOUR UID', icon: 'uid' },
  { label: 'TAKE A SHOT', icon: 'shot' },
  { label: 'SCORE POINTS', icon: 'trophy' },
]
const goalZones: Zone[] = ['top-left', 'top-right', 'bottom-left', 'center', 'bottom-right']
const points = (zone: Zone) => gameConfig.pointsByZone[zone]
const rankMedals: Record<number, string> = { 1: rankGold, 2: rankSilver, 3: rankBronze }
const keypad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'backspace']
let priorFocus: HTMLElement | null = null

watch(() => props.screen, () => {
  uid.value = ''
  keypadOpen.value = false
  policyOpen.value = false
  nickname.value = ''
  alternate.value = false
  fieldTouched.value = false
})

watch(() => props.timedOut, async (timedOut) => {
  if (timedOut) {
    priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    resumeButton.value?.focus()
    return
  }

  await nextTick()
  if (priorFocus?.isConnected) priorFocus.focus()
  priorFocus = null
})

function disableLeavingScreen(element: Element) {
  if (element instanceof HTMLElement) {
    element.inert = true
    element.setAttribute('aria-hidden', 'true')
  }
}

function isCurrent(entry: Entry) {
  return !!props.currentResultId && entry.id === props.currentResultId
}

function closeKeypadOutside(event: PointerEvent) {
  const target = event.target
  if (keypadOpen.value && target instanceof Element && !target.closest('.registration-field, .uid-keypad, .text-keyboard, .keypad-close')) keypadOpen.value = false
}

function toggleRegistration() {
  alternate.value = !alternate.value
  keypadOpen.value = false
  fieldTouched.value = false
}

function setTextKeyboardOpen(open: boolean) {
  nicknameInput.value?.focus({ preventScroll: true })
  keypadOpen.value = open
}

function editNickname(text: string) {
  const input = nicknameInput.value
  if (!input) return
  let start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  if (!text && start === end) {
    const previousChar = Array.from(input.value.slice(0, start)).at(-1)
    start -= previousChar?.length ?? 0
  }
  if (input.value.length - (end - start) + text.length > input.maxLength) return
  input.setRangeText(text, start, end, 'end')
  nickname.value = input.value
  fieldTouched.value = true
}

function pressKey(key: string) {
  if (key === 'clear') uid.value = ''
  else if (key === 'backspace') uid.value = uid.value.slice(0, -1)
  else if (uid.value.length < 8) uid.value += key
  fieldTouched.value = true
}

function keyLabel(key: string) {
  if (key === 'clear') return 'Clear UID'
  if (key === 'backspace') return 'Delete last digit'
  return key
}

async function submit() {
  fieldTouched.value = true
  if (!ready.value) return
  if (alternate.value) {
    const value = nickname.value.trim()
    const publicName = emailIsValid.value ? (value[0] + '***@' + value.split('@')[1]).slice(0, 40) : value
    let identity = publicName
    if (emailIsValid.value) {
      const normalized = value.toLowerCase()
      if (globalThis.crypto?.subtle) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
        identity = 'email:' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
      } else {
        let hash = 2166136261
        for (const char of normalized) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
        identity = 'email:local-' + (hash >>> 0).toString(16)
      }
    }
    emit('register', { uid: identity, nickname: publicName })
    return
  }
  emit('register', { uid: uid.value.trim() })
}
</script>

<template>
  <main class="kiosk" :lang="locale" @contextmenu.prevent @pointerdown.capture="closeKeypadOutside">
    <div v-if="currentScreen === 'idle'" class="language-switch" role="group" :aria-label="t('Game language')" :inert="timedOut || loading" :aria-hidden="timedOut || loading">
      <button type="button" :aria-label="locale === 'en' ? 'Переключить на русский' : 'Switch to English'"
        @click="setLocale(locale === 'en' ? 'ru' : 'en')">
        <img :src="locale === 'en' ? languageRu : languageEn" alt="" draggable="false">
      </button>
    </div>
    <Transition name="screen" @before-leave="disableLeavingScreen">
    <div :key="currentScreen" class="kiosk-content" :class="'screen-' + currentScreen" :inert="timedOut || loading" :aria-hidden="timedOut || loading">
      <div v-if="currentScreen !== 'game'" class="coinw-logo" role="img" aria-label="CoinW"></div>

      <template v-if="currentScreen === 'idle'">
        <IdleArtwork />
        <h1 class="challenge-title"><template v-if="locale === 'en'"><span class="challenge-title__vectors" aria-label="Football Challenge"><img :src="footballTitle" alt=""><img :src="challengeTitle" alt=""></span></template><template v-else><span>{{ t('Football') }}</span><span>{{ t('Challenge') }}</span></template></h1>
        <div class="kiosk-actions kiosk-actions--idle">
          <button type="button" class="kiosk-button kiosk-button--cut-right kiosk-button--secondary" @click="emit('leaderboard')">
            <span>{{ t('LEADERBOARD') }}</span>
          </button>
          <button type="button" class="kiosk-button kiosk-button--cut-left" @click="emit('start')">
            <span>{{ t('START GAME') }}</span>
          </button>
        </div>
      </template>

      <template v-else-if="currentScreen === 'instructions'">
        <div class="rules-art" aria-hidden="true"></div>
        <h1 class="sr-only">{{ t('5 SHOTS. SCORE BIG.') }}</h1>
        <section class="rules-panel" :aria-label="t('How to play')" aria-describedby="rules-swipe rules-scoring">
          <ol class="rules-steps">
            <li v-for="(step, index) in steps" :key="step.icon" class="rules-step">
              <span class="white-pill rules-step-index">{{ t('Step') }} {{ index + 1 }}</span>
              <span class="rule-icon" :class="'rule-icon--' + step.icon" aria-hidden="true"></span>
              <span class="rules-step-label">{{ t(step.label) }}</span>
            </li>
          </ol>
          <section class="rules-zones">
            <h2 class="white-pill">{{ t('Goal zones & points') }}</h2>
            <div class="rules-goal" :aria-label="t('Five goal zones')">
              <span v-for="zone in goalZones" :key="zone" class="rules-goal-value" :class="'rules-goal-value--' + zone">
                <span class="sr-only">{{ t(zone) }}: </span>{{ points(zone) }}
              </span>
            </div>
            <p id="rules-swipe" class="sr-only">{{ t('Swipe from the ball toward the goal.') }}</p>
            <div class="rules-legend">
              <span>{{ t('CENTER') }} <strong>+{{ points('center') }}</strong></span>
              <span>{{ t('SIDE ZONES') }} <strong>+{{ points('bottom-left') }}</strong></span>
              <span>{{ t('TOP CORNERS') }} <strong>+{{ points('top-left') }}</strong></span>
            </div>
          </section>
          <div class="rules-outcomes">
            <div class="rules-outcome">
              <span class="rule-ball" aria-hidden="true"></span>
              <span class="rules-shot-count"><span>×</span><b>{{ gameConfig.maxShots }}</b></span>
              <span class="rules-arrow" aria-hidden="true"></span>
              <div class="rules-outcome-score"><b>{{ gameConfig.maxScore.toLocaleString('en-US').replaceAll(',', '\u00a0') }}</b><strong>{{ t('POINTS MAX') }}</strong><small>{{ t('FOR {count} GOALS', { count: gameConfig.maxShots }) }}</small></div>
            </div>
            <div class="rules-outcome">
              <span class="rules-save-icons" aria-hidden="true"></span>
              <span class="rules-arrow" aria-hidden="true"></span>
              <div class="rules-outcome-score"><b>0</b><strong>{{ t('POINTS') }}</strong><small>{{ t('SAVE OR MISS') }}</small></div>
            </div>
          </div>
          <p id="rules-scoring" class="sr-only">{{ t('Score when the ball crosses the goal line inside the posts and beats the goalkeeper.') }}</p>
        </section>
        <div class="kiosk-actions">
          <button type="button" class="kiosk-button kiosk-button--home" :aria-label="t('Back to home')" @click="emit('back')">
            <span class="house-icon" aria-hidden="true"></span>
          </button>
          <button type="button" class="kiosk-button kiosk-button--cut-left" @click="emit('continue')">
            <span>{{ t('CONTINUE') }}</span>
          </button>
        </div>
      </template>

      <form v-else-if="currentScreen === 'registration'" class="registration" novalidate @submit.prevent="submit"
        @keydown.esc="alternate && keypadOpen && setTextKeyboardOpen(false)">
        <div class="registration-art" aria-hidden="true"></div>
        <div class="registration-panel" :class="{ 'registration-panel--alternate': alternate, 'registration-panel--typing': alternate && keypadOpen }">
          <div v-if="alternate" class="registration-field">
            <input ref="nicknameInput" v-model="nickname" class="kiosk-field" :aria-label="t('Nickname or email')"
              :placeholder="t('Enter your nickname or email')" maxlength="254" inputmode="none" autocomplete="off"
              autocapitalize="none" :spellcheck="false" required :aria-invalid="!!error"
              :aria-describedby="error ? 'registration-error' : undefined" @input="fieldTouched = true"
              @focus="keypadOpen = true" @click="keypadOpen = true">
            <button type="button" class="keyboard-icon" :aria-label="t(keypadOpen ? 'Close keypad' : 'Open keyboard')"
              :aria-expanded="keypadOpen" @pointerdown.prevent @click="setTextKeyboardOpen(!keypadOpen)"></button>
          </div>
          <label v-else class="registration-field">
            <input id="uid" v-model="uid" class="kiosk-field" aria-label="CoinW UID" inputmode="none" autocomplete="off"
              :placeholder="t('Enter your CoinW UID')" maxlength="8" required :aria-invalid="!!error"
              :aria-describedby="error ? 'registration-error' : undefined" @input="fieldTouched = true" @focus="keypadOpen = true" @click="keypadOpen = true">
            <span class="keyboard-icon" aria-hidden="true"></span>
          </label>
          <p v-if="error" id="registration-error" class="registration-error" role="alert">{{ t(error) }}</p>

          <TextKeyboard v-if="alternate && keypadOpen && !timedOut" @insert="editNickname" @backspace="editNickname('')" @close="setTextKeyboardOpen(false)" />
          <button v-if="!alternate && keypadOpen" type="button" class="keypad-close" @click="keypadOpen = false">{{ t('Close keypad') }}</button>
          <div v-if="!alternate && keypadOpen" class="uid-keypad" role="group" :aria-label="t('UID keypad')">
            <button v-for="key in keypad" :key="key" type="button" class="uid-key" :aria-label="t(keyLabel(key))"
              :class="{ 'uid-key--command': key === 'clear' || key === 'backspace' }" @click="pressKey(key)">
              {{ key === 'clear' ? t('CLEAR') : key === 'backspace' ? '⌫' : key }}
            </button>
          </div>
          <div v-if="allowAlternative && !keypadOpen && !alternate" class="registration-or"><span>{{ t('or') }}</span></div>
          <button v-if="allowAlternative && !keypadOpen" type="button" class="registration-alternative" @click="toggleRegistration">
            {{ t(alternate ? 'Use CoinW UID instead' : 'Use nickname or email instead') }}
          </button>
          <p v-if="!keypadOpen" class="registration-consent">{{ t('By continuing, you agree to') }} <button type="button" class="policy-link" @click="policyOpen = true">{{ t('the terms of personal data') }}</button> {{ t('processing in accordance with the rules provided by the organizer.') }}</p>
        </div>
        <div v-if="policyOpen" class="policy-overlay" role="dialog" aria-modal="true" :aria-label="t('Personal data policy')">
          <div class="policy-card"><h2>{{ t('Personal data policy') }}</h2><p>{{ t('Policy text will be provided by the organizer.') }}</p><button type="button" class="kiosk-button kiosk-button--cut-left" @click="policyOpen = false"><span>{{ t('BACK') }}</span></button></div>
        </div>
        <div class="kiosk-actions">
          <button type="button" class="kiosk-button kiosk-button--home" :aria-label="t('Back to home')" @click="emit('finish')">
            <span class="house-icon" aria-hidden="true"></span>
          </button>
          <button type="submit" class="kiosk-button kiosk-button--cut-left" :disabled="!ready">
            <span>{{ t('START GAME') }}</span>
          </button>
        </div>
      </form>

      <template v-else-if="currentScreen === 'finished'">
        <div class="results-art" aria-hidden="true"><span class="ambient-arena"></span></div>
        <section class="result-hero">
          <h1 class="white-pill">{{ t('Your result') }}</h1>
        </section>
        <section class="result-summary" :aria-label="t('Score and goals')">
          <div class="result-score"><strong>{{ formatNumber(score) }}</strong><span>{{ t('POINTS') }}</span></div>
          <div class="result-stats">
            <div class="result-stat result-stat--goals">
              <span class="result-stat-rim" aria-hidden="true"></span>
              <small>{{ t('GOALS') }}: {{ goals }}/{{ gameConfig.maxShots }}</small>
              <div class="result-dots" aria-hidden="true">
                <i v-for="n in gameConfig.maxShots" :key="n" :class="{ scored: n <= goals }"></i>
              </div>
            </div>
            <div class="result-stat result-stat--shots">
              <span class="result-stat-rim" aria-hidden="true"></span>
              <span class="rule-icon rule-icon--trophy" aria-hidden="true"></span>
              <div class="result-rank">
                <small>{{ t("TODAY'S RANK") }}</small>
                <strong v-if="rank !== null">#{{ rank }}</strong>
                <strong v-else :aria-label="t('Unavailable')">—</strong>
                <span>{{ shots }} / {{ gameConfig.maxShots }} {{ t('SHOTS') }}</span>
              </div>
            </div>
          </div>

        </section>
        <div class="kiosk-actions">
          <button type="button" class="kiosk-button kiosk-button--home" :aria-label="t('Back to home')" @click="emit('finish')">
            <span class="house-icon" aria-hidden="true"></span>
          </button>
          <button type="button" class="kiosk-button kiosk-button--cut-left" @click="emit('leaderboard')">
            <span>{{ t('VIEW LEADERBOARD') }}</span>
          </button>
        </div>
      </template>

      <template v-else-if="currentScreen === 'leaderboard'">
        <div class="leaderboard-art" aria-hidden="true"><span class="ambient-arena"></span></div>
        <section class="leaderboard-panel" :class="{ 'leaderboard-panel--message': leaderboardStatus !== 'success' || !playerRecords.length }" :aria-label="t('Leaderboard')">
          <div class="leaderboard-header"><div class="leaderboard-header-card"><svg class="leaderboard-card-outline" viewBox="0 0 400 148" preserveAspectRatio="none" aria-hidden="true"><path class="leaderboard-card-shape" d="M32 2 H319 Q335 2 346 14 L389 59 Q398 68 398 80 V115 Q398 127 389 136 L383 142 Q378 146 366 146 H32 Q2 146 2 116 V32 Q2 20 11 12 L17 7 Q23 2 32 2 Z"/><path class="leaderboard-card-highlight" d="M235 2 H319 Q335 2 346 14 L389 59"/></svg><h1>TOP 10</h1></div><div class="leaderboard-header-card"><svg class="leaderboard-card-outline" viewBox="0 0 400 148" preserveAspectRatio="none" aria-hidden="true"><path class="leaderboard-card-shape" d="M32 2 H319 Q335 2 346 14 L389 59 Q398 68 398 80 V115 Q398 127 389 136 L383 142 Q378 146 366 146 H32 Q2 146 2 116 V32 Q2 20 11 12 L17 7 Q23 2 32 2 Z"/><path class="leaderboard-card-highlight" d="M235 2 H319 Q335 2 346 14 L389 59"/></svg><span>{{ t('PLAYERS TODAY') }}</span><strong>{{ formatNumber(leaderboardCount) }}</strong></div></div>
          <div v-if="leaderboardStatus === 'success' && playerRecords.length" class="leaderboard-scroll">
            <table class="leaderboard-table">
              <thead><tr><th scope="col">{{ t('RANK') }}</th><th scope="col">{{ t('PLAYER') }}</th><th scope="col">{{ t('GOALS') }}</th><th scope="col">{{ t('POINTS') }}</th></tr></thead>
              <tbody>
                <tr v-for="(entry, index) in playerRecords" :key="entry.id ?? index" :class="{ 'leaderboard-current': isCurrent(entry) }">
                  <th scope="row">
                    <template v-if="rankMedals[entry.rank ?? index + 1]">
                      <img class="rank-medal" :src="rankMedals[entry.rank ?? index + 1]" alt="">
                      <span class="sr-only">{{ entry.rank ?? index + 1 }}</span>
                    </template>
                    <span v-else class="rank-number">{{ entry.rank ?? index + 1 }}</span>
                  </th>
                  <td :title="entry.playerId">{{ entry.playerId }}</td>
                  <td>{{ entry.goals }}</td>
                  <td><strong>{{ formatNumber(entry.score) }}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          <template v-else>
            <div class="rank-ghost" aria-hidden="true"></div>
            <div class="leaderboard-status" role="status">
              <span class="status-badge" aria-hidden="true">{{ leaderboardStatus === 'loading' ? '…' : '!' }}</span>
              <p v-if="leaderboardStatus === 'loading'">{{ t('Loading leaderboard…') }}</p>
              <template v-else-if="leaderboardStatus === 'unavailable'">
                <p v-if="didSaveLocally">{{ t('Result saved on this kiosk') }}</p>
                <p v-else>{{ t('Leaderboard unavailable') }}</p>
                <span v-if="didSaveLocally">{{ t('Leaderboard position temporarily unavailable') }}</span>
              </template>
              <p v-else-if="leaderboardStatus === 'error'">{{ t('Could not load leaderboard') }}</p>
              <p v-else>{{ t('No results yet') }}</p>
            </div>
          </template>
          <div v-if="currentEntry" class="leaderboard-result">
            <span class="white-pill">{{ t('Your result') }}</span>
            <div class="leaderboard-result-row"><span class="rank-number">{{ currentEntry.rank }}</span><span>{{ currentEntry.playerId }}</span><span>{{ currentEntry.goals }}</span><strong>{{ formatNumber(currentEntry.score) }}</strong></div>
          </div>
        </section>
        <div class="kiosk-actions">
          <button type="button" class="kiosk-button kiosk-button--cut-left" @click="emit('newGame')">
            <span>{{ t('HOME') }}</span>
          </button>
        </div>
      </template>


    </div>
    </Transition>

    <Transition name="screen">
      <div v-show="currentScreen === 'game'" class="kiosk-content screen-game"
        :inert="currentScreen !== 'game' || timedOut || loading" :aria-hidden="currentScreen !== 'game' || timedOut || loading">
        <slot />
      </div>
    </Transition>

    <div v-if="loading" class="startup-loader" :aria-busy="!loadFailed" role="status">
      <div class="startup-logo" role="img" aria-label="CoinW"></div>
      <div class="startup-content">
        <h1>{{ t(loadFailed ? 'COULD NOT LOAD THE GAME' : 'PREPARING YOUR GAME') }}</h1>
        <p>{{ t(loadFailed ? 'Check your connection and try again.' : 'Loading everything for a smooth game.') }}</p>
        <div v-if="!loadFailed" class="startup-progress" role="progressbar" :aria-label="t('Game loading')" :aria-valuenow="loadingProgress" aria-valuemin="0" aria-valuemax="100">
          <i :style="{ transform: `scaleX(${loadingProgress / 100})` }"></i>
        </div>
        <strong v-if="!loadFailed">{{ loadingProgress }}%</strong>
        <button v-else type="button" class="kiosk-button kiosk-button--cut-left" @click="emit('retry')"><span>{{ t('TRY AGAIN') }}</span></button>
      </div>
    </div>

    <div v-if="timedOut" class="timeout-overlay">
      <section class="timeout-panel" role="alertdialog" aria-modal="true" aria-labelledby="timeout-title" aria-describedby="timeout-description">
        <h2 id="timeout-title">{{ t('STILL PLAYING?') }}</h2>
        <p id="timeout-description">
          {{ timeoutSeconds === null ? t('Returning to the start shortly.') : t('Returning to the start in {seconds} seconds.', { seconds: timeoutSeconds }) }}
        </p>
        <button ref="resumeButton" type="button" class="kiosk-button kiosk-button--cut-left" @click="emit('resume')">
          <span>{{ t('CONTINUE') }}</span>
        </button>
      </section>
    </div>
  </main>
</template>
