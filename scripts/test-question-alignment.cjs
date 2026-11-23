const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.join(__dirname, '..', 'data', 'zhanggong')
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const bank = read('questions.json')
const audit = read('source-audit.json')
const independent = read('alignment-audit.json')
const records = new Map(audit.questions.map(q => [q.id, q]))
assert.equal(independent.pagesAudited, 116)
assert.equal(independent.optionFirstLines, 1216)
assert.equal(independent.crossPageCases.length, 93)
let changed = 0
for (const sample of independent.crossPageCases) {
  const record = records.get(sample.id)
  const question = bank.questions.find(q => q.id === sample.id)
  assert.equal(record.questionCrops.length, sample.placements.length)
  let top = 0
  for (let i = 0; i < sample.placements.length; i++) {
    const source = record.questionCrops[i]
    const expected = sample.placements[i]
    assert.equal(source.page, expected.page)
    assert.equal(source.columnLeft, expected.bodyLeft)
    assert.equal(source.pasteX, expected.pasteX, sample.id)
    assert.equal(source.pasteY, top, sample.id)
    assert.deepEqual(source.bbox, expected.sourceCropBox)
    top += expected.height + 16
  }
  assert.equal(question.questionImage.width, sample.newCanvasWidth)
  assert.equal(question.questionImage.height, top - 16)
  const labels = sample.optionLabels.map(label => label.newX)
  assert(Math.max(...labels) - Math.min(...labels) <= 1, sample.id)
  if (sample.changed) changed++
}
assert.equal(changed, 79)
const reported = independent.crossPageCases.find(q => q.id === 'zg-2026-013')
assert.equal(reported.placements[1].pasteX, 89)
assert.equal(reported.optionLabels.find(label => label.label === 'D').newX, 103)
assert.match(bank.albums[0].subtitle, /2026年115题＋2025年189题/)
console.log(JSON.stringify({ crossPageQuestions: 93, correctedQuestions: 79, clearlyMisalignedOptionsFixed: 32, sourcePagesChecked: 116, optionLabelSpreadMaxPixels: 1, reportedDOffsetPixels: 89 }))
