// Drives the page with real keyboard events and asserts the editor's model.
//
//   npm run build && npm run repro
//
// On @pierre/diffs 1.7.1 case 1 (default autoSurround) fails: select-all then
// typing {"b":2} one key at a time does not replace the document. Case 2
// (autoSurround: 'never') passes, which pins the cause.
//
// CHROME_PATH can point at a specific Chromium binary; otherwise Playwright's
// own download is used (`npx playwright install chromium`).

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = fileURLToPath(new URL('./dist', import.meta.url))
const TYPED = '{"b":2}'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

async function ensureBuilt() {
  try {
    await stat(join(ROOT, 'index.html'))
  } catch {
    console.error('dist/index.html is missing — run `npm run build` first.')
    process.exit(2)
  }
}

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(ROOT, path === '/' ? 'index.html' : path)
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function runCase(browser, base, autoSurround, typed = TYPED) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto(`${base}/?autoSurround=${autoSurround}`)
  await page.waitForFunction(() => window.__repro?.ready === true, null, { timeout: 30_000 })

  const initial = await page.evaluate(() => window.__repro.initial)

  // Wait for the editor to attach, then focus its content element. Attaching
  // happens after the first highlight, so the contenteditable appears late.
  await page.waitForFunction(
    () => {
      const root = document.querySelector('diffs-container')?.shadowRoot
      return root?.querySelector('[contenteditable="true"]') != null
    },
    null,
    { timeout: 30_000 },
  )

  const focused = await page.evaluate(() => {
    const root = document.querySelector('diffs-container')?.shadowRoot
    const editable = root?.querySelector('[contenteditable="true"]')
    editable?.focus()
    return root?.activeElement === editable || document.activeElement === editable
  })
  if (!focused) throw new Error('the editor content element did not take focus')

  // Let the deferred caret placement settle before selecting.
  await page.waitForTimeout(500)
  await page.keyboard.press('ControlOrMeta+a')
  await page.waitForTimeout(300)

  await page.keyboard.type(typed)
  await page.waitForTimeout(800)

  const result = await page.evaluate(() => ({
    model: window.__repro.model(),
    rows: window.__repro.rows(),
    changes: window.__repro.changes(),
  }))

  await page.close()

  let parsed = true
  try {
    JSON.parse(result.model)
  } catch {
    parsed = false
  }

  return {
    autoSurround,
    typed,
    initialLines: initial.split('\n').length,
    model: result.model,
    rows: result.rows,
    changeCount: result.changes.length,
    replaced: result.model === typed,
    jsonValid: parsed,
    errors,
  }
}

function report(result) {
  const label = result.autoSurround === 'default' ? 'default autoSurround' : "autoSurround: 'never'"
  console.log(`\n=== ${label} (${result.initialLines}-line document) ===`)
  console.log(`change events:   ${result.changeCount}`)
  console.log(`model after typing ${JSON.stringify(result.typed)}:`)
  console.log(JSON.stringify(result.model))
  console.log(`replaced exactly: ${result.replaced}`)
  console.log(`valid JSON:       ${result.jsonValid}`)
  if (result.errors.length) console.log(`page errors:      ${JSON.stringify(result.errors)}`)
}

await ensureBuilt()
const { server, port } = await serve()
const base = `http://127.0.0.1:${port}`
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
)

let exitCode = 0
try {
  const withDefault = await runCase(browser, base, 'default')
  const braceOnly = await runCase(browser, base, 'default', '{')
  const withNever = await runCase(browser, base, 'never')

  report(withDefault)
  report(braceOnly)
  report(withNever)

  console.log('\n--- verdict ---')
  if (withDefault.replaced) {
    console.log('PASS  default autoSurround: the selection was replaced.')
  } else {
    console.log('FAIL  default autoSurround: the previous document survived the edit.')
    console.log('      This is the reported bug: typing a surround character over a')
    console.log('      whole-document selection wraps it instead of replacing it.')
    exitCode = 1
  }
  if (braceOnly.replaced) {
    console.log("PASS  default autoSurround, typing '{' alone: replaced.")
  } else {
    console.log("FAIL  default autoSurround, typing '{' alone: wrapped the document,")
    console.log(`      model length ${braceOnly.model.length} vs ${braceOnly.initialLines}-line source.`)
    exitCode = 1
  }
  console.log(
    withNever.replaced
      ? "PASS  autoSurround: 'never': the selection was replaced."
      : "FAIL  autoSurround: 'never': the selection was not replaced either.",
  )
  if (!withNever.replaced) exitCode = 1
} finally {
  await browser.close()
  server.close()
}

process.exit(exitCode)
