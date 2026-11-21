const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')

const repo = path.resolve(__dirname, '..')
const storageKey = 'xiaotian_quiz_state_v1'
const draftKey = 'xiaotian_quiz_draft_v1'
const source = fs.readFileSync(path.join(repo, 'app.js'), 'utf8').replace(/\ninit\(\)\s*$/, '')
const fixtures = [
  { id: 'test-1', source: '测试', album: '测试专辑', paper: '第01套', number: 1, stem: '测试题一', options: ['甲', '乙', '丙', '丁'], answer: 0, answerLetter: 'A', explanation: '甲正确。' },
  { id: 'test-2', source: '测试', album: '测试专辑', paper: '第01套', number: 2, stem: '测试题二', options: ['甲', '乙', '丙', '丁'], answer: 1, answerLetter: 'B', explanation: '乙正确。' },
  { id: 'test-3', source: '测试', album: '测试专辑', paper: '第01套', number: 3, stem: '测试题三', options: ['甲', '乙', '丙', '丁'], answer: 2, answerLetter: 'C', explanation: '丙正确。' }
]
const bank = {
  albums: [{ id: 'test', source: '测试', title: '测试专辑', subtitle: '计时回归测试', count: 3, papers: [{ name: '第01套', count: 3 }] }],
  questions: fixtures,
  stats: { questionCount: 3, paperCount: 1, albumCount: 1 }
}

function harness(saved, savedDraft, storageFails = false) {
  let now = 0
  const epoch = 1800000000000
  const storage = new Map(saved ? [[storageKey, JSON.stringify(saved)]] : [])
  if (savedDraft) storage.set(draftKey, JSON.stringify(savedDraft))
  const listeners = new Map()
  const windowListeners = new Map()
  const intervals = new Map()
  let nextTimer = 0
  let selection = ''
  class Element {
    constructor(selector = '', parent = null) {
      this.selector = selector
      this.tagName = selector === '.source-explanation-image' ? 'IMG' : selector.endsWith('Button') || selector === '.option' ? 'BUTTON' : 'DIV'
      this.parentElement = parent
      this.dataset = {}
      this.attributes = new Map()
      this.innerHTML = ''
      this.textContent = ''
      this.hidden = false
      this.disabled = false
      this.classList = { toggle() {}, add() {}, remove() {}, contains: () => false }
      this.style = { setProperty() {} }
    }
    addEventListener(type, fn) {
      const key = `${this.selector}:${type}`
      if (!listeners.has(key)) listeners.set(key, [])
      listeners.get(key).push(fn)
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    getAttribute(name) { return this.attributes.get(name) ?? null }
    removeAttribute(name) { this.attributes.delete(name) }
    querySelector() { return null }
    querySelectorAll() { return [] }
    get childElementCount() { return this.innerHTML.trim() ? 1 : 0 }
    get children() { return this.innerHTML.trim() ? [{}] : [] }
    matches(selector) {
      return selector.split(',').some(part => {
        const trimmed = part.trim()
        const data = trimmed.match(/^\[data-([a-z-]+)\]$/)
        if (data) return Object.hasOwn(this.dataset, data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()))
        return trimmed === this.selector || trimmed.toUpperCase() === this.tagName
      })
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null }
    contains(element) { return element === this || !!element?.parentElement && this.contains(element.parentElement) }
  }
  const elements = new Map()
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element(selector))
    return elements.get(selector)
  }
  get('.question-card').parentElement = get('.quiz-shell')
  get('.quiz-shell').parentElement = get('#mainContent')
  const document = {
    hidden: false,
    visibilityState: 'visible',
    documentElement: Object.assign(new Element('html'), { dataset: {} }),
    querySelector: selector => {
      if (selector === '.modal-backdrop' || selector === '.modal') return get('#modalRoot').innerHTML ? get(selector) : null
      return get(selector)
    },
    querySelectorAll: selector => selector === '.nav-item' ? ['home', 'progress', 'wrong', 'favorites'].map(route => Object.assign(new Element('.nav-item'), { dataset: { route } })) : [],
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    getSelection: () => ({ isCollapsed: !selection, toString: () => selection })
  }
  const context = {
    document,
    Element,
    HTMLElement: Element,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (storageFails) throw new Error('QuotaExceededError'); storage.set(key, String(value)) }, removeItem: key => storage.delete(key) },
    performance: { now: () => now },
    Date: class extends Date { static now() { return epoch + now } },
    console,
    setTimeout: () => ++nextTimer,
    clearTimeout() {},
    setInterval: fn => { const id = ++nextTimer; intervals.set(id, fn); return id },
    clearInterval: id => intervals.delete(id),
    requestAnimationFrame: fn => fn(now),
    cancelAnimationFrame() {},
    navigator: {},
    fetch: async () => ({ ok: true, json: async () => bank }),
  }
  context.window = {
    scrollTo() {},
    getSelection: document.getSelection,
    addEventListener(type, fn) { if (!windowListeners.has(type)) windowListeners.set(type, []); windowListeners.get(type).push(fn) },
    requestAnimationFrame: context.requestAnimationFrame,
    matchMedia: () => ({ matches: false, addEventListener() {} })
  }
  vm.createContext(context)
  vm.runInContext(source + `\nglobalThis.testApi = {state, startQuiz, navigate, goBack, changeQuestion, pauseQuizTiming, resumeQuizTiming, getQuestionMilliseconds, getSessionMilliseconds, formatDuration, submitSession, render, renderQuiz, renderProgress, saveUserState, setQuizFont, continueDraft};`, context)
  const api = context.testApi
  api.state.data = JSON.parse(JSON.stringify(bank))
  const fire = (type, event = {}, target = document) => {
    const complete = { target: get('.question-card'), detail: 1, cancelable: true, preventDefault() { this.defaultPrevented = true }, stopImmediatePropagation() { this.immediatePropagationStopped = true }, ...event }
    const eventListeners = target === document ? listeners : windowListeners
    for (const listener of eventListeners.get(type) || []) { listener(complete); if (complete.immediatePropagationStopped) break }
    return complete
  }
  return {
    ...api, document, elements, Element, fire,
    advance(ms, tick = true) { now += ms; if (tick) for (const fn of [...intervals.values()]) fn() },
    saved() { return JSON.parse(storage.get(storageKey) || '{}') },
    draftSaved() { return JSON.parse(storage.get(draftKey) || 'null') },
    setHidden(hidden) { document.hidden = hidden; document.visibilityState = hidden ? 'hidden' : 'visible'; fire('visibilitychange') },
    setSelection(value) { selection = value },
    element: get,
    swipe({ dx = -100, dy = 5, fingers = 1, cancel = false, target = get('.question-card') } = {}) {
      const start = { clientX: 220, clientY: 250, identifier: 1 }
      const finish = { clientX: start.clientX + dx, clientY: start.clientY + dy, identifier: 1 }
      const touches = fingers === 1 ? [start] : [start, { ...start, identifier: 2 }]
      fire('touchstart', { touches, changedTouches: touches, target })
      fire('touchmove', { touches: fingers === 1 ? [finish] : [finish, { ...finish, identifier: 2 }], changedTouches: [finish], target })
      return fire(cancel ? 'touchcancel' : 'touchend', { touches: [], changedTouches: [finish], target })
    }
  }
}

let passed = 0
function test(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { console.error(`FAIL ${name}`); throw error }
}

test('revisited questions accumulate active time without render/save double counting', () => {
  const h = harness()
  h.startQuiz(h.state.data.questions)
  h.advance(1250)
  assert.equal(h.getQuestionMilliseconds('test-1'), 1250)
  h.render(); h.setQuizFont('large'); h.saveUserState()
  assert.equal(h.getSessionMilliseconds(), 1250)
  h.changeQuestion(1)
  h.advance(2300)
  h.changeQuestion(0)
  h.advance(750)
  assert.equal(h.getQuestionMilliseconds('test-1'), 2000)
  assert.equal(h.getQuestionMilliseconds('test-2'), 2300)
  assert.equal(h.getSessionMilliseconds(), 4300)
  assert.equal(h.formatDuration(4300), '00:04')
})

test('background intervals pause and returning resumes only the current question', () => {
  const h = harness()
  h.startQuiz(h.state.data.questions)
  h.advance(1100)
  h.setHidden(true)
  h.advance(20000)
  assert.equal(h.getSessionMilliseconds(), 1100)
  h.setHidden(false)
  h.advance(900)
  assert.equal(h.getQuestionMilliseconds('test-1'), 2000)
  h.pauseQuizTiming(); h.pauseQuizTiming()
  h.advance(3000)
  assert.equal(h.getSessionMilliseconds(), 2000)
  h.resumeQuizTiming(); h.resumeQuizTiming()
  h.advance(1000)
  assert.equal(h.getSessionMilliseconds(), 3000)
  assert.equal(h.formatDuration(3601000), '01:00:01')
  assert.equal(h.formatDuration(-50), '00:00')
})

test('back preserves answers and time; continued draft survives a fresh app load', () => {
  const h = harness()
  h.startQuiz(h.state.data.questions)
  h.state.sessionAnswers['test-1'] = 2
  h.advance(1600)
  h.changeQuestion(1)
  h.advance(2400)
  h.goBack()
  assert.notEqual(h.state.route, 'quiz')
  h.advance(10000)
  assert.equal(h.getSessionMilliseconds(), 4000)
  const saved = h.saved()
  const savedDraft = h.draftSaved()
  assert(savedDraft, 'Leaving an unfinished quiz must save its draft')
  const reloaded = harness(saved, savedDraft)
  reloaded.continueDraft()
  assert.equal(reloaded.state.route, 'quiz')
  assert.equal(reloaded.state.sessionIndex, 1)
  assert.equal(reloaded.state.sessionAnswers['test-1'], 2)
  assert.equal(reloaded.getSessionMilliseconds(), 4000)
  reloaded.advance(1000)
  assert.equal(reloaded.getQuestionMilliseconds('test-2'), 3400)
})

test('missing answers block submission and charge the elapsed time to the original question', () => {
  const h = harness()
  h.startQuiz(h.state.data.questions)
  h.advance(1200)
  h.changeQuestion(1)
  h.state.sessionAnswers['test-2'] = 1
  h.advance(1800)
  h.submitSession()
  assert.equal(h.state.sessionSubmitted, false)
  assert.equal(h.state.sessionIndex, 0)
  assert.equal(h.getQuestionMilliseconds('test-2'), 1800)
  assert.equal(h.state.user.history.length, 0)
  assert.equal(Object.keys(h.state.user.attempts).length, 0)
  h.advance(1000)
  assert.equal(h.getQuestionMilliseconds('test-1'), 2200)
})

test('submission persists per-question seconds and total; review never increases either', () => {
  const h = harness()
  h.startQuiz(h.state.data.questions.slice(0, 2))
  h.advance(2200)
  h.state.sessionAnswers['test-1'] = 0
  h.changeQuestion(1)
  h.advance(3800)
  h.state.sessionAnswers['test-2'] = 3
  h.submitSession()
  assert.equal(h.state.sessionSubmitted, true)
  assert.equal(h.state.user.attempts['test-1'].durationSeconds, 2)
  assert.equal(h.state.user.attempts['test-2'].durationSeconds, 4)
  assert.equal(h.state.user.history.length, 1)
  const record = h.state.user.history[0]
  assert.equal(record.totalSeconds, 6)
  assert.equal(record.correctCount, 1)
  assert.equal(record.questions.length, 2)
  assert.equal(record.questions.find(q => q.id === 'test-2').seconds, 4)
  assert.equal(record.questions.find(q => q.id === 'test-2').durationMs, 3800)
  assert.equal(record.questions.reduce((sum, q) => sum + q.seconds, 0), record.totalSeconds)
  assert.equal(record.questions.find(q => q.id === 'test-2').selected, 3)
  assert.equal(record.questions.find(q => q.id === 'test-2').correct, false)
  assert.equal(h.draftSaved(), null)
  const stored = JSON.stringify(h.saved())
  h.submitSession()
  assert.equal(h.state.user.history.length, 1, 'Repeated submission must not duplicate a practice record')
  h.advance(60000); h.changeQuestion(1); h.advance(10000); h.render()
  assert.equal(h.getSessionMilliseconds(), 6000)
  assert.equal(h.getQuestionMilliseconds('test-2'), 3800)
  assert.equal(JSON.stringify(h.saved()), stored)
  assert(h.renderProgress().includes('00:06'), 'Saved practice time must be visible from progress')
})

test('old saved attempts remain intact and history retains the latest 50 practices', () => {
  const oldAttempt = { selected: 2, correct: false, at: 1 }
  const h = harness({ attempts: { legacy: oldAttempt }, wrong: ['legacy'], favorites: ['legacy'], theme: 1, quizFont: 'medium' })
  assert.equal(h.state.user.quizFont, 'medium')
  assert.equal(h.state.user.history.length, 0)
  assert.equal(JSON.stringify(h.state.user.attempts.legacy), JSON.stringify(oldAttempt))
  h.state.user.history = Array.from({ length: 50 }, (_, i) => ({ id: `old-${i}`, submittedAt: i, totalSeconds: i, questions: [] }))
  h.startQuiz(h.state.data.questions.slice(0, 1))
  h.advance(1000)
  h.state.sessionAnswers['test-1'] = 0
  h.submitSession()
  assert.equal(h.state.user.history.length, 50)
  assert.equal(JSON.stringify(h.state.user.attempts.legacy), JSON.stringify(oldAttempt))
  assert(h.state.user.history.some(r => r.questions.some(q => q.id === 'test-1')))
})

test('horizontal swipe changes one question and never exits or submits at an edge', () => {
  const h = harness()
  h.startQuiz(h.state.data.questions)
  h.advance(1200)
  h.swipe()
  assert.equal(h.state.sessionIndex, 1, 'Left swipe goes to the next question')
  assert.equal(h.getQuestionMilliseconds('test-1'), 1200)
  h.advance(800)
  h.swipe({ dx: 100 })
  assert.equal(h.state.sessionIndex, 0, 'Right swipe goes to the previous question')
  h.swipe({ dx: 100 })
  assert.equal(h.state.route, 'quiz')
  assert.equal(h.state.sessionIndex, 0)
  h.changeQuestion(2)
  h.swipe()
  assert.equal(h.state.sessionIndex, 2)
  assert.equal(h.state.sessionSubmitted, false)
  assert.equal(h.state.route, 'quiz')
})

test('large saved histories remain bounded without losing the new practice', () => {
  const h = harness()
  h.state.user.history = Array.from({ length: 7 }, (_, i) => ({ id: `large-${i}`, submittedAt: i, totalSeconds: 20, questions: Array.from({ length: 2000 }, () => ({ id: 'old', seconds: 0 })) }))
  h.startQuiz(h.state.data.questions.slice(0, 1))
  h.state.sessionAnswers['test-1'] = 0
  h.advance(1500)
  h.submitSession()
  assert(h.state.user.history.reduce((sum, record) => sum + record.questions.length, 0) <= 10000)
  assert(h.state.user.history.some(record => record.questions.some(q => q.id === 'test-1')))
})

test('a completed swipe suppresses its ghost tap without blocking keyboard answers', () => {
  const h = harness()
  h.startQuiz(h.state.data.questions)
  h.swipe()
  assert.equal(h.state.sessionIndex, 1)
  const option = h.element('.option')
  option.parentElement = h.element('.question-card')
  option.dataset.option = '2'
  const ghostTap = h.fire('click', { target: option, detail: 1 })
  assert(ghostTap.defaultPrevented)
  assert.equal(h.state.sessionAnswers['test-2'], undefined)
  h.fire('click', { target: option, detail: 0 })
  assert.equal(h.state.sessionAnswers['test-2'], 2)
  h.advance(500)
  option.dataset.option = '0'
  h.fire('click', { target: option, detail: 1 })
  assert.equal(h.state.sessionAnswers['test-2'], 0)
})

test('storage write failures preserve the running quiz and show an actionable notice', () => {
  const h = harness(undefined, undefined, true)
  assert.doesNotThrow(() => h.startQuiz(h.state.data.questions.slice(0, 1)))
  assert(h.element('#toast').textContent.includes('暂时无法保存记录'))
  h.advance(2500)
  assert.equal(h.getSessionMilliseconds(), 2500)
  h.state.sessionAnswers['test-1'] = 0
  assert.doesNotThrow(() => h.submitSession())
  assert.equal(h.state.sessionSubmitted, true)
  assert.equal(h.state.user.history.length, 1)
})

test('vertical, short, cancelled, multi-touch and selected-text gestures do not change questions', () => {
  const h = harness()
  h.startQuiz(h.state.data.questions)
  h.changeQuestion(1)
  for (const gesture of [{ dx: -30, dy: 5 }, { dx: -100, dy: 130 }, { dx: -100, cancel: true }, { dx: -100, fingers: 2 }]) {
    h.swipe(gesture)
    assert.equal(h.state.sessionIndex, 1, JSON.stringify(gesture))
  }
  h.setSelection('选中的题干文字')
  h.swipe()
  assert.equal(h.state.sessionIndex, 1)
  h.setSelection('')
  h.element('#modalRoot').innerHTML = '<div class="modal-backdrop">设置字号</div>'
  h.swipe()
  assert.equal(h.state.sessionIndex, 1)
  h.element('#modalRoot').innerHTML = ''
  const image = h.element('.source-explanation-image')
  image.parentElement = h.element('.source-explanation')
  h.swipe({ target: image })
  assert.equal(h.state.sessionIndex, 1)
  h.fire('touchstart', { touches: [{ clientX: 220, clientY: 250, identifier: 1 }] })
  h.fire('touchmove', { touches: [{ clientX: 100, clientY: 250, identifier: 1 }, { clientX: 180, clientY: 250, identifier: 2 }] })
  h.fire('touchend', { touches: [], changedTouches: [{ clientX: 100, clientY: 250, identifier: 1 }] })
  assert.equal(h.state.sessionIndex, 1, 'A second finger added midway cancels swiping')
  h.fire('touchstart', { touches: [{ clientX: 220, clientY: 250, identifier: 1 }] })
  h.advance(2000)
  h.fire('touchend', { touches: [], changedTouches: [{ clientX: 100, clientY: 250, identifier: 1 }] })
  assert.equal(h.state.sessionIndex, 1, 'A long text-selection gesture is not a quick swipe')
  h.navigate('home')
  h.swipe()
  assert.equal(h.state.route, 'home', 'A gesture outside the quiz cannot reopen it')
})

console.log(`PASS: ${passed} quiz navigation, gesture, timing and persistence scenarios`)
