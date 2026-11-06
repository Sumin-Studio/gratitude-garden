// Runs the built app in one of its headless modes.
//   pnpm capture [lotus]           the studio flower at 10/30/60/100 % growth + a watering → .claude/screens/capture
//   pnpm export-placeholders       placeholders as GLBs → resources/flowers/_placeholder
//   pnpm selftest                  pad / voice notes / auto-plant / garden window / tray checks
//   pnpm padshot                   the pad under the menu-bar icon → .claude/screens/pad
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const [mode, arg] = process.argv.slice(2)
const root = resolve(import.meta.dirname, '..')
const env = { ...process.env, SIP_USER_DATA: resolve(root, '.claude/userdata-headless') }

if (mode === 'capture') {
  env.SIP_CAPTURE = resolve(root, process.env.SIP_CAPTURE ?? '.claude/screens/capture')
  env.SIP_CAPTURE_FLOWERS = arg ?? 'lotus'
} else if (mode === 'padshot') {
  env.SIP_PADSHOT = resolve(root, '.claude/screens/pad')
} else if (mode === 'export') {
  env.SIP_EXPORT = resolve(root, 'resources/flowers/_placeholder')
} else if (mode === 'selftest') {
  env.SIP_SELFTEST = '1'
  env.SIP_SELFTEST_TRAY = resolve(root, '.claude/screens')
} else {
  console.error('usage: run-mode.mjs capture [ids] | export | selftest | padshot')
  process.exit(1)
}

spawn('pnpm', ['exec', 'electron-vite', 'preview'], { cwd: root, env, stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0))
