const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')

const repo = path.resolve(__dirname, '..')
const storageKey = 'xiaotian_quiz_state_v1'
const draftKey = 'xiaotian_quiz_draft_v1'
const notesKey = 'xiaotian_quiz_notes_v1'
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

function harness(saved, savedDraft, storageFails = false, savedNotes) {
  let failStorage = storageFails
  let now = 0
  const epoch = 1800000000000
  const storage = new Map(saved ? [[storageKey, JSON.stringify(saved)]] : [])
  if (savedDraft) storage.set(draftKey, JSON.stringify(savedDraft))
  if (savedNotes !== undefined) storage.set(notesKey, JSON.stringify(savedNotes))
  const listeners = new Map()
  const windowListeners = new Map()
  const intervals = new Map()
  const timeouts = new Map()
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
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (failStorage) throw new Error('QuotaExceededError'); storage.set(key, String(value)) }, removeItem: key => storage.delete(key) },
    performance: { now: () => now },
    Date: class extends Date { static now() { return epoch + now } },
    console,
    setTimeout: (fn, delay = 0) => { const id = ++nextTimer; timeouts.set(id, {fn, at:now + delay}); return id },
    clearTimeout: id => timeouts.delete(id),
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
  for (const file of ['text-format.js', 'reference-reviews.js', 'option-reviews.js', 'explanation-format.js']) {
    vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), context)
  }
  vm.runInContext(source + `\nglobalThis.testApi = {state, startQuiz, navigate, goBack, changeQuestion, pauseQuizTiming, resumeQuizTiming, getQuestionMilliseconds, getSessionMilliseconds, formatDuration, submitSession, render, renderQuiz, renderProgress, renderTimingHistory, openHistoryRecord, renderReferenceAnswer, conciseReferenceReason, saveUserState, setQuizFont, continueDraft, toggleHistoryManagement, selectHistoryRecord, selectAllHistoryRecords, selectedHistoryRecords, requestHistoryDeletion, cancelHistoryDeletion, confirmHistoryDeletion, toggleQuestionNote, saveQuestionNote, renderQuestionNotes, pitfallScope, collectPitfalls, openPitfallManual, closePitfallManual, jumpFromPitfall, renderPitfallManual, referenceFormatter:window.QuizExplanationFormatter};`, context)
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
    advance(ms, tick = true) {
      const target = now + ms
      for (;;) {
        const next = [...timeouts].filter(([,item])=>item.at<=target).sort((a,b)=>a[1].at-b[1].at)[0]
        if (!next) break
        now = next[1].at; timeouts.delete(next[0]); next[1].fn()
      }
      now = target
      if (tick) for (const fn of [...intervals.values()]) fn()
    },
    saved() { return JSON.parse(storage.get(storageKey) || '{}') },
    draftSaved() { return JSON.parse(storage.get(draftKey) || 'null') },
    notesSaved() { return JSON.parse(storage.get(notesKey) || 'null') },
    setHidden(hidden) { document.hidden = hidden; document.visibilityState = hidden ? 'hidden' : 'visible'; fire('visibilitychange') },
    setSelection(value) { selection = value },
    setStorageFails(value) { failStorage = value },
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
  assert.equal(h.state.sessionIndex, 1)
  h.advance(1000)
  assert.equal(h.state.sessionIndex, 2)
  h.advance(500)
  option.dataset.option = '0'
  h.fire('click', { target: option, detail: 1 })
  assert.equal(h.state.sessionAnswers['test-3'], 0)
  assert.equal(h.state.sessionSubmitted, false)
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

test('numbered references appear only after submission, retain correct rows and highlight exact errors', () => {
  const h = harness()
  const fullBank = JSON.parse(fs.readFileSync(path.join(repo, 'data/questions.json'), 'utf8'))
  const question = fullBank.questions.find(q => q.id === 'xh-special-021')
  assert(question)
  const snapshot = JSON.stringify(question)
  h.startQuiz([question])
  assert(!h.renderQuiz().includes('reference-answer'), 'Answers must stay hidden until the entire paper is submitted')
  h.state.sessionAnswers[question.id] = 2
  h.submitSession()
  const html = h.renderQuiz()
  assert.equal((html.match(/class="reference-item /g) || []).length, 4)
  assert.equal((html.match(/reference-verdict correct/g) || []).length, 2)
  assert.equal((html.match(/reference-verdict incorrect/g) || []).length, 2)
  assert(html.includes('解决的就是人心和力量问题'))
  assert(html.includes('错误词句：一致性中寻求多样性'))
  assert(html.includes('<strong>多样性中寻求一致性</strong>'))
  assert(html.includes('错误词句：以人民为中心'))
  assert(html.includes('<strong>党的领导</strong>'))
  assert(!html.includes('查看完整解析'))
  assert(!html.includes('查看原文解析'))
  assert.equal(JSON.stringify(question), snapshot, 'Rendering cannot rewrite canonical question content')
})

test('display normalization repairs Chinese spacing across stems, choices and explanations, while escaping markup', () => {
  const h = harness()
  const question = { ...fixtures[0], stem: '测试 的题 干 <script>坏</script>', options: ['中 文选项', 'Open AI 5 kg', '丙', '丁'], explanation: '这 是解 析 <img src=x onerror=alert(1)>' }
  const snapshot = JSON.stringify(question)
  h.startQuiz([question])
  const before = h.renderQuiz()
  assert(before.includes('测试的题干'))
  assert(before.includes('中文选项'))
  assert(before.includes('Open AI 5 kg'))
  assert(before.includes('&lt;script&gt;'))
  h.state.sessionAnswers[question.id] = 0
  h.submitSession()
  const after = h.renderQuiz()
  assert(after.includes('这是解析'))
  assert(after.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert(!after.includes('<img src=x'))
  const numbered = { ...question, stem: '下列说法正确的有几项？①中 文是正确的 <svg/onload=alert(1)>②另一 项是错误的', options: ['1项', '2项', '3项', '4项'], explanation: '①正确。②错误：另一项应修改。<img src=x>' }
  const numberedHtml = h.renderReferenceAnswer(numbered)
  assert(numberedHtml.includes('&lt;svg/onload=alert(1)&gt;'))
  assert(!numberedHtml.includes('<svg/'))
  assert(!numberedHtml.includes('<img src=x>'))
  assert.equal(JSON.stringify(question), snapshot)
})

test('the reported screenshot highlights all three exact wrong phrases without repeated negative tails', () => {
  const h = harness()
  const fullBank = JSON.parse(fs.readFileSync(path.join(repo, 'data/questions.json'), 'utf8'))
  const question = fullBank.questions.find(q => q.id === 'xh-special-005')
  const html = h.renderReferenceAnswer(question)
  const mainReference = html.split('<details class="reference-original"')[0]
  assert.equal((mainReference.match(/class="reference-item /g) || []).length, 5)
  assert.equal((mainReference.match(/reference-verdict correct/g) || []).length, 2)
  assert.equal((mainReference.match(/class="reference-wrong"/g) || []).length, 3)
  assert.equal((mainReference.match(/class="reference-fix"/g) || []).length, 3)
  for (const phrase of ['矛盾的普遍性和客观性', '客观规律性和主观能动性的有机结合', '辩证唯物主义普遍联系的原理']) {
    assert(mainReference.includes(`<strong>${phrase}</strong>`))
  }
  assert(!mainReference.includes('原解析：'))
  assert(!mainReference.includes('而非'))
  assert(!mainReference.includes('而不是'))
  assert(!html.includes('而非矛盾的普遍性和客观性'), 'The redundant original panel is removed')
  assert.equal(h.conciseReferenceReason('正确表述，而非矛盾的普遍性和客观性。', '体现了矛盾的普遍性和客观性'), '正确表述。')
  assert.equal(h.conciseReferenceReason('正确表述，而不是辩证唯物主义普遍联系的原理。', '体现了辩证唯物主义普遍联系的原理'), '正确表述。')
  assert.equal(h.conciseReferenceReason('需要保留的内容，而非另一个知识点。', '题干没有这句话'), '需要保留的内容，而非另一个知识点。', 'Unrelated source commentary is not stripped by a blanket deletion')
  const ordinary = { ...question, stem: '这一说法体现了矛盾的普遍性和客观性，是否准确？', explanation: '体现的是客观规律性和主观能动性的有机结合，而非矛盾的普遍性和客观性。' }
  const ordinaryReference = h.renderReferenceAnswer(ordinary).split('<details class="reference-original"')[0]
  assert(ordinaryReference.includes('客观规律性和主观能动性的有机结合'))
  assert(!ordinaryReference.includes('而非矛盾'))
  assert.equal(ordinary.explanation, '体现的是客观规律性和主观能动性的有机结合，而非矛盾的普遍性和客观性。', 'Only the displayed explanation is shortened; canonical content stays unchanged')
})

test('selected frame stays visible for exactly one second before advancing; final submission remains manual', () => {
  const h = harness()
  h.startQuiz(h.state.data.questions)
  const option = h.element('.option')
  option.parentElement = h.element('.question-card')
  option.dataset.option = '1'
  h.advance(1250)
  h.fire('click', { target: option })
  assert.equal(h.state.sessionAnswers['test-1'], 1)
  assert.equal(h.state.sessionIndex, 0)
  assert(h.renderQuiz().includes('class="option selected" data-option="1" aria-pressed="true"'))
  assert.equal(h.draftSaved().index, 0)
  assert.equal(h.draftSaved().answers['test-1'], 1)
  assert(!h.renderQuiz().includes('reference-answer'))
  assert(!h.renderQuiz().includes('feedback incorrect'))
  const duplicate = h.fire('click', { target: option })
  assert(duplicate.defaultPrevented)
  assert.equal(h.state.sessionAnswers['test-2'], undefined)
  assert.equal(h.state.sessionIndex, 0)
  h.advance(999)
  assert.equal(h.state.sessionIndex, 0)
  h.advance(1)
  assert.equal(h.state.sessionIndex, 1)
  assert.equal(h.getQuestionMilliseconds('test-1'), 2250)
  assert.equal(h.draftSaved().index, 1)
  h.advance(1000)
  option.dataset.option = '2'
  h.fire('click', { target: option })
  assert.equal(h.state.sessionIndex, 1)
  h.advance(1000)
  assert.equal(h.state.sessionIndex, 2)
  assert.equal(h.getQuestionMilliseconds('test-2'), 2000)
  h.advance(750)
  option.dataset.option = '0'
  h.fire('click', { target: option })
  assert.equal(h.state.sessionIndex, 2)
  assert.equal(h.state.sessionAnswers['test-3'], 0)
  assert(h.renderQuiz().includes('class="option selected" data-option="0" aria-pressed="true"'))
  h.advance(3000)
  assert.equal(h.state.sessionIndex, 2)
  assert.equal(h.state.sessionSubmitted, false)
  assert.equal(h.state.user.history.length, 0)
  assert(h.renderQuiz().includes('交卷并查看解析'))
  h.changeQuestion(0)
  h.advance(500)
  option.dataset.option = '3'
  h.fire('click', { target: option })
  assert.equal(h.state.sessionAnswers['test-1'], 3, 'A previous answer can still be changed')
  assert.equal(h.state.sessionIndex, 0)
  h.submitSession()
  assert.equal(h.state.sessionSubmitted, true)
  const submittedAnswers = JSON.stringify(h.state.sessionAnswers)
  h.advance(1000)
  h.fire('click', { target: option })
  assert.equal(JSON.stringify(h.state.sessionAnswers), submittedAnswers, 'Review cannot change a submitted answer')
})

test('changing a selection restarts the full second and manual navigation cancels pending movement', () => {
  const h=harness(); h.startQuiz(h.state.data.questions)
  const option=h.element('.option'); option.parentElement=h.element('.question-card'); option.dataset.option='0'
  h.fire('click',{target:option}); h.advance(600)
  option.dataset.option='2'; h.fire('click',{target:option})
  h.advance(999); assert.equal(h.state.sessionIndex,0)
  assert.equal(h.state.sessionAnswers['test-1'],2)
  h.advance(1); assert.equal(h.state.sessionIndex,1)
  h.advance(300); h.fire('click',{target:option})
  h.changeQuestion(2); h.advance(2000); assert.equal(h.state.sessionIndex,2)
  h.changeQuestion(0); h.fire('click',{target:option}); h.goBack(); h.advance(2000)
  assert.notEqual(h.state.route,'quiz'); assert.equal(h.state.sessionIndex,0)
  h.continueDraft(); h.fire('click',{target:option}); h.setHidden(true); h.advance(2000)
  assert.equal(h.state.sessionIndex,0,'A background tab cannot advance unseen')
  h.setHidden(false); h.advance(2000); assert.equal(h.state.sessionIndex,0)
})

test('all 1100 questions render reviewed references and repaired sources without changing grading data', () => {
  const h = harness()
  const fullBank = JSON.parse(fs.readFileSync(path.join(repo, 'data/questions.json'), 'utf8'))
  const before = JSON.stringify(fullBank)
  let rendered = 0
  for (const question of fullBank.questions) {
    const html = h.renderReferenceAnswer(question)
    assert(html.includes('参考答案'), `${question.id}: unified reference layout`)
    assert(!html.includes('待补清晰原件'), `${question.id}: no missing-source placeholder in learning explanations`)
    assert(!html.includes('reference-review-note'), `${question.id}: all source uncertainties resolved`)
    assert(!html.includes('C:\\Users\\'), `${question.id}: no private source paths in the page`)
    assert(!html.includes('undefined'), `${question.id}: no missing template values`)
    assert(!html.includes('查看完整解析') && !html.includes('查看原文解析') && !html.includes('查看完整原解析'), `${question.id}: removed redundant explanation entries`)
    rendered++
  }
  assert.equal(rendered, 1100)
  const repaired = id => h.renderReferenceAnswer(fullBank.questions.find(q => q.id === id))
  assert(repaired('xh-newlaw-076').includes('统筹地区人民政府'))
  assert(repaired('xh-newlaw-077').includes('职工个人不缴费'))
  assert(repaired('xh-newlaw-077').includes('ybj.sh.gov.cn'))
  h.startQuiz([fullBank.questions.find(q=>q.id==='xh-500-196')])
  assert(h.renderQuiz().includes('4150元/人'))
  assert(!h.renderQuiz().includes('4巧0'))
  assert(repaired('xh-500-467').includes('<strong>15岁</strong>'))
  assert(!repaired('xh-500-467').includes('巧岁'))
  const contextual = repaired('cg-186')
  assert(contextual.includes('reference-focus'))
  assert(!contextual.includes('reference-wrong'), 'Correct policies in another category must not be crossed out as false facts')
  const legalRule = repaired('xh-newlaw-053')
  assert(legalRule.includes('<del class="reference-wrong">应当全部返还</del>'))
  assert(legalRule.includes('明显违反公平原则'))
  assert.equal(JSON.stringify(fullBank), before)
})

test('ordinary ABCD references annotate all three wrong options in the reported example and omit the correct one', () => {
  const h=harness()
  const fullBank=JSON.parse(fs.readFileSync(path.join(repo,'data/questions.json'),'utf8'))
  const question=fullBank.questions.find(item=>item.id==='xh-special-010')
  const html=h.renderReferenceAnswer(question)
  assert.equal((html.match(/class="reference-item /g)||[]).length,3)
  for (const letter of ['A','B','D']) assert(html.includes(`<b>${letter}</b><span class="reference-verdict incorrect">`))
  assert(!html.includes('<b>C</b><span class="reference-verdict'))
  assert(!html.includes('reference-choice'))
  assert(html.includes('reference-wrong') && html.includes('合理调节高收入'))
  assert(!html.includes('查看完整解析') && !html.includes('查看原文解析'))
})

function practiceRecord(id, selected = 0) {
  return {id,submittedAt:1800000000000,title:'测试专辑 · 历史套卷',totalSeconds:12,correctCount:selected===0?1:0,questions:[
    {id:'test-1',selected,correct:selected===0,seconds:5,durationMs:4500},
    {id:'test-2',selected:3,correct:false,seconds:7,durationMs:7500}
  ]}
}

test('historical review restores each attempt rather than the latest answer to the same question', () => {
  const records=[practiceRecord('new',2),practiceRecord('old',0)]
  const h=harness({history:records,attempts:{'test-1':{selected:2,correct:false,at:2}},wrong:['test-1']})
  const stored=JSON.stringify(h.saved())
  assert.equal(h.openHistoryRecord(1),true)
  assert.equal(h.state.sessionAnswers['test-1'],0)
  assert.equal(h.state.reviewingHistory,true)
  assert.equal(h.state.sessionSubmitted,true)
  assert(h.renderQuiz().includes('历史作答'))
  assert(h.renderQuiz().includes('class="option selected correct" data-option="0"'))
  assert(h.renderQuiz().includes('当次作答：回答正确'))
  h.goBack(); assert.equal(h.state.route,'progress')
  h.openHistoryRecord(0)
  assert.equal(h.state.sessionAnswers['test-1'],2)
  assert(h.renderQuiz().includes('你选了 C，正确答案是 A'))
  assert.equal(JSON.stringify(h.saved()),stored)
  assert.equal(JSON.stringify(h.state.user.history),JSON.stringify(records))
})

test('history card and per-question controls open read-only review, support navigation and keep times frozen', () => {
  const h=harness({history:[practiceRecord('clickable')]})
  h.navigate('progress')
  const html=h.renderTimingHistory()
  assert(html.includes('查看当次作答与解析'))
  assert(html.includes('逐题用时与作答'))
  const row=h.element('.history-button'); row.dataset.historyRecord='0';row.dataset.historyQuestion='1'
  h.fire('click',{target:row})
  assert.equal(h.state.route,'quiz');assert.equal(h.state.sessionIndex,1)
  assert.equal(h.state.sessionAnswers['test-2'],3)
  assert.equal(h.getSessionMilliseconds(),12000)
  assert.equal(h.element('#questionTimer').textContent,'00:07')
  assert(h.renderQuiz().includes('返回练习记录'))
  const stored=JSON.stringify(h.saved())
  h.advance(60000);h.swipe({dx:100});h.advance(30000);h.setHidden(true);h.advance(30000);h.setHidden(false)
  assert.equal(h.state.sessionIndex,0)
  assert.equal(h.getSessionMilliseconds(),12000)
  assert.equal(h.element('#questionTimer').textContent,'00:05')
  assert.equal(h.element('#sessionTimer').textContent,'00:12')
  const option=h.element('.option');option.dataset.option='2';h.fire('click',{target:option})
  assert.equal(h.state.sessionAnswers['test-1'],0)
  h.submitSession(); assert.equal(h.state.user.history.length,1)
  assert.equal(JSON.stringify(h.saved()),stored)
  h.goBack();assert.equal(h.state.route,'progress')
})

test('opening history preserves an active draft and cancels its pending auto-advance across reloads', () => {
  const h=harness({history:[practiceRecord('past',2)]})
  h.startQuiz(h.state.data.questions)
  const option=h.element('.option');option.dataset.option='0';h.fire('click',{target:option});h.advance(600)
  h.openHistoryRecord(0)
  const draft=h.draftSaved()
  assert.equal(draft.index,0);assert.equal(draft.answers['test-1'],0);assert.equal(draft.times['test-1'],600)
  h.advance(5000)
  assert.equal(h.state.sessionIndex,0,'Old auto-advance must not change the historical session')
  h.changeQuestion(1);h.goBack();assert.equal(h.state.route,'progress')
  assert.equal(JSON.stringify(h.draftSaved()),JSON.stringify(draft))
  const reloaded=harness(h.saved(),h.draftSaved());reloaded.continueDraft()
  assert.equal(reloaded.state.reviewingHistory,false);assert.equal(reloaded.state.sessionSubmitted,false)
  assert.equal(reloaded.state.sessionIndex,0);assert.equal(reloaded.state.sessionAnswers['test-1'],0)
  assert.equal(reloaded.getSessionMilliseconds(),600)
  reloaded.advance(1000);assert.equal(reloaded.getSessionMilliseconds(),1600)
})

test('missing historical questions retain original totals and original row links without overwriting records', () => {
  const record=practiceRecord('partially-missing')
  record.questions.splice(1,0,{id:'removed',selected:0,correct:true,seconds:20})
  record.totalSeconds=32;record.correctCount=2
  const h=harness({history:[record]})
  const before=JSON.stringify(h.state.user.history)
  assert(h.openHistoryRecord(0,2))
  assert.equal(h.state.sessionIndex,1)
  assert.equal(h.state.session[1].id,'test-2')
  assert.equal(h.getSessionMilliseconds(),32000)
  assert(h.renderQuiz().includes('原记录中有 1 道题暂不可用'))
  assert(h.renderQuiz().includes('2 / 3'))
  assert.equal(JSON.stringify(h.state.user.history),before)
  const unavailable=harness({history:[{...record,questions:[{id:'removed',seconds:20}]}]})
  assert.equal(unavailable.openHistoryRecord(0),false)
  assert.equal(unavailable.state.route,'home')
  assert.equal(unavailable.openHistoryRecord(-1),false)
  assert.equal(unavailable.openHistoryRecord(NaN),false)
  assert.equal(unavailable.openHistoryRecord(100),false)
})

test('older records lacking a selected answer disclose it and never substitute the latest attempt', () => {
  const record=practiceRecord('old-no-choice');delete record.questions[0].selected
  const h=harness({history:[record],attempts:{'test-1':{selected:2,correct:false}}})
  h.openHistoryRecord(0)
  assert.equal(h.state.sessionAnswers['test-1'],undefined)
  const html=h.renderQuiz()
  assert(html.includes('这次记录没有保存所选选项'))
  assert(!html.includes('你选了 C'))
  assert(!html.includes('回答错误，你选了 未作答'))
  assert(html.includes('参考答案'))
})

test('a draft remains resumable in memory after storage fails while opening historical review', () => {
  const h=harness({history:[practiceRecord('quota')]},null,true)
  h.startQuiz(h.state.data.questions);h.state.sessionAnswers['test-1']=3;h.advance(1800)
  h.openHistoryRecord(0);h.goBack()
  assert(h.continueDraft())
  assert.equal(h.state.sessionSubmitted,false);assert.equal(h.state.reviewingHistory,false)
  assert.equal(h.state.sessionAnswers['test-1'],3)
  assert.equal(h.getSessionMilliseconds(),1800)
  assert.equal(h.state.user.history.length,1)
})

test('bulk history mode selects records with native checkboxes or card clicks and supports selecting all', () => {
  const h=harness({history:[practiceRecord('a'),practiceRecord('b'),practiceRecord('c')]})
  h.navigate('progress');h.toggleHistoryManagement()
  assert.equal(h.state.historyManaging,true)
  assert.equal(h.requestHistoryDeletion(),false)
  assert(h.renderTimingHistory().includes('删除所选（0）'))
  const check=h.element('.history-check');check.dataset.historySelect='0';check.checked=true
  h.fire('change',{target:check})
  assert.equal(h.selectedHistoryRecords().length,1)
  const card=h.element('.history-card');card.dataset.historyRecord='1'
  h.fire('click',{target:card})
  assert.equal(h.state.route,'progress','Selecting a card in bulk mode must not enter answer review')
  assert.equal(h.selectedHistoryRecords().length,2)
  const all=h.element('.history-all');all.dataset.historyAll='';all.checked=true
  h.fire('change',{target:all});assert.equal(h.selectedHistoryRecords().length,3)
  all.checked=false;h.fire('change',{target:all});assert.equal(h.selectedHistoryRecords().length,0)
  h.toggleHistoryManagement();assert.equal(h.state.historyManaging,false)
  assert.equal(h.saved().history.length,3)
})

test('confirmed batch deletion removes only the selected histories and preserves progress, preferences and draft', () => {
  const draft={version:1,ids:['test-1','test-2'],index:1,answers:{'test-1':2},times:{'test-1':1000,'test-2':2000},title:'未完成',returnTo:{route:'home'}}
  const saved={history:[practiceRecord('a'),practiceRecord('b',2),practiceRecord('c')],attempts:{'test-1':{selected:2,correct:false,at:1}},wrong:['test-1'],favorites:['test-2'],theme:4,quizFont:'large',customPreference:'keep'}
  const h=harness(saved,draft);h.navigate('progress');h.toggleHistoryManagement()
  h.selectHistoryRecord(0,true);h.selectHistoryRecord(2,true)
  assert(h.requestHistoryDeletion())
  assert.equal(h.state.user.history.length,3,'Opening confirmation cannot delete data')
  assert(h.element('#modalRoot').innerHTML.includes('确认删除 2 条'))
  assert(h.confirmHistoryDeletion())
  assert.deepEqual(h.saved().history.map(record=>record.id),['b'])
  for(const key of ['attempts','wrong','favorites','theme','quizFont','customPreference']) assert.equal(JSON.stringify(h.saved()[key]),JSON.stringify(saved[key]),`${key} must stay intact`)
  assert.equal(JSON.stringify(h.draftSaved()),JSON.stringify(draft))
  assert.equal(h.state.historySelection.size,0)
  h.toggleHistoryManagement();assert(h.openHistoryRecord(0))
  assert.equal(h.state.sessionAnswers['test-1'],2,'Remaining records must retain their links after indices are rebuilt')
  const reloaded=harness(h.saved(),h.draftSaved());assert(reloaded.continueDraft())
  assert.equal(reloaded.state.sessionIndex,1);assert.equal(reloaded.state.sessionAnswers['test-1'],2)
})

test('cancel, Escape, and leaving progress discard deletion confirmation without removing records', () => {
  const h=harness({history:[practiceRecord('a'),practiceRecord('b')]})
  h.navigate('progress');h.toggleHistoryManagement();h.selectAllHistoryRecords(true)
  const before=JSON.stringify(h.saved())
  h.requestHistoryDeletion();h.cancelHistoryDeletion()
  assert.equal(h.selectedHistoryRecords().length,2)
  assert.equal(h.confirmHistoryDeletion(),false)
  h.requestHistoryDeletion();h.fire('keydown',{key:'Escape'})
  assert.equal(h.state.pendingHistoryDeletion,null)
  h.requestHistoryDeletion();h.navigate('home')
  assert.equal(h.state.pendingHistoryDeletion,null);assert.equal(h.state.historyManaging,false)
  assert.equal(h.state.historySelection.size,0);assert.equal(h.confirmHistoryDeletion(),false)
  assert.equal(JSON.stringify(h.saved()),before)
})

test('failed deletion persistence retains records and selection, and can be retried safely', () => {
  const h=harness({history:[practiceRecord('a'),practiceRecord('b')]},null,true)
  h.navigate('progress');h.toggleHistoryManagement();h.selectHistoryRecord(1,true);h.requestHistoryDeletion()
  const before=JSON.stringify(h.state.user.history)
  assert.equal(h.confirmHistoryDeletion(),false)
  assert.equal(JSON.stringify(h.state.user.history),before)
  assert.equal(h.saved().history.length,2);assert.equal(h.selectedHistoryRecords().length,1)
  assert(h.element('#modalRoot').innerHTML.includes('删除未保存，记录仍然保留'))
  h.setStorageFails(false);assert(h.confirmHistoryDeletion())
  assert.deepEqual(h.saved().history.map(record=>record.id),['a'])
})

test('deletion uses a confirmation snapshot rather than duplicate IDs or shifting array indices', () => {
  const h=harness({history:[practiceRecord('same'),practiceRecord('same',2),practiceRecord(undefined)]})
  h.navigate('progress');h.toggleHistoryManagement();h.selectHistoryRecord(1,true);h.requestHistoryDeletion()
  const extra=practiceRecord('new')
  h.state.user.history.unshift(extra)
  h.selectAllHistoryRecords(true)
  assert.equal(h.selectedHistoryRecords().length,1,'Confirmation blocks changing selection behind its dialog')
  assert(h.confirmHistoryDeletion())
  assert.deepEqual(h.saved().history.map(record=>record.id||'no-id'),['new','same','no-id'])
  assert.equal(h.saved().history[1].questions[0].selected,0,'The other record with the same ID must survive')
  assert.equal(h.confirmHistoryDeletion(),false,'A second confirm cannot remove anything else')
})

test('all histories including unavailable old records can be removed, leaving a disabled bulk action', () => {
  const h=harness({history:[practiceRecord('a'),{id:'old',questions:[{id:'removed',seconds:1}],totalSeconds:1}]})
  h.navigate('progress');h.toggleHistoryManagement();h.selectAllHistoryRecords(true);h.requestHistoryDeletion();h.confirmHistoryDeletion()
  assert.equal(h.saved().history.length,0);assert.equal(h.state.historyManaging,false)
  const html=h.renderTimingHistory()
  assert(html.includes('还没有计时记录'))
  assert(/data-action="history-manage"[^>]*disabled/.test(html))
  h.toggleHistoryManagement();assert.equal(h.state.historyManaging,false)
  assert.equal(h.requestHistoryDeletion(),false)
})

test('question notes appear after submission, persist per question and reopen from historical review', () => {
  const h=harness();h.startQuiz(h.state.data.questions.slice(0,2))
  assert(!h.renderQuiz().includes('data-action="note-toggle"'))
  h.state.sessionAnswers={'test-1':0,'test-2':1};h.submitSession();h.toggleQuestionNote()
  assert(h.renderQuiz().includes('我的笔记'))
  h.saveQuestionNote('test-1','第一题：记忆方法')
  h.changeQuestion(1);h.toggleQuestionNote();h.saveQuestionNote('test-2','第二题：易错点')
  h.changeQuestion(0)
  assert(h.renderQuestionNotes(fixtures[0]).includes('第一题：记忆方法'))
  assert(!h.renderQuestionNotes(fixtures[0]).includes('第二题：易错点'))
  const reloaded=harness(h.saved(),h.draftSaved(),false,h.notesSaved())
  reloaded.openHistoryRecord(0);reloaded.toggleQuestionNote()
  assert(reloaded.renderQuiz().includes('第一题：记忆方法'))
  reloaded.changeQuestion(1);assert(reloaded.renderQuiz().includes('第二题：易错点'))
})

test('note input preserves whitespace and markup literally without re-rendering the focused editor', () => {
  const h=harness({history:[practiceRecord('notes')]});h.openHistoryRecord(0);h.toggleQuestionNote()
  const text='\n中文  空格\n  English words  <b>bold</b>\n</textarea><script>alert("x")</script> & 原样'
  const editor=h.element('.note-editor');editor.dataset.questionNote='test-1';editor.value=text
  const before=h.element('#mainContent').innerHTML
  h.fire('input',{target:editor})
  assert.equal(h.notesSaved()['test-1'],text)
  assert.equal(h.element('#mainContent').innerHTML,before,'Typing must not replace the textarea or reset its caret')
  const html=h.renderQuestionNotes(fixtures[0])
  assert(/<textarea[^>]*>\n\n中文/.test(html),'An extra template LF must protect the user’s leading LF from HTML textarea parsing')
  assert(html.includes('中文  空格\n  English words'))
  assert(html.includes('&lt;/textarea&gt;&lt;script&gt;'))
  assert(!html.includes('<script>'));assert(!html.includes('<b>bold</b>'))
})

test('unsaved notes remain in memory on storage failure and retry persists the full note map', () => {
  const h=harness({history:[practiceRecord('note-quota')]},null,true)
  h.openHistoryRecord(0);h.toggleQuestionNote()
  assert.equal(h.saveQuestionNote('test-1','尚未写入磁盘的笔记'),false)
  assert.equal(h.state.notes['test-1'],'尚未写入磁盘的笔记')
  assert.equal(h.notesSaved(),null)
  assert(h.renderQuestionNotes(fixtures[0]).includes('尚未保存，请重试'))
  h.setStorageFails(false);assert(h.saveQuestionNote('test-2','第二条笔记'))
  assert.equal(h.notesSaved()['test-1'],'尚未写入磁盘的笔记')
  assert.equal(h.state.noteSaveErrors.size,0)
  assert(h.renderQuestionNotes(fixtures[0]).includes('已自动保存'))
})

test('batch deletion of practice records never removes notes or other saved data', () => {
  const h=harness({history:[practiceRecord('a'),practiceRecord('b')]},null,false,{'test-1':'独立保存的笔记'})
  h.navigate('progress');h.toggleHistoryManagement();h.selectAllHistoryRecords(true);h.requestHistoryDeletion()
  assert(h.confirmHistoryDeletion());assert.equal(h.saved().history.length,0)
  assert.equal(h.notesSaved()['test-1'],'独立保存的笔记')
  const reloaded=harness(h.saved(),null,false,h.notesSaved())
  assert.equal(reloaded.state.notes['test-1'],'独立保存的笔记')
})

test('a late input from a previous question is saved under its captured question ID', () => {
  const h=harness({history:[practiceRecord('late-input')]});h.openHistoryRecord(0);h.toggleQuestionNote()
  const oldEditor=h.element('.old-note-editor');oldEditor.dataset.questionNote='test-1';oldEditor.value='切题时完成的输入'
  h.changeQuestion(1);h.saveQuestionNote('test-2','第二题原有内容')
  h.fire('input',{target:oldEditor})
  assert.equal(h.notesSaved()['test-1'],'切题时完成的输入')
  assert.equal(h.notesSaved()['test-2'],'第二题原有内容')
  assert.equal(h.saveQuestionNote('unknown-question','不能保存'),false)
  assert.equal(h.notesSaved()['unknown-question'],undefined)
})

test('note loading accepts only string entries and clearing a note leaves histories intact', () => {
  const invalid=harness(null,null,false,['invalid-array'])
  assert.equal(Object.keys(invalid.state.notes).length,0)
  const h=harness({history:[practiceRecord('keep')]},null,false,{'test-1':'有效',bad:{text:'旧结构'},other:123})
  assert.equal(Object.getPrototypeOf(h.state.notes),null)
  assert.equal(h.state.notes['test-1'],'有效');assert.equal(h.state.notes.bad,undefined)
  assert(h.saveQuestionNote('test-1',''))
  assert.deepEqual(h.notesSaved(),{})
  assert.equal(h.saved().history.length,1)
})

test('all five progress album cards open their own paper lists and return to progress', () => {
  const h = harness({ history: [practiceRecord('album-navigation')], wrong: ['test-1'], favorites: ['test-2'] })
  h.state.data = JSON.parse(fs.readFileSync(path.join(repo, 'data/questions.json'), 'utf8'))
  assert.equal(h.state.data.albums.length, 5)
  const savedBefore = JSON.stringify(h.saved())
  const userBefore = JSON.stringify(h.state.user)
  h.navigate('progress')
  const html = h.element('#mainContent').innerHTML
  assert.equal((html.match(/<button type="button" class="progress-card" data-album=/g) || []).length, 5, 'Every album card must be a native keyboard-accessible button')
  for (const album of h.state.data.albums) {
    assert(html.includes(`data-album="${album.id}"`))
    assert(html.includes(`查看${album.title}套卷列表`))
    const card = h.element('.progress-card'); card.dataset.album = album.id
    const title = new h.Element('.progress-card-title', card)
    h.fire('click', { target: title })
    assert.equal(h.state.route, 'album')
    assert.equal(h.state.selectedAlbum.id, album.id)
    const albumHtml = h.element('#mainContent').innerHTML
    assert(albumHtml.includes(`<h1>${album.title}</h1>`))
    assert.equal((albumHtml.match(/class="paper-row" data-paper=/g) || []).length, album.papers.length)
    h.goBack()
    assert.equal(h.state.route, 'progress')
  }
  assert.equal(JSON.stringify(h.state.user), userBefore)
  assert.equal(JSON.stringify(h.saved()), savedBefore)
})

test('opening an album from progress preserves the unfinished draft, progress, notes and history', () => {
  const h = harness({ history: [practiceRecord('keep-history')], attempts: { 'test-3': { selected: 2, correct: true } }, wrong: ['test-1'], favorites: ['test-2'] }, null, false, { 'test-1': '保留笔记' })
  h.startQuiz(h.state.data.questions)
  h.state.sessionAnswers['test-1'] = 1
  h.advance(1600)
  h.changeQuestion(1)
  h.advance(2400)
  h.navigate('progress')
  const savedBefore = JSON.stringify(h.saved())
  const userBefore = JSON.stringify(h.state.user)
  const draftBefore = JSON.stringify(h.draftSaved())
  const notesBefore = JSON.stringify(h.notesSaved())
  const card = h.element('.progress-card'); card.dataset.album = 'test'
  h.fire('click', { target: card })
  h.advance(10000)
  assert.equal(h.state.route, 'album')
  h.goBack()
  assert.equal(h.state.route, 'progress')
  assert.equal(JSON.stringify(h.state.user), userBefore)
  assert.equal(JSON.stringify(h.saved()), savedBefore)
  assert.equal(JSON.stringify(h.draftSaved()), draftBefore)
  assert.equal(JSON.stringify(h.notesSaved()), notesBefore)
  const reloaded = harness(h.saved(), h.draftSaved(), false, h.notesSaved())
  assert(reloaded.continueDraft())
  assert.equal(reloaded.state.sessionIndex, 1)
  assert.equal(reloaded.state.sessionAnswers['test-1'], 1)
  assert.equal(reloaded.getSessionMilliseconds(), 4000)
})

function finishPaper(h) {
  for (const question of h.state.session) h.state.sessionAnswers[question.id] = question.answer
  h.submitSession()
}

test('pitfall manual is inaccessible until submission, including forged actions and direct rendering', () => {
  const h=harness();h.startQuiz(h.state.data.questions)
  assert(!h.renderQuiz().includes('查看挖坑手册'))
  assert.equal(h.openPitfallManual(),false)
  assert.equal(h.renderPitfallManual(),'')
  const action=h.element('.pitfall-action');action.dataset.action='open-pitfalls';h.fire('click',{target:action})
  assert.equal(h.state.pitfallOpen,false)
  assert.equal(h.pitfallScope().questions.length,0)
  h.state.pitfallOpen=true
  assert.equal(h.renderPitfallManual(),'')
  assert(!h.renderQuiz().includes('pitfall-list'))
  h.state.pitfallOpen=false;finishPaper(h)
  assert(h.renderQuiz().includes('查看挖坑手册'))
  h.fire('click',{target:action});assert.equal(h.state.pitfallOpen,true)
})

test('a fully correct submitted paper still collects every false statement in source order', () => {
  const h=harness();h.state.data=JSON.parse(fs.readFileSync(path.join(repo,'data/questions.json'),'utf8'))
  const paper=h.state.data.questions.filter(q=>q.id.startsWith('xh-special-')&&q.paper==='第02套')
  h.startQuiz(paper);for(const q of paper)h.state.sessionAnswers[q.id]=q.answer
  h.submitSession();assert(h.openPitfallManual())
  const scope=h.pitfallScope();assert.equal(scope.questions.length,20)
  const entries=h.collectPitfalls(scope.questions)
  assert(entries.length>0,'Include false source statements even when the user answered every question correctly')
  assert.equal(entries[0].question.id,'xh-special-021');assert.equal(entries[0].item.label,'③')
  assert.equal(entries[1].question.id,'xh-special-021');assert.equal(entries[1].item.label,'④')
  const html=h.renderPitfallManual()
  assert(html.includes('一致性中寻求多样性')&&html.includes('<strong>多样性中寻求一致性</strong>'))
  assert(html.includes('以人民为中心')&&html.includes('<strong>党的领导</strong>'))
  assert(html.includes('aria-label="错误词句：'))
  assert.deepEqual(Array.from(html.matchAll(/data-pitfall-entry="(\d+)"/g),m=>Number(m[1])),Array.from({length:entries.length},(_,i)=>i+1))
  assert.equal((html.match(/data-pitfall-entry=/g)||[]).length,entries.length)
  assert(entries.every(entry=>entry.item.verdict==='incorrect'))
})

test('one-question historical records expand to the entire paper without fabricating historical answers', () => {
  const full=JSON.parse(fs.readFileSync(path.join(repo,'data/questions.json'),'utf8'))
  const q=full.questions.find(q=>q.id==='xh-special-029')
  const record={id:'partial',submittedAt:1800000000000,title:`${q.album} · ${q.paper}`,totalSeconds:12,correctCount:1,questions:[{id:q.id,selected:q.answer,correct:true,seconds:12}]}
  const h=harness({history:[record]},null,false,{[q.id]:'原有笔记'});h.state.data=full
  h.openHistoryRecord(0);const stored=JSON.stringify(h.saved());const notes=JSON.stringify(h.notesSaved())
  const beforeSession=h.state.session
  assert.equal(h.state.session.length,1)
  const summary=h.renderQuiz()
  assert(summary.includes('查看挖坑手册')&&!summary.includes('正在回看当次选择、答案与解析'))
  assert(!/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}/.test(summary),'Do not show the submission timestamp in the result banner')
  h.openPitfallManual();assert.equal(h.pitfallScope().questions.length,20)
  const entries=h.collectPitfalls(h.pitfallScope().questions)
  assert(entries.some(entry=>entry.question.id==='xh-special-040'),'Unvisited questions in the same paper must be included')
  const html=h.renderPitfallManual()
  assert(html.includes('查看原题'))
  assert(!html.includes('data-pitfall-jump="xh-special-040"'),'Do not pretend an unrecorded question has historical answers')
  assert.equal(h.jumpFromPitfall('xh-special-040'),false)
  assert.equal(h.state.session,beforeSession);assert.equal(h.state.session.length,1)
  assert(h.jumpFromPitfall(q.id),'The current question must close the manual even when its index does not change')
  assert.equal(h.state.pitfallOpen,false);assert(!h.element('#mainContent').innerHTML.includes('class="pitfall-list"'))
  assert.equal(JSON.stringify(h.saved()),stored);assert.equal(JSON.stringify(h.notesSaved()),notes)
  assert.equal(h.state.sessionRecord.totalSeconds,12);assert.equal(h.state.sessionRecord.correctCount,1)
  assert.equal(h.state.sessionAnswers[q.id],q.answer)
})

test('custom and mixed-paper manuals keep exactly the practiced question set and its order', () => {
  const h=harness();h.state.data=JSON.parse(fs.readFileSync(path.join(repo,'data/questions.json'),'utf8'))
  const byId=id=>h.state.data.questions.find(q=>q.id===id)
  h.startQuiz([byId('xh-special-029'),byId('cg-003')],0,{title:'随机十题'});finishPaper(h);h.openPitfallManual()
  assert.deepEqual(Array.from(h.pitfallScope().questions,q=>q.id),['xh-special-029','cg-003'])
  const html=h.renderPitfallManual();assert(html.includes('小黑 · 政治理论专项十套卷 · 第02套 · 原第 29 题'))
  assert(html.includes('超格 · 政治理论考前200题 · 第01套 · 原第 3 题'))
  h.navigate('home');assert.equal(h.state.pitfallOpen,false)
  h.startQuiz([byId('xh-special-029'),byId('xh-special-021')],0,{title:'错题练习'});finishPaper(h);h.openPitfallManual()
  assert.deepEqual(Array.from(h.pitfallScope().questions,q=>q.id),['xh-special-029','xh-special-021'])
})

test('manual navigation, swipes and font changes preserve the original review, storage and frozen times', () => {
  const h=harness({history:[practiceRecord('manual-review')],wrong:['test-2'],favorites:['test-1']},null,false,{'test-1':'笔记'})
  h.startQuiz(h.state.data.questions);h.state.sessionAnswers['test-1']=2;h.advance(1700);h.changeQuestion(1);h.advance(2300)
  h.openHistoryRecord(0)
  const before={user:JSON.stringify(h.state.user),saved:JSON.stringify(h.saved()),draft:JSON.stringify(h.draftSaved()),notes:JSON.stringify(h.notesSaved()),session:h.state.session,index:h.state.sessionIndex,answers:JSON.stringify(h.state.sessionAnswers),times:JSON.stringify(h.state.sessionTimes),record:JSON.stringify(h.state.sessionRecord)}
  h.openPitfallManual();h.advance(60000);h.swipe({dx:-120});assert.equal(h.state.sessionIndex,before.index)
  h.goBack();assert.equal(h.state.route,'quiz');assert.equal(h.state.pitfallOpen,false)
  h.openPitfallManual();assert(h.jumpFromPitfall('test-2'));assert.equal(h.state.sessionIndex,1)
  h.openPitfallManual();assert.equal(h.jumpFromPitfall('unknown'),false);h.closePitfallManual()
  assert.equal(h.state.session,before.session);assert.equal(JSON.stringify(h.state.sessionAnswers),before.answers)
  assert.equal(JSON.stringify(h.state.sessionTimes),before.times);assert.equal(JSON.stringify(h.state.sessionRecord),before.record)
  assert.equal(JSON.stringify(h.state.user),before.user);assert.equal(JSON.stringify(h.saved()),before.saved)
  assert.equal(JSON.stringify(h.draftSaved()),before.draft);assert.equal(JSON.stringify(h.notesSaved()),before.notes)
  assert.equal(h.getSessionMilliseconds(),12000)
  h.openPitfallManual();h.setQuizFont('large');assert(h.state.pitfallOpen);assert(h.element('#mainContent').innerHTML.includes('pitfall-list'))
})

test('all 55 paper manuals retain every reviewed error, including source-only errors, and exclude contextual statements', () => {
  const h=harness();h.state.data=JSON.parse(fs.readFileSync(path.join(repo,'data/questions.json'),'utf8'))
  let papers=0,total=0
  for(const album of h.state.data.albums)for(const paper of album.papers){
    papers++
    const questions=h.state.data.questions.filter(q=>q.album===album.title&&q.paper===paper.name)
    const expected=questions.flatMap(q=>{const f=h.referenceFormatter.format(q)||h.referenceFormatter.formatOptions(q);return(f?.items||[]).filter(i=>i.verdict==='incorrect').map(i=>`${q.id}:${i.label}`)})
    const entries=h.collectPitfalls(questions)
    assert.deepEqual(Array.from(entries,e=>`${e.question.id}:${e.item.label}`),Array.from(expected))
    assert(entries.every(e=>e.item.verdict==='incorrect'&&!e.item.contextual))
    total+=entries.length
  }
  assert.equal(papers,55);assert.equal(total,1447)
  for(const [id,label]of [['xh-500-158','②'],['xh-500-174','④'],['xh-special-159','B']]){
    const q=h.state.data.questions.find(q=>q.id===id)
    h.startQuiz([q]);finishPaper(h);h.openPitfallManual()
    const entry=h.collectPitfalls([q]).find(e=>e.item.label===label)
    assert(entry&&entry.item.reason,`${id}:${label}: retain errors even without an approved inline replacement`)
    assert(h.renderPitfallManual().replace(/<[^>]+>/g,'').includes(entry.item.text))
    assert(h.renderPitfallManual().includes('说明：'))
  }
})

test('empty manuals and unsafe source text render safely without partial entries or executable markup', () => {
  const h=harness();h.startQuiz(h.state.data.questions);finishPaper(h);h.openPitfallManual()
  assert(h.renderPitfallManual().includes('没有需要收集的错误表述'))
  const evil={...h.state.data.questions[0],stem:'①<script>alert(1)</script>②第二项的原始内容',explanation:'①错误：来源仅指出错误。',options:['1项','2项','3项','4项'],answer:0,answerLetter:'A'}
  h.state.data.questions=[evil];h.startQuiz([evil]);finishPaper(h);h.openPitfallManual()
  const html=h.renderPitfallManual();assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'))
  assert(html.includes('data-pitfall-entry="1"'))
})

console.log(`PASS: ${passed} quiz navigation, gesture, timing, persistence and reference scenarios`)
