/**
 * Load and provide access to the static game data JSON files.
 */
import type { GameData } from './types'

let cached: GameData | null = null

export async function loadGameData(): Promise<GameData> {
  if (cached) return cached

  const [buffLines, spells, clicks, procs, roleWeights] = await Promise.all([
    fetch('/data/buffLines.json').then(r => r.json()),
    fetch('/data/spells.json').then(r => r.json()),
    fetch('/data/clicks.json').then(r => r.json()),
    fetch('/data/procs.json').then(r => r.json()),
    fetch('/data/roleWeights.json').then(r => r.json()),
  ])

  cached = { buffLines, spells, clicks, procs, roleWeights }
  return cached
}
