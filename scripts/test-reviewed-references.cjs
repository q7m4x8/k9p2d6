'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
global.QuizText = require('../text-format.js')
global.QuizReferenceReviews = require('../reference-reviews.js')
const formatter = require('../explanation-format.js')
const bankFile = path.join(__dirname, '../data/questions.json')
const bankBytes = fs.readFileSync(bankFile)
const bank = JSON.parse(bankBytes)
const before = JSON.stringify(bank)
const reviews = global.QuizReferenceReviews
assert.equal(reviews.complete, true)
assert.equal(reviews.reviewedQuestions, 1100)
assert.deepEqual(reviews.unresolvedStatements, [])
assert.deepEqual(reviews.unresolvedQuestions, [])
const seen = new Set()
let numbered = 0, statements = 0, corrections = 0, rules = 0, focuses = 0
for (const question of bank.questions) {
  const result = formatter.format(question)
  if (!result) continue
  numbered++
  const fix = reviews.displayFixes[question.id]
  let stem = question.stem
  if (fix?.expectedStem === stem) for (const [oldText, newText] of fix.replacements) stem = stem.replace(oldText, newText)
  const originals = formatter.extractStatements(stem)
  assert.deepEqual(result.items.map(item => item.text), originals.map(item => item.text), `${question.id}: all source statements retained`)
  for (const item of result.items) {
    statements++
    const key = `${question.id}:${item.label}`
    assert.equal(item.segments.map(segment => segment.type === 'correction' ? segment.wrong : segment.text).join(''), item.text, `${key}: original reconstruction`)
    const review = reviews.entries[key]
    if (!review) continue
    seen.add(key)
    assert.equal(item.manuallyReviewed, true, `${key}: compiled manual evidence must pass the runtime guard`)
    const edits = item.segments.filter(segment => segment.type === 'correction')
    assert.equal(edits.length, review.pairs.length, `${key}: no silently dropped corrections`)
    assert.deepEqual(edits.map(segment => [segment.wrong, segment.correct]), [...review.pairs].sort((a, b) => {
      const locate = pair => { let start = item.text.indexOf(pair.wrong); for (let i = 0; i < (pair.occurrence || 0); i++) start = item.text.indexOf(pair.wrong, start + pair.wrong.length); return start }
      return locate(a) - locate(b)
    }).map(pair => [pair.wrong, pair.correct]), `${key}: every approved replacement renders at its original position`)
    if (review.rule) { assert.equal(item.correctedRule, review.rule.correct); rules++ }
    assert.equal(item.segments.filter(segment => segment.type === 'focus' || segment.type === 'wrong-focus').length, (review.focus || []).length, `${key}: contextual focus preserved`)
    focuses += (review.focus || []).length
    corrections += edits.length
  }
}
assert.equal(numbered, 693)
assert.equal(statements, 3002)
assert.equal(seen.size, Object.keys(reviews.entries).length)
for (const [id, expected] of [
  ['xh-newlaw-074', ['correct', 'incorrect', 'correct', 'correct']],
  ['xh-newlaw-075', ['correct', 'correct', 'incorrect', 'correct']],
  ['xh-newlaw-076', ['incorrect', 'correct', 'correct', 'incorrect']],
  ['cg-147', ['correct', 'correct', 'correct', 'correct', 'correct']],
  ['cg-150', ['correct', 'correct', 'correct', 'correct']],
  ['cg-181', ['correct', 'correct', 'correct', 'correct']],
  ['cg-198', ['correct', 'correct', 'correct', 'correct']]
]) assert.deepEqual(formatter.format(bank.questions.find(q => q.id === id)).items.map(item => item.verdict), expected, `${id}: source reconstruction matches answer key`)
const repeated = formatter.format(bank.questions.find(q => q.id === 'cg-192')).items[3]
assert.equal(repeated.segments.filter(segment => segment.type === 'correction' && segment.correct === '发展中国家').length, 2)
const imageOCR = formatter.format(bank.questions.find(q => q.id === 'xh-mock-056')).items[4]
assert(imageOCR.segments.some(segment => segment.correct === '结伴不结盟'))
const changedSource = { ...bank.questions.find(q => q.id === 'xh-500-092'), explanation: '来源已变更，原有批注不再适用。' }
assert(formatter.format(changedSource).items.every(item => !item.manuallyReviewed), 'Stale source evidence must fail closed')
assert.equal(JSON.stringify(bank), before)
assert.deepEqual(fs.readFileSync(bankFile), bankBytes, 'Canonical stems, choices and answer keys are byte-identical')
assert(!JSON.stringify(reviews).includes('C:\\Users\\'), 'Published annotations must not expose local source paths')
console.log(JSON.stringify({ reviewedQuestions: reviews.reviewedQuestions, numbered, statements, reviewedStatements: seen.size, corrections, rules, focuses, canonicalBankUnchanged: true }, null, 2))
console.log('PASS exhaustive reviewed-reference coverage, evidence guards and source reconstruction')
