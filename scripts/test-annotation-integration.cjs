const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const source = fs.readFileSync(path.join(__dirname, 'test-quiz-features.cjs'), 'utf8')
const boundary = source.search(/\r?\nlet passed = 0/)
const setup = source.slice(0, boundary).replace('...api, document, elements, Element, fire,', '...api, contextWindow: context.window, document, elements, Element, fire,')
const context = { require, console, __dirname, process }
vm.runInNewContext(setup + '\nglobalThis.inkHarness = harness', context)
function harness() {
  const h = context.inkHarness()
  let active = false
  const mounts = []
  h.contextWindow.QuizAnnotations = { active: () => active, toggle: () => (active = !active), beforeRender() {}, mount(surface, id) { mounts.push(id) } }
  return Object.assign(h, { setInk: value => { active = value }, mounts })
}
const h = harness()
h.startQuiz(h.state.data.questions)
const option = new h.Element('.option'); option.dataset.option = '0'
h.fire('click', { target: option })
const pen = new h.Element('button'); pen.dataset.action = 'ink-toggle'
h.fire('click', { target: pen })
assert(h.contextWindow.QuizAnnotations.active())
h.advance(1500)
assert.equal(h.state.sessionIndex, 0, 'Entering pen cancels the pending 300-millisecond jump')
delete h.state.sessionAnswers[h.state.session[0].id]
h.fire('click', { target: option })
assert.equal(h.state.sessionAnswers[h.state.session[0].id], undefined, 'Drawing cannot select an answer')
const touchTarget = h.elements.get('.question-card')
h.fire('touchstart', { target: touchTarget, touches: [{ identifier: 1, clientX: 300, clientY: 200 }] })
h.fire('touchend', { target: touchTarget, touches: [], changedTouches: [{ identifier: 1, clientX: 80, clientY: 200 }] })
assert.equal(h.state.sessionIndex, 0, 'Drawing a horizontal line cannot swipe to another question')
const oldFont = h.state.user.quizFont
h.setQuizFont('large')
assert.equal(h.state.user.quizFont, oldFont, 'Drawing geometry is not changed by an in-progress font selection')
h.fire('click', { target: pen })
h.advance(300)
h.fire('click', { target: option })
h.advance(299)
assert.equal(h.state.sessionIndex, 0, 'Answering stays on the question until 300 milliseconds after pen exits')
h.advance(1)
assert.equal(h.state.sessionIndex, 1, 'Answering and auto-next resume after pen exits')
assert(h.mounts.includes('test-1') && h.mounts.includes('test-2'))
const bank = require('../bank-loader').merge([
  require('../data/questions.json'),
  require('../data/zhanggong/questions.json'),
  require('../data/zhanggong-yanyu/questions.json')
])
const all = harness(); all.state.data = bank
for (const q of bank.questions) {
  all.startQuiz([q])
  const html = all.renderQuiz()
  assert(html.includes('data-action="ink-toggle"'), q.id)
  assert(html.includes('data-ink-surface'), q.id)
  all.state.sessionAnswers[q.id] = q.answer
  all.submitSession()
  const review = all.renderQuiz()
  assert(review.includes('data-action="ink-toggle"'), q.id)
  assert(review.indexOf('data-ink-surface') < review.indexOf('class="feedback'), q.id)
  assert(review.includes('</div></div><div class="feedback'), 'Answer expansion stays outside the drawing surface')
}
assert.equal(bank.questions.length, 1604)
console.log('PASS pen on all 1604 questions and reviews; pending auto-next cancellation, option/swipe/font guards, remount and resumed answering')
