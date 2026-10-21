// The part of shell-guard that decides. It runs in a process of its own, under hooks/shell-guard.mjs, and prints
// `{ exitCode, stdout }` as JSON. Anything it throws is a block.
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { answerFor, decideRequest, detectTool, requestOf } from '../src/lib/hookio.mjs'

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let text = ''
for await (const chunk of process.stdin) text += chunk
const input = JSON.parse(text)
const tool = detectTool(input)
if (tool === null) throw new Error('not the call of a tool this guard knows')
const decision = decideRequest(tool, requestOf(input, tool), { kitRoot, env: process.env, home: homedir() })
process.stdout.write(JSON.stringify(answerFor(tool, decision)))
