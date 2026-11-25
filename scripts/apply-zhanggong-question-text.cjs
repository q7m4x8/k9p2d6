// Update question wording only. The same IDs, grading and source images remain in the bank.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const [candidatePath, ...reviewPaths] = process.argv.slice(2)
assert(candidatePath && reviewPaths.length, 'Pass the source candidate and the reviewed correction files')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const bankPath = path.join(__dirname, '../data/zhanggong/questions.json')
const bank = read(bankPath)
const candidates = new Map(read(candidatePath).questions.map(q => [q.id, q]))
const corrections = new Map()
for (const file of reviewPaths) {
  for (const [id, correction] of Object.entries(read(file))) {
    assert(candidates.has(id), `Unknown correction: ${id}`)
    corrections.set(id, { ...corrections.get(id), ...correction })
  }
}

function normalizeQuotes(text) {
  let open = false
  return text.replace(/[“”"]/g, char => {
    const opening = char === '“' || (char === '"' && !open)
    open = opening
    return opening ? '“' : '”'
  })
}

function repairCommonGlyphs(text) {
  return text.replace(/([深融进嵌植注切投])人(?!工)/g, '$1入')
    .replace(/可支配收人/g, '可支配收入')
}

function formatStem(text) {
  return normalizeQuotes(repairCommonGlyphs(text))
    .replace(/^\((?=202[56])/, '（')
    .replace(/填人(?=[画划横文下各空词（])/g, '填入')
    .replace(/(?<![.．])[.．]{3,}(?=\s*_{2,})|(?<=_{2,})[.．]{3,}/g, '')
    .replace(/ *([，。；！：？”])/g, '$1')
    .replace(/([（“]) */g, '$1')
    .replace(/ *(_{2,}) */g, '____')
    .replace(/\s*((?:依次)?填入[画划]横线[^：:\n]{0,48}[：:])\s*$/, '\n$1')
    .trim()
}

function formatOption(text) {
  return normalizeQuotes(repairCommonGlyphs(text.trim()))
    .replace(/([，、；]) +/g, '$1')
    .replace(/ +/g, '　')
}

assert.equal(bank.questions.length, 304)
assert.equal(candidates.size, bank.questions.length)
for (const question of bank.questions) {
  const row = candidates.get(question.id)
  assert(row && row.year === question.sourceQuestion.year && row.originalNumber === question.sourceQuestion.number, question.id)
  assert.deepEqual(row.options.map(option => option.label), ['A', 'B', 'C', 'D'], question.id)
  const override = corrections.get(question.id) || {}
  let reviewedStem = override.stem ?? row.stem
  for (const [before, after] of override.stemReplacements ?? []) {
    if (!reviewedStem.includes(before) && reviewedStem.includes(after)) continue
    assert(reviewedStem.includes(before), `Unmatched review text: ${question.id} ${before}`)
    reviewedStem = reviewedStem.replace(before, after)
  }
  const stem = formatStem(reviewedStem)
  const options = (override.options ?? row.options.map(option => option.text)).map(formatOption)
  assert(stem.length > 25 && stem.includes('____'), `Incomplete stem: ${question.id}`)
  assert.equal(options.length, 4)
  assert(options.every(text => text.length >= 2), `Incomplete options: ${question.id}`)
  Object.assign(question, { stem, options, questionRenderMode: 'text' })
}
bank.version = '20261125-1'
fs.writeFileSync(bankPath, JSON.stringify(bank) + '\n')
console.log(`Updated ${bank.questions.length} text questions from the original source candidates and ${corrections.size} reviewed question corrections.`)
