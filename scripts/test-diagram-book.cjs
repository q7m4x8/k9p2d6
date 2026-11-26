const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { merge } = require('../bank-loader')
const politics = require('../data/questions.json')
const words = require('../data/zhanggong/questions.json')
const verbal = require('../data/zhanggong-yanyu/questions.json')
const diagrams = require('../data/liu-diagram-700/questions.json')

const title = '刘义恒图推700题'
const bookId = 'liu-diagram-700'
const answerLetters = 'ABCD'
const combined = merge([politics, words, verbal, diagrams])
const reviewSection = /<section class="reference-answer"[\s\S]*?<\/section>/
const chineseDigits = '零一二三四五六七八九'

// Reuse the quiz suite's DOM and local storage harness.
const featureSource = fs.readFileSync(path.join(__dirname, 'test-quiz-features.cjs'), 'utf8')
const boundary = featureSource.search(/\r?\nlet passed = 0/)
assert(boundary > 0)
const context = { require, console, __dirname, process }
vm.runInNewContext(featureSource.slice(0, boundary) + '\nglobalThis.diagramHarness = harness', context)

function harness() {
  const h = context.diagramHarness()
  h.state.data = combined
  return h
}

function click(h, key, value) {
  const element = new h.Element('button')
  element.dataset[key] = String(value)
  h.fire('click', { target: element })
}

function paperName(number) {
  const tens = Math.floor(number / 10)
  const units = number % 10
  return `挑战图推700题（${tens > 1 ? chineseDigits[tens] : ''}${tens ? '十' : ''}${units ? chineseDigits[units] : ''}）`
}

function imagePath(question) {
  return `./data/${bookId}/questions/${question.questionImage.file}`
}

function checkAnswerOnlyReview(html, question) {
  const section = html.match(reviewSection)?.[0]
  assert(section, question.id)
  assert(section.includes(`正确答案 <b>${question.answerLetter}</b>`), question.id)
  assert(section.includes(`data-question-note="${question.id}"`), question.id)
  assert.doesNotMatch(section, /答案解释|补充说明|原版笔记解析|reference-prose|reference-items|<img\b/, question.id)
  assert.match(html, new RegExp(`class="option(?: selected)? correct" data-option="${question.answer}"`), question.id)
}

assert.deepEqual(combined.stats, { questionCount: 2304, paperCount: 116, albumCount: 8 })
assert.equal(diagrams.albums.length, 1)
assert.equal(diagrams.questions.length, 700)
const [album] = diagrams.albums
assert.equal(album.id, bookId)
assert.equal(album.title, title)
assert.equal(album.count, 700)
assert.equal(album.papers.length, 35)
// Both independent transcriptions of the source PDF's three key pages agreed.
const answerHash = createHash('sha256').update(diagrams.questions.map(question => question.answerLetter).join('')).digest('hex')
assert.equal(answerHash, '9fc3e43f47c6bf51c0de1acd1be72653eb027398c79303709bd92b909bd9f86c')

const h = harness()
for (const [paperIndex, paper] of album.papers.entries()) {
  assert.equal(paper.name, paperName(paperIndex + 1))
  assert.equal(paper.count, 20)
  click(h, 'album', bookId)
  assert(h.element('#mainContent').innerHTML.includes(`data-paper="${paper.name}"`))
  click(h, 'paper', paper.name)
  assert.equal(h.state.sessionTitle, `${title} · ${paper.name}`)
  assert.equal(h.state.session.length, 20)
  for (const [number, question] of h.state.session.entries()) {
    const offset = paperIndex * 20 + number
    assert.equal(question, diagrams.questions[offset])
    assert.equal(question.id, `lyt-${String(offset + 1).padStart(3, '0')}`)
    assert.equal(question.number, number + 1, question.id)
    assert.equal(question.assetBook, bookId, question.id)
    assert.equal(question.questionRenderMode, 'image', question.id)
    assert.equal(question.referenceMode, 'answer-only', question.id)
    assert.deepEqual(question.options, [...answerLetters], question.id)
    assert.equal(question.answerLetter, answerLetters[question.answer], question.id)
    assert(!question.explanation && !(question.referenceImages?.length), question.id)
    const { file, width, height } = question.questionImage
    assert.equal(file, `${question.id}.webp`)
    assert(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0, question.id)
    const image = fs.readFileSync(path.join(__dirname, '..', 'data', bookId, 'questions', file))
    assert.equal(image.toString('ascii', 0, 4), 'RIFF', question.id)
    assert.equal(image.toString('ascii', 8, 12), 'WEBP', question.id)

    h.changeQuestion(number)
    click(h, 'option', number === 0 ? (question.answer + 1) % 4 : question.answer)
    const html = h.renderQuiz()
    assert(html.includes(`src="${imagePath(question)}?`), question.id)
    assert.match(html, /class="option selected"/, question.id)
    assert.deepEqual([...html.matchAll(/aria-label="选项 ([A-D])"/g)].map(match => match[1]), question.options)
    assert.doesNotMatch(html, /正确答案|class="feedback|option(?: selected)? (?:correct|incorrect)|\/answers\/|\/answer-previews\//, question.id)
  }
  assert.match(h.renderQuiz(), /交卷并查看答案/)
  click(h, 'action', 'submit-session')
  assert.equal(h.state.sessionRecord.correctCount, 19)
  assert(h.state.user.wrong.includes(h.state.session[0].id))
  for (const [index, question] of h.state.session.entries()) {
    h.changeQuestion(index)
    const html = h.renderQuiz()
    checkAnswerOnlyReview(html, question)
    assert.doesNotMatch(html, /查看挖坑手册/)
    if (index === 0) assert.match(html, /下一题答案/)
  }
  assert.equal(h.openPitfallManual(), false)
  assert(h.openHistoryRecord(0, 19))
  assert(h.state.reviewingHistory)
  assert.match(h.renderQuiz(), /当次作答：回答正确/)
  checkAnswerOnlyReview(h.renderQuiz(), h.state.session[19])
}

const mixed = harness()
const question = diagrams.questions[0]
const politicalQuestion = politics.questions.find(question => question.id === 'cg-003')
const wordQuestion = words.questions[0]
mixed.startQuiz([question, politicalQuestion, wordQuestion])
for (const item of mixed.state.session) mixed.state.sessionAnswers[item.id] = item.answer
mixed.submitSession()
checkAnswerOnlyReview(mixed.renderQuiz(), question)
assert.match(mixed.renderQuiz(), /查看挖坑手册/)
mixed.changeQuestion(1)
assert.match(mixed.renderQuiz(), /reference-prose|reference-items/)
mixed.changeQuestion(2)
assert.match(mixed.renderQuiz(), /original-reference-answer/)
assert.match(mixed.renderQuiz(), /\/zhanggong\/answer-previews\//)
assert(mixed.openPitfallManual())
const pitfalls = mixed.collectPitfalls(mixed.pitfallScope().questions)
assert(pitfalls.length > 0)
assert(pitfalls.every(entry => entry.question === politicalQuestion && entry.questionNumber === 2))

const retry = harness()
retry.startQuiz([question])
const figure = new retry.Element('.original-image-page', retry.element('#mainContent'))
figure.dataset.originalRole = 'question'
const image = new retry.Element('img.original-notes-image', figure)
image.dataset.originalFile = question.questionImage.file
image.setAttribute('src', `${imagePath(question)}?v=original`)
const error = new retry.Element('.original-image-error', figure)
error.hidden = true
const button = new retry.Element('button', error)
button.dataset.action = 'retry-original-image'
figure.querySelector = selector => selector === 'img.original-notes-image' ? image : selector === '.original-image-error' ? error : null
retry.fire('error', { target: image })
assert.equal(image.hidden, true)
assert.equal(image.getAttribute('src'), null)
assert.equal(error.hidden, false)
retry.fire('click', { target: button })
assert.equal(image.hidden, false)
assert.equal(error.hidden, true)
assert(image.src.startsWith(`${imagePath(question)}?v=`))
assert.match(image.src, /&retry=\d+$/)
const firstRetry = image.src
retry.fire('error', { target: image })
retry.fire('click', { target: button })
assert.notEqual(image.src, firstRetry)
assert.doesNotMatch(retry.renderQuiz(), /正确答案|class="feedback/)

console.log('PASS 35 diagram papers and 700 WebP images, PDF answer keys, submission and history, mixed review modes, and image retry')
