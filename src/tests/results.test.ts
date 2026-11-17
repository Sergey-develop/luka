import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDubaiDay, LocalResultsRepository, publicPlayerName } from '../repositories/results'
import type { GameResult } from '../types/game'

const storage = new Map<string, string>()
const local = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
}
const now = new Date('2026-12-01T19:59:00Z')
const result: GameResult = {
  id: 'original',
  uid: '123456',
  score: 450,
  goals: 3,
  cornerGoals: 1,
  shots: 5,
  date: '2026-12-01T16:00:00Z',
}

describe('local results', () => {
  beforeEach(() => { storage.clear(); vi.stubGlobal('localStorage', local) })
  afterEach(() => vi.unstubAllGlobals())

  it('persists history and avoids duplicate records', async () => {
    await new LocalResultsRepository().saveResult(result)
    await new LocalResultsRepository().saveResult(result)
    expect(await new LocalResultsRepository().getPlayerResults(result.uid)).toEqual([result])
    expect(await new LocalResultsRepository().checkConnection()).toBe(false)
  })

  it('shows a new Dubai day at 20:00 UTC without removing history', async () => {
    const repo = new LocalResultsRepository()
    const nextDay = new Date('2026-12-01T20:00:00Z')
    const legacy = { ...result, id: 'legacy', shots: 3, score: 550 }
    await repo.saveResult(result)
    await repo.saveResult(legacy)

    expect(getDubaiDay(now)).not.toBe(getDubaiDay(nextDay))
    expect(await repo.getLeaderboard(now)).toEqual([result])
    expect(await repo.getLeaderboard(nextDay)).toEqual([])
    expect(await repo.getPlayerResults(result.uid)).toHaveLength(2)
  })

  it('keeps the best daily result and applies all tie breaks in order', async () => {
    const repo = new LocalResultsRepository()
    const scores: GameResult[] = [
      { ...result, id: 'less-goals', uid: '02', goals: 2, cornerGoals: 2 },
      { ...result, id: 'less-corners', uid: '03', cornerGoals: 0 },
      { ...result, id: 'later', uid: '04', date: '2026-12-01T17:00:00Z' },
      { ...result, id: 'higher', uid: '05', score: 500, goals: 2 },
      { ...result, id: 'second-try', score: 200 },
      result,
    ]
    for (const entry of scores) await repo.saveResult(entry)
    expect((await repo.getLeaderboard(now)).map(entry => entry.id)).toEqual([
      'higher', 'original', 'later', 'less-corners', 'less-goals',
    ])
  })

  it('masks UID even when short and uses a supplied nickname as the public name', () => {
    expect(publicPlayerName(result)).toBe('••••456')
    expect(publicPlayerName({ uid: '1' })).toBe('••••')
    expect(publicPlayerName({ uid: 'Guest', nickname: 'Guest' })).toBe('Guest')
  })

  it('propagates storage failures', async () => {
    vi.stubGlobal('localStorage', { ...local, setItem: () => { throw new Error('quota') } })
    await expect(new LocalResultsRepository().saveResult(result)).rejects.toThrow('quota')
  })
})
