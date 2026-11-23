'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
global.QuizText = require('../text-format.js')
global.QuizReferenceReviews = require('../reference-reviews.js')
global.QuizOptionReviews = require('../option-reviews.js')
const formatter = require('../explanation-format.js')
const bytes = fs.readFileSync(path.join(__dirname, '../data/questions.json'))
const bank = JSON.parse(bytes)
const audit = require('../data/reference-review-source/audit-20261123.json')
const compact = text => String(text || '').replace(/\s+/g, '')
const byId = new Map(bank.questions.map(q => [q.id,q]))
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), '3d6c5a303810092b5f284d0c57dec487ac553de528777bec53d0fd4dc0240869')
assert.equal(audit.decisions.length, 535)
for (const row of audit.decisions) {
  const question = byId.get(row.qid)
  assert(compact(question.explanation).includes(compact(row.evidence)), `${row.qid}:${row.label}: audit evidence belongs to the actual source`)
  const item = formatter.format(question).items.find(item => item.label === row.label)
  assert.equal(item.verdict, row.verdict, `${row.qid}:${row.label}: independently reviewed source verdict must render`)
  if (row.contextual) {
    assert.equal(item.contextual, true, `${row.qid}:${row.label}: context exclusions must be distinguished from factual errors`)
    assert.equal(item.reason, row.reason, `${row.qid}:${row.label}: specific contextual explanation must be visible`)
  }
}
let numbered=0, statements=0, contextual=0, incorrect=0, sourceErrorLabels=0, ordinary=0, conclusions=0
for (const question of bank.questions) {
  assert.equal(question.answerLetter, 'ABCD'[question.answer], `${question.id}: grading index and letter agree`)
  const conclusion = question.explanation.match(/(?:故|因此|所以)(?:本题)?(?:正确)?(?:答案为|选)\s*([A-D])/)
  if (conclusion) { assert.equal(conclusion[1], question.answerLetter, `${question.id}: original answer conclusion agrees`); conclusions++ }
  const result = formatter.format(question)
  if (!result) { assert(formatter.formatOptions(question), `${question.id}: ordinary options render`); ordinary++; continue }
  numbered++; statements += result.items.length
  for (const item of result.items) {
    if (item.verdict === 'unknown') {
      assert(item.contextual && item.reason, `${question.id}:${item.label}: no unexplained neutral rows may hide missed errors`)
      contextual++
    }
    if (item.verdict === 'incorrect') {
      assert(item.reason || item.correctedRule || item.segments.some(segment=>segment.type==='correction'), `${question.id}:${item.label}: factual error needs a correction or a source explanation`)
      incorrect++
    }
  }
  // Independently scan the literal source, without the formatter's quote/boundary
  // parser. A source's explicit error label may only stay neutral when a guarded
  // human review supplies a concrete contextual reason. This catches the reported
  // mixed-quote and OCR-boundary omission instead of deriving coverage from itself.
  for (const match of result.sourceExplanation.matchAll(/([①-⑳](?:[、，,和及与]?[①-⑳])*)\s*(?:项)?\s*(?:(?:的)?(?:说法|表述|判断))?\s*(?:均|都)?\s*(?:错误|不正确)/g)) {
    for (const label of [...match[1]].filter(label=>/[①-⑳]/.test(label))) {
      const item = result.items.find(item=>item.label===label)
      if (!item) continue
      assert(item.verdict === 'incorrect' || (item.contextual && item.reason), `${question.id}:${label}: explicit source error was silently omitted`)
      sourceErrorLabels++
    }
  }
  const counts = question.options.map(option=>compact(option).match(/^([0-9]+)项$/)?.[1])
  const introduction = compact(question.stem.split('①')[0])
  if (counts.every(Boolean) && /几项/.test(introduction)) {
    const negative = /(?:不正确|错误|不准确|不属于|不包括|不符合|未体现|不体现)/.test(introduction)
    const matching = result.items.filter(item=>negative ? item.verdict === 'incorrect' || item.contextual : item.verdict === 'correct').length
    assert.equal(matching, Number(counts[question.answer]), `${question.id}: all item judgments must agree with the count in the answer key`)
  }
}
assert.equal(numbered,693);assert.equal(statements,3002);assert.equal(ordinary,407)
for (const [id,label,wrong,correct] of [
  ['xh-special-029','④','全民守法','公正司法'],
  ['xh-special-136','③','同源文明','多样文明'],
  ['xh-special-136','③','同质文化','多元文化'],
  ['xh-special-158','①','加强师德师风建设','立德树人']
]) {
  const item=formatter.format(byId.get(id)).items.find(item=>item.label===label)
  assert.equal(item.verdict,'incorrect')
  assert(item.segments.some(segment=>segment.wrong===wrong&&segment.correct===correct),`${id}:${label}: verified source correction must appear`)
}
const sourceOnly=formatter.format(byId.get('xh-500-158')).items[1]
assert.equal(sourceOnly.verdict,'incorrect')
assert(sourceOnly.segments.some(segment=>segment.type==='wrong-focus'&&segment.text==='创造理想世界'))
assert(!sourceOnly.segments.some(segment=>segment.type==='correction'),'Do not invent a replacement absent from the source')
const guarded = byId.get('xh-500-100')
const changedOptions = {...guarded,options:['①②','①③','①④','②③']}
assert.equal(formatter.format(changedOptions).items[3].verdict,'unknown','Changed combination options must invalidate answer-supported reviewed judgments and supplemental verdicts')
const changedAnswer = {...guarded,answer:0,answerLetter:'A'}
assert.equal(formatter.format(changedAnswer).items[3].verdict,'unknown','Changed answer keys must invalidate the reviewed positive completion')
console.log(JSON.stringify({questions:bank.questions.length,numbered,statements,ordinary,incorrect,contextual,sourceErrorLabels,conclusions,reviewedDecisions:audit.decisions.length,canonicalBankUnchanged:true},null,2))
console.log('PASS all source verdicts, answer counts, reviewed contextual explanations and reported omissions')
