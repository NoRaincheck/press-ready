import { invoke } from '@tauri-apps/api/tauri'
import { open, save } from '@tauri-apps/api/dialog'

let inputPath = ''
let outputPath = ''
let grayscale = false
let boundaryBoxes = false
let outlineMode = 0

const $ = (id) => document.getElementById(id)

const inputPathLabel = $('input-path')
const outputPathLabel = $('output-path')
const logArea = $('log-area')
const statusLabel = $('status')
const progressContainer = $('progress-container')
const progressBar = $('progress-bar')
const gsStatus = $('gs-status')
const pfStatus = $('pf-status')

function log(...lines) {
  for (const line of lines) {
    logArea.value += line + '\n'
  }
  logArea.scrollTop = logArea.scrollHeight
}

function parsePdffonts(stdout) {
  const lines = stdout.split('\n')
  if (!/^name/.test(lines[0]) || lines.length < 3) return []

  const cols = lines[0].split(/\s+/)
  const acc = []
  lines[1].split(' ').forEach((h) => {
    const prev = acc.length > 0 ? acc[acc.length - 1] : 0
    acc.push(h.length + prev + 1)
  })
  const maxLen = lines[0].length

  return lines.slice(2).filter((l) => l.trim().length > 0).map((line) => {
    const extra = line.length > maxLen ? line.indexOf(' ') - acc[0] : 0
    const font = {}
    for (const c of cols) {
      const start = cols.indexOf(c) > 0 ? acc[cols.indexOf(c) - 1] + extra : 0
      font[c] = line.substring(start, acc[cols.indexOf(c)] + extra).trim()
    }
    return font
  })
}

async function pickInput() {
  const path = await open({
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    multiple: false,
  })
  if (!path) return

  inputPath = path
  inputPathLabel.textContent = path
  inputPathLabel.style.color = '#000'

  if (!outputPath || outputPath === 'output.pdf') {
    const idx = path.lastIndexOf('/')
    const dot = path.lastIndexOf('.')
    const dir = idx >= 0 ? path.substring(0, idx) : ''
    const name = dot > idx ? path.substring(idx + 1, dot) : path.substring(idx + 1)
    outputPath = dir + '/' + name + '-print-ready.pdf'
    outputPathLabel.textContent = outputPath
    outputPathLabel.style.color = '#000'
  }
}

async function pickOutput() {
  const path = await save({
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!path) return
  outputPath = path
  outputPathLabel.textContent = path
  outputPathLabel.style.color = '#000'
}

async function startBuild() {
  if (!inputPath) {
    alert('No input', 'Please select an input PDF file.')
    return
  }

  logArea.value = ''
  statusLabel.textContent = 'Status: Building…'
  progressContainer.style.display = 'block'
  progressBar.value = 0

  log('==> press-ready build started')
  log('==> Input: ' + inputPath)
  log('==> Output: ' + outputPath)

  try {
    log('==> Listing fonts in input PDF…')
    const fontsRaw = await invoke('run_pdffonts', { filePath: inputPath })
    const fonts = parsePdffonts(fontsRaw)
    if (fonts.length > 0) {
      log('  name\ttype\tembedded\tsubset')
      for (const f of fonts) log('  ' + f.name + '\t' + f.type + '\t' + f.emb + '\t' + f.sub)
    } else {
      log('  (no fonts found)')
    }

    const hasType3 = fonts.some((f) => f.type === 'Type 3')
    let enforceOutline
    if (outlineMode === 0) {
      enforceOutline = hasType3
      log('==> Auto-detect: ' + (hasType3 ? 'will outline fonts (Type 3 found)' : 'no outline needed'))
    } else {
      enforceOutline = outlineMode === 1
      log('==> Enforce outline: ' + (enforceOutline ? 'Yes' : 'No') + ' (user override)')
    }

    log('==> Generating PDF…')
    log('  Input:           ' + inputPath.split('/').pop())
    log('  Output:          ' + (outputPath.split('/').pop() || 'output.pdf'))
    log('  Color Mode:      ' + (grayscale ? 'Gray' : 'CMYK'))
    log('  Enforce outline: ' + (enforceOutline ? 'yes' : 'no'))
    log('  Boundary boxes:  ' + (boundaryBoxes ? 'yes' : 'no'))

    progressBar.value = 30

    const result = await invoke('convert_pdf', {
      input: inputPath,
      output: outputPath,
      grayscale,
      enforceOutline,
      boundaryBoxes,
    })

    progressBar.value = 80
    log('==> Ghostscript: exit code ' + result.exit_code)

    if (result.exit_code === 0) {
      log('==> Listing fonts in output PDF…')
      const outRaw = await invoke('run_pdffonts', { filePath: outputPath })
      const outFonts = parsePdffonts(outRaw)
      if (outFonts.length > 0) {
        log('  name\ttype\tembedded\tsubset')
        for (const f of outFonts) log('  ' + f.name + '\t' + f.type + '\t' + f.emb + '\t' + f.sub)
      }
      log('==> Build complete ✓')
      progressBar.value = 100
    }

    if (result.stderr && result.exit_code !== 0) {
      log('==> stderr:')
      for (const l of result.stderr.split('\n').filter((x) => x.trim())) log('  ' + l)
    }

    statusLabel.textContent = result.exit_code === 0 ? 'Status: Complete ✓' : 'Status: Error (see log)'
  } catch (err) {
    log('==> Error: ' + (err.message || err))
    statusLabel.textContent = 'Status: Error (see log)'
  }

  progressContainer.style.display = 'none'
}

// Event listeners
$('btn-input').addEventListener('click', pickInput)
$('btn-output').addEventListener('click', pickOutput)
$('btn-build').addEventListener('click', startBuild)
$('chk-grayscale').addEventListener('change', (e) => {
  grayscale = e.target.checked
})
$('chk-boundary').addEventListener('change', (e) => {
  boundaryBoxes = e.target.checked
})
$('sel-outline').addEventListener('change', (e) => {
  outlineMode = parseInt(e.target.value, 10)
}) // Initial dependency check
;(async () => {
  try {
    const deps = await invoke('check_dependencies')
    gsStatus.textContent = deps.ghostscript ? '✓' : '✗'
    pfStatus.textContent = deps.pdffonts ? '✓' : '✗'
    const ok = deps.ghostscript && deps.pdffonts
    const el = document.querySelector('.dep-check')
    el.style.color = ok ? '#1d7c3a' : '#c41e3a'
  } catch {
    gsStatus.textContent = '?'
    pfStatus.textContent = '?'
  }
})()
