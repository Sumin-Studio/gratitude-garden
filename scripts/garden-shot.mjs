// `pnpm garden-shot`: photographs the garden with mock flowers into
// .claude/screens/garden/ and prints the frame rate. Serves the renderer with
// vite and drives it from a small Electron window (garden-shot-main.cjs).
//   SIP_GARDENSHOT_ONLY=home,left   just those views
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const PORT = Number(process.env.SIP_GARDENSHOT_PORT) || 5197
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
const electron = spawn('pnpm', ['exec', 'electron', resolve(root, 'scripts/garden-shot-main.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SIP_GARDENSHOT: '1', SIP_GARDENSHOT_URL: `http://localhost:${PORT}/garden.html?capture`, SIP_GARDENSHOT_DIR: resolve(root, '.claude/screens/garden') }
})
electron.on('exit', stop)
