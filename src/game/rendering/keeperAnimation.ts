import { gsap } from 'gsap'
import type { Sprite } from 'pixi.js'
import { gameConfig } from '../../config/game'
import type { Shot } from '../../types/game'

const homeX = gameConfig.keeper.start.x
const groundY = 545
const upright = 180

export function readyStance(body: Sprite, moving: boolean) {
  body.position.set(homeX, groundY - upright / 2)
  body.width = body.height = upright
  body.rotation = 0
  if (!moving) return

  // A small set step in each direction. Lower the hips while the feet are planted.
  const loop = gsap.timeline({ repeat: -1 })
  for (const side of [-1, 1]) {
    loop.to(body, { x: homeX + side * 8, y: 451, rotation: side * .025, duration: .24, ease: 'sine.out' })
      .to(body, { x: homeX + side * 10, y: 460, height: 170, rotation: side * .012, duration: .15, ease: 'sine.inOut' })
      .to(body, { x: homeX, y: 455, height: upright, rotation: 0, duration: .55, ease: 'sine.inOut' })
  }
  return loop
}

export function animateKeeper(tl: gsap.core.Timeline, body: Sprite, dive: Sprite, shot: Shot,
  react: number, arrive: number, hold: number, reduced: boolean) {
  const hand = shot.outcome === 'saved' ? shot.target : shot.keeper
  const reach = hand.x - homeX
  const side = reach < 0 ? -1 : 1
  const travel = arrive - react
  const recover = arrive + hold - .52
  const standing = Math.abs(reach) < 65
  const high = hand.y < gameConfig.keeper.start.y - 20

  body.alpha = 1
  dive.alpha = 0
  dive.visible = !standing
  if (!reduced) {
    tl.to(body, { x: homeX - side * (standing ? 2 : 7), y: 465, height: 160, width: 186,
      rotation: -side * .035, duration: .14, ease: 'power1.inOut' }, Math.max(0, react - .14))
  }

  if (standing) {
    // For a low block the knees bend; for a high ball the feet leave the ground.
    const height = high ? 185 : Math.max(136, Math.min(176, 2 * (groundY - hand.y - 22)))
    const contactY = Math.min(groundY - height / 2, hand.y + 22)
    tl.to(body, { x: hand.x, y: contactY, height, width: 180, rotation: side * .025,
      duration: travel, ease: 'power2.out' }, react)
    if (!reduced) {
      tl.to(body, { y: 466, height: 158, width: 185, rotation: 0,
        duration: high ? .27 : .14, ease: high ? 'power2.in' : 'sine.out' }, arrive)
    }
  } else {
    // The right glove in the 276 × 198 drawing is at (255, 40), relative to a (129, 99) pivot.
    const angle = (high ? -.20 : .34) * side
    const gx = 126 * side
    const gy = -59
    const contactX = hand.x - gx * Math.cos(angle) + gy * Math.sin(angle)
    const contactY = hand.y - gx * Math.sin(angle) - gy * Math.cos(angle)
    dive.width = 276
    dive.height = 198
    dive.scale.x = Math.abs(dive.scale.x) * side
    const fullScale = { x: dive.scale.x, y: dive.scale.y }
    dive.scale.set(fullScale.x * .87, fullScale.y * .91)
    dive.position.set(homeX - side * 16, 462)
    dive.rotation = (high ? -.42 : -.12) * side
    const blend = reduced ? .04 : .09
    tl.to(body, { alpha: 0, x: homeX + side * 10, duration: blend }, react)
      .to(dive, { alpha: 1, duration: blend }, react)
      .to(dive.scale, { ...fullScale, duration: travel * .75, ease: 'power2.out' }, react)
      .to(dive, { x: contactX, rotation: angle, duration: travel, ease: 'power1.out' }, react)
    if (high || reduced) {
      tl.to(dive, { y: contactY, duration: travel, ease: 'sine.out' }, react)
    } else {
      tl.to(dive, { y: Math.min(contactY, 460) - 15, duration: travel * .4, ease: 'power2.out' }, react)
        .to(dive, { y: contactY, duration: travel * .6, ease: 'power1.in' }, react + travel * .4)
    }

    const landingX = contactX + side * (reduced ? 0 : 18)
    if (!reduced) {
      // Rotate into a flank landing, slide a little on the grass, then push up in place.
      tl.to(dive, { x: landingX, y: 488, rotation: side * .57, duration: .3, ease: 'power1.in' }, arrive)
        .to(dive, { x: landingX + side * 5, rotation: side * .48, duration: .16, ease: 'power2.out' }, arrive + .3)
    }
    tl.set(body, { x: landingX, y: 468, height: 154, width: 185, rotation: side * .07 }, recover)
      .to(dive, { alpha: 0, duration: blend }, recover)
      .to(body, { alpha: 1, duration: blend }, recover)
  }

  tl.to(body, { x: homeX, y: groundY - upright / 2, width: upright, height: upright, rotation: 0,
    duration: reduced ? .16 : .42, ease: 'sine.inOut' }, recover + .09)
}
