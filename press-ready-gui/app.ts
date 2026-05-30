import {
    App,
    VStack,
    HStack,
    Text,
    Button,
    Toggle,
    Picker,
    TextArea,
    ProgressView,
    State,
    Divider,
    Spacer,
    openFileDialog,
    saveFileDialog,
    alert,
    pickerAddItem,
    widgetSetHidden,
    widgetMatchParentHeight,
    textareaSetString,
    textSetString,
    textSetFontSize,
    textSetFontFamily,
    textSetColor,
    setPadding,
    appSetMinSize,
    appSetMaxSize,
} from "perry/ui"
import { spawn, execSync } from "child_process"
import { writeFileSync, unlinkSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join, resolve, dirname, basename, extname } from "path"
import { v4 as uuid } from "uuid"
import { ICC_PROFILE_BASE64 } from "./icc"

const PDFX_DEF_TEMPLATE = `systemdict /ProcessColorModel known {
  systemdict /ProcessColorModel get dup /DeviceGray ne exch /DeviceCMYK ne and
} {
  true
} ifelse
{ (ERROR: ProcessColorModel must be /DeviceGray or DeviceCMYK.)=
  /ProcessColorModel cvx /rangecheck signalerror
} if
/ICCProfile ({{{iccProfilePath}}}) def
[ /GTS_PDFXVersion (PDF/X-1:2001)
  /GTS_PDFXConformance (PDF/X-1a:2001)
  /Title ({{{title}}})
  /Trapped /False
  /DOCINFO pdfmark
currentdict /ICCProfile known {
  [/_objdef {icc_PDFX} /type /stream /OBJ pdfmark
  [{icc_PDFX} <</N systemdict /ProcessColorModel get /DeviceGray eq {1} {4} ifelse >> /PUT pdfmark
  [{icc_PDFX} ICCProfile (r) file /PUT pdfmark
} if
[/_objdef {OutputIntent_PDFX} /type /dict /OBJ pdfmark
[{OutputIntent_PDFX} <<
  /Type /OutputIntent
  /S /GTS_PDFX
  /OutputCondition (Commercial and specialty printing)
  /Info (test)
  /OutputConditionIdentifier (U001)
  /RegistryName (http://www.color.org)
  currentdict /ICCProfile known {
    /DestOutputProfile {icc_PDFX}
  } if
>> /PUT pdfmark
[{Catalog} <</OutputIntents [ {OutputIntent_PDFX} ]>> /PUT pdfmark`

// ── Utilities ──

function isGsAvailable(): boolean {
    try { execSync("gs --version", { timeout: 5000 }); return true }
    catch { return false }
}

function isPdffontsAvailable(): boolean {
    try { execSync("which pdffonts", { timeout: 5000 }); return true }
    catch { return false }
}

interface FontRow { name: string; type: string; emb: string; sub: string }

function parsePdffonts(filePath: string): FontRow[] {
    try {
        const out = execSync(`pdffonts "${filePath}"`, { timeout: 15000 }).toString()
        const lines = out.split("\n")
        if (!/^name/.test(lines[0]) || lines.length < 3) return []
        const cols = lines[0].split(/\s+/)
        const acc: number[] = []
        lines[1].split(" ").forEach((h) => {
            const prev = acc.length > 0 ? acc[acc.length - 1] : 0
            acc.push(h.length + prev + 1)
        })
        const maxLen = lines[0].length
        return lines.slice(2).filter((l) => l.trim().length > 0).map((line) => {
            const extra = line.length > maxLen ? line.indexOf(" ") - acc[0] : 0
            const font: any = {}
            for (const c of cols) {
                const start = cols.indexOf(c) > 0 ? acc[cols.indexOf(c) - 1] + extra : 0
                font[c] = line.substring(start, acc[cols.indexOf(c)] + extra).trim()
            }
            return font as FontRow
        })
    } catch { return [] }
}

function writeIccFile(iccPath: string) {
    writeFileSync(iccPath, Buffer.from(ICC_PROFILE_BASE64, "base64"))
}

function buildGsArgs(outputPath: string, grayScale: boolean, enforceOutline: boolean, boundaryBoxes: boolean, iccPath: string, pdfxDefPath: string, inputPath: string): string[] {
    const a = [
        "-dPDFX", "-dBATCH", "-dNOPAUSE", "-dNOOUTERSAVE",
        "-sDEVICE=pdfwrite", "-dPDFSTOPONERROR",
        "-dShowAnnots=false", "-dPDFSETTINGS=/prepress", "-dPrinted",
        "-r600", "-dGrayImageResolution=600", "-dMonoImageResolution=600", "-dColorImageResolution=600",
        `-sOutputFile=${outputPath}`, "-dNOSAFER",
    ]
    if (boundaryBoxes) a.push("-dUseCropBox", "-dUseTrimBox", "-dUseBleedBox")
    if (enforceOutline) a.push("-dNoOutputFonts")
    if (grayScale) {
        a.push("-sProcessColorModel=DeviceGray", "-sColorConversionStrategy=Gray", "-sColorConversionStrategyForImages=Gray")
    } else {
        a.push("-sProcessColorModel=DeviceCMYK", "-sColorConversionStrategy=CMYK", "-sColorConversionStrategyForImages=CMYK", "-dOverrideICC", `-sOutputICCProfile=${iccPath}`)
    }
    a.push(pdfxDefPath, inputPath)
    return a
}

// ── Log state ──
const logLines = State<string[]>([])
const logArea = TextArea("", (_: string) => {})
widgetMatchParentHeight(logArea)

function log(...lines: string[]) {
    const cur = logLines.value.slice()
    for (const l of lines) cur.push(l)
    logLines.set(cur)
    textareaSetString(logArea, cur.join("\n"))
}

function runGs(args: string[]): Promise<{ exitCode: number | null; stderr: string }> {
    return new Promise((resolve) => {
        const errChunks: string[] = []
        const child = spawn("gs", args)
        child.stdout?.on("data", (d: Buffer) => {
            for (const l of d.toString().split("\n").filter((x) => x.trim())) log(`  ${l}`)
        })
        child.stderr?.on("data", (d: Buffer) => {
            const s = d.toString()
            errChunks.push(s)
            for (const l of s.split("\n").filter((x) => x.trim())) log(`  ${l}`)
        })
        child.on("close", (code) => resolve({ exitCode: code, stderr: errChunks.join("") }))
        child.on("error", (e: Error) => resolve({ exitCode: -1, stderr: e.message }))
    })
}

// ── Widgets ──

const heading = Text("press-ready build")
textSetFontSize(heading, 22)
textSetFontFamily(heading, "Menlo")

const gsOk = isGsAvailable()
const pfOk = isPdffontsAvailable()
const depCheck = Text(`${gsOk ? "✓" : "✗"} Ghostscript  |  ${pfOk ? "✓" : "✗"} pdffonts`)
textSetColor(depCheck, gsOk && pfOk ? 0.0 : 1.0, gsOk ? 0.5 : 0.0, 0.0, 1.0)
textSetFontSize(depCheck, 11)

const inputLabel = Text("Input PDF:")
const inputPathLabel = Text("(no file selected)")
textSetColor(inputPathLabel, 0.5, 0.5, 0.5, 1.0)

const outputLabel = Text("Output PDF:")
const outputPathLabel = Text("output.pdf")
textSetColor(outputPathLabel, 0.5, 0.5, 0.5, 1.0)

const statusLabel = Text("Status: Ready")
textSetColor(statusLabel, 0.4, 0.4, 0.4, 1.0)

const grayToggle = Toggle("Gray-scale", (on: boolean) => grayScale.set(on))
const boundaryToggle = Toggle("Boundary boxes", (on: boolean) => boundaryBoxes.set(on))

const outlinePicker = Picker((i: number) => outlineMode.set(i))
pickerAddItem(outlinePicker, "Enforce outline: Auto")
pickerAddItem(outlinePicker, "Enforce outline: Yes")
pickerAddItem(outlinePicker, "Enforce outline: No")

const progress = ProgressView()
widgetSetHidden(progress, true)

async function startBuild() {
    if (inputPath.value.length === 0) {
        alert("No input", "Please select an input PDF file.")
        return
    }
    if (!isGsAvailable()) {
        alert("Ghostscript not found", "Install it:\n  macOS: brew install ghostscript\n  Linux: apt-get install ghostscript")
        return
    }

    textareaSetString(logArea, "")
    logLines.set([])
    textSetString(statusLabel, "Status: Building...")
    widgetSetHidden(progress, false)

    log("==> press-ready build started")
    log(`==> Input: ${inputPath.value}`)
    log(`==> Output: ${outputPath.value}`)

    // Inspect fonts
    log("==> Listing fonts in input PDF...")
    const fonts = parsePdffonts(inputPath.value)
    if (fonts.length > 0) {
        log("  name\ttype\tembedded\tsubset")
        for (const f of fonts) log(`  ${f.name}\t${f.type}\t${f.emb}\t${f.sub}`)
    } else {
        log("  (no fonts found)")
    }

    const hasType3 = fonts.some((f) => f.type === "Type 3")
    let enforceOutline: boolean
    if (outlineMode.value === 0) {
        enforceOutline = hasType3
        log(`==> Auto-detect: ${hasType3 ? "will outline fonts (Type 3 found)" : "no outline needed"}`)
    } else {
        enforceOutline = outlineMode.value === 1
        log(`==> Enforce outline: ${enforceOutline ? "Yes" : "No"} (user override)`)
    }

    log("==> Generating PDF...")
    log(`  Input:           ${basename(inputPath.value)}`)
    log(`  Output:          ${basename(outputPath.value || "output.pdf")}`)
    log(`  Color Mode:      ${grayScale.value ? "Gray" : "CMYK"}`)
    log(`  Enforce outline: ${enforceOutline ? "yes" : "no"}`)
    log(`  Boundary boxes:  ${boundaryBoxes.value ? "yes" : "no"}`)

    const workDir = tmpdir()
    const id = uuid()
    const iccPath = join(workDir, `press-ready-${id}.icc`)
    const psPath = join(workDir, `press-ready-${id}.ps`)

    let gsExitCode: number | null = null

    try {
        log("==> Writing ICC profile...")
        writeIccFile(iccPath)

        log("==> Writing PDF/X definition...")
        const ps = PDFX_DEF_TEMPLATE
            .replace("{{{iccProfilePath}}}", iccPath)
            .replace("{{{title}}}", "Auto-generated PDF (press-ready)")
        writeFileSync(psPath, ps, "utf-8")

        log("==> Running Ghostscript...")
        const gsArgs = buildGsArgs(
            resolve(outputPath.value || "output.pdf"),
            grayScale.value, enforceOutline, boundaryBoxes.value,
            iccPath, psPath, resolve(inputPath.value),
        )
        log(`  gs ${gsArgs.join(" ")}`)

        const result = await runGs(gsArgs)
        gsExitCode = result.exitCode
        log(`==> Ghostscript: exit code ${result.exitCode}`)

        if (result.exitCode === 0) {
            const outFile = resolve(outputPath.value || "output.pdf")
            if (existsSync(outFile)) {
                log("==> Listing fonts in output PDF...")
                const outFonts = parsePdffonts(outFile)
                if (outFonts.length > 0) {
                    log("  name\ttype\tembedded\tsubset")
                    for (const f of outFonts) log(`  ${f.name}\t${f.type}\t${f.emb}\t${f.sub}`)
                }
                log("==> Build complete ✓")
            }
        }
        if (result.stderr.length > 0 && result.exitCode !== 0) {
            log("==> stderr:")
            for (const l of result.stderr.split("\n").filter((x) => x.trim())) log(`  ${l}`)
        }
    } catch (err: any) {
        log(`==> Error: ${err.message || err}`)
    } finally {
        try { unlinkSync(iccPath) } catch {}
        try { unlinkSync(psPath) } catch {}
    }

    widgetSetHidden(progress, true)
    textSetString(statusLabel, gsExitCode === 0 ? "Status: Complete ✓" : "Status: Error (see log)")
}

function pickInput() {
    openFileDialog((path: string) => {
        if (path.length === 0) return
        inputPath.set(path)
        textSetString(inputPathLabel, path)
        textSetColor(inputPathLabel, 0.0, 0.0, 0.0, 1.0)
        if (outputPath.value.length === 0 || outputPath.value === "output.pdf") {
            const dir = dirname(path)
            const name = basename(path, extname(path))
            const out = join(dir, `${name}-print-ready.pdf`)
            outputPath.set(out)
            textSetString(outputPathLabel, out)
            textSetColor(outputPathLabel, 0.0, 0.0, 0.0, 1.0)
        }
    })
}

function pickOutput() {
    saveFileDialog((path: string) => {
        if (path.length === 0) return
        outputPath.set(path)
        textSetString(outputPathLabel, path)
        textSetColor(outputPathLabel, 0.0, 0.0, 0.0, 1.0)
    }, "output", "pdf")
}

appSetMinSize(600, 500)
appSetMaxSize(1200, 1000)

App({
    title: "press-ready build",
    width: 760,
    height: 640,
    body: (() => {
        const root = VStack(16, [
            heading,
            depCheck,
            Divider(),

            HStack(8, [inputLabel, inputPathLabel, Spacer(), Button("Browse Input...", () => pickInput())]),
            HStack(8, [outputLabel, outputPathLabel, Spacer(), Button("Browse Output...", () => pickOutput())]),

            Divider(),
            grayToggle,
            outlinePicker,
            boundaryToggle,

            Divider(),
            statusLabel,
            Button("Start Build", () => startBuild()),

            Divider(),
            Text("Build Log"),
            logArea,
            progress,
        ])
        setPadding(root, 16, 16, 16, 16)
        return root
    })(),
})
