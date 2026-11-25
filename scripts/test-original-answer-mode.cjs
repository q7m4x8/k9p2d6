const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')

const repo = path.resolve(__dirname, '..')
// Reuse the existing DOM/storage harness without running or changing its 52 cases.
const featureSource = fs.readFileSync(path.join(__dirname, 'test-quiz-features.cjs'), 'utf8')
const harnessBoundary = featureSource.search(/\r?\nlet passed = 0/)
assert(harnessBoundary > 0, 'The shared quiz feature harness must be available')
const harnessSource = featureSource.slice(0, harnessBoundary).replace(
  '...api, document, elements, Element, fire,',
  '...api, contextWindow: context.window, document, elements, Element, fire,'
)
const harnessContext = { require, console, __dirname, process }
vm.runInNewContext(harnessSource + '\nglobalThis.originalModeHarness = harness', harnessContext)
const harness = (...args) => harnessContext.originalModeHarness(...args)

function originalQuestion(overrides = {}) {
  return {
    id: 'zg-2026-001', source: '张弓', album: '张弓选词大典', paper: '第01套', number: 1,
    stem: '原 题：请选词填空。', options: ['咄咄逼人  锋芒毕露', '甲 乙', '丙 丁', '戊 己'],
    answer: 0, answerLetter: 'A', explanation: '此处不应显示自动政治解析。',
    referenceMode: 'original-annotated',
    referenceImages: [
      { file: 'zg-2026-001-02.webp', width: 900, height: 450, page: 4, caption: '原笔记 <img src=x onerror="alert(1)">' },
      { file: 'zg-2026-001-01.webp', width: 900, height: 650, page: 3 }
    ],
    questionImage: { file: 'zg-2026-001-00.webp', width: 900, height: 550, page: 3 },
    ...overrides
  }
}

function startOriginal(h, question = originalQuestion()) {
  h.state.data.questions.push(question)
  h.startQuiz([question])
  return question
}

function finishSession(h) {
  for (const question of h.state.session) h.state.sessionAnswers[question.id] = question.answer
  h.submitSession()
  assert.equal(h.state.sessionSubmitted, true)
}

function imageNodes(h, role = 'answer', file = 'zg-2026-001-02.webp') {
  const figure = new h.Element('.original-image-page')
  figure.dataset.originalRole = role
  const image = new h.Element('img.original-notes-image', figure)
  image.dataset.originalFile = file
  image.setAttribute('src', './data/zhanggong/answers/' + file)
  const error = new h.Element('.original-image-error', figure)
  error.hidden = true
  const retry = new h.Element('.original-image-retry', error)
  retry.dataset.action = 'retry-original-image'
  figure.querySelector = selector => selector === 'img.original-notes-image' ? image : selector === '.original-image-error' ? error : null
  return { figure, image, error, retry }
}

let passed = 0
function test(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { console.error(`FAIL ${name}`); throw error }
}

test('text questions request no images by default and can switch to the original layout without losing selections or ink', () => {
  const h = harness()
  let inkId
  h.contextWindow.QuizAnnotations = {
    beforeRender() {},
    mount(_surface, id) { inkId = id },
    active: () => false
  }
  const question = startOriginal(h, originalQuestion({ questionRenderMode: 'text' }))
  const html = h.renderQuiz()
  assert.equal(inkId, question.id + '-text')
  assert(!html.includes('./data/zhanggong/questions/'))
  assert(!html.includes('./data/zhanggong/answers/'))
  assert(!html.includes('data-action="note-toggle"'))
  assert.equal(h.renderReferenceAnswer(question), '')
  assert.match(html, /data-action="toggle-original-question"[^>]*>查看原题/)
  assert(html.includes('咄咄逼人  锋芒毕露'))
  const option = new h.Element('.option')
  option.dataset.option = '0'
  h.fire('click', { target: option })
  const toggle = new h.Element('.original-question-toggle')
  toggle.dataset.action = 'toggle-original-question'
  h.fire('click', { target: toggle })
  const original = h.renderQuiz()
  assert.equal(inkId, question.id)
  assert(original.includes('./data/zhanggong/questions/zg-2026-001-00.webp'))
  assert(original.includes('讲义第 3 页'))
  assert(original.includes('data-option="0" aria-pressed="true"'))
  assert(!original.includes('./data/zhanggong/answers/'))
  h.fire('click', { target: toggle })
  assert.equal(inkId, question.id + '-text')
  const returned = h.renderQuiz()
  assert(!returned.includes('./data/zhanggong/questions/'))
  assert(returned.includes('data-option="0" aria-pressed="true"'))
  finishSession(h)
  const revealed = h.renderQuiz()
  assert(revealed.includes('./data/zhanggong/answers/zg-2026-001-02.webp'))
  assert(revealed.includes('正确答案 <b>A</b>'))
  assert(revealed.includes('data-action="note-toggle"'))
})

test('original answer pages keep input order and escape captions without invoking political formatting', () => {
  const h = harness()
  const question = startOriginal(h)
  finishSession(h)
  h.contextWindow.QuizExplanationFormatter = {
    format() { throw new Error('Original notes must bypass political formatting') },
    formatOptions() { throw new Error('Original notes must bypass option rewriting') }
  }
  const html = h.renderReferenceAnswer(question)
  assert(html.indexOf('zg-2026-001-02.webp') < html.indexOf('zg-2026-001-01.webp'))
  assert.equal((html.match(/class="original-notes-image"/g) || []).length, 2)
  assert(html.includes('原笔记 &lt;img src=x onerror=&quot;alert(1)&quot;&gt;'))
  assert(!html.includes('<img src=x'))
  assert(!html.includes(question.explanation))
  assert(!html.includes('reference-wrong'))
  assert(!html.includes('reference-rule'))
  assert(html.includes('target="_blank" rel="noopener noreferrer"'))
  assert(html.includes('width="900" height="450"'))
  assert(html.includes('笔记第 4 页'))
  assert(!html.includes('讲义第 4 页'))
})

test('source discrepancy notices appear safely after submission without changing the original notes or grading', () => {
  const h = harness()
  const notice = '原资料冲突：手写 B；按讲义答案 D 评分。\n<img src=x onerror="alert(1)">'
  const question = startOriginal(h, originalQuestion({ answer: 3, answerLetter: 'D', sourceNotice: notice }))
  assert(!h.renderQuiz().includes('原资料冲突'))
  finishSession(h)
  const html = h.renderReferenceAnswer(question)
  assert(html.includes('正确答案 <b>D</b>'))
  assert(html.includes('原资料冲突：手写 B；按讲义答案 D 评分。\n&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'))
  assert(!html.includes('<img src=x'))
  assert(html.indexOf('original-source-notice') > html.indexOf('正确答案 <b>D</b>'))
  assert.equal(h.state.user.attempts[question.id].correct, true)
  assert(h.renderReferenceAnswer({ ...question, sourceNotice: { html: '<b>unsafe</b>' } }).includes('original-reference-answer'))
  assert(!h.renderReferenceAnswer({ ...question, sourceNotice: { html: '<b>unsafe</b>' } }).includes('original-source-notice'))
})

test('unsafe paths and dimensions cannot escape the controlled original image directories', () => {
  const h = harness()
  const question = startOriginal(h)
  finishSession(h)
  const files = ['../escape.webp', 'https://evil.invalid/a.webp', 'data:image/png,hi', 'a/b.webp', 'a\\b.webp', 'a..b.webp', '.hidden.webp', 'x.svg', 'x.webp?z=1', 'x%2fy.webp', 'x.webp#fragment']
  for (const file of files) {
    const html = h.renderReferenceAnswer({ ...question, referenceImages: [{ file }] })
    assert(!html.includes('<img '), file)
    assert(html.includes('本题原版解析图片暂不可用'), file)
    question.questionImage = { file }
    assert(!h.renderQuiz().includes('data-action="toggle-original-question"'), file)
  }
  for (const referenceImages of [null, {}, 'not an image list', [null], []]) {
    assert(!h.renderReferenceAnswer({ ...question, referenceImages }).includes('<img '))
  }
  const html = h.renderReferenceAnswer({ ...question, referenceImages: [{ file: 'zg-2025-001-01.jpg', width: '9" onload="alert(1)', height: -1, caption: '<script>alert(1)</script>' }] })
  assert(html.includes('./data/zhanggong/answers/zg-2025-001-01.jpg'))
  assert(!html.includes('onload='))
  assert(!html.includes(' height="-1"'))
  assert(!html.includes('<script>'))
})

test('word group spacing is literal only for original mode and normal political formatting stays intact', () => {
  const h = harness()
  const question = originalQuestion({ stem: '原 题 <b>题干</b>', options: ['咄咄逼人  锋芒毕露', '<b>甲</b>  乙', '丙 丁', '戊 己'] })
  const control = { ...h.state.data.questions[0], id: 'control-spacing', stem: '汉 字', options: ['甲 乙', '丙 丁', '戊 己', '庚 辛'] }
  h.state.data.questions.push(question, control)
  h.startQuiz([question, control])
  let html = h.renderQuiz()
  assert(html.includes('咄咄逼人  锋芒毕露'))
  assert(html.includes('&lt;b&gt;甲&lt;/b&gt;  乙'))
  assert(html.includes('原 题 &lt;b&gt;题干&lt;/b&gt;'))
  assert(html.includes('options original-word-options'))
  h.changeQuestion(1)
  html = h.renderQuiz()
  assert(html.includes('汉字'))
  assert(html.includes('甲乙'))
  assert(!html.includes('甲 乙'))
  assert(!html.includes('original-word-options'))
})

test('clean image question mode shows its primary image and four accessible letter choices', () => {
  const h = harness()
  const question = startOriginal(h, originalQuestion({ questionRenderMode: 'image' }))
  let html = h.renderQuiz()
  assert(html.includes('<div class="original-question">'))
  assert(html.includes('options original-choice-only'))
  assert.equal((html.match(/data-option=/g) || []).length, 4)
  for (const letter of 'ABCD') assert(html.includes(`aria-label="选项 ${letter}"`))
  assert(!html.includes(question.stem))
  assert(!html.includes('咄咄逼人'))
  assert(!html.includes('data-action="toggle-original-question"'))
  assert(!html.includes('data-action="note-toggle"'))
  assert(!html.includes('./data/zhanggong/answers/'))
  question.questionImage = { file: '../not-allowed.webp' }
  html = h.renderQuiz()
  assert(html.includes('原题图片暂不可用，下方显示题目文字'))
  assert(html.includes(question.stem))
  assert(html.includes('咄咄逼人  锋芒毕露'))
})

test('image failures offer a retry in the same figure and never fall back to a political explanation', () => {
  const h = harness()
  startOriginal(h)
  finishSession(h)
  const { image, error, retry } = imageNodes(h)
  h.fire('error', { target: image })
  assert.equal(image.hidden, true)
  assert.equal(image.getAttribute('src'), null)
  assert.equal(error.hidden, false)
  h.fire('click', { target: retry })
  assert.equal(image.hidden, false)
  assert.equal(error.hidden, true)
  assert.match(image.src, /^\.\/data\/zhanggong\/answers\/zg-2026-001-02\.webp\?v=20261123-10&retry=\d+$/)
  h.fire('error', { target: image })
  assert.equal(error.hidden, false)
  assert(!h.renderQuiz().includes('此处不应显示自动政治解析'))
  const unsafe = imageNodes(h, 'answer', '../escape.webp')
  h.fire('click', { target: unsafe.retry })
  assert.equal(unsafe.image.src, undefined)
})

test('retry actions cannot reveal answer images before submission but can retry clean question images', () => {
  const h = harness()
  startOriginal(h)
  const answer = imageNodes(h)
  h.fire('click', { target: answer.retry })
  assert.equal(answer.image.src, undefined)
  const question = imageNodes(h, 'question', 'zg-2026-001-00.webp')
  h.fire('error', { target: question.image })
  assert.equal(question.error.hidden, false)
  h.fire('click', { target: question.retry })
  assert.match(question.image.src, /^\.\/data\/zhanggong\/questions\/zg-2026-001-00\.webp\?v=20261123-10&retry=\d+$/)
  assert.equal(question.error.hidden, true)
})

test('stable original IDs preserve separate notes, favorites, attempts and historical reviews', () => {
  const priorAttempt = { selected: 2, correct: false, at: 123 }
  const priorRecord = { id: 'political-history', title: '原有练习', submittedAt: 1800000000000, totalSeconds: 7, correctCount: 0, questions: [{ id: 'test-1', selected: 2, correct: false, seconds: 7 }] }
  const h = harness({ attempts: { 'test-1': priorAttempt }, wrong: ['test-1'], favorites: ['test-1'], history: [priorRecord] }, null, false, { 'test-1': '原有政治笔记' })
  const question = startOriginal(h)
  finishSession(h)
  h.toggleQuestionNote()
  assert(h.saveQuestionNote(question.id, '词义  笔记\n<b>保持原样</b>'))
  assert.equal(h.notesSaved()['test-1'], '原有政治笔记')
  assert.equal(h.notesSaved()[question.id], '词义  笔记\n<b>保持原样</b>')
  const html = h.renderReferenceAnswer(question)
  assert(html.includes(`data-question-note="${question.id}"`))
  assert(html.includes('词义  笔记\n&lt;b&gt;保持原样&lt;/b&gt;'))
  const favorite = h.element('.original-favorite'); favorite.dataset.action = 'favorite'
  h.fire('click', { target: favorite })
  assert.deepEqual(Array.from(h.saved().favorites), ['test-1', question.id])
  assert.equal(JSON.stringify(h.saved().attempts['test-1']), JSON.stringify(priorAttempt))
  assert.equal(JSON.stringify(h.saved().history.find(record => record.id === priorRecord.id)), JSON.stringify(priorRecord))
  assert(h.saved().history[0].questions.some(entry => entry.id === question.id))
  assert(h.openHistoryRecord(0))
  assert(h.renderQuiz().includes('./data/zhanggong/answers/'))
  assert(h.renderQuiz().includes(`data-question-note="${question.id}"`))
  assert.equal(h.notesSaved()['test-1'], '原有政治笔记')
})

test('original-only sessions have no manual and mixed sessions collect only political entries at original positions', () => {
  const h = harness()
  const question = startOriginal(h)
  finishSession(h)
  assert(!h.renderQuiz().includes('data-action="open-pitfalls"'))
  assert.equal(h.openPitfallManual(), false)
  assert.equal(h.collectPitfalls([question]).length, 0)
  assert.equal(h.resolvePitfall(question.id + ':A'), null)
  h.state.pitfallOpen = true
  assert.equal(h.renderPitfallManual(), '')
  assert(h.renderQuiz().includes('original-reference-answer'))
  h.state.pitfallOpen = false

  const fullBank = JSON.parse(fs.readFileSync(path.join(repo, 'data/questions.json'), 'utf8'))
  const first = fullBank.questions.find(item => item.id === 'xh-special-029')
  const second = fullBank.questions.find(item => item.id === 'cg-003')
  assert(first && second)
  const another = originalQuestion({ id: 'zg-2025-001' })
  fullBank.questions.push(question, another)
  h.state.data = fullBank
  h.startQuiz([question, first, another, second], 0, { title: '综合练习' })
  finishSession(h)
  const formatter = h.contextWindow.QuizExplanationFormatter
  h.contextWindow.QuizExplanationFormatter = {
    format(item) { assert.notEqual(item.referenceMode, 'original-annotated'); return formatter.format(item) },
    formatOptions(item) { assert.notEqual(item.referenceMode, 'original-annotated'); return formatter.formatOptions(item) }
  }
  assert(h.renderQuiz().includes('data-action="open-pitfalls"'))
  assert(h.openPitfallManual())
  assert.deepEqual(Array.from(h.pitfallScope().questions, item => item.id), [question.id, first.id, another.id, second.id])
  const entries = h.collectPitfalls(h.pitfallScope().questions)
  assert(entries.some(entry => entry.question.id === first.id))
  assert(entries.some(entry => entry.question.id === second.id))
  assert(entries.every(entry => entry.question.id === first.id || entry.question.id === second.id))
  assert(entries.filter(entry => entry.question.id === first.id).every(entry => entry.questionNumber === 2))
  assert(entries.filter(entry => entry.question.id === second.id).every(entry => entry.questionNumber === 4))
  assert(!h.renderPitfallManual().includes('data-pitfall-id="zg-'))
})

test('all 304 production questions honor their question layout and keep original notes in paper and historical reviews', () => {
  const bank = JSON.parse(fs.readFileSync(path.join(repo, 'data/zhanggong/questions.json'), 'utf8'))
  const h = harness()
  h.state.data = bank
  h.contextWindow.QuizExplanationFormatter = {
    format() { throw new Error('Original book called the political formatter') },
    formatOptions() { throw new Error('Original book called the political option formatter') }
  }
  let reviewed = 0
  for (const paper of bank.albums[0].papers) {
    const questions = bank.questions.filter(q => q.paper === paper.name)
    h.startQuiz(questions)
    for (let i = 0; i < questions.length; i++) {
      h.changeQuestion(i)
      const html = h.renderQuiz()
      const question = questions[i]
      if (question.questionRenderMode === 'image') {
        assert(html.includes(`src="./data/zhanggong/questions/${question.questionImage.file}`), question.id)
      } else {
        assert(!html.includes('./data/zhanggong/questions/'), question.id)
        assert(html.includes('options original-word-options'), question.id)
        assert(html.includes('data-action="toggle-original-question"'), question.id)
      }
      assert(!html.includes('./data/zhanggong/answers/'))
      assert(!html.includes('original-source-notice'))
      h.state.sessionAnswers[questions[i].id] = questions[i].answer
    }
    h.submitSession()
    assert(h.state.sessionSubmitted)
    for (let i = 0; i < questions.length; i++) {
      h.changeQuestion(i)
      const html = h.renderQuiz()
      for (const image of questions[i].referenceImages) assert(html.includes(`./data/zhanggong/answers/${image.file}`))
      assert(!html.includes('data-action="open-pitfalls"'))
      assert(html.includes(`data-question-note="${questions[i].id}"`))
      if (questions[i].sourceNotice) assert(html.includes(questions[i].sourceNotice))
      reviewed++
    }
    assert(h.openHistoryRecord(0))
    assert(h.state.reviewingHistory)
    assert(h.renderQuiz().includes('./data/zhanggong/answers/'))
  }
  assert.equal(reviewed, 304)
  assert.equal(h.saved().history.length, 16)
  assert.equal(Object.keys(h.saved().attempts).length, 304)
})

console.log(`PASS: ${passed} original answer visibility, safety, retry, notes and mixed-session scenarios`)
