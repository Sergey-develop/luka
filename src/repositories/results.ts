import type { GameResult } from '../types/game'
import { gameConfig } from '../config/game'

export interface ResultsRepository {
  saveResult(result: GameResult): Promise<void>
  getLeaderboard(now?: Date): Promise<GameResult[]>
  getPlayerResults(uid: string): Promise<GameResult[]>
  checkConnection(): Promise<boolean>
}

const KEY = 'coinw-football-results-v1'
const dubaiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function getDubaiDay(date = new Date()): string {
  return dubaiDate.format(date)
}

export function playerKey(result: Pick<GameResult, 'uid' | 'nickname'>): string {
  if (!result.nickname) return `uid:${result.uid}`
  return `nickname:${result.nickname.normalize('NFKC').toLocaleLowerCase('en')}`
}

export function publicPlayerName(result: Pick<GameResult, 'uid' | 'nickname'>): string {
  if (result.nickname) return result.nickname
  const visible = Math.min(3, Math.floor(result.uid.length / 2))
  return '••••' + (visible ? result.uid.slice(-visible) : '')
}

function compareResults(a: GameResult, b: GameResult): number {
  return b.score - a.score
    || b.goals - a.goals
    || (b.cornerGoals ?? 0) - (a.cornerGoals ?? 0)
    || Date.parse(a.date) - Date.parse(b.date)
}

export class LocalResultsRepository implements ResultsRepository {
  private read(): GameResult[] {
    const value = localStorage.getItem(KEY)
    if (!value) return []
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.some(entry => !entry
      || typeof entry.id !== 'string' || typeof entry.uid !== 'string'
      || (entry.nickname !== undefined && typeof entry.nickname !== 'string')
      || !Number.isFinite(entry.score) || !Number.isInteger(entry.goals)
      || !Number.isInteger(entry.shots) || !Number.isFinite(Date.parse(entry.date)))) {
      throw new Error('Invalid saved results')
    }
    return parsed as GameResult[]
  }

  async saveResult(result: GameResult): Promise<void> {
    const results = this.read()
    if (results.some(item => item.id === result.id)) return
    results.push(result)
    localStorage.setItem(KEY, JSON.stringify(results))
  }

  async getLeaderboard(now = new Date()): Promise<GameResult[]> {
    const day = getDubaiDay(now)
    const results = this.read()
      .filter(item => item.shots === gameConfig.maxShots && getDubaiDay(new Date(item.date)) === day)
      .sort(compareResults)

    const best = new Map<string, GameResult>()
    for (const result of results) {
      const key = playerKey(result)
      if (!best.has(key)) best.set(key, result)
    }
    return [...best.values()]
  }

  async getPlayerResults(uid: string): Promise<GameResult[]> {
    return this.read().filter(result => result.uid === uid).sort(compareResults)
  }

  async checkConnection(): Promise<boolean> {
    return false
  }
}
