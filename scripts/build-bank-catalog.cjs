const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { merge } = require('../bank-loader.js')
const approvedReferences = require('../reference-reviews.js')
const approvedOptions = require('../option-reviews.js')

const root = path.resolve(__dirname, '..')
const sourceSpecs = [
  ['data/questions.json', '20261121-5'],
  ['data/zhanggong/questions.json', '20261125-2'],
  ['data/zhanggong-yanyu/questions.json', '20261125-6'],
  ['data/liu-diagram-700/questions.json', '20261127-1']
]

const sourceBanks = sourceSpecs.map(([file]) => JSON.parse(readFileSync(path.join(root, file), 'utf8')))
const bank = merge(sourceBanks)
const reviewFields = ['entries', 'questionReviews', 'supplements', 'displayFixes']
const referenceReviews = Object.fromEntries(reviewFields.map(field => [field, approvedReferences[field]]))
const optionReviews = { entries: approvedOptions.entries }
const politicsAlbums = new Set(sourceBanks[0].albums.map(album => album.id))
const questionsByTitle = new Map(bank.albums.map(album => [album.title, new Map()]))
const indexedQuestions = new Set()
const outputs = new Map()

function addOutput(file, data) {
  assert.ok(!outputs.has(file), `Duplicate data file: ${file}`)
  const contents = JSON.stringify(data) + '\n'
  const hash = createHash('sha256').update(contents).digest('hex').slice(0, 16)
  outputs.set(file, { contents, data })
  return `./${file}?v=${hash}`
}

function reviewsFor(questionIds) {
  const onlyQuestions = rows => Object.fromEntries(Object.entries(rows).filter(([key]) => questionIds.has(key)))
  const statements = Object.fromEntries(Object.entries(referenceReviews.entries).filter(([key]) => questionIds.has(key.split(':', 1)[0])))
  return {
    referenceReviews: {
      entries: statements,
      questionReviews: onlyQuestions(referenceReviews.questionReviews),
      supplements: onlyQuestions(referenceReviews.supplements),
      displayFixes: onlyQuestions(referenceReviews.displayFixes)
    },
    optionReviews: { entries: onlyQuestions(optionReviews.entries) }
  }
}

for (const [index, question] of bank.questions.entries()) {
  const papers = questionsByTitle.get(question.album)
  if (!papers.has(question.paper)) papers.set(question.paper, { firstQuestionIndex: index, questions: [] })
  const { firstQuestionIndex, questions } = papers.get(question.paper)
  assert.equal(index, firstQuestionIndex + questions.length, `Questions are out of order for ${question.album} / ${question.paper}`)
  questions.push(question)
}

const albums = bank.albums.map(album => {
  assert.match(album.id, /^[a-z0-9-]+$/, `Invalid album ID: ${album.id}`)
  const sourcePapers = questionsByTitle.get(album.title)
  const papers = album.papers.map(paper => {
    assert.match(paper.id, /^[a-z0-9-]+$/, `Invalid paper ID: ${paper.id}`)
    const file = `data/papers/${album.id}/${paper.id}.json`
    const source = sourcePapers.get(paper.name)
    assert.ok(source, `No questions found for ${album.title} / ${paper.name}`)
    const { firstQuestionIndex, questions } = source
    assert.equal(questions.length, paper.count, `Question count for ${album.title} / ${paper.name}`)
    const questionIds = questions.map(question => question.id)
    for (const id of questionIds) {
      assert.ok(!indexedQuestions.has(id), `Question indexed twice: ${id}`)
      indexedQuestions.add(id)
    }
    const payload = { questions }
    if (politicsAlbums.has(album.id)) Object.assign(payload, reviewsFor(new Set(questionIds)))
    const url = addOutput(file, payload)
    return { ...paper, firstQuestionIndex, questionIds, url }
  })
  assert.equal(papers.reduce((total, paper) => total + paper.count, 0), album.count, `Question count for ${album.title}`)
  return { ...album, papers }
})

assert.equal(outputs.size, bank.stats.paperCount)
assert.equal(indexedQuestions.size, bank.stats.questionCount)

const paperReviews = Array.from(outputs.values(), output => output.data).filter(data => data.referenceReviews)
for (const field of reviewFields) {
  const combined = Object.assign({}, ...paperReviews.map(data => data.referenceReviews[field]))
  assert.deepEqual(combined, referenceReviews[field], `Reference review coverage for ${field}`)
}
assert.deepEqual(Object.assign({}, ...paperReviews.map(data => data.optionReviews.entries)), optionReviews.entries, 'Option review coverage')

const reviewUrl = addOutput('data/reviews/politics.json', { referenceReviews, optionReviews })
const sources = sourceSpecs.map(([file, version], index) => ({
  url: `./${file}?v=${version}`,
  albumIds: sourceBanks[index].albums.map(album => album.id),
  ...(index === 0 ? { reviewUrl } : {})
}))
const catalog = { appName: bank.appName, stats: bank.stats, albums, sources, referenceSources: approvedReferences.sources }
for (const [file, { contents, data }] of outputs) {
  const destination = path.join(root, file)
  mkdirSync(path.dirname(destination), { recursive: true })
  writeFileSync(destination, contents)
  assert.deepEqual(JSON.parse(readFileSync(destination, 'utf8')), data, `Roundtrip for ${file}`)
}

writeFileSync(path.join(root, 'data/bank-catalog.js'), `window.QuizBankCatalog = ${JSON.stringify(catalog)};\n`)
console.log(`Indexed ${bank.stats.questionCount} questions in ${bank.stats.paperCount} papers across ${bank.stats.albumCount} albums`)
