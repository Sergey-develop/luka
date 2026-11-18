import { gameConfig } from '../config/game'
import type { Point, Shot, Swipe, Zone, Trajectory } from '../types/game'
import { calculateScore } from './scoring'

export function isValidSwipe({ dx, dy, durationMs }: Swipe): boolean {
  const { minLength, minForward } = gameConfig.swipe
  return Number.isFinite(dx) && Number.isFinite(dy)
    && (durationMs === undefined || (Number.isFinite(durationMs) && durationMs > 0))
    && dy <= -minForward && Math.hypot(dx, dy) >= minLength
}

/** Classifies the ball centre when the whole ball crosses the goal line. */
export function zoneAtGoalLine({ x, y }: Point): Zone | null {
  const { goal, ballRadius, sideWidthRatio, topHeightRatio } = gameConfig.field
  if (x <= goal.left + ballRadius || x >= goal.right - ballRadius
    || y <= goal.top + ballRadius || y >= goal.bottom - ballRadius) return null

  const horizontal = (x - goal.left) / (goal.right - goal.left)
  if (horizontal >= sideWidthRatio && horizontal <= 1 - sideWidthRatio) return 'center'

  const upper = (y - goal.top) / (goal.bottom - goal.top) < topHeightRatio
  if (horizontal < sideWidthRatio) return upper ? 'top-left' : 'bottom-left'
  return upper ? 'top-right' : 'bottom-right'
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Bound the virtual finger, including gestures that start off the ball centre. */
export function constrainSwipe(swipe: Swipe): Swipe {
  const { ballStart, inputBounds: bounds } = gameConfig.field
  return { ...swipe,
    dx: Math.max(bounds.left, Math.min(bounds.right, ballStart.x + swipe.dx)) - ballStart.x,
    dy: Math.max(bounds.top, Math.min(bounds.bottom, ballStart.y + swipe.dy)) - ballStart.y,
  }
}

function powerAtLength(gesture: Swipe, fullPowerLength: number): number {
  const { swipe } = gameConfig
  const length = Math.hypot(gesture.dx, gesture.dy)
  const pull = clamp01((length - swipe.minLength) / (fullPowerLength - swipe.minLength))
  const speed = length / (Math.max(60, gesture.durationMs ?? swipe.defaultDurationMs) / 1000)
  return .8 * pull + .2 * clamp01((speed - 250) / 1750)
}

export function shotPower(gesture: Swipe): number {
  return powerAtLength(gesture, gameConfig.swipe.fullPowerLength)
}

export function launchTrajectory(gesture: Swipe): Trajectory {
  const { ballistics, swipe } = gameConfig
  const bounded = constrainSwipe(gesture)
  const speed = ballistics.minSpeed + shotPower(bounded) * (ballistics.maxSpeed - ballistics.minSpeed)
  const aimElevation = .09 + .3 * clamp01((-bounded.dy - swipe.minLength) / (swipe.elevationLength - swipe.minLength))
  const yaw = Math.atan2(bounded.dx, Math.max(swipe.minLength, -bounded.dy)) * .5
  // Keep the same target height while the calibrated power changes ball speed.
  const referenceSpeed = ballistics.minSpeed + powerAtLength(bounded, swipe.elevationLength) * (ballistics.maxSpeed - ballistics.minSpeed)
  const distance = ballistics.goalDistance / Math.cos(yaw)
  const referenceTime = distance / (referenceSpeed * Math.cos(aimElevation))
  const height = referenceSpeed * Math.sin(aimElevation) * referenceTime - .5 * ballistics.gravity * referenceTime ** 2
  const gravityTerm = ballistics.gravity * distance ** 2 / (2 * speed ** 2)
  const discriminant = Math.max(0, distance ** 2 - 4 * gravityTerm * (gravityTerm + height))
  const elevation = Math.atan((2 * (gravityTerm + height)) / (distance + Math.sqrt(discriminant)))
  const vx = speed * Math.cos(elevation) * Math.sin(yaw)
  const vy = speed * Math.sin(elevation)
  const vz = speed * Math.cos(elevation) * Math.cos(yaw)
  return { vx, vy, vz, duration: ballistics.goalDistance / vz }
}

/** Project the same gravity-driven flight used for scoring into the scene. */
export function flightPosition(trajectory: Trajectory, progress: number) {
  const { field, ballistics: b } = gameConfig
  const t = clamp01(progress) * trajectory.duration
  const depth = trajectory.vz * t / b.goalDistance
  const goalScale = field.ballRadius * 2 / 182
  const scale = 1 / (1 + (1 / goalScale - 1) * depth)
  const perspectiveDepth = (1 - scale) / (1 - goalScale)
  const pixelsY = (field.goal.bottom - field.goal.top) / b.goalHeight
  const groundStart = field.ballStart.y + b.launchHeight * pixelsY / goalScale
  const groundY = groundStart + (field.goal.bottom - groundStart) * perspectiveDepth
  const height = Math.max(0, b.launchHeight + trajectory.vy * t - .5 * b.gravity * t * t)
  return {
    x: field.ballStart.x + trajectory.vx * t * (field.goal.right - field.goal.left) / b.goalWidth * scale / goalScale,
    y: groundY - height * pixelsY * scale / goalScale,
    groundY, scale,
  }
}

export function evaluateSwipe(swipe: Swipe, attemptIndex: number, previousShot?: Shot): Shot | null {
  if (!isValidSwipe(swipe)) return null
  swipe = constrainSwipe(swipe)
  if (!isValidSwipe(swipe)) return null
  const { field, keeper } = gameConfig
  const trajectory = launchTrajectory(swipe)
  const flightMs = trajectory.duration * 1000
  const { x, y } = flightPosition(trajectory, 1)
  const target = { x, y }
  const zone = zoneAtGoalLine(target)

  const baseReactionMs = keeper.reactionMs[attemptIndex]
  if (baseReactionMs === undefined) throw new Error('No goalkeeper reaction defined for this attempt')
  // Read a repeated corner: an earlier push-off, not a forced save outcome.
  const anticipated = zone !== null && zone.startsWith('top-') && previousShot?.zone === zone
  const reactionMs = anticipated ? Math.min(baseReactionMs, 190) : baseReactionMs
  // On some hard central shots the keeper commits to the wrong side.
  const wrongSide = zone === 'center' && Math.abs(target.x - keeper.start.x) < 70
    && shotPower(swipe) >= .7 && (attemptIndex === 1 || attemptIndex === 3)
  const predictedX = target.x + (wrongSide ? (attemptIndex === 1 ? -120 : 120) : 0)
  const desired = {
    x: Math.min(field.goal.right - field.ballRadius, Math.max(field.goal.left + field.ballRadius, predictedX)),
    y: Math.min(field.goal.bottom - field.ballRadius, Math.max(field.goal.top + field.ballRadius, target.y)),
  }
  const dx = desired.x - keeper.start.x
  const dy = desired.y - keeper.start.y
  // Vary the strength of the push-off; saves still require physical reach.
  const effort = Math.max(keeper.diveEffort[attemptIndex], anticipated ? 1.05 : 0)
  const travelSeconds = Math.hypot(dx / (keeper.speed.x * effort), dy / (keeper.speed.y * effort))
  const availableSeconds = Math.max(0, flightMs - reactionMs) / 1000
  const reach = travelSeconds === 0 ? 1 : clamp01(availableSeconds / travelSeconds)
  const gloves = {
    x: keeper.start.x + dx * reach,
    y: keeper.start.y + dy * reach,
  }
  const touchesBall = Math.hypot(
    (target.x - gloves.x) / keeper.gloveReach.x,
    (target.y - gloves.y) / keeper.gloveReach.y,
  ) <= 1

  const outcome = zone === null ? 'miss' : touchesBall ? 'saved' : 'goal'
  return {
    zone,
    outcome,
    points: calculateScore(zone, outcome),
    target,
    keeper: gloves,
    trajectory,
    flightMs,
    reactionMs,
  }
}
