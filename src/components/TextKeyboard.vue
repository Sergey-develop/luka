<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { locale, t } from '../i18n'

const emit = defineEmits<{
  insert: [value: string]
  backspace: []
  close: []
}>()

const language = ref(locale.value)
const symbols = ref(false)
const shift = ref(false)
const letters = {
  en: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
  ru: ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбюё'],
}
const symbolRows = ['1234567890', '@._-+!#$%&', '()[]:/?,\'"*=']
const rows = computed(() => {
  if (symbols.value) return symbolRows
  return letters[language.value].map(row => shift.value ? row.toUpperCase() : row)
})

function insert(value: string) {
  voiceError.value = ''
  emit('insert', value)
  shift.value = false
}

function switchLanguage() {
  language.value = language.value === 'en' ? 'ru' : 'en'
  shift.value = false
  symbols.value = false
}

function toggleSymbols() {
  symbols.value = !symbols.value
  shift.value = false
}

interface Dictation {
  lang: string
  processLocally?: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

const recognition = shallowRef<Dictation | null>(null)
const voiceError = ref('')

function toggleVoice() {
  voiceError.value = ''
  if (recognition.value) {
    recognition.value.stop()
    return
  }
  const browser = window as Window & {
    SpeechRecognition?: new () => Dictation
    webkitSpeechRecognition?: new () => Dictation
  }
  const SpeechRecognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition
  if (!SpeechRecognition) {
    voiceError.value = 'Voice input is unavailable.'
    return
  }
  const session = new SpeechRecognition()
  if (!('processLocally' in session)) {
    voiceError.value = 'Voice input is unavailable.'
    return
  }
  session.processLocally = true
  session.lang = language.value === 'ru' ? 'ru-RU' : 'en-US'
  session.onresult = event => {
    const text = event.results[0]?.[0]?.transcript
    if (text) insert(text)
  }
  session.onerror = ({ error }) => {
    if (error === 'language-not-supported') voiceError.value = 'Voice input is unavailable.'
    else voiceError.value = error === 'not-allowed' || error === 'service-not-allowed'
      ? 'Microphone access was denied.' : 'Could not recognize speech. Try again.'
  }
  session.onend = () => { recognition.value = null }
  recognition.value = session
  try { session.start() }
  catch {
    recognition.value = null
    voiceError.value = 'Voice input is unavailable.'
  }
}

function cancelVoice() {
  const session = recognition.value
  if (!session) return
  session.onend = session.onerror = session.onresult = null
  session.abort()
  recognition.value = null
}

function cancelIfHidden() {
  if (document.hidden) cancelVoice()
}
onMounted(() => document.addEventListener('visibilitychange', cancelIfHidden))
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', cancelIfHidden)
  cancelVoice()
})
</script>

<template>
  <div class="text-keyboard" :class="{ 'text-keyboard--artwork': language === 'en' && locale === 'en' && !shift && !symbols }"
    role="group" :aria-label="t('Text keyboard')" @pointerdown.prevent>
    <div v-for="(row, index) in rows" :key="index" class="text-keyboard__row">
      <button v-if="index === 2 && !symbols" type="button" class="key key--command key--shift"
        :aria-label="t('Shift')" :aria-pressed="shift" @click="shift = !shift"><span class="key-icon key-icon--shift" aria-hidden="true"></span></button>
      <button v-for="key in row" :key="key" type="button" class="key" :lang="language" @click="insert(key)">{{ key }}</button>
      <button v-if="index === 2" type="button" class="key key--command key--backspace"
        :aria-label="t('Backspace')" @click="emit('backspace')"><span class="key-icon key-icon--backspace" aria-hidden="true"></span></button>
    </div>
    <div class="text-keyboard__row">
      <button type="button" class="key key--command" :aria-label="t(symbols ? 'Show letters' : 'Show numbers and symbols')"
        @click="toggleSymbols">{{ symbols ? (language === 'ru' ? 'АБВ' : 'ABC') : '123' }}</button>
      <button type="button" class="key key--command" :aria-label="t('Switch keyboard language')" @click="switchLanguage">
        <span class="key-icon key-icon--globe" aria-hidden="true"></span>
      </button>
      <button type="button" class="key key--command key--mic" :aria-label="t('Voice input')" :title="t('Voice input')"
        :aria-pressed="!!recognition" @click="toggleVoice"><span class="key-icon key-icon--mic" aria-hidden="true"></span></button>
      <button type="button" class="key key--space" :aria-label="t('Space')" @click="insert(' ')">{{ t('Space') }}</button>
      <button type="button" class="key key--command key--done" :aria-label="t('Done')" @click="emit('close')">{{ t('Return') }}</button>
    </div>
    <p v-if="voiceError" class="voice-status" role="status">{{ t(voiceError) }}</p>
  </div>
</template>

<style scoped>
.text-keyboard {
  position: relative;
  display: grid;
  flex: 1 1 0;
  min-height: 0;
  grid-template-rows: repeat(4, minmax(0, 1fr));
  justify-items: center;
  gap: 2cqw;
  padding: 4.8cqw 1cqw;
  border-radius: 5cqw;
  background: #e9dbff1a;
  box-shadow: inset 0 0 0 .1cqw #d9cbff38;
}

.text-keyboard__row {
  display: flex;
  justify-content: center;
  gap: 1cqw;
  width: min(100%, 63.15cqw);
}

.key {
  display: grid;
  place-items: center;
  min-width: 0;
  flex: 0 1 5.42cqw;
  padding: 0;
  border: 0;
  border-radius: .65cqw;
  background: #fff;
  color: #000;
  font: 400 3.8cqw/1 Arial, sans-serif;
  touch-action: manipulation;
}

.key--command {
  flex-basis: 7cqw;
  color: #fff;
  background: #724dff;
  font-size: 2.45cqw;
}

.key--shift { margin-right: auto; }
.key--backspace { margin-left: auto; }
.key--mic { flex-basis: 5.42cqw; }
.key--space { flex: 1; font-size: 2.55cqw; text-transform: lowercase; }
.key--done { flex-basis: 15cqw; text-transform: lowercase; }
.key[aria-pressed="true"] { background: #4a20cd; box-shadow: inset 0 0 0 .2cqw #fff; }
.key:active { background: #d5c8ff; color: #311483; }
.key:focus-visible { outline: .3cqw solid #20105a; outline-offset: .2cqw; }

.key-icon {
  width: 3.704cqw;
  aspect-ratio: 1;
  background: url('../assets/art/keyboard-commands.png') 0 0 / 400% 100% no-repeat;
}
.key-icon--backspace { background-position-x: 33.3333%; }
.key-icon--globe { background-position-x: 66.6667%; }
.key-icon--mic { background-position-x: 100%; }

.voice-status {
  position: absolute;
  inset: auto 1cqw 1cqw;
  margin: 0;
  color: white;
  font-size: 2.2cqw;
  text-align: center;
}
/* The supplied artwork includes the unshifted English labels. Each key remains a native button. */
.text-keyboard--artwork {
  background: url('../assets/art/keyboard-en.webp') center / 100% 100% no-repeat;
  border-radius: 0;
  box-shadow: none;
}
.text-keyboard--artwork .key {
  background: transparent;
  color: transparent;
}
.text-keyboard--artwork .key-icon { visibility: hidden; }
.text-keyboard--artwork .key:active,
.text-keyboard--artwork .key[aria-pressed="true"] { background: #4820c650; }

@media (forced-colors: active) {
  .text-keyboard--artwork { background: Canvas; }
  .text-keyboard--artwork .key { background: ButtonFace; color: ButtonText; }
  .text-keyboard--artwork .key-icon { visibility: visible; forced-color-adjust: none; }
}
</style>
