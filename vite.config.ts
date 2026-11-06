import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The real flower models, for the mock bridge: GET /flowers/<id>.glb.
const flowers: Plugin = {
  name: 'sip-flowers',
  configureServer(server) {
    server.middlewares.use('/flowers', async (req, res, next) => {
      try {
        const file = basename((req.url ?? '').split('?')[0])
        const bytes = await readFile(resolve(__dirname, 'resources/flowers', file))
        res.setHeader('Content-Type', 'model/gltf-binary')
        res.end(bytes)
      } catch {
        next()
      }
    })
  }
}

// Dev only: a page can save a self-contained snapshot of itself for the
// Figma import (`window.__snap` in the browser, POST /__snap?name=…), into
// .claude/screens/figma/<name>.html.
const snap: Plugin = {
  name: 'sip-snap',
  configureServer(server) {
    server.middlewares.use('/__snap', async (req, res) => {
      const name = basename(new URL(req.url ?? '/', 'http://x').searchParams.get('name') ?? 'page').replace(/[^\w.-]/g, '_')
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const dir = resolve(__dirname, '.claude/screens/figma')
      await mkdir(dir, { recursive: true })
      await writeFile(resolve(dir, `${name}.html`), Buffer.concat(chunks))
      res.end(`saved ${name}.html ${Buffer.concat(chunks).length} bytes`)
    })
  }
}

// Renderer only, in a plain browser (mock bridge): `pnpm web`.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), flowers, snap],
  server: { port: 5179, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        pad: resolve(__dirname, 'src/renderer/pad.html'),
        garden: resolve(__dirname, 'src/renderer/garden.html')
      }
    }
  }
})
