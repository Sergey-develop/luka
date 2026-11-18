import type { Zone } from '../types/game'

const pointsByZone = {
  'bottom-left': 150,
  'top-left': 200,
  center: 100,
  'bottom-right': 150,
  'top-right': 200,
} satisfies Record<Zone, number>

const maxShots = 5

export const gameConfig = {
  maxShots,
  maxScore: maxShots * Math.max(...Object.values(pointsByZone)),
  pointsByZone,
  field: {
    width: 540,
    height: 960,
    ballStart: { x: 270, y: 726 },
    goal: { left: 27, right: 513, top: 308, bottom: 515 },
    ballRadius: 16,
    inputBounds: { left: 16, right: 524, top: 270, bottom: 850 },
    sideWidthRatio: 0.245,
    topHeightRatio: 0.37,
  },
  swipe: {
    minLength: 45,
    minForward: 24,
    fullPowerLength: 240,
    elevationLength: 510,
    defaultDurationMs: 350,
  },
  ballistics: { gravity: 9.81, goalDistance: 11, goalWidth: 7.32, goalHeight: 2.44, launchHeight: .11, minSpeed: 13, maxSpeed: 23 },
  keeper: {
    start: { x: 270, y: 430 },
    speed: { x: 360, y: 260 },
    gloveReach: { x: 43, y: 37 },
    // Predict the shot, but limit travel by reaction time and movement speed.
    reactionMs: [165, 260, 280, 250, 175],
    diveEffort: [1.45, 1.05, .95, 1.1, 1.4],
  },
  animation: { resultMs: 1200, minFlightMs: 850 },
  timing: {
    countdownMs: 3000,
    menuWarningMs: 45000,
    menuTimeoutMs: 60000,
    gameWarningMs: 45000,
    gameTimeoutMs: 60000,
    resultReturnMs: 12000,
  },
  alternativeRegistration: true,
  kiosk: { disableContextMenu: true, designWidth: 1080, designHeight: 1920 },
}
