<script setup lang="ts">
import { locale, setLocale, t, formatNumber } from '../i18n'
import languageEn from '../assets/art/language-en.png'
import languageRu from '../assets/art/language-ru.png'

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
  score?: number
  goals?: number
  shots?: number
  rank?: number | null
  saveMessage?: string
  leaderboard?: Entry[]
  leaderboardStatus?: string
  allowAlternative?: boolean
  currentResultId?: string | null
  timedOut?: boolean
  timeoutSeconds?: number | null
}>(), {
  score: 0,
  goals: 0,
  shots: 0,
  rank: null,
  saveMessage: '',
  leaderboard: () => [],
  leaderboardStatus: 'empty',
  allowAlternative: false,
  currentResultId: null,
  timedOut: false,
  timeoutSeconds: null,
})

const emit = defineEmits<{
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
const nickname = ref('')
const email = ref('')
const alternate = ref(false)
const fieldTouched = ref(false)
const resumeButton = ref<HTMLButtonElement | null>(null)
const playerRecords = computed(() => {
  const top = props.leaderboard.slice(0, 10)
  const current = props.leaderboard.slice(10).find(entry => isCurrent(entry))
  return current ? [...top, current] : top
})

const uidIsValid = computed(() => /^\d{1,20}$/.test(uid.value.trim()))
const emailIsValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))
const ready = computed(() => alternate.value ? !!nickname.value.trim() && emailIsValid.value : uidIsValid.value)
const error = computed(() => {
  if (!fieldTouched.value) return ''
  if (alternate.value) {
    return email.value.trim() && !emailIsValid.value ? 'Enter a valid email address.' : ''
  }
  return uid.value && !uidIsValid.value ? 'Use up to 20 digits for your CoinW UID.' : ''
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
  nickname.value = ''
  email.value = ''
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

function toggleRegistration() {
  alternate.value = !alternate.value
  fieldTouched.value = false
}

function pressKey(key: string) {
  if (key === 'clear') uid.value = ''
  else if (key === 'backspace') uid.value = uid.value.slice(0, -1)
  else if (uid.value.length < 20) uid.value += key
  fieldTouched.value = true
}

function keyLabel(key: string) {
  if (key === 'clear') return 'Clear UID'
  if (key === 'backspace') return 'Delete last digit'
  return key
}

function submit() {
  fieldTouched.value = true
  if (!ready.value) return
  if (alternate.value) {
    emit('register', { uid: nickname.value.trim(), nickname: nickname.value.trim(), email: email.value.trim() })
    return
  }
  emit('register', { uid: uid.value.trim() })
}
</script>

<template>
  <main class="kiosk" :lang="locale" @contextmenu.prevent>
    <div class="language-switch" :class="{ 'language-switch--game': currentScreen === 'game' }" role="group" :aria-label="t('Game language')" :inert="timedOut">
      <button type="button" :aria-label="locale === 'en' ? 'Переключить на русский' : 'Switch to English'"
        @click="setLocale(locale === 'en' ? 'ru' : 'en')">
        <img :src="locale === 'en' ? languageEn : languageRu" alt="" draggable="false">
      </button>
    </div>
    <Transition name="screen" @before-leave="disableLeavingScreen">
    <div :key="currentScreen" class="kiosk-content" :class="'screen-' + currentScreen" :inert="timedOut">
      <div v-if="currentScreen !== 'game'" class="coinw-logo" role="img" aria-label="CoinW"></div>

      <template v-if="currentScreen === 'idle'">
        <div class="idle-art" aria-hidden="true"></div>
        <div class="idle-shimmer" aria-hidden="true"></div>
        <h1 class="challenge-title"><span>{{ t('Football') }}</span><span>{{ t('Challenge') }}</span></h1>
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

      <form v-else-if="currentScreen === 'registration'" class="registration" novalidate @submit.prevent="submit">
        <div class="registration-art" aria-hidden="true"></div>
        <div class="registration-panel" :class="{ 'registration-panel--alternate': alternate }">
          <template v-if="alternate">
            <input v-model="nickname" class="kiosk-field" :aria-label="t('Nickname')" :placeholder="t('Enter your nickname')" maxlength="40" autocomplete="off" required @input="fieldTouched = true">
            <input v-model="email" class="kiosk-field" :aria-label="t('Email')" type="email" :placeholder="t('Enter your email')" maxlength="254" autocomplete="off" required
              :aria-invalid="!!error" :aria-describedby="error ? 'registration-error' : undefined" @input="fieldTouched = true">
          </template>
          <label v-else class="uid-field">
            <input id="uid" v-model="uid" class="kiosk-field" aria-label="CoinW UID" inputmode="none" autocomplete="off"
              :placeholder="t('Enter your CoinW UID')" maxlength="20" required :aria-invalid="!!error"
              :aria-describedby="error ? 'registration-error' : 'uid-hint'" @input="fieldTouched = true">
            <span class="keyboard-icon" aria-hidden="true"><i></i></span>
          </label>
          <p v-if="error" id="registration-error" class="registration-error" role="alert">{{ t(error) }}</p>
          <p v-else-if="!alternate" id="uid-hint" class="registration-hint">{{ t('Use the keypad to enter your CoinW UID.') }}</p>
          <div v-if="!alternate" class="uid-keypad" role="group" :aria-label="t('UID keypad')">
            <button v-for="key in keypad" :key="key" type="button" class="uid-key" :aria-label="t(keyLabel(key))"
              :class="{ 'uid-key--command': key === 'clear' || key === 'backspace' }" @click="pressKey(key)">
              {{ key === 'clear' ? t('CLEAR') : key === 'backspace' ? '⌫' : key }}
            </button>
          </div>
          <button v-if="allowAlternative" type="button" class="registration-alternative" @click="toggleRegistration">
            {{ t(alternate ? 'Use CoinW UID instead' : 'Use nickname and email instead') }}
          </button>
        </div>
        <div class="kiosk-actions">
          <button type="button" class="kiosk-button kiosk-button--cut-right kiosk-button--secondary kiosk-button--short" @click="emit('back')">
            <span>{{ t('BACK') }}</span>
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
          <p v-if="saveMessage" class="result-notice" role="status">{{ t(saveMessage) }}</p>
        </section>
        <div class="kiosk-actions">
          <button type="button" class="kiosk-button kiosk-button--cut-right kiosk-button--secondary kiosk-button--short" @click="emit('finish')">
            <span>{{ t('FINISH') }}</span>
          </button>
          <button type="button" class="kiosk-button kiosk-button--cut-left" @click="emit('leaderboard')">
            <span>{{ t('VIEW LEADERBOARD') }}</span>
          </button>
        </div>
      </template>

      <template v-else-if="currentScreen === 'leaderboard'">
        <div class="leaderboard-art" aria-hidden="true"><span class="ambient-arena"></span></div>
        <section class="leaderboard-panel" :class="{ 'leaderboard-panel--message': leaderboardStatus !== 'success' || !playerRecords.length }" :aria-label="t('Leaderboard')">
          <h1>{{ t('TODAY’S LEADERBOARD') }}</h1>
          <p class="leaderboard-caption">{{ t('Luka Modrić Football Challenge') }}</p>
          <div v-if="leaderboardStatus === 'success' && playerRecords.length" class="leaderboard-scroll">
            <table class="leaderboard-table">
              <thead><tr><th scope="col">#</th><th scope="col">{{ t('PLAYER') }}</th><th scope="col">{{ t('GOALS') }}</th><th scope="col">{{ t('POINTS') }}</th></tr></thead>
              <tbody>
                <tr v-for="(entry, index) in playerRecords" :key="entry.id ?? index" :class="{ 'leaderboard-current': isCurrent(entry) }">
                  <th scope="row">
                    <template v-if="rankMedals[entry.rank ?? index + 1]">
                      <img class="rank-medal" :src="rankMedals[entry.rank ?? index + 1]" alt="">
                      <span class="sr-only">{{ entry.rank ?? index + 1 }}</span>
                    </template>
                    <template v-else>{{ entry.rank ?? index + 1 }}</template>
                  </th>
                  <td :title="entry.playerId">{{ entry.playerId }}<span v-if="isCurrent(entry)" class="current-tag">{{ t('YOU') }}</span></td>
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
        </section>
        <div class="kiosk-actions">
          <button type="button" class="kiosk-button kiosk-button--cut-left" @click="emit('newGame')">
            <span>{{ t('NEW GAME') }}</span>
          </button>
        </div>
      </template>

      <slot v-else-if="currentScreen === 'game'" />
    </div>
    </Transition>

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
