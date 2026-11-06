// `pnpm glass-shot <dir>`: photographs the garden's glass (the tune panel and
// its pill, the callout with a voice note) at 900 × 650 and prints the frame
// rate with each one up. Same harness as garden-shot.
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const PORT = Number(process.env.SIP_GLASSSHOT_PORT) || 5212
const dir = resolve(process.argv[2] ?? resolve(root, '.claude/screens/glass'))
const vite = spawn('pnpm', ['exec', 'vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const stop = (code) => {
  vite.kill()
  process.exit(code ?? 0)
}
for (let i = 0; ; i++) {
  const up = await fetch(`http://localhost:${PORT}/garden.html`).catch(() => null)
  if (up?.ok) break
  if (i > 100) stop(1)
  await new Promise((r) => setTimeout(r, 150))
}
const electron = spawn('pnpm', ['exec', 'electron', resolve(root, 'scripts/glass-shot-main.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SIP_GLASSSHOT_URL: `http://localhost:${PORT}/garden.html?capture`, SIP_GLASSSHOT_DIR: dir }
})
electron.on('exit', stop)
