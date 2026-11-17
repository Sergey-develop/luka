import { gameAudio } from './audio/gameAudio'
import stadiumUrl from './assets/stadium-clean.webp'

const artwork = import.meta.glob<string>('./assets/art/*.{webp,png}', {
  eager: true, query: '?url', import: 'default',
})
// Retain decoded images so later CSS backgrounds do not trigger another decode/download.
const images = new Map<string, HTMLImageElement>()
async function loadImage(url: string) {
  if (images.has(url)) return
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await image.decode()
  images.set(url, image)
}

export async function preloadGame(onProgress: (progress: number) => void) {
  const tasks = [
    ...Object.values(artwork).map(loadImage),
    loadImage(stadiumUrl),
    ...['Satoshi Variable', 'Monda', 'Inter'].map(font => document.fonts.load(`700 16px "${font}"`)),
    gameAudio.preload(),
  ]
  let loaded = 0
  await Promise.all(tasks.map(async task => {
    await task
    onProgress(++loaded / tasks.length)
  }))
}
