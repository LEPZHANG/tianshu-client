// Fail loudly when the sibling Harness checkout this build depends on is
// absent or unbuilt.
//
// `@deepseek-ai/dsh` and `@deepseek-ai/dsh-web-frontend` resolve through
// `file:../apps/cli` and `file:../apps/web`. npm creates those symlinks
// whether or not the targets exist and exits 0, so a checkout of this project
// ALONE installs cleanly, packages cleanly, and produces an application whose
// Harness entry point is a dangling link. Nothing before this script noticed.
//
// Run from `postinstall` and again from `build`, because the two failure
// modes differ: a missing checkout breaks at install, while a checkout that
// exists but was never built breaks only when packaging copies an empty
// `dist/`.

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const harnessRoot = resolve(projectRoot, '..')

/** The two `file:` referents, with the artifact each must carry to be usable. */
const REQUIRED = [
  {
    reference: '@deepseek-ai/dsh',
    directory: join(harnessRoot, 'apps', 'cli'),
    artifact: join(harnessRoot, 'apps', 'cli', 'lib', 'bin.js'),
    missingArtifactHint: 'the Harness CLI is not built',
  },
  {
    reference: '@deepseek-ai/dsh-web-frontend',
    directory: join(harnessRoot, 'apps', 'web'),
    artifact: join(harnessRoot, 'apps', 'web', 'dist', 'index.html'),
    missingArtifactHint: 'the web client is not built',
  },
]

const absent = REQUIRED.filter((entry) => !existsSync(entry.directory))
const unbuilt = REQUIRED.filter(
  (entry) => existsSync(entry.directory) && !existsSync(entry.artifact)
)

if (absent.length === 0 && unbuilt.length === 0) {
  console.log(`verify-harness-checkout: sibling Harness checkout is present and built (${harnessRoot})`)
  process.exit(0)
}

console.error('verify-harness-checkout: this build needs a built Harness checkout beside it.\n')

if (absent.length > 0) {
  console.error(`  Missing directory (expected beside this project, at ${harnessRoot}):`)
  for (const entry of absent) {
    console.error(`    ${entry.directory}   <- ${entry.reference}`)
  }
  console.error(
    '\n  A checkout of this project alone is not enough: npm links these paths\n'
    + '  without checking them, so the install "succeeds" and the packaged\n'
    + '  application ends up with a dangling Harness entry point.\n'
    + '\n  Check the Harness repository out as a SIBLING of this directory, so\n'
    + '  that ../apps/cli and ../apps/web resolve, then build it.\n'
  )
}

if (unbuilt.length > 0) {
  console.error('  Present but unbuilt:')
  for (const entry of unbuilt) {
    console.error(`    ${entry.directory}   (${entry.missingArtifactHint}: ${entry.artifact} is missing)`)
  }
  console.error('\n  Run `pnpm install && pnpm run build` in the Harness checkout first.\n')
}

process.exit(1)
