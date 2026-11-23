'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const repo = path.resolve(__dirname, '..')
global.QuizText = require('../text-format.js')
const formatter = require('../explanation-format.js')
const bank = JSON.parse(fs.readFileSync(path.join(repo, 'data/questions.json'), 'utf8'))
const inputDirectory = path.resolve(process.argv.slice(2).find(value => !value.startsWith('--')) || path.join(repo, 'data/reference-review-source'))
const partial = process.argv.includes('--allow-partial')
const compact = value => global.QuizText.normalize(value).replace(/\s+/g, '')
const equivalent = value => compact(String(value).normalize('NFKC')).replace(/[“”"‘’「」『』]/g, '')
const approvalFile = path.join(inputDirectory, 'image-approvals.json')
const imageApprovals = fs.existsSync(approvalFile) ? JSON.parse(fs.readFileSync(approvalFile, 'utf8')) : []
const evidenceFile = file => path.isAbsolute(file) ? file : path.resolve(inputDirectory, file)
const supplementsFile = path.join(inputDirectory, 'source-supplements.json')
const additions = fs.existsSync(supplementsFile) ? JSON.parse(fs.readFileSync(supplementsFile, 'utf8')) : { sources: {}, supplements: {}, overrides: [] }
const expectedRows = new Map()
const allStatements = new Map()
for (const question of bank.questions) {
  for (const item of formatter.extractStatements(question.stem)) allStatements.set(`${question.id}:${item.label}`, { question, item })
  const result = formatter.format(question)
  for (const item of result?.items || []) {
    if (item.verdict === 'incorrect') expectedRows.set(`${question.id}:${item.label}`, { question, item })
  }
}
const entries = Object.create(null)
const pending = new Map()
const questionReviews = Object.create(null)
const counts = { mapped: 0, explanation_only: 0, source_unclear: 0 }
for (const batch of [1, 2, 3]) {
  const file = path.join(inputDirectory, `review-${batch}.json`)
  if (!fs.existsSync(file)) { if (partial) continue; throw new Error(`Missing review batch: ${batch}`) }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(rows)) throw new Error(`Review batch ${batch} is not an array`)
  for (const row of rows) {
    if (!expectedRows.has(row.key) || pending.has(row.key)) throw new Error(`Unexpected or duplicate review: ${row.key}`)
    pending.set(row.key, row)
  }
  const questionFile = path.join(inputDirectory, `question-review-${batch}.json`)
  if (!fs.existsSync(questionFile)) { if (partial) continue; throw new Error(`Missing question review batch: ${batch}`) }
  for (const row of JSON.parse(fs.readFileSync(questionFile, 'utf8'))) {
    if (!bank.questions.some(q => q.id === row.id) || questionReviews[row.id]) throw new Error(`Unexpected or duplicate question review: ${row.id}`)
    const question = bank.questions.find(q => q.id === row.id)
    const { extraReviews, ...description } = row
    questionReviews[row.id] = { ...description, expectedStem: question.stem, expectedExplanation: question.explanation, expectedAnswerLetter: question.answerLetter, expectedOptions: question.options }
    for (const extra of row.extraReviews || []) {
      if (pending.has(extra.key)) throw new Error(`Duplicate extra review: ${extra.key}`)
      pending.set(extra.key, extra)
    }
  }
}
for (const override of additions.overrides || []) {
  const source = allStatements.get(override.key)
  if (!source) throw new Error(`Unknown supplemental statement: ${override.key}`)
  pending.set(override.key, { original: source.item.text, reason: source.question.explanation, ...pending.get(override.key), ...override })
}
for (const row of pending.values()) {
    const source = allStatements.get(row.key)
    if (!source) throw new Error(`Unknown statement review: ${row.key}`)
    if (compact(row.original) !== compact(source.item.text)) throw new Error(`Original changed: ${row.key}`)
    if (!Object.hasOwn(counts, row.status) || !Array.isArray(row.pairs)) throw new Error(`Invalid review status: ${row.key}`)
    if (row.status === 'mapped' && !row.pairs.length && !row.rule) throw new Error(`Mapped review has no corrections: ${row.key}`)
    if (row.verdict && !['correct', 'incorrect', 'unknown'].includes(row.verdict)) throw new Error(`Invalid verdict: ${row.key}`)
    const original = compact(row.original)
    const explanation = equivalent(source.question.explanation)
    const used = []
    if (row.rule && (!explanation.includes(equivalent(row.rule.evidence)) || !equivalent(row.rule.evidence).includes(equivalent(row.rule.correct)))) throw new Error(`Rule lacks source evidence: ${row.key}`)
    for (const focus of row.focus || []) {
      const needle = compact(focus.text)
      const start = original.indexOf(needle)
      if (!needle || start < 0 || original.indexOf(needle, start + 1) >= 0 || !explanation.includes(equivalent(focus.evidence))) throw new Error(`Focus lacks source evidence or unique location: ${row.key}`)
      if (used.some(range => start < range.end && start + needle.length > range.start)) throw new Error(`Overlapping focus: ${row.key}`)
      used.push({ start, end: start + needle.length })
    }
    for (const pair of row.pairs) {
      const wrong = compact(pair.wrong)
      const correct = equivalent(pair.correct)
      const evidence = equivalent(pair.evidence)
      let position = original.indexOf(wrong)
      if (Number.isInteger(pair.occurrence) && pair.occurrence >= 0) {
        for (let occurrence = 0; occurrence < pair.occurrence && position >= 0; occurrence++) position = original.indexOf(wrong, position + wrong.length)
      } else if (position >= 0 && original.indexOf(wrong, position + 1) >= 0) throw new Error(`Ambiguous wrong span: ${row.key} ${pair.wrong}`)
      if (!wrong || !correct || position < 0) throw new Error(`Invalid wrong span: ${row.key} ${pair.wrong}`)
      let approvedImage = false
      if ((pair.imageVerified || pair.imageEvidence) && row.imageEvidence) {
        const approval = imageApprovals.find(item => item.key === row.key && item.correct === pair.correct && evidenceFile(item.file) === evidenceFile(row.imageEvidence))
        if (approval) {
          const bytes = fs.readFileSync(evidenceFile(approval.file))
          approvedImage = crypto.createHash('sha256').update(bytes).digest('hex') === approval.sha256
        }
      }
      let approvedExternal = false
      if (pair.externalEvidence) {
        const external = additions.sources[pair.externalEvidence]
        if (!external) throw new Error(`Unknown external evidence: ${pair.externalEvidence}`)
        const supplied = external.questionId ? bank.questions.find(q => q.id === external.questionId)?.explanation : external.evidence
        approvedExternal = equivalent(supplied).includes(evidence) && evidence.includes(correct)
        if (approvedExternal) pair.approvedExternalEvidence = true
      }
      if (!approvedExternal && (!evidence || !explanation.includes(evidence) || (!evidence.includes(correct) && !approvedImage))) throw new Error(`Correction lacks source evidence: ${row.key} ${pair.correct}`)
      if (approvedImage) pair.approvedImageEvidence = true
      if (used.some(range => position < range.end && position + wrong.length > range.start)) throw new Error(`Overlapping spans: ${row.key}`)
      used.push({ start: position, end: position + wrong.length })
    }
    if (row.status !== 'mapped' && !row.note) throw new Error(`Review exception needs an explanation: ${row.key}`)
    entries[row.key] = { ...row, verdict: row.verdict || (row.status === 'mapped' ? 'incorrect' : undefined), imageEvidence: row.imageEvidence ? path.basename(row.imageEvidence) : undefined,
      pairs: row.pairs.map(pair => ({ ...pair, imageEvidence: pair.imageEvidence ? path.basename(pair.imageEvidence) : undefined })) }
    counts[row.status]++
}
const missing = [...expectedRows.keys()].filter(key => !entries[key])
if (missing.length && !partial) throw new Error(`Unreviewed statements (${missing.length}): ${missing.slice(0, 8).join(', ')}`)
const coveredQuestions = new Set(Object.keys(entries).map(key => key.slice(0, key.lastIndexOf(':'))))
for (const id of Object.keys(questionReviews)) coveredQuestions.add(id)
const missingQuestions = bank.questions.filter(q => !coveredQuestions.has(q.id)).map(q => q.id)
if (missingQuestions.length && !partial) throw new Error(`Unreviewed questions (${missingQuestions.length}): ${missingQuestions.slice(0, 8).join(', ')}`)
const supplements = Object.fromEntries(Object.entries(additions.supplements || {}).map(([id, item]) => {
  const question = bank.questions.find(q => q.id === id)
  if (!question || !item.sources?.every(source => additions.sources[source])) throw new Error(`Invalid supplement: ${id}`)
  return [id, { ...item, expectedExplanation: question.explanation, expectedStem: question.stem, expectedAnswerLetter: question.answerLetter, expectedOptions: question.options, approved: true }]
}))
const unresolvedStatements = Object.values(entries).filter(row => row.status === 'source_unclear').map(row => row.key)
const unresolvedQuestions = Object.values(questionReviews).filter(row => row.sourceStatus === 'source_unclear' && !supplements[row.id] && !additions.displayFixes?.[row.id]).map(row => row.id)
if ((unresolvedStatements.length || unresolvedQuestions.length) && !partial) throw new Error(`Unresolved sources: ${[...unresolvedStatements, ...unresolvedQuestions].join(', ')}`)
const payload = { version: 2, counts, statementCount: Object.keys(entries).length, expectedCount: expectedRows.size, reviewedQuestions: coveredQuestions.size, complete: !missing.length && !missingQuestions.length && !unresolvedStatements.length && !unresolvedQuestions.length, unresolvedStatements, unresolvedQuestions, entries, questionReviews, sources: additions.sources, supplements, displayFixes: additions.displayFixes || {} }
const wrapper = `/* Individually reviewed source-backed answer annotations. Generated by scripts/build-reference-reviews.cjs. */\n(function(root, data) {\n  if (typeof module === 'object' && module.exports) module.exports = data\n  if (root) root.QuizReferenceReviews = data\n})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, ${JSON.stringify(payload)});\n`
fs.writeFileSync(path.join(repo, 'reference-reviews.js'), wrapper)
console.log(JSON.stringify({ statementCount: payload.statementCount, expectedCount: payload.expectedCount, counts, missing: missing.length, reviewedQuestions: coveredQuestions.size, missingQuestions: missingQuestions.length, unresolvedStatements, unresolvedQuestions, complete: payload.complete }, null, 2))
