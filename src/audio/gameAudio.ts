import stadiumUrl from '../assets/audio/stadium.ogg'
import applauseUrl from '../assets/audio/goal-crowd-balanced.ogg'
import booUrl from '../assets/audio/miss-balanced.ogg'
import kickUrl from '../assets/audio/kick.ogg'
import clickUrl from '../assets/audio/click.ogg'
import type { Outcome } from '../types/game'

class GameAudio {
  private context?: AudioContext
  private master?: GainNode
  private ambience?: GainNode
  private crowd?: AudioBufferSourceNode
  private buffers: Partial<Record<'stadium' | 'applause' | 'boo' | 'kick' | 'click', AudioBuffer>> = {}
  private voices = new Set<AudioScheduledSourceNode>()
  private uiVoices = new Set<AudioScheduledSourceNode>()
  private envelopes = new Map<AudioScheduledSourceNode, { gain: GainNode; endsAt: number; crowd: boolean }>()
  private fading = new WeakSet<AudioScheduledSourceNode>()
  private reaction?: AudioBufferSourceNode
  private active = false
  private disposed = false
  private clickLoading?: Promise<void>
  private clickData?: Promise<ArrayBuffer | undefined>

  async unlock() {
    if (this.disposed || document.hidden) return
    try {
      if (!this.context) {
        this.context = new AudioContext()
        this.master = this.context.createGain()
        this.master.gain.value = .65
        const limiter = this.context.createDynamicsCompressor()
        limiter.threshold.value = -12
        limiter.ratio.value = 6
        this.master.connect(limiter).connect(this.context.destination)
        this.clickLoading = this.loadClick()
        void this.loadSounds()
      }
      if (this.context.state === 'suspended') await this.context.resume()
    } catch { /* Audio must never prevent playing the game. */ }
  }

  private preloadClick() {
    this.clickData ??= fetch(clickUrl)
      .then(response => response.ok ? response.arrayBuffer() : undefined)
      .catch(() => undefined)
    return this.clickData
  }

  private async loadClick() {
    try {
      const data = await this.preloadClick()
      if (!data || this.disposed) return
      const buffer = await this.context!.decodeAudioData(data)
      if (!this.disposed) this.buffers.click = buffer
    } catch { /* Optional sound must not block navigation. */ }
  }

  private async loadSounds() {
    const context = this.context!
    const urls = { stadium: stadiumUrl, applause: applauseUrl, boo: booUrl, kick: kickUrl }
    await Promise.allSettled(Object.entries(urls).map(async ([name, url]) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error('Audio unavailable')
      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      if (this.disposed) return
      this.buffers[name as keyof typeof urls] = buffer
      if (name === 'stadium') this.syncCrowd()
    }))
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
    return !this.disposed && !document.hidden && this.context?.state === 'running'
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
    if (document.hidden) {
      this.stopEffects(true, true)
      void this.context?.suspend().catch(() => {})
    } else if (this.context) void this.unlock()
  }

  mount() {
    void this.preloadClick()
    document.addEventListener('pointerdown', this.onGesture, true)
    document.addEventListener('keydown', this.onGesture, true)
    document.addEventListener('click', this.onClick, true)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  dispose() {
    this.disposed = true
    document.removeEventListener('pointerdown', this.onGesture, true)
    document.removeEventListener('keydown', this.onGesture, true)
    document.removeEventListener('click', this.onClick, true)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.stopEffects(true, true)
    this.crowd?.stop()
    void this.context?.close().catch(() => {})
  }
}

export const gameAudio = new GameAudio()
