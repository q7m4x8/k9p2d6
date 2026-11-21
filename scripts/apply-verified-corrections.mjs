import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bankPath = path.join(root, 'data/questions.json')
const corrections = JSON.parse(fs.readFileSync(path.join(root, 'data/verified-corrections.json'), 'utf8'))
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'))
const originalCount = bank.questions.length
const questions = new Map(bank.questions.map(q => [q.id, q]))
let fields = 0
for (const correction of corrections.questions) {
  const q = questions.get(correction.id)
  assert(q, `Unknown corrected question ${correction.id}`)
  for (const [field, value] of Object.entries(correction.after)) {
    assert(['stem', 'options', 'explanation'].includes(field), `Unexpected correction field ${field}`)
    if (JSON.stringify(q[field]) === JSON.stringify(value)) continue
    assert.deepEqual(q[field], correction.before[field], `${q.id}.${field} changed since source comparison`)
    q[field] = value
    fields++
  }
}
assert.equal(bank.questions.length, originalCount)
fs.writeFileSync(bankPath, JSON.stringify(bank))
console.log(JSON.stringify({ questionsInBank: originalCount, correctedFields: fields, records: corrections.questions.length }))
