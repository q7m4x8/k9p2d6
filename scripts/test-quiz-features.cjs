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
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (storageFails) throw new Error('QuotaExceededError'); storage.set(key, String(value)) }, removeItem: key => storage.delete(key) },
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
  vm.runInContext(source + `\nglobalThis.testApi = {state, startQuiz, navigate, goBack, changeQuestion, pauseQuizTiming, resumeQuizTiming, getQuestionMilliseconds, getSessionMilliseconds, formatDuration, submitSession, render, renderQuiz, renderProgress, renderReferenceAnswer, conciseReferenceReason, saveUserState, setQuizFont, continueDraft};`, context)
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

console.log(`PASS: ${passed} quiz navigation, gesture, timing, persistence and reference scenarios`)
