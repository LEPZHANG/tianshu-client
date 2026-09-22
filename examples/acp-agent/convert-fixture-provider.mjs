/**
 * Deterministic conversion provider for the `convert-document` snapshot scenario.
 *
 * The seam, the route planner, the `convert_document` tool, its path resolution, its sandbox check,
 * and its rendering all run for real; only the external converter is replaced. A real LibreOffice
 * cannot serve this scenario: its PDF output embeds timestamps and varies with version and platform,
 * so the byte size in the pinned tool result would differ on every machine the fixture replays on.
 *
 * The routes mirror the shipped table's shape closely enough to exercise what the transcript pins: a
 * faithful direct conversion, and a lossy two-step plan reached through an intermediate format.
 *
 * Each output is a real minimal document of its target format, because the seam reads every result back
 * and refuses one that is not — a fixture writing the same placeholder bytes for every format would fail
 * the conversion it is meant to demonstrate.
 */
import { writeFile } from 'node:fs/promises'

/**
 * The bytes written for each target format: a PDF with a page tree and a trailer, a line of text, and a
 * stored (uncompressed) OOXML workbook carrying the part that identifies it. Fixed content, so the size
 * the tool result reports is the same on every machine.
 */
const OUTPUTS = {
  pdf: Buffer.from(
    '%PDF-1.4\n'
    + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n'
    + 'trailer<</Root 1 0 R/Size 4>>\n'
    + 'startxref\n0\n%%EOF\n',
    'latin1',
  ),
  txt: Buffer.from('fixture-converted-document\n', 'utf8'),
  // Base64 rather than built here: a ZIP writer in a fixture would be more code than the archive, and a
  // constant cannot drift between runs.
  xlsx: Buffer.from(
    'UEsDBBQAAAAAAMJ5MV10vYL26QAAAOkAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcn'
    + 'Npb249IjEuMCI/PjxUeXBlcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3Jn'
    + 'L3BhY2thZ2UvMjAwNi9jb250ZW50LXR5cGVzIj48T3ZlcnJpZGUgUGFydE5hbWU9Ii94bC93b3JrYm'
    + '9vay54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNl'
    + 'ZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldC5tYWluK3htbCIvPjwvVHlwZXM+UEsDBBQAAAAAAM'
    + 'J5MV0PSfKynwAAAJ8AAAAPAAAAeGwvd29ya2Jvb2sueG1sPD94bWwgdmVyc2lvbj0iMS4wIj8+PHdv'
    + 'cmtib29rIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvc3ByZWFkc2hlZX'
    + 'RtbC8yMDA2L21haW4iPjxzaGVldHM+PHNoZWV0IG5hbWU9IlNoZWV0MSIgc2hlZXRJZD0iMSIvPjwv'
    + 'c2hlZXRzPjwvd29ya2Jvb2s+UEsBAhQDFAAAAAAAwnkxXXS9gvbpAAAA6QAAABMAAAAAAAAAAAAAAI'
    + 'ABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAAAADCeTFdD0nysp8AAACfAAAADwAAAAAA'
    + 'AAAAAAAAgAEaAQAAeGwvd29ya2Jvb2sueG1sUEsFBgAAAAACAAIAfgAAAOYBAAAAAA==',
    'base64',
  ),
}

/** Cordis plugin name. */
export const name = 'convert-fixture-provider'

/** The conversion seam this provider registers into. */
export const inject = ['documentConvert']

/**
 * Register the fixture provider.
 * @param ctx - Cordis context; the registration disposes with the fiber.
 */
export function apply(ctx) {
  ctx.documentConvert.registerProvider({
    id: 'fixture-converter',
    routes: [
      { from: 'docx', to: 'pdf', fidelity: 'faithful', priority: 10 },
      { from: 'docx', to: 'txt', fidelity: 'lossy', priority: 10 },
      { from: 'pdf', to: 'txt', fidelity: 'lossy', priority: 10 },
      { from: 'txt', to: 'xlsx', fidelity: 'lossy', priority: 10 },
    ],
    available: () => true,
    // A provider reports what its step cost the document and lets the seam check the result. This one
    // declares no caveats, so it reports none rather than an empty sentence.
    convert: async (step) => {
      await writeFile(step.outputPath, OUTPUTS[step.targetFormat])
      return []
    },
  })
}
