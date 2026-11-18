<script setup lang="ts">
import { ref } from 'vue'
import hero from '../assets/art/idle-hero.webp'
import coin from '../assets/art/idle-coin.webp'
import underCoin from '../assets/art/idle-coin-backdrop.webp'

const coinReady = ref(false)
const backdropReady = ref(false)
</script>

<template>
  <div class="idle-art" aria-hidden="true">
    <svg class="idle-decoration" viewBox="0 0 540 612" preserveAspectRatio="none" focusable="false">
      <defs>
        <!-- Only the interior of each light trail can move. The original player stays on the background. -->
        <path id="idle-front-streak" d="M200 557 C327 539 453 510 549 458" />
        <path id="idle-left-streak" d="M-8 377 C12 350 40 337 61 324" />
        <path id="idle-right-streak" d="M425 216 Q496 205 548 174" />
        <filter id="idle-soft-edge" x="-20%" y="-100%" width="140%" height="300%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        <mask id="idle-front-light" maskUnits="userSpaceOnUse" x="0" y="0" width="540" height="612">
          <use href="#idle-front-streak" fill="none" stroke="white" stroke-width="32" filter="url(#idle-soft-edge)" />
        </mask>
        <mask id="idle-back-light" maskUnits="userSpaceOnUse" x="0" y="0" width="540" height="612">
          <g fill="none" stroke="white" stroke-width="15" filter="url(#idle-soft-edge)">
            <use href="#idle-left-streak" />
            <use href="#idle-right-streak" />
          </g>
        </mask>
      </defs>

      <g mask="url(#idle-back-light)">
        <image :href="hero" width="540" height="612" class="back-ribbon" />
        <g class="ribbon-glint ribbon-glint--back">
          <use href="#idle-left-streak" />
          <use href="#idle-right-streak" />
        </g>
      </g>
      <g mask="url(#idle-front-light)">
        <image :href="hero" width="540" height="612" class="front-ribbon" />
        <use href="#idle-front-streak" class="ribbon-glint" />
      </g>

      <g :style="{ opacity: coinReady && backdropReady ? 1 : 0 }">
        <image :href="underCoin" x="10" y="372" width="240" height="234" @load="backdropReady = true" />
        <image :href="coin" x="10" y="372" width="240" height="234" class="floating-coin" @load="coinReady = true" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.idle-decoration { display: block; width: 100%; height: 100%; overflow: hidden; }

.floating-coin { animation: coin-float 4.8s ease-in-out infinite; }
.front-ribbon { animation: front-wave 3.9s ease-in-out infinite alternate; }
.back-ribbon { animation: back-wave 4.7s ease-in-out infinite alternate; }

.ribbon-glint {
  fill: none;
  stroke: #ffe7ff;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-dasharray: 29 141;
  opacity: .5;
  animation: light-travel 3s linear infinite;
}
.ribbon-glint--back { opacity: .38; animation-duration: 3.8s; }

@keyframes coin-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
@keyframes front-wave {
  from { transform: translateY(-1.5px); }
  to { transform: translateY(2.5px); }
}
@keyframes back-wave {
  from { transform: translateY(1.2px); }
  to { transform: translateY(-1.4px); }
}
@keyframes light-travel {
  to { stroke-dashoffset: -170; }
}

@media (prefers-reduced-motion: reduce) {
  .idle-decoration { display: none; }
}
</style>
