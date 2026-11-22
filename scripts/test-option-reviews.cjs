'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
global.QuizText = require('../text-format.js')
global.QuizReferenceReviews = require('../reference-reviews.js')
global.QuizOptionReviews = require('../option-reviews.js')
const formatter = require('../explanation-format.js')
const bytes = fs.readFileSync(path.join(repo,'data/questions.json'))
const bank = JSON.parse(bytes)
const before = JSON.stringify(bank)
let reviewed = 0, pairs = 0, rules = 0
for (const question of bank.questions) {
  if (formatter.format(question)) { assert.equal(formatter.formatOptions(question),null); continue }
  const result = formatter.formatOptions(question)
  assert(result, `${question.id}: all ordinary-option questions must load reviewed annotations`)
  reviewed++
  const review = global.QuizOptionReviews.entries[question.id]
  assert.deepEqual(result.items.map(item=>item.label),review.options.filter(item=>item.verdict!=='correct').map(item=>item.label))
  for (const item of result.items) {
    assert.notEqual(item.verdict,'correct',`${question.id}: true options do not repeat in the reference`)
    assert.equal(item.segments.map(segment=>segment.type==='correction'?segment.wrong:segment.text).join(''),item.text)
    const source = review.options.find(option=>option.label===item.label)
    const edits = item.segments.filter(segment=>segment.type==='correction')
    assert.equal(edits.length,(source.pairs||[]).length,`${question.id}:${item.label}: no corrections silently dropped`)
    if (source.verdict==='contextual') assert.equal(edits.length,0,'Off-topic truth must not be crossed out')
    pairs+=edits.length
    if (source.rule) {assert.equal(item.correctedRule,source.rule.correct);rules++}
  }
  assert.equal(formatter.formatOptions({...question,explanation:question.explanation+'来源变更'}),null,'Changed sources fail closed')
  assert.equal(formatter.formatOptions({...question,options:[...question.options,'新选项']}),null,'Changed choices fail closed')
}
assert.equal(reviewed,407)
assert.equal(pairs,global.QuizOptionReviews.inlineCorrections)
assert.equal(rules,global.QuizOptionReviews.fullRuleCorrections)
const example=formatter.formatOptions(bank.questions.find(question=>question.id==='xh-special-010'))
assert.deepEqual(example.items.map(item=>item.label),['A','B','D'])
assert(example.items.every(item=>item.segments.some(segment=>segment.type==='correction')||item.correctedRule))
assert.equal(JSON.stringify(bank),before)
assert.deepEqual(fs.readFileSync(path.join(repo,'data/questions.json')),bytes)
console.log(JSON.stringify({reviewed,pairs,rules,canonicalBankUnchanged:true},null,2))
console.log('PASS all ordinary-option references, exact spans, evidence guards and contextual safety')
