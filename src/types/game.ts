export type Zone = 'bottom-left' | 'top-left' | 'center' | 'bottom-right' | 'top-right'
export type Outcome = 'goal' | 'saved' | 'miss'
export type Phase = 'idle' | 'instructions' | 'registration' | 'countdown' | 'aiming' | 'shooting' | 'shot-result' | 'finished' | 'leaderboard'

export interface Player {
  uid: string
  nickname?: string
}

export interface Point {
  x: number
  y: number
}

export interface Swipe {
  dx: number
  dy: number
  durationMs?: number
}

export interface Trajectory {
  vx: number
  vy: number
  vz: number
  duration: number
}

export interface Shot {
  zone: Zone | null
  outcome: Outcome
  points: number
  target: Point
  keeper: Point
  trajectory: Trajectory
  flightMs: number
  reactionMs: number
}

export interface GameResult {
  id: string
  uid: string
  nickname?: string
  score: number
  goals: number
  cornerGoals?: number
  shots: number
  date: string
}
