import stadiumUrl from '../assets/audio/stadium.mp3'
import applauseUrl from '../assets/audio/goal-crowd-balanced.mp3'
import booUrl from '../assets/audio/miss-balanced.mp3'
import kickUrl from '../assets/audio/kick.mp3'
import clickUrl from '../assets/audio/click.mp3'
import musicUrl from '../assets/audio/menu-theme.mp3'
import type { Outcome } from '../types/game'

const soundUrls = { stadium: stadiumUrl, applause: applauseUrl, boo: booUrl, kick: kickUrl, click: clickUrl, music: musicUrl }
type SoundName = keyof typeof soundUrls

class GameAudio {
  private context?: AudioContext
  private master?: GainNode
  private ambience?: GainNode
  private crowd?: AudioBufferSourceNode
  private buffers: Partial<Record<SoundName, AudioBuffer>> = {}
  private voices = new Set<AudioScheduledSourceNode>()
  private uiVoices = new Set<AudioScheduledSourceNode>()
  private envelopes = new Map<AudioScheduledSourceNode, { gain: GainNode; endsAt: number; crowd: boolean }>()
  private fading = new WeakSet<AudioScheduledSourceNode>()
  private reaction?: AudioBufferSourceNode
  private menuActive = false
  private musicOffset = 0
  private musicStartedAt = 0
  private menuMusic?: AudioBufferSourceNode
  private menuGain?: GainNode
  private active = false
  private disposed = false
  private clickLoading?: Promise<void>
  private downloads: Partial<Record<SoundName, Promise<ArrayBuffer>>> = {}
  private preloading?: Promise<void>

  private download(name: SoundName): Promise<ArrayBuffer> {
    return this.downloads[name] ??= fetch(soundUrls[name]).then(response => {
      if (!response.ok) throw new Error('Audio unavailable')
      return response.arrayBuffer()
    }).catch(error => { delete this.downloads[name]; throw error })
  }

  preload(): Promise<void> {
    return this.preloading ??= (async () => {
      // Decode ahead of time without opening or playing a live audio session.
      const decoder = new OfflineAudioContext(2, 1, 44100)
      await Promise.all((Object.keys(soundUrls) as SoundName[]).map(async name => {
        const data = await this.download(name)
        const buffer = await decoder.decodeAudioData(data.slice(0))
        if (!this.disposed) this.buffers[name] = buffer
      }))
    })().catch(error => { this.preloading = undefined; throw error })
  }

  async unlock() {
    if (this.disposed) return
    try {
      if (!this.context) {
        // Request media playback on iOS / embedded WebKit when supported.
        try {
          const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
          if (session) session.type = 'playback'
        } catch { /* Older webviews may expose a read-only or unavailable session. */ }
        this.context = new AudioContext()
        this.context.addEventListener('statechange', () => {
          if (this.context?.state === 'running') { this.syncMenuMusic(); this.syncCrowd() }
        })
        this.master = this.context.createGain()
        this.master.gain.value = .65
        const limiter = this.context.createDynamicsCompressor()
        limiter.threshold.value = -12
        limiter.ratio.value = 6
        this.master.connect(limiter).connect(this.context.destination)
        // Reuse the startup decoder even if the first tap happens while loading.
        const prepared = this.preloading ?? Promise.resolve()
        this.clickLoading = prepared.then(() => this.loadClick(), () => this.loadClick())
        void prepared.catch(() => {}).then(() => this.loadSounds())
      }
      if (this.context.state !== 'running' && this.context.state !== 'closed') await this.context.resume()
      this.syncMenuMusic()
    } catch { /* Audio must never prevent playing the game. */ }
  }

  private preloadClick() {
    return this.download('click').catch(() => undefined)
  }

  private async loadClick() {
    if (this.buffers.click) return
    try {
      const data = await this.preloadClick()
      if (!data || this.disposed) return
      const buffer = await this.context!.decodeAudioData(data.slice(0))
      if (!this.disposed) this.buffers.click = buffer
    } catch { /* Optional sound must not block navigation. */ }
  }

  private async loadSounds() {
    const context = this.context!
    await Promise.allSettled((['stadium', 'applause', 'boo', 'kick', 'music'] as const).map(async name => {
      if (!this.buffers[name]) {
        const data = await this.download(name)
        const buffer = await context.decodeAudioData(data.slice(0))
        if (this.disposed) return
        this.buffers[name] = buffer
      }
      if (name === 'stadium') this.syncCrowd()
      if (name === 'music') this.syncMenuMusic()
    }))
  }

  setMenuMusic(active: boolean) {
    this.menuActive = active
    this.syncMenuMusic()
  }

  private syncMenuMusic() {
    if (!this.menuActive) {
      const music = this.menuMusic
      const gain = this.menuGain
      this.menuMusic = undefined
      this.menuGain = undefined
      if (music && gain && this.context) {
        const now = this.context.currentTime
        this.musicOffset = (this.musicOffset + now - this.musicStartedAt + .65) % music.buffer!.duration
        gain.gain.cancelAndHoldAtTime(now)
        gain.gain.linearRampToValueAtTime(0, now + .65)
        music.stop(now + .66)
      }
      return
    }
    if (this.menuMusic || !this.canPlay() || !this.buffers.music) return
    const context = this.context!
    const music = context.createBufferSource()
    const gain = context.createGain()
    music.buffer = this.buffers.music
    music.loop = true
    gain.gain.setValueAtTime(0, context.currentTime)
    gain.gain.linearRampToValueAtTime(.18, context.currentTime + 1)
    music.connect(gain).connect(this.master!)
    music.onended = () => { music.disconnect(); gain.disconnect() }
    this.menuMusic = music
    this.menuGain = gain
    this.musicStartedAt = context.currentTime
    music.start(0, this.musicOffset)
  }

  private syncCrowd() {
    if (!this.active) {
      const crowd = this.crowd
      const gain = this.ambience
      this.crowd = undefined
      this.ambience = undefined
      if (crowd && gain && this.context) {
        const now = this.context.currentTime
        gain.gain.cancelAndHoldAtTime(now)
        gain.gain.linearRampToValueAtTime(0, now + .15)
        crowd.stop(now + .16)
      }
      return
    }
    if (this.crowd || !this.context || !this.buffers.stadium) return
    const crowd = this.context.createBufferSource()
    const gain = this.context.createGain()
    const now = this.context.currentTime
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(.13, now + .4)
    crowd.buffer = this.buffers.stadium
    crowd.loop = true
    crowd.connect(gain).connect(this.master!)
    crowd.onended = () => { crowd.disconnect(); gain.disconnect() }
    this.crowd = crowd
    this.ambience = gain
    crowd.start()
  }

  setPlaying(active: boolean) {
    this.active = active
    this.syncCrowd()
    if (!active) this.stopEffects()
  }

  private canPlay() {
    return !this.disposed && this.context?.state === 'running'
  }

  private track(source: AudioScheduledSourceNode, gain: GainNode, endsAt: number, ui = false, crowd = false) {
    const voices = ui ? this.uiVoices : this.voices
    voices.add(source)
    this.envelopes.set(source, { gain, endsAt, crowd })
    source.onended = () => {
      voices.delete(source)
      source.disconnect()
      gain.disconnect()
      this.envelopes.delete(source)
      if (this.reaction === source) this.reaction = undefined
    }
  }

  private sample(name: 'click' | 'kick' | 'applause' | 'boo', volume: number, rate = 1) {
    const buffer = this.buffers[name]
    if (!this.canPlay() || !buffer) return
    const context = this.context!
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    const gain = context.createGain()
    const now = context.currentTime
    const isCrowd = name === 'applause' || name === 'boo'
    const attack = isCrowd ? .06 : .002
    const release = isCrowd ? 1.5 : .02
    const duration = Math.min(buffer.duration / rate, name === 'applause' ? 3 : name === 'boo' ? buffer.duration / rate : 1)
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(volume, now + attack)
    gain.gain.setValueAtTime(volume, now + Math.max(.01, duration - release))
    if (isCrowd) {
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration - .025)
      gain.gain.linearRampToValueAtTime(0, now + duration)
    } else gain.gain.linearRampToValueAtTime(0, now + duration)
    source.connect(gain).connect(this.master!)
    if (isCrowd) {
      if (this.reaction) this.stopVoice(this.reaction)
      this.reaction = source
    }
    this.track(source, gain, now + duration, name === 'click', isCrowd)
    source.start()
    source.stop(now + duration)
  }

  click() { this.sample('click', .2) }

  kick() {
    if (!this.active) return
    if (this.reaction) this.stopVoice(this.reaction)
    this.sample('kick', .85)
  }

  result(outcome: Outcome) {
    if (!this.active) return
    if (outcome === 'goal') this.sample('applause', .4)
    else if (outcome === 'miss') this.sample('boo', .4)
    else this.sample('kick', .3, .8)
  }

  private stopVoice(source: AudioScheduledSourceNode, immediate = false) {
    if (immediate) { try { source.stop() } catch { /* Already ended. */ }; return }
    const envelope = this.envelopes.get(source)
    if (!envelope || !this.context || this.fading.has(source)) return
    this.fading.add(source)
    const now = this.context.currentTime
    const end = Math.max(now, Math.min(envelope.endsAt, now + (envelope.crowd ? .95 : .35)))
    envelope.gain.gain.cancelAndHoldAtTime(now)
    envelope.gain.gain.linearRampToValueAtTime(0, end)
    try { source.stop(end) } catch { /* Already ended. */ }
  }

  stopEffects(includeUI = false, immediate = false) {
    if (includeUI) this.uiVoices.forEach(source => this.stopVoice(source, immediate))
    this.voices.forEach(source => this.stopVoice(source, immediate))
  }

  private onGesture = () => { void this.unlock() }
  private onClick = (event: MouseEvent) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button || button.disabled || button.matches('.ball-control')) return
    void this.unlock().then(() => this.clickLoading).then(() => this.click())
  }
  private onVisibility = () => {
    // Keep playing in background tabs; resume if the browser interrupted audio.
    if (!document.hidden && this.context) void this.unlock()
  }

  mount() {
    void this.unlock()
    void this.preloadClick()
    document.addEventListener('pointerdown', this.onGesture, true)
    document.addEventListener('touchend', this.onGesture, true)
    document.addEventListener('keydown', this.onGesture, true)
    document.addEventListener('click', this.onClick, true)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  dispose() {
    this.disposed = true
    document.removeEventListener('pointerdown', this.onGesture, true)
    document.removeEventListener('touchend', this.onGesture, true)
    document.removeEventListener('keydown', this.onGesture, true)
    document.removeEventListener('click', this.onClick, true)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.stopEffects(true, true)
    this.crowd?.stop()
    this.menuMusic?.stop()
    void this.context?.close().catch(() => {})
  }
}

export const gameAudio = new GameAudio()
