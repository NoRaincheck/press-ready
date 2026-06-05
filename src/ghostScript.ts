import fs from 'fs'
import path from 'upath'
import execa from 'execa'
import { tmpdir } from 'os'
import { join } from 'upath'
import Mustache from 'mustache'
import { v4 as uuid } from 'uuid'
import shell from 'shelljs'
import { spawn } from 'child_process'
import { createInterface } from 'readline'
const debug = require('debug')('press-ready')

export interface GhostscriptOption {
  inputPath: string
  outputPath: string
  pdfxDefTemplatePath?: string
  sourceIccProfilePath?: string
  grayScale?: boolean
  enforceOutline?: boolean
  boundaryBoxes?: boolean
  title?: string
}

const ASSETS_DIR = path.resolve(__dirname, '..', 'assets')

export function isGhostscriptAvailable() {
  return (
    (process.platform === 'win32' &&
      (shell.which('gswin64c') || shell.which('gswin32c'))) ||
    shell.which('gs')
  )
}

export async function ghostScript({
  inputPath,
  outputPath,
  pdfxDefTemplatePath = path.join(ASSETS_DIR, 'PDFX_def.ps.mustache'),
  sourceIccProfilePath = path.join(ASSETS_DIR, 'JapanColor2001Coated.icc'),
  grayScale = false,
  enforceOutline = false,
  boundaryBoxes = false,
  title = 'Auto-generated PDF (press-ready)',
}: GhostscriptOption) {
  const workingDir = tmpdir()
  const id = uuid()

  // ICC profile
  const iccProfilePath = join(workingDir, `press-ready-${id}.icc`)
  fs.copyFileSync(sourceIccProfilePath, iccProfilePath)

  // PDFXDef
  const pdfxDefPath = join(workingDir, `press-ready-${id}.ps`)
  const pdfxDefTemplateString = fs.readFileSync(pdfxDefTemplatePath, 'utf-8')
  const pdfxDef = Mustache.render(pdfxDefTemplateString, {
    title,
    iccProfilePath,
  })
  fs.writeFileSync(pdfxDefPath, pdfxDef, 'utf-8')

  // configure gs command
  const gsCommand = (process.platform === 'win32' &&
    ((shell.which('gswin64c') && 'gswin64c') ||
      (shell.which('gswin32c') && 'gswin32c'))) ||
    'gs'
  const gsOptions = [
    '-dPDFX',
    '-dBATCH',
    '-dNOPAUSE',
    '-dNOOUTERSAVE',
    '-sDEVICE=pdfwrite',
    '-dPDFSTOPONERROR',
    '-dShowAnnots=false',
    '-dPDFSETTINGS=/prepress',
    '-dPrinted',
    '-r300',
    '-dDownsampleColorImages=true',
    '-dDownsampleGrayImages=true',
    '-dDownsampleMonoImages=true',
    '-dColorImageResolution=300',
    '-dGrayImageResolution=300',
    '-dMonoImageResolution=300',
    `-sOutputFile=${outputPath}`,
    '-dNOSAFER',
    '-dAlignToPixels=0',
  ]
  if (boundaryBoxes) {
    gsOptions.push('-dUseCropBox', '-dUseTrimBox', '-dUseBleedBox')
  }
  if (enforceOutline) {
    gsOptions.push('-dNoOutputFonts')
  }
  if (grayScale) {
    gsOptions.push(
      '-sProcessColorModel=DeviceGray',
      '-sColorConversionStrategy=Gray',
      '-sColorConversionStrategyForImages=Gray',
    )
  } else {
    gsOptions.push(
      '-sProcessColorModel=DeviceCMYK',
      '-sColorConversionStrategy=CMYK',
      '-sColorConversionStrategyForImages=CMYK',
      '-dOverrideICC',
      `-sOutputICCProfile=${iccProfilePath}`,
    )
  }

  const args = [...gsOptions, pdfxDefPath, inputPath]
  const command: [string, string[]] = [gsCommand, args]

  debug(gsCommand, args.join(' '))

  // Try to get total page count via pdfinfo (from poppler, same as pdffonts)
  let totalPages = 0
  try {
    const { stdout: pdfinfoOut } = await execa('pdfinfo', [inputPath])
    const m = pdfinfoOut.match(/Pages:\s*(\d+)/i)
    if (m) totalPages = parseInt(m[1], 10)
  } catch {
    // pdfinfo not available; we'll parse total from GS output during streaming
  }

  try {
    // generate pdf with ghostscript, streaming stderr for progress
    const child = spawn(gsCommand, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let currentPage = 0

    // Parse stderr line-by-line for page progress
    const rl = createInterface({ input: child.stderr! })
    rl.on('line', (line: string) => {
      stderr += line + '\n'

      // "Processing pages 1 through N." — capture total if we don't have it yet
      if (!totalPages) {
        const totalMatch = line.match(/Processing pages \d+ through (\d+)/)
        if (totalMatch) totalPages = parseInt(totalMatch[1], 10)
      }

      // "Page N" — update current page and emit progress
      const pageMatch = line.trim().match(/^Page\s+(\d+)$/)
      if (pageMatch) {
        currentPage = parseInt(pageMatch[1], 10)
        if (totalPages > 0) {
          process.stderr.write(
            `\rPress-ready: processing page ${currentPage}/${totalPages}`,
          )
        } else {
          process.stderr.write(`\rPress-ready: processing page ${currentPage}`)
        }
      }
    })

    child.stdout!.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    await new Promise<void>((resolve) => {
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })

    // Clear progress line
    if (currentPage > 0) process.stderr.write('\n')

    return {
      command: [gsCommand, args] as [string, string[]],
      rawOutput: stdout,
      rawError: stderr,
    }
  } catch (err) {
    return {
      command: [gsCommand, args] as [string, string[]],
      rawOutput: '',
      rawError: err.message || String(err),
    }
  } finally {
    fs.unlinkSync(iccProfilePath)
    fs.unlinkSync(pdfxDefPath)
  }
}
