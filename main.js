import { File } from '@pierre/diffs'
import { Editor } from '@pierre/diffs/edit'

const params = new URLSearchParams(location.search)
const mode = params.get('autoSurround') ?? 'default'

// A 12-line document: enough rows to be a realistic JSON editor buffer.
const DOC = JSON.stringify(
  [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi' },
  ],
  null,
  2,
)

const host = document.getElementById('host')
const out = document.getElementById('out')

// The editor's own model, taken from onChange — not from the rendered rows.
let model = DOC
const changes = []

window.__repro = {
  initial: DOC,
  mode,
  model: () => model,
  changes: () => changes,
  rows: () => {
    const root = host.querySelector('diffs-container')?.shadowRoot
    const content = root?.querySelector('[data-content]')
    if (!content) return null
    return [...content.children].map((row) => row.textContent ?? '').join('\n')
  },
  ready: false,
}

async function main() {
  const file = new File({
    theme: { light: 'github-light', dark: 'github-dark' },
    themeType: 'light',
    overflow: 'wrap',
    disableFileHeader: true,
    tokenizeMaxLineLength: 0,
  })

  file.render({
    file: { name: 'history.json', contents: DOC, lang: 'json' },
    containerWrapper: host,
  })

  // The component must finish its first highlight before an editor can attach.
  await file.prepareForEditing?.()

  const editor = new Editor('file', {
    // 'never' disables auto-surround, which is the switch under test.
    ...(mode === 'never' ? { autoSurround: 'never' } : {}),
    onChange: (event) => {
      model = event.file.contents
      changes.push(model)
      out.textContent = `model:\n${model}`
    },
  })

  editor.edit(file)
  window.__repro.ready = true
}

main().catch((error) => {
  console.error(error)
  out.textContent = `failed: ${error.message}`
})
