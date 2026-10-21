import { UsageError } from './errors.mjs'

const PRESETS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
]
const MIN_SIZE = 100
const MAX_SIZE = 4000
const MAX_VIEWPORTS = 6
const SIZE = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/
const CHOICES = `${PRESETS.map((preset) => preset.name).join(', ')} or WIDTHxHEIGHT (${MIN_SIZE} to ${MAX_SIZE})`

function parseOne(text) {
  const preset = PRESETS.find((candidate) => candidate.name === text)
  if (preset !== undefined) return preset
  const match = SIZE.exec(text)
  const width = Number(match?.[1])
  const height = Number(match?.[2])
  if (match === null || width < MIN_SIZE || width > MAX_SIZE || height < MIN_SIZE || height > MAX_SIZE) {
    throw new UsageError(`--viewports takes ${CHOICES}, separated by commas`)
  }
  return { name: text, width, height }
}

/**
 * The sizes to look at: `mobile,tablet,desktop` for a plain run, desktop alone for a run with steps (they run once, so
 * several sizes would run them again for each), or what `--viewports` lists.
 */
export function parseViewports(text, { hasSteps }) {
  if (text === undefined) return hasSteps ? [PRESETS[2]] : PRESETS
  const viewports = []
  for (const part of text.split(',')) {
    const viewport = parseOne(part)
    if (!viewports.some((known) => known.name === viewport.name)) viewports.push(viewport)
  }
  if (viewports.length > MAX_VIEWPORTS) throw new UsageError(`--viewports takes at most ${MAX_VIEWPORTS} sizes`)
  if (hasSteps && viewports.length > 1) throw new UsageError('--steps runs once, so it takes one viewport: look at the other sizes in a separate run without --steps')
  return viewports
}
