import { gameConfig } from '../config/game'
import type { Outcome, Shot, Zone } from '../types/game'

export function pointsForZone(zone: Zone) {
  return gameConfig.pointsByZone[zone]
}

export function calculateScore(zone: Zone | null, outcome: Outcome): number {
  return outcome === 'goal' && zone !== null ? pointsForZone(zone) : 0
}

export function scoreShots(shots: readonly Shot[]): number {
  return shots.reduce((sum, shot) => sum + shot.points, 0)
}

export function isCornerGoal(shot: Shot): boolean {
  return shot.outcome === 'goal' && (shot.zone === 'top-left' || shot.zone === 'top-right')
}
