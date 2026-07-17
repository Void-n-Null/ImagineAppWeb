/**
 * Vendor Tesseract runtime assets into `public/` from the PINNED installed
 * packages (IMA-39). Runs on `prebuild` (and can be run by hand).
 *
 * Why copy into `public/` instead of Vite `?url` imports (the zxing-wasm
 * doctrine used elsewhere)?  The tesseract core is a two-file Emscripten module:
 * a `.wasm.js` glue that locates its sibling `.wasm` by a URL DERIVED from the
 * glue's own script URL (`new URL('.wasm', scriptName)`). Vite `?url`
 * fingerprints each file to a SEPARATE hashed path, so the glue would look for
 * the wasm at the wrong URL and fail. Copying the files verbatim to a stable,
 * un-fingerprinted `public/tesseract/…` path keeps the sibling resolution
 * intact.
 *
 * Drift protection is preserved a different way: the bytes are copied from
 * `node_modules` at build time, so they can never drift from the installed,
 * lockfile-pinned `tesseract.js` / `tesseract.js-core` versions. The output
 * dirs are gitignored — nothing large lands in the repo.
 *
 * traineddata: vendored from `@tesseract.js-data/eng` (a lockfile-pinned npm
 * package — tesseract.js's own data distribution), NOT from the host OS. The
 * `4.0.0_best_int` model (~2.9 MB gz) is the library's recommended
 * accuracy/size balance and keeps the first-use download cellular-friendly.
 * Copying from node_modules makes the build deterministic on every builder
 * (local Arch, GitHub CI, Vercel) with zero build-time network beyond
 * `bun install` — a /usr/share/tessdata or CDN dependency would produce
 * different models per environment (or 404 in prod).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const coreDir = join(root, 'node_modules', 'tesseract.js-core')
const distDir = join(root, 'node_modules', 'tesseract.js', 'dist')
const trainedData = join(
  root,
  'node_modules',
  '@tesseract.js-data',
  'eng',
  '4.0.0_best_int',
  'eng.traineddata.gz',
)

const outTess = join(root, 'public', 'tesseract')
const outCore = join(outTess, 'core')
const outTessdata = join(root, 'public', 'tessdata')

/** Copy a file verbatim, creating the destination directory as needed. */
function copy(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, readFileSync(from))
}

/**
 * Core variants we might load at runtime. getCore picks one by feature
 * detection (relaxed-SIMD > SIMD > baseline), always the LSTM-only build since
 * we createWorker with OEM.LSTM_ONLY. We vendor the whole matrix so any device
 * resolves locally; each `.wasm.js` needs its sibling `.wasm` beside it.
 */
const CORE_VARIANTS = [
  'tesseract-core-relaxedsimd-lstm',
  'tesseract-core-simd-lstm',
  'tesseract-core-lstm',
]

function main(): void {
  if (!existsSync(coreDir) || !existsSync(distDir) || !existsSync(trainedData)) {
    console.error(
      '[sync-tesseract] tesseract.js / @tesseract.js-data/eng not installed — run `bun install` first.',
    )
    process.exit(1)
  }

  // Worker script.
  copy(join(distDir, 'worker.min.js'), join(outTess, 'worker.min.js'))

  // Core glue + wasm for each variant.
  for (const v of CORE_VARIANTS) {
    copy(join(coreDir, `${v}.wasm.js`), join(outCore, `${v}.wasm.js`))
    copy(join(coreDir, `${v}.wasm`), join(outCore, `${v}.wasm`))
  }

  // traineddata: the lockfile-pinned best_int model, copied verbatim.
  copy(trainedData, join(outTessdata, 'eng.traineddata.gz'))

  console.log(
    '[sync-tesseract] worker + core + eng.traineddata.gz (best_int) vendored to public/',
  )
}

main()
