import { gameConfig } from '../config/game'
import type { GameResult, Phase, Player, Shot, Swipe } from '../types/game'
import { evaluateSwipe } from './physics'
import { isCornerGoal, scoreShots } from './scoring'

const uidPattern = /^\d{8}$/

function sessionId(): string {
  // getRandomValues works on the kiosk's local HTTP network as well as HTTPS.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

export class GameEngine {
  phase: Phase = 'idle'
  player: Player | null = null
  shots: Shot[] = []
  pending: Shot | null = null
  private completedResult: GameResult | null = null

  private require(...allowed: Phase[]) {
    if (!allowed.includes(this.phase)) throw new Error(`Invalid transition from ${this.phase}`)
  }

  private clearRound() {
    this.player = null
    this.shots = []
    this.pending = null
    this.completedResult = null
  }

  get score() { return scoreShots(this.shots) }
  get goals() { return this.shots.filter(shot => shot.outcome === 'goal').length }
  get cornerGoals() { return this.shots.filter(isCornerGoal).length }

  openInstructions() {
    this.require('idle', 'leaderboard')
    this.clearRound()
    this.phase = 'instructions'
  }

  openRegistration() {
    this.require('instructions')
    this.phase = 'registration'
  }

  back() {
    this.require('instructions', 'registration')
    if (this.phase === 'registration') this.phase = 'instructions'
    else this.home()
  }

  register(player: Player) {
    this.require('registration')
    const uid = player.uid.trim()
    const nickname = player.nickname?.trim()
    if (nickname && gameConfig.alternativeRegistration) {
      if (nickname.length > 40) throw new Error('Enter a nickname up to 40 characters.')
      this.player = { uid: uid.startsWith('email:') ? uid : nickname, nickname }
    } else {
      if (!uidPattern.test(uid)) throw new Error('Enter a valid CoinW UID (exactly 8 digits).')
      this.player = { uid }
    }
    this.phase = 'countdown'
  }

  start() {
    this.require('countdown')
    this.phase = 'aiming'
  }

  shoot(gesture: Swipe): Shot | null {
    this.require('aiming')
    if (this.shots.length >= gameConfig.maxShots) throw new Error('No shots left')
    const shot = evaluateSwipe(gesture, this.shots.length, this.shots.at(-1))
    if (!shot) return null

    this.pending = shot
    this.phase = 'shooting'
    return shot
  }

  resolveShot() {
    this.require('shooting')
    if (!this.pending) throw new Error('Missing shot')
    this.shots.push(this.pending)
    this.pending = null
    this.phase = 'shot-result'
  }

  next() {
    this.require('shot-result')
    this.phase = this.shots.length === gameConfig.maxShots ? 'finished' : 'aiming'
  }

  result(): GameResult {
    this.require('finished')
    if (!this.player) throw new Error('Missing player')
    this.completedResult ??= {
      id: sessionId(),
      uid: this.player.uid,
      ...(this.player.nickname ? { nickname: this.player.nickname } : {}),
      score: this.score,
      goals: this.goals,
      cornerGoals: this.cornerGoals,
      shots: this.shots.length,
      date: new Date().toISOString(),
    }
    return this.completedResult
  }

  home() {
    this.clearRound()
    this.phase = 'idle'
  }

  leaderboard() {
    this.require('idle', 'finished')
    this.phase = 'leaderboard'
  }
}
