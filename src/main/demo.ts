import { app } from 'electron'
import fs from 'node:fs'
import { join } from 'node:path'
import { FLOWER_IDS, type FlowerId } from '../shared/diary'

// Demo mode, for recording the app: a `demo.json` in the app's folder,
//   { "replay": true, "seed": "lotus" }
// `seed`: the seed waiting is always that kind. `replay`: after a Submit, the
// next time the pad opens, today reopens as it was before (the flower it
// planted goes back to being the seed, the page open with the same things),
// so the same take can be done again. Delete the file to go back to normal.

export type Demo = { replay: boolean; seed: FlowerId | null }

export function readDemo(): Demo | null {
  try {
    const raw = JSON.parse(fs.readFileSync(join(app.getPath('userData'), 'demo.json'), 'utf8'))
    const seed = FLOWER_IDS.includes(raw?.seed) ? (raw.seed as FlowerId) : null
    return { replay: raw?.replay === true, seed }
  } catch {
    return null
  }
}

/** Save demo mode, or remove demo.json when it's all off. */
export function writeDemo(d: Demo) {
  const file = join(app.getPath('userData'), 'demo.json')
  if (!d.replay && !d.seed) fs.rmSync(file, { force: true })
  else fs.writeFileSync(file, JSON.stringify({ replay: d.replay, seed: d.seed }, null, 2) + '\n')
}
