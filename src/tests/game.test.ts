import { describe, expect, it } from 'vitest'
import { gameConfig } from '../config/game'
import { GameEngine } from '../game/engine'
import { evaluateSwipe, zoneAtGoalLine, constrainSwipe, flightPosition, shotPower } from '../game/physics'
import type { Swipe } from '../types/game'

const upperLeft: Swipe = { dx: -254, dy: -375, durationMs: 100 }
const upperRight: Swipe = { dx: 254, dy: -375, durationMs: 100 }
const straight: Swipe = { dx: 0, dy: -310 }

function createRound() {
  const game = new GameEngine()
  game.openInstructions()
  game.openRegistration()
  game.register({ uid: '12345678' })
  game.start()
  return game
}

describe('swipe physics', () => {
  it('awards 100, 150, or 200 based on the actual goal line crossing', () => {
    expect(evaluateSwipe({ dx: 130, dy: -405 }, 2)).toMatchObject({
      zone: 'center', outcome: 'goal', points: 100,
    })
    expect(evaluateSwipe({ dx: 175, dy: -260 }, 2)).toMatchObject({
      zone: 'bottom-right', outcome: 'goal', points: 150,
    })
    expect(evaluateSwipe(upperRight, 0)).toMatchObject({
      zone: 'top-right', outcome: 'goal', points: 200,
    })
  })

  it('tracks both sides and saves reachable shots while corners remain beatable', () => {
    for (let attempt = 0; attempt < gameConfig.maxShots; attempt++) {
      for (const sign of [-1, 1]) {
        const saved = evaluateSwipe({ dx: sign * 55, dy: -251 }, attempt)!
        expect(saved.outcome).toBe('saved')
        expect(Math.sign(saved.keeper.x - gameConfig.keeper.start.x)).toBe(sign)
        expect(evaluateSwipe({ dx: sign * 254, dy: -375, durationMs: 100 }, attempt)?.outcome).toBe('goal')
      }
    }
  })

  it('allows shots into either upper corner to beat the keeper', () => {
    for (const sign of [-1, 1]) {
      const gesture = { dx: sign * 158, dy: -359 }
      const zone = sign < 0 ? 'top-left' : 'top-right'
      const slower = evaluateSwipe({ ...gesture, durationMs: 800 }, 2)!
      const faster = evaluateSwipe({ ...gesture, durationMs: 100 }, 2)!
      expect(slower).toMatchObject({ zone, outcome: 'goal', points: 200 })
      expect(faster).toMatchObject({ zone, outcome: 'goal', points: 200 })
      expect(slower.keeper.y).toBeLessThan(gameConfig.keeper.start.y)
      expect(Math.sign(slower.keeper.x - gameConfig.keeper.start.x)).toBe(sign)
      // A quicker reaction can stop the same shot on another attempt.
      expect(evaluateSwipe({ ...gesture, durationMs: 100 }, 0)?.outcome).toBe('saved')
    }
  })

  it('allows fast shots into either upper corner', () => {
    for (const sign of [-1, 1]) {
      const shots = Array.from({ length: gameConfig.maxShots }, (_, attempt) =>
        evaluateSwipe({ dx: sign * 215, dy: -375, durationMs: 80 }, attempt)!)
      expect(shots.every(shot => shot.zone === (sign < 0 ? 'top-left' : 'top-right'))).toBe(true)
      expect(shots.filter(shot => shot.outcome === 'goal').length).toBeGreaterThanOrEqual(4)
      expect(shots.some(shot => shot.outcome === 'goal')).toBe(true)
      expect(shots.every(shot => Math.abs(shot.keeper.x - 270) > 20 && shot.keeper.y < 430)).toBe(true)
    }
  })

  it('balances repeated ordinary centre and corner shots across a five-shot round', () => {
    for (const gesture of [{ dx: 0, dy: -310, durationMs: 800 }, { dx: 158, dy: -359, durationMs: 100 }]) {
      const outcomes = Array.from({ length: 5 }, (_, attempt) => evaluateSwipe(gesture, attempt)!.outcome)
      expect(outcomes).toContain('goal')
      expect(outcomes).toContain('saved')
    }
  })

  it('uses flight velocity and gravity instead of the finger release position', () => {
    const fast = evaluateSwipe({ ...upperRight, durationMs: 100 }, 0)!
    const slow = evaluateSwipe({ ...upperRight, durationMs: 800 }, 0)!
    expect(fast.flightMs).toBeLessThan(slow.flightMs)
    expect(fast.target.y).toBeLessThan(slow.target.y - 15)
    expect(fast.target.y).not.toBeCloseTo(gameConfig.field.ballStart.y + upperRight.dy, 0)
    const start = flightPosition(fast.trajectory, 0)
    expect(start.x).toBeCloseTo(gameConfig.field.ballStart.x)
    expect(start.y).toBeCloseTo(gameConfig.field.ballStart.y)
    const end = flightPosition(fast.trajectory, 1)
    expect(end.x).toBeCloseTo(fast.target.x)
    expect(end.y).toBeCloseTo(fast.target.y)
    const heightAtGoal = (gameConfig.field.goal.bottom - end.y) / (207 / 2.44)
    const t = fast.trajectory.duration
    expect(heightAtGoal).toBeCloseTo(.11 + fast.trajectory.vy * t - .5 * 9.81 * t * t)
  })

  it('bounds the gesture independently of how far outside the field the finger moves', () => {
    const edge = { dx: 254, dy: -456, durationMs: 200 }
    const outside = { dx: 5000, dy: -5000, durationMs: 200 }
    expect(constrainSwipe(outside)).toEqual(edge)
    expect(evaluateSwipe(outside, 0)).toEqual(evaluateSwipe(edge, 0))
    expect(constrainSwipe({ dx: -9999, dy: 9999 })).toEqual({ dx: -254, dy: 124 })
    expect(evaluateSwipe({ ...upperRight, durationMs: NaN }, 0)).toBeNull()
    expect(evaluateSwipe({ ...upperRight, durationMs: 0 }, 0)).toBeNull()
  })

  it('rejects a post, a wide ball, and a ball above the crossbar', () => {
    const wide = { dx: 260, dy: -250 }
    expect(zoneAtGoalLine({ x: 33, y: 418 })).toBeNull()
    expect(evaluateSwipe(wide, 0)).toMatchObject({
      zone: null, outcome: 'miss', points: 0,
    })
    expect(evaluateSwipe({ dx: 0, dy: -450 }, 0)).toMatchObject({
      zone: null, outcome: 'miss', points: 0,
    })
  })

  it('lets a hard straight shot beat a keeper diving the wrong way', () => {
    const hard = { dx: 0, dy: -310, durationMs: 100 }
    expect(evaluateSwipe(hard, 1)).toMatchObject({ zone: 'center', outcome: 'goal', points: 100 })
    expect(evaluateSwipe(hard, 0)).toMatchObject({ zone: 'center', outcome: 'saved' })
    expect(evaluateSwipe({ ...hard, durationMs: 800 }, 1)).toMatchObject({ zone: 'center', outcome: 'goal' })
  })

  it('uses the same keeper reaction for equivalent attempts and swipes', () => {
    const result = evaluateSwipe(straight, 0)
    expect(result).toMatchObject({
      zone: 'center', outcome: 'saved', points: 0,
    })
    expect(evaluateSwipe(straight, 0)).toEqual(result)
    expect(evaluateSwipe(straight, 1)).toMatchObject({ zone: 'center', outcome: 'goal' })
    expect(shotPower({ dx: 0, dy: -240, durationMs: 150 })).toBeGreaterThanOrEqual(.9)
  })
})

describe('five-shot session', () => {
  it('leaves extremely short, backwards and non-finite gestures uncounted', () => {
    const game = createRound()
    for (const gesture of [{ dx: 3, dy: -4 }, { dx: 80, dy: 34 }, { dx: NaN, dy: -300 }]) {
      expect(game.shoot(gesture)).toBeNull()
      expect(game.phase).toBe('aiming')
    }
    expect(game.shots).toHaveLength(0)
    expect(game.pending).toBeNull()
  })

  it('reaches 1000 only after five goals and rejects a sixth shot or duplicate resolution', () => {
    const game = createRound()
    const attemptPlan = [upperRight, upperLeft, upperRight, upperLeft, upperRight]
    for (const [index, gesture] of attemptPlan.entries()) {
      expect(game.shoot(gesture)).toMatchObject({ outcome: 'goal', points: 200 })
      expect(game.shots).toHaveLength(index)
      expect(() => game.shoot(gesture)).toThrow()
      game.resolveShot()
      expect(() => game.resolveShot()).toThrow()
      game.next()
    }
    expect(game.score).toBe(gameConfig.maxScore)
    expect(game.goals).toBe(5)
    expect(() => game.shoot(upperRight)).toThrow()
    expect(game.result()).toMatchObject({ score: 1000, goals: 5, cornerGoals: 5, shots: 5 })
    expect(game.result().id).toBe(game.result().id)
  })

  it('tracks repeated fast shots into the farthest upper corner', () => {
    for (const gesture of [upperLeft, upperRight]) {
      const game = createRound()
      expect(game.shoot(gesture)?.outcome).toBe('goal')
      game.resolveShot()
      game.next()
      for (let attempt = 1; attempt < 5; attempt++) {
        const shot = game.shoot(gesture)!
        expect(shot.outcome).toBe('goal')
        expect(shot.reactionMs).toBeLessThanOrEqual(190)
        game.resolveShot()
        game.next()
      }
    }
  })

  it('supports back, local validation, countdown, and cancellation with a pending shot', () => {
    const game = new GameEngine()
    expect(() => game.start()).toThrow()
    game.openInstructions()
    game.openRegistration()
    game.back()
    expect(game.phase).toBe('instructions')
    game.openRegistration()
    expect(() => game.register({ uid: ' ' })).toThrow()
    expect(() => game.register({ uid: 'ABC' })).toThrow()
    expect(() => game.register({ uid: '1234567' })).toThrow()
    expect(() => game.register({ uid: '123456789' })).toThrow()
    game.register({ uid: 'A local name', nickname: 'A local name' })
    expect(game.phase).toBe('countdown')
    expect(() => game.shoot(straight)).toThrow()
    game.start()
    game.shoot(straight)
    game.home()
    expect(game.phase).toBe('idle')
    expect(game.pending).toBeNull()
    expect(game.player).toBeNull()
    expect(() => game.result()).toThrow()
  })
})

