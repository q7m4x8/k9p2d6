'use strict'
const fs = require('node:fs')
const path = require('node:path')
const repo = path.resolve(__dirname, '..')
global.QuizText = require('../text-format.js')
global.QuizReferenceReviews = require('../reference-reviews.js')
const formatter = require('../explanation-format.js')
const bank = JSON.parse(fs.readFileSync(path.join(repo, 'data/questions.json'), 'utf8'))
const directory = path.resolve(process.argv[2] || path.join(repo, 'data/option-review-source'))
const checkPartial = process.argv.includes('--check-partial')
const questions = bank.questions.filter(question => !formatter.format(question))
const expected = new Map(questions.map(question => [question.id, question]))
const normalize = value => global.QuizText.normalize(String(value ?? '')).normalize('NFKC').replace(/\s+/g, '').replace(/[“”"'‘’「」『』]/g, '')
const compact = value => global.QuizText.normalize(value).replace(/\s+/g, '')
const entries = Object.create(null)
let corrections = 0, rules = 0, contextual = 0, incorrect = 0
for (const batch of [1, 2, 3]) {
  const rows = JSON.parse(fs.readFileSync(path.join(directory, `review-${batch}.json`), 'utf8'))
  for (const row of rows) {
    const question = expected.get(row.id)
    if (!question || entries[row.id] || !Array.isArray(row.options)) throw new Error(`Unexpected or invalid option review: ${row.id}`)
    const explanation = global.QuizReferenceReviews.supplements[question.id]?.explanation || question.explanation
    const source = normalize(explanation)
    const labels = new Set()
    for (const option of row.options) {
      const index = 'ABCD'.indexOf(option.label)
      if (!/^[ABCD]$/.test(option.label) || index < 0 || index >= question.options.length || labels.has(option.label) || !['correct', 'incorrect', 'contextual'].includes(option.verdict)) throw new Error(`Invalid option: ${row.id}:${option.label}`)
      labels.add(option.label)
      const original = compact(question.options[index])
      const used = []
      const location = (text, occurrence) => {
        const needle = compact(text)
        let start = original.indexOf(needle)
        if (Number.isInteger(occurrence) && occurrence >= 0) for (let i = 0; i < occurrence && start >= 0; i++) start = original.indexOf(needle, start + needle.length)
        else if (start >= 0 && original.indexOf(needle, start + needle.length) >= 0) throw new Error(`Ambiguous location: ${row.id}:${option.label} ${text}`)
        if (!needle || start < 0 || used.some(range => start < range.end && start + needle.length > range.start)) throw new Error(`Missing/overlapping span: ${row.id}:${option.label} ${text}`)
        used.push({start, end:start + needle.length})
      }
      for (const pair of option.pairs || []) {
        if (option.verdict !== 'incorrect') throw new Error(`A true/contextual option cannot be crossed out: ${row.id}:${option.label}`)
        location(pair.wrong, pair.occurrence)
        if (!pair.correct || normalize(pair.wrong) === normalize(pair.correct) || !pair.evidence || !source.includes(normalize(pair.evidence)) || !normalize(pair.evidence).includes(normalize(pair.correct))) throw new Error(`Correction lacks exact source evidence: ${row.id}:${option.label} ${pair.correct}`)
        corrections++
      }
      for (const focus of option.focus || []) {
        if (focus.wrong && option.verdict !== 'incorrect') throw new Error(`Contextual truth cannot be crossed out: ${row.id}:${option.label}`)
        location(focus.text, focus.occurrence)
        if (!focus.evidence || !source.includes(normalize(focus.evidence))) throw new Error(`Focus lacks source evidence: ${row.id}:${option.label}`)
      }
      if (option.rule) {
        if (!option.rule.correct || !source.includes(normalize(option.rule.evidence)) || !normalize(option.rule.evidence).includes(normalize(option.rule.correct))) throw new Error(`Rule lacks source evidence: ${row.id}:${option.label}`)
        rules++
      }
      if (option.verdict !== 'correct' && !(option.pairs?.length || option.rule || option.reason)) throw new Error(`Option has no explanation: ${row.id}:${option.label}`)
      if (option.verdict === 'contextual') contextual++
      if (option.verdict === 'incorrect') incorrect++
    }
    entries[row.id] = {...row,expectedStem:question.stem,expectedOptions:question.options,expectedExplanation:question.explanation,expectedEffectiveExplanation:explanation,expectedAnswerLetter:question.answerLetter}
  }
}
const missing = questions.filter(question => !entries[question.id]).map(question => question.id)
if (missing.length && !checkPartial) throw new Error(`Unreviewed questions: ${missing.join(', ')}`)
if (checkPartial) { console.log(JSON.stringify({validated:Object.keys(entries).length,remaining:missing.length,corrections,rules,contextual,incorrect},null,2)); process.exit(0) }
const summary = {version:'20261122-4',questionCount:questions.length,reviewedQuestionCount:Object.keys(entries).length,incorrectOptions:incorrect,contextualOptions:contextual,inlineCorrections:corrections,fullRuleCorrections:rules,complete:true}
const payload = {...summary,entries}
fs.writeFileSync(path.join(repo, 'option-reviews.js'), `/* Source-reviewed ordinary-option annotations. Generated by scripts/build-option-reviews.cjs. */\n(function(root,data){if(typeof module==='object'&&module.exports)module.exports=data;if(root)root.QuizOptionReviews=data;})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,${JSON.stringify(payload)});\n`)
fs.writeFileSync(path.join(repo, 'data/option-review-summary.json'), JSON.stringify(summary,null,2)+'\n')
console.log(JSON.stringify(summary,null,2))
