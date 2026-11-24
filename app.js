const STORAGE_KEY = 'xiaotian_quiz_state_v1'
const DRAFT_KEY = 'xiaotian_quiz_draft_v1'
const NOTES_KEY = 'xiaotian_quiz_notes_v1'
const PITFALL_FAVORITES_KEY = 'xiaotian_quiz_pitfall_favorites_v1'
const USER_DEFAULTS = { attempts: {}, wrong: [], favorites: [], theme: 0, quizFont: 'small', history: [] }
const themes = [
  { accent: '#ff7a1a', soft: '#fff0df', ink: '#c84f00', glow: '#fff0e2' },
  { accent: '#2878e8', soft: '#e9f2ff', ink: '#1559aa', glow: '#eaf2ff' },
  { accent: '#23a56f', soft: '#e6f7ef', ink: '#14734d', glow: '#e7f8ef' },
  { accent: '#8d6547', soft: '#f5ede7', ink: '#62442f', glow: '#f7ede4' },
  { accent: '#6573dc', soft: '#eceeff', ink: '#4752ad', glow: '#ecefff' },
  { accent: '#8e62dc', soft: '#f1eaff', ink: '#6742a8', glow: '#f2ebff' }
]

const state = {
  data: null,
  sourceExplanations: null,
  route: 'home',
  selectedAlbum: null,
  session: [],
  sessionIndex: 0,
  sessionAnswers: {},
  sessionSubmitted: false,
  pitfallOpen: false,
  pitfallFavorites: loadPitfallFavorites(),
  favoriteTab: 'questions',
  reviewingHistory: false,
  historySkippedQuestions: 0,
  historyManaging: false,
  historySelection: new Set(),
  pendingHistoryDeletion: null,
  notes: loadQuestionNotes(),
  openNotes: new Set(),
  touchedNotes: new Set(),
  noteSaveErrors: new Set(),
  sessionTimes: {},
  timerStartedAt: null,
  sessionRecord: null,
  sessionTitle: '',
  quizReturn: { route: 'home' },
  backStack: [],
  user: loadUserState()
}

const main = document.querySelector('#mainContent')
const toast = document.querySelector('#toast')
let storageWarningShown = false
let pendingAutoAdvance = null

function cancelAutoAdvance() {
  if (pendingAutoAdvance !== null) clearTimeout(pendingAutoAdvance)
  pendingAutoAdvance = null
}

function scheduleAutoAdvance() {
  cancelAutoAdvance()
  if (state.sessionIndex >= state.session.length - 1) return
  const session = state.session
  const index = state.sessionIndex
  const id = currentQuestion().id
  const answer = state.sessionAnswers[id]
  pendingAutoAdvance = setTimeout(() => {
    pendingAutoAdvance = null
    if (state.route !== 'quiz' || document.hidden || window.QuizAnnotations?.active() || state.sessionSubmitted || state.session !== session ||
      state.sessionIndex !== index || currentQuestion()?.id !== id || state.sessionAnswers[id] !== answer) return
    suppressAutoAnswerUntil = performance.now() + 250
    changeQuestion(index + 1)
  }, 500)
}

function loadUserState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
    let draft = null
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY)) } catch {}
    return { ...USER_DEFAULTS, ...saved, history: Array.isArray(saved.history) ? saved.history.filter(item => item && Array.isArray(item.questions)).slice(0, 50) : [], draft }
  } catch {
    return { ...USER_DEFAULTS, draft: null }
  }
}

function loadQuestionNotes() {
  const notes = Object.create(null)
  try {
    const saved = JSON.parse(localStorage.getItem(NOTES_KEY))
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [id, text] of Object.entries(saved)) if (typeof text === 'string') notes[id] = text
    }
  } catch {}
  return notes
}

function validPitfallKey(key) {
  return typeof key === 'string' && !/\s/.test(key) && /^[a-zA-Z0-9][a-zA-Z0-9_-]*:[A-D①-⑳]$/u.test(key)
}

function loadPitfallFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(PITFALL_FAVORITES_KEY))
    return Array.isArray(saved) ? [...new Set(saved.filter(validPitfallKey))] : []
  } catch { return [] }
}

function questionNoteStatus(id) {
  return state.noteSaveErrors.has(id) ? '尚未保存，请重试；当前输入仍保留在本页。'
    : state.touchedNotes.has(id) || state.notes[id] ? '已自动保存' : '输入后自动保存到当前浏览器'
}

function saveQuestionNote(id, text) {
  if (typeof text !== 'string' || !state.data?.questions.some(question => question.id === id)) return false
  if (text) state.notes[id] = text
  else delete state.notes[id]
  state.touchedNotes.add(id)
  const saved = writeStorage(NOTES_KEY, state.notes)
  if (saved) state.noteSaveErrors.clear()
  else state.noteSaveErrors.add(id)
  // Do not re-render the editor on input: keep focus, selection and IME composition intact.
  document.querySelectorAll('[data-note-status]').forEach(element => {
    if (element.dataset.noteStatus === id) element.textContent = questionNoteStatus(id)
  })
  document.querySelectorAll('[data-note-retry]').forEach(element => {
    if (element.dataset.noteRetry === id) element.hidden = saved
  })
  return saved
}

function toggleQuestionNote() {
  const question = currentQuestion()
  if (state.route !== 'quiz' || !state.sessionSubmitted || !question) return
  const opening = !state.openNotes.has(question.id)
  if (opening) state.openNotes.add(question.id)
  else state.openNotes.delete(question.id)
  render()
  if (opening) document.querySelector('[data-question-note]')?.focus?.()
}

function renderQuestionNoteButton(question) {
  const open = state.openNotes.has(question.id)
  return `<button class="mini-btn ghost question-note-toggle" data-action="note-toggle" aria-expanded="${open}" aria-controls="notes-${escapeHtml(question.id)}">${open ? '收起笔记' : state.notes[question.id] ? '查看笔记' : '写笔记'}</button>`
}

function renderQuestionNotes(question) {
  const id = escapeHtml(question.id)
  return `<section class="question-notes" id="notes-${id}" ${state.openNotes.has(question.id) ? '' : 'hidden'}><label for="note-input-${id}">我的笔记</label><textarea id="note-input-${id}" data-question-note="${id}" rows="4" placeholder="记下解题思路、易错点或记忆方法…" aria-describedby="note-status-${id}">\n${escapeHtml(state.notes[question.id] || '')}</textarea><div class="note-save-row"><span id="note-status-${id}" data-note-status="${id}" role="status" aria-live="polite">${escapeHtml(questionNoteStatus(question.id))}</span><button class="mini-btn ghost" data-action="note-retry" data-note-retry="${id}" ${state.noteSaveErrors.has(question.id) ? '' : 'hidden'}>重试保存</button></div></section>`
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true } catch {
    if (!storageWarningShown) {
      storageWarningShown = true
      showToast('浏览器暂时无法保存记录，请勿关闭当前页面')
    }
    return false
  }
}

function saveUserState() {
  const { draft, ...saved } = state.user
  return writeStorage(STORAGE_KEY, saved)
}

function formatDuration(milliseconds) {
  const seconds = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000)
  const hh = Math.floor(seconds / 3600)
  const mm = Math.floor(seconds / 60) % 60
  const ss = seconds % 60
  return `${hh ? `${String(hh).padStart(2, '0')}:` : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function getQuestionMilliseconds(id) {
  const saved = state.sessionTimes[id] || 0
  return saved + (state.timerStartedAt !== null && currentQuestion()?.id === id ? Math.max(0, performance.now() - state.timerStartedAt) : 0)
}

function getSessionMilliseconds() {
  if (state.reviewingHistory && state.sessionRecord) return state.sessionRecord.totalSeconds * 1000
  return state.session.reduce((sum, question) => sum + getQuestionMilliseconds(question.id), 0)
}

function wasAnswerCorrect(question) {
  const recorded = state.reviewingHistory && state.sessionRecord?.questions.find(entry => entry.id === question.id)
  return typeof recorded?.correct === 'boolean' ? recorded.correct : state.sessionAnswers[question.id] === question.answer
}

function practiceDate(record) {
  const date = new Date(record.submittedAt)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '日期未记录'
}

function recordedQuestionMilliseconds(id) {
  const entry = state.sessionSubmitted && state.sessionRecord?.questions.find(item => item.id === id)
  return entry ? entry.seconds * 1000 : getQuestionMilliseconds(id)
}

function updateTimerDisplay() {
  const visible = state.route === 'quiz' && !!currentQuestion()
  document.querySelector('#quizTimer').hidden = !visible
  if (!visible) return
  document.querySelector('#questionTimer').textContent = formatDuration(recordedQuestionMilliseconds(currentQuestion().id))
  document.querySelector('#sessionTimer').textContent = formatDuration(getSessionMilliseconds())
}

function persistDraft() {
  if (!state.session.length || state.sessionSubmitted) return
  const times = Object.fromEntries(state.session.map(question => [question.id, getQuestionMilliseconds(question.id)]))
  state.user.draft = { version: 1, ids: state.session.map(question => question.id), index: state.sessionIndex, answers: { ...state.sessionAnswers }, times, returnTo: { ...state.quizReturn }, title: state.sessionTitle, updatedAt: Date.now() }
  writeStorage(DRAFT_KEY, state.user.draft)
}

function pauseQuizTiming() {
  cancelAutoAdvance()
  if (state.timerStartedAt !== null) {
    const question = currentQuestion()
    if (question) state.sessionTimes[question.id] = getQuestionMilliseconds(question.id)
    state.timerStartedAt = null
  }
  persistDraft()
  updateTimerDisplay()
}

function resumeQuizTiming() {
  if (state.route === 'quiz' && !state.sessionSubmitted && !document.hidden && currentQuestion() && state.timerStartedAt === null) state.timerStartedAt = performance.now()
  updateTimerDisplay()
}

function continueDraft() {
  const draft = state.user.draft
  if (!draft || !Array.isArray(draft.ids) || !draft.ids.length || !state.data) return false
  const byId = new Map(state.data.questions.map(question => [question.id, question]))
  if (new Set(draft.ids).size !== draft.ids.length || draft.ids.some(id => !byId.has(id))) return false
  pauseQuizTiming()
  state.session = draft.ids.map(id => byId.get(id))
  state.sessionIndex = Math.max(0, Math.min(Number.isInteger(draft.index) ? draft.index : 0, state.session.length - 1))
  state.sessionAnswers = {}
  state.sessionTimes = {}
  for (const question of state.session) {
    const answer = draft.answers?.[question.id]
    if (Number.isInteger(answer) && answer >= 0 && answer < question.options.length) state.sessionAnswers[question.id] = answer
    const time = draft.times?.[question.id]
    state.sessionTimes[question.id] = Number.isFinite(time) && time >= 0 ? time : 0
  }
  state.sessionSubmitted = false
  state.reviewingHistory = false
  state.historySkippedQuestions = 0
  state.sessionRecord = null
  state.sessionTitle = draft.title || '继续练习'
  state.quizReturn = draft.returnTo && ['home', 'album', 'wrong', 'favorites', 'progress'].includes(draft.returnTo.route) ? draft.returnTo : { route: 'home' }
  navigate('quiz')
  persistDraft()
  return true
}

function setTheme(index) {
  const theme = themes[index] || themes[0]
  const root = document.documentElement.style
  root.setProperty('--accent', theme.accent)
  root.setProperty('--accent-soft', theme.soft)
  root.setProperty('--accent-ink', theme.ink)
  root.setProperty('--page-glow', theme.glow)
  state.user.theme = index
  saveUserState()
  renderThemePicker()
}

function setQuizFont(size) {
  if (window.QuizAnnotations?.active()) return showToast('请先退出画笔，再调整字号')
  const nextSize = ['small', 'medium', 'large'].includes(size) ? size : 'small'
  document.documentElement.dataset.quizFont = nextSize
  state.user.quizFont = nextSize
  saveUserState()
  document.querySelectorAll('button[data-quiz-font]').forEach(button => {
    const selected = button.dataset.quizFont === nextSize
    button.classList.toggle('active', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
}

function renderFontControls() {
  return `<div class="font-controls" role="group" aria-label="调整全局字号">
    <span>字号</span>
    ${[['small', '小'], ['medium', '中'], ['large', '大']].map(([size, label]) =>
      `<button data-quiz-font="${size}" class="${state.user.quizFont === size ? 'active' : ''}" aria-label="${label}字号" aria-pressed="${state.user.quizFont === size}">${label}</button>`
    ).join('')}
  </div>`
}

function openFontSettings() {
  document.querySelector('#modalRoot').innerHTML = `<div class="modal-backdrop"><section class="modal font-settings" role="dialog" aria-modal="true" aria-labelledby="fontSettingsTitle"><h2 id="fontSettingsTitle">字体大小</h2><p>首页、题库、做题、进度、错题和收藏都会一起调整。</p>${renderFontControls()}<p>选择后立即生效，下次打开仍会保留。</p><button class="btn primary" data-action="close-modal">完成</button></section></div>`
}

function renderThemePicker() {
  document.querySelector('#themePicker').innerHTML = themes.map((theme, index) =>
    `<button class="theme-dot ${state.user.theme === index ? 'active' : ''}" style="--dot:${theme.accent}" data-theme="${index}" aria-label="切换主题色"></button>`
  ).join('')
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function escapeQuizText(value = '') {
  return escapeHtml(window.QuizText ? window.QuizText.normalize(value) : value)
}

function isOriginalAnnotated(question) {
  return question?.referenceMode === 'original-annotated'
}

function originalImageAsset(image, role) {
  if (!image || typeof image.file !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(?:webp|png|jpe?g)$/i.test(image.file)) return null
  if (!['answer', 'question'].includes(role)) return null
  return `./data/zhanggong/${role === 'question' ? 'questions' : 'answers'}/${image.file}?v=20261123-10`
}

function renderOriginalImage(question, image, index, total, role) {
  const asset = originalImageAsset(image, role)
  if (!asset) return ''
  const isQuestion = role === 'question'
  const page = Number.isInteger(image.page) && image.page > 0 ? `${isQuestion ? '讲义' : '笔记'}第 ${image.page} 页` : isQuestion ? '原题' : '原版笔记'
  const position = total > 1 ? ` · ${index + 1}/${total}` : ''
  const caption = image.caption ? `<span class="original-image-caption">${escapeHtml(image.caption)}</span>` : ''
  const dimensions = ['width', 'height'].map(name => Number.isInteger(image[name]) && image[name] > 0 && image[name] <= 100000 ? ` ${name}="${image[name]}"` : '').join('')
  const label = `${question.album || '张弓选词大典'}第 ${question.number} 题${isQuestion ? '原题' : '原版解析'}，${page}${position}`
  return `<figure class="original-image-page ${isQuestion ? 'original-question-page' : 'original-answer-page'}" data-original-role="${role}"><figcaption><span>${escapeHtml(page + position)}${caption}</span><a href="${escapeHtml(asset)}" target="_blank" rel="noopener noreferrer">查看原尺寸 ↗</a></figcaption><a class="original-image-link" href="${escapeHtml(asset)}" target="_blank" rel="noopener noreferrer" aria-label="新标签查看${isQuestion ? '原题' : '原版解析'}原尺寸"><img class="original-notes-image" data-original-file="${escapeHtml(image.file)}" src="${escapeHtml(asset)}"${dimensions} loading="${isQuestion ? 'eager' : 'lazy'}" decoding="async" alt="${escapeHtml(label)}"></a><div class="original-image-error" role="status" hidden><p>${isQuestion ? '原题' : '原版解析'}图片加载失败，可重新加载或打开原尺寸查看。</p><button type="button" class="mini-btn ghost" data-action="retry-original-image">重新加载</button></div></figure>`
}

function renderOriginalReferenceAnswer(question, heading, notes) {
  if (!state.sessionSubmitted) return ''
  const images = Array.isArray(question.referenceImages) ? question.referenceImages : []
  const pages = images.map((image, index) => renderOriginalImage(question, image, index, images.length, 'answer')).join('')
  const content = pages || '<p class="original-image-unavailable">本题原版解析图片暂不可用，请稍后重试。</p>'
  const notice = typeof question.sourceNotice === 'string' && question.sourceNotice.trim() ? `<p class="original-source-notice">${escapeHtml(question.sourceNotice)}</p>` : ''
  return `<section class="reference-answer original-reference-answer" aria-label="原版笔记解析"><header class="reference-heading">${heading}<span>正确答案 <b>${escapeHtml(question.answerLetter)}</b></span></header>${notice}<p class="original-reference-hint">原版笔记解析 · 点击图片可在新标签查看原尺寸</p><div class="original-reference-pages">${content}</div>${notes}</section>`
}

function retryOriginalImage(button) {
  const figure = button?.closest('.original-image-page')
  const question = currentQuestion()
  if (state.route !== 'quiz' || !isOriginalAnnotated(question) || !figure) return false
  const role = figure.dataset.originalRole
  if (role === 'answer' && !state.sessionSubmitted) return false
  const image = figure.querySelector('img.original-notes-image')
  const asset = originalImageAsset({ file: image?.dataset.originalFile }, role)
  if (!asset) return false
  const error = figure.querySelector('.original-image-error')
  if (error) error.hidden = true
  image.hidden = false
  image.src = `${asset}&retry=${Date.now()}`
  return true
}

function displayQuestionStem(question) {
  if (isOriginalAnnotated(question)) return question.stem
  const fix = window.QuizReferenceReviews?.displayFixes?.[question.id]
  let stem = question.stem
  if (fix?.expectedStem === stem) for (const [before, after] of fix.replacements || []) stem = stem.replace(before, after)
  return stem
}

function conciseReferenceReason(reason, originalStatement) {
  const compact = value => String(value).normalize('NFKC').replace(/\s+/g, '').replace(/[“”"‘’「」『』]/g, '')
  return String(reason).replace(/[，,]\s*(?:而非|而不是)([^。！？；;\n]+)([。！？；;]|$)/g,
    (sentence, negated, punctuation) => compact(originalStatement).includes(compact(negated)) ? punctuation : sentence)
}

function referenceSupplement(question) {
  const record = window.QuizReferenceReviews?.supplements?.[question.id]
  return record?.approved && record.expectedExplanation === question.explanation && record.expectedStem === question.stem &&
    record.expectedAnswerLetter === question.answerLetter && JSON.stringify(record.expectedOptions) === JSON.stringify(question.options) ? record : null
}

function renderReferenceSources(question, supplement) {
  const data = window.QuizReferenceReviews
  if (!data) return ''
  const identifiers = new Set(supplement?.sources || [])
  for (const item of Object.values(data.entries || {})) {
    if (!item.key.startsWith(question.id + ':')) continue
    for (const identifier of item.sources || []) identifiers.add(identifier)
    for (const pair of item.pairs || []) if (pair.externalEvidence) identifiers.add(pair.externalEvidence)
  }
  const sources = [...identifiers].map(identifier => data.sources[identifier]).filter(Boolean)
  if (!sources.length) return ''
  const links = sources.map(source => (source.url && /^https:\/\//.test(source.url)) || (source.asset && /^[a-zA-Z0-9-]+\.webp$/.test(source.asset))
    ? `<a href="${escapeHtml(source.url || './data/source-explanations/' + source.asset)}" target="_blank" rel="noopener">${escapeHtml(source.title)}</a>`
    : `<span>${escapeHtml(source.title)}</span>`).join('；')
  const note = supplement?.note ? `<p>${escapeQuizText(supplement.note)}</p>` : ''
  return `<aside class="reference-sources">${note}<p>核对依据：${links}</p></aside>`
}

function renderReferenceSegments(segments) {
  return segments.map(segment => segment.type === 'correction'
    ? `<del class="reference-wrong" aria-label="错误词句：${escapeQuizText(segment.wrong)}">${escapeQuizText(segment.wrong)}</del><span class="reference-fix"><span>应为：</span><strong>${escapeQuizText(segment.correct)}</strong></span>`
    : segment.type === 'focus' ? `<mark class="reference-focus">${escapeHtml(segment.text)}</mark>`
      : segment.type === 'wrong-focus' ? `<del class="reference-wrong">${escapeHtml(segment.text)}</del>` : escapeHtml(segment.text)).join('')
}

function formatReference(question) {
  if (isOriginalAnnotated(question)) return null
  const formatter = window.QuizExplanationFormatter
  return formatter?.format(question) || formatter?.formatOptions(question)
}

function referenceStatus(item) {
  if (item.reviewStatus === 'source_unclear') return '待核对'
  if (item.verdict === 'correct') return '✓ 正确'
  if (item.verdict === 'incorrect') return '× 错误'
  if (item.contextual) return '题意不符'
  return item.manuallyReviewed ? '题意说明' : '原句'
}

function renderReferenceAnswer(question) {
  const heading = `<div class="reference-heading-title"><h3>参考答案</h3>${renderQuestionNoteButton(question)}</div>`
  const notes = renderQuestionNotes(question)
  if (isOriginalAnnotated(question)) return renderOriginalReferenceAnswer(question, heading, notes)
  const supplement = referenceSupplement(question)
  const original = supplement?.explanation || question.explanation || `正确答案：${question.answerLetter}`
  const sources = renderReferenceSources(question, supplement)
  const formatted = formatReference(question)
  if (!formatted) {
    const concise = conciseReferenceReason(original, [question.stem, ...(question.options || [])].join('\n'))
    return `<section class="reference-answer"><header class="reference-heading">${heading}<span>正确答案 <b>${escapeHtml(question.answerLetter)}</b></span></header><div class="reference-prose"><h4>答案解释</h4><p class="explanation-text">${escapeQuizText(concise)}</p></div>${sources}${notes}</section>`
  }
  const rows = formatted.items.map(item => {
    const hasCorrection = !!item.correctedRule || item.segments.some(segment => segment.type === 'correction')
    const verdict = ['correct', 'incorrect'].includes(item.verdict) ? item.verdict : 'unknown'
    const text = renderReferenceSegments(item.segments)
    const reasonText = item.reason ? escapeQuizText(conciseReferenceReason(item.reason, item.text)) : ''
    const reason = (!hasCorrection || item.needsExplanation) && verdict !== 'correct' && reasonText
      ? (hasCorrection
        ? `<details class="reference-extra"><summary>补充说明</summary><p class="reference-reason">${reasonText}</p></details>`
        : `<p class="reference-reason"><span>说明：</span>${reasonText}</p>`) : ''
    const reviewNote = item.reviewStatus === 'source_unclear' && item.reviewNote ? `<p class="reference-review-note">${escapeQuizText(item.reviewNote)}</p>` : ''
    const rule = item.correctedRule ? `<div class="reference-rule"><b>${verdict === 'unknown' ? '知识点说明' : '正确表述'}</b><p>${escapeQuizText(item.correctedRule)}</p></div>` : ''
    const favorite = state.sessionSubmitted ? renderPitfallFavorite(`${question.id}:${item.label}`, `参考答案 ${item.label}`) : ''
    return `<li class="reference-item ${verdict}"><div class="reference-item-head"><b>${escapeHtml(item.label)}</b><span class="reference-verdict ${verdict}">${referenceStatus(item)}</span>${favorite}</div><p class="reference-statement">${text}</p>${rule}${reviewNote}${reason}</li>`
  }).join('')
  const countText = /^\d+\s*项$/.test(question.options?.[question.answer] || '')
    ? `（${question.options[question.answer].replace(/\s/g, '')}）` : ''
  const emptyNote = formatted.mode === 'options' && !formatted.items.length ? `<p class="reference-reason">各选项的判断需结合题意，正确答案为 ${escapeHtml(question.answerLetter)}。</p>` : ''
  return `<section class="reference-answer" aria-label="参考答案"><header class="reference-heading">${heading}<span>正确答案 <b>${escapeHtml(question.answerLetter)}</b>${escapeHtml(countText)}</span></header><ol class="reference-items">${rows}</ol>${emptyNote}${sources}${notes}</section>`
}

function renderSourceExplanation(question) {
  const record = state.sourceExplanations?.questions?.[question.id]
  if (!record) return ''
  const sourceName = state.sourceExplanations.sources[record.source] || '原答案 PDF'
  const pages = [...new Set([...record.pages, ...(record.unavailablePages || [])])].sort((a, b) => a - b)
  const pageLabel = pages.length ? ` · PDF 第 ${pages.join('、')} 页` : ''
  const incomplete = record.sourceIncomplete
    ? `<p class="source-explanation-notice">${record.unavailablePages?.length ? `原答案 PDF 第 ${record.unavailablePages.join('、')} 页损坏，` : ''}本题原文解析不完整${record.images.length ? '，下方仅显示可读取的部分' : '，暂无可显示的原文图片'}。</p>`
    : ''
  const images = record.images.map((item, index) => `<figure class="source-explanation-page">
    <figcaption><span>PDF 第 ${item.page} 页${record.images.length > 1 ? ` · ${index + 1}/${record.images.length}` : ''}</span><a href="./data/source-explanations/${escapeHtml(item.file)}" target="_blank" rel="noopener">查看大图</a></figcaption>
    <img class="source-explanation-image" data-source-src="./data/source-explanations/${escapeHtml(item.file)}" width="${item.width}" height="${item.height}" loading="lazy" decoding="async" alt="${escapeHtml(question.paper)}本题原文解析，PDF第${item.page}页">
    <p class="source-explanation-error" hidden>原文图片加载失败，请收起后重试。</p>
  </figure>`).join('')
  return `<details class="source-explanation"><summary>查看原文解析</summary><div class="source-explanation-body"><p class="source-explanation-meta">来源：${escapeHtml(sourceName)}${pageLabel}</p>${incomplete}${images}</div></details>`
}

async function loadSourceExplanations() {
  try {
    const response = await fetch('./data/source-explanations/manifest.json?v=20261121-5')
    if (!response.ok) return
    state.sourceExplanations = await response.json()
    if (state.route === 'quiz' && state.sessionSubmitted) render()
  } catch {
    // Optional source images never block the question bank or saved progress.
  }
}

function showToast(message) {
  toast.textContent = message
  toast.classList.add('show')
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800)
}

function answeredIds() {
  return new Set(Object.keys(state.user.attempts))
}

function accuracy() {
  const attempts = Object.values(state.user.attempts)
  if (!attempts.length) return 0
  return Math.round(attempts.filter(item => item.correct).length / attempts.length * 100)
}

function questionsFor(albumId, paperName) {
  return state.data.questions.filter(item =>
    (!albumId || item.album === state.data.albums.find(album => album.id === albumId)?.title) &&
    (!paperName || item.paper === paperName)
  )
}

function draftMatchesQuestions(questions) {
  const ids = state.user.draft?.ids
  return Array.isArray(ids) && ids.length === questions.length && ids.every((id, index) => id === questions[index].id)
}

function albumProgress(album) {
  const ids = answeredIds()
  const questions = questionsFor(album.id)
  const done = questions.filter(item => ids.has(item.id)).length
  return { done, total: questions.length, percent: questions.length ? Math.round(done / questions.length * 100) : 0 }
}

function paperProgress(album, paper) {
  const ids = answeredIds()
  const questions = questionsFor(album.id, paper.name)
  const done = questions.filter(item => ids.has(item.id)).length
  return { done, total: questions.length, percent: questions.length ? Math.round(done / questions.length * 100) : 0 }
}

function navigate(route, options = {}) {
  state.pitfallOpen = false
  if (route !== 'progress') endHistoryManagement()
  cancelAutoAdvance()
  if (state.route === 'quiz' && route !== 'quiz') pauseQuizTiming()
  if (!options.replace && state.route !== route && state.route !== 'quiz' && route !== 'quiz') state.backStack.push({ route: state.route, albumId: state.selectedAlbum?.id })
  state.route = route
  if (options.albumId) state.selectedAlbum = state.data.albums.find(item => item.id === options.albumId)
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route))
  window.scrollTo({ top: 0, behavior: 'instant' })
  render()
  if (route === 'quiz') resumeQuizTiming()
}

function goBack() {
  if (state.pitfallOpen) return closePitfallManual()
  const destination = state.route === 'quiz' ? state.quizReturn : state.backStack.pop() || { route: 'home' }
  navigate(destination.route, { albumId: destination.albumId, replace: true })
}

function render() {
  if (!state.data) return
  window.QuizAnnotations?.beforeRender()
  const renderers = {
    home: renderHome,
    album: renderAlbum,
    quiz: renderQuiz,
    progress: renderProgress,
    wrong: () => renderQuestionList('wrong'),
    favorites: () => renderQuestionList('favorites')
  }
  document.querySelector('#app').classList.toggle('quiz-mode', state.route === 'quiz')
  document.querySelector('#backButton').hidden = state.route === 'home'
  main.innerHTML = (renderers[state.route] || renderHome)()
  window.QuizAnnotations?.mount(main.querySelector('[data-ink-surface]'), state.route === 'quiz' && !state.pitfallOpen ? currentQuestion()?.id : null, main.querySelector('[data-action="ink-toggle"]'), showToast)
  const selectAll = main.querySelector('[data-history-all]')
  if (selectAll) selectAll.indeterminate = selectedHistoryRecords().length > 0 && selectedHistoryRecords().length < state.user.history.length
  updateTimerDisplay()
}

function renderHome() {
  const stats = state.data.stats
  const cards = state.data.albums.map((album, index) => `
    <article class="album-card" data-album="${album.id}">
      <div class="album-icon">${album.referenceMode === 'original-annotated' ? '词' : ['⚡','法','卷','专'][index] || '题'}</div>
      <h3>${escapeHtml(album.title)}</h3>
      <p>${escapeHtml(album.subtitle)}</p>
      <div class="tag-row"><span class="tag">${album.count} 题</span><span class="tag neutral">${album.papers.length} 个子卷</span><span class="tag neutral">${album.source}</span></div>
    </article>`).join('')
  return `
    <section class="hero">
      <div><span class="eyebrow">小天爱刷题</span><h1>把题刷透，<strong>把分拿到</strong></h1><p class="hero-copy">政治理论与言语选词，按题本与套卷练习，自动记录进度。</p></div>
      <div class="hero-stats">
        <div class="stat-chip"><b>${stats.questionCount}</b><span>题目</span></div>
        <div class="stat-chip"><b>${stats.paperCount}</b><span>子卷</span></div>
        <div class="stat-chip"><b>${stats.albumCount}</b><span>专辑</span></div>
      </div>
    </section>
    <div class="action-row">
      <button class="soft-action" data-action="random">🎲 随机十题</button>
      <button class="soft-action" data-action="continue">▶ ${state.user.draft?.ids?.length ? '继续上次练习' : '继续练习'}</button>
    </div>
    <div class="section-head"><h2>专辑</h2><p>选择一个专辑或子卷开始练习</p></div>
    <section class="album-grid">${cards}</section>`
}

function renderAlbum() {
  const album = state.selectedAlbum || state.data.albums[0]
  const resumeAlbum = draftMatchesQuestions(questionsFor(album.id))
  const rows = album.papers.map((paper, index) => {
    const progress = paperProgress(album, paper)
    return `<div class="paper-row" data-paper="${escapeHtml(paper.name)}">
      <span class="paper-no">${String(index + 1).padStart(2, '0')}</span>
      <div><strong>${escapeHtml(paper.name)}</strong><div class="paper-progress"><i style="--progress:${progress.percent}%"></i></div></div>
      <em>${progress.done}/${progress.total}</em>
    </div>`
  }).join('')
  return `<button class="back-button" data-action="back-home">返回练习首页</button>
    <section class="detail-head"><span class="eyebrow">${album.source} · 专辑</span><h1>${escapeHtml(album.title)}</h1><p>${escapeHtml(album.subtitle)} · 共 ${album.count} 题</p></section>
    <button class="start-banner" data-action="start-album"><div><strong>${resumeAlbum ? '继续上次练习' : '从头开始练'}</strong><small>${resumeAlbum ? `从第 ${state.user.draft.index + 1} 题继续，已保存答案与用时` : `按顺序完成全部 ${album.count} 题`}</small></div><span>${resumeAlbum ? '继续' : '开始'}</span></button>
    <div class="section-head"><h2>子卷</h2><p>共 ${album.papers.length} 个</p></div>
    <div class="paper-list">${rows}</div>`
}

function startQuiz(questions, startIndex = 0, options = {}) {
  if (!questions.length) return showToast('当前没有可练习的题目')
  pauseQuizTiming()
  if (draftMatchesQuestions(questions) && continueDraft()) return
  state.quizReturn = { route: state.route === 'quiz' ? state.quizReturn.route : state.route, albumId: state.selectedAlbum?.id }
  state.session = [...questions]
  state.sessionIndex = Math.max(0, Math.min(startIndex, questions.length - 1))
  state.sessionAnswers = {}
  state.sessionSubmitted = false
  state.reviewingHistory = false
  state.historySkippedQuestions = 0
  state.sessionTimes = {}
  state.timerStartedAt = null
  state.sessionRecord = null
  const first = questions[0]
  state.sessionTitle = options.title || (questions.every(q => q.album === first.album && q.paper === first.paper) ? `${first.album} · ${first.paper}` : questions.every(q => q.album === first.album) ? first.album : '综合练习')
  navigate('quiz')
  persistDraft()
}

function currentQuestion() { return state.session[state.sessionIndex] }

function openHistoryRecord(recordIndex, questionIndex = 0) {
  if (!Number.isInteger(recordIndex) || recordIndex < 0 || !state.data) return false
  const record = state.user.history?.[recordIndex]
  if (!record || !Array.isArray(record.questions)) return false
  const byId = new Map(state.data.questions.map(question => [question.id, question]))
  const seen = new Set()
  const available = record.questions.flatMap((entry, originalIndex) => {
    const question = byId.get(entry?.id)
    if (!question || seen.has(question.id)) return []
    seen.add(question.id)
    const selected = Number.isInteger(entry.selected) && entry.selected >= 0 && entry.selected < question.options.length ? entry.selected : null
    const seconds = Number.isFinite(entry.seconds) && entry.seconds >= 0 ? entry.seconds : Number.isFinite(entry.durationMs) && entry.durationMs >= 0 ? Math.floor(entry.durationMs / 1000) : 0
    return [{ question, originalIndex, entry: { ...entry, selected, seconds, correct: typeof entry.correct === 'boolean' ? entry.correct : selected !== null && selected === question.answer } }]
  })
  if (!available.length) { showToast('这条记录的题目暂不在当前题库中，无法回看'); return false }
  // Save the active practice before installing this read-only historical session.
  pauseQuizTiming()
  state.session = available.map(item => item.question)
  const start = available.findIndex(item => item.originalIndex === questionIndex)
  state.sessionIndex = start >= 0 ? start : 0
  state.sessionAnswers = Object.fromEntries(available.filter(item => item.entry.selected !== null).map(item => [item.question.id, item.entry.selected]))
  state.sessionTimes = Object.fromEntries(available.map(item => [item.question.id, item.entry.seconds * 1000]))
  state.timerStartedAt = null
  state.sessionSubmitted = true
  state.reviewingHistory = true
  state.historySkippedQuestions = record.questions.length - available.length
  state.sessionRecord = {
    ...record,
    questions: available.map(item => item.entry),
    questionCount: record.questions.length,
    totalSeconds: Number.isFinite(record.totalSeconds) && record.totalSeconds >= 0 ? record.totalSeconds : available.reduce((sum, item) => sum + item.entry.seconds, 0),
    correctCount: Number.isInteger(record.correctCount) && record.correctCount >= 0 && record.correctCount <= record.questions.length ? record.correctCount : available.filter(item => item.entry.correct).length
  }
  state.sessionTitle = record.title || '练习记录'
  state.quizReturn = { route: 'progress' }
  navigate('quiz')
  return true
}

function renderQuiz() {
  if (state.pitfallOpen && state.sessionSubmitted && state.session.some(question => !isOriginalAnnotated(question))) return renderPitfallManual()
  const question = currentQuestion()
  if (!question) return '<div class="empty-state"><b>练习已完成</b>请选择其他题库继续。</div>'
  const isFavorite = state.user.favorites.includes(question.id)
  const progress = Math.round((state.sessionIndex + 1) / state.session.length * 100)
  const selectedOption = state.sessionAnswers[question.id]
  const reveal = state.sessionSubmitted
  const historical = state.reviewingHistory
  const answeredCount = state.session.filter(item => Number.isInteger(state.sessionAnswers[item.id])).length
  const correctCount = state.sessionSubmitted
    ? historical ? state.sessionRecord.correctCount : state.session.filter(wasAnswerCorrect).length
    : 0
  const resultTotal = historical ? state.sessionRecord.questionCount : state.session.length
  const correct = wasAnswerCorrect(question)
  const missingHistoricalAnswer = historical && !Number.isInteger(selectedOption)
  const originalQuestion = isOriginalAnnotated(question)
  const imageQuestion = originalQuestion && question.questionRenderMode === 'image' && !!originalImageAsset(question.questionImage, 'question')
  const questionContent = imageQuestion
    ? `<div class="original-question">${renderOriginalImage(question, question.questionImage, 0, 1, 'question')}</div>`
    : `${originalQuestion && question.questionRenderMode === 'image' ? '<p class="original-image-unavailable">原题图片暂不可用，下方显示题目文字。</p>' : ''}<p class="question-stem">${originalQuestion ? escapeHtml(displayQuestionStem(question)) : escapeQuizText(displayQuestionStem(question))}</p>`
  const questionCheck = originalQuestion && !imageQuestion && originalImageAsset(question.questionImage, 'question')
    ? `<details class="original-question-check"><summary>查看原题</summary>${renderOriginalImage(question, question.questionImage, 0, 1, 'question')}</details>` : ''
  const optionsClass = imageQuestion ? 'options original-choice-only' : originalQuestion ? 'options original-word-options' : 'options'
  const options = question.options.map((option, index) => {
    let className = 'option'
    if (selectedOption === index) className += ' selected'
    if (reveal && index === question.answer) className += ' correct'
    if (reveal && selectedOption === index && index !== question.answer) className += ' incorrect'
    const optionText = imageQuestion ? '' : `<span class="option-text">${originalQuestion ? escapeHtml(option) : escapeQuizText(option)}</span>`
    return `<button class="${className}" data-option="${index}" aria-pressed="${selectedOption === index}" ${imageQuestion ? `aria-label="选项 ${'ABCD'[index]}"` : ''} ${reveal ? 'disabled' : ''}><span class="option-letter">${'ABCD'[index]}</span>${optionText}</button>`
  }).join('')
  const feedback = reveal
    ? missingHistoricalAnswer
      ? '<div class="feedback history-missing-answer">这次记录没有保存所选选项，下方仍可查看正确答案与解析。</div>'
      : `<div class="feedback ${correct ? 'correct' : 'incorrect'}">${historical ? '当次作答：' : ''}${correct ? '回答正确' : `回答错误，你选了 ${Number.isInteger(selectedOption) ? 'ABCD'[selectedOption] : '未作答'}，正确答案是 ${question.answerLetter}`}</div>`
    : ''
  const explanation = reveal ? renderReferenceAnswer(question) : ''
  const pitfallButton = state.session.some(item => !isOriginalAnnotated(item))
    ? '<br><button type="button" class="pitfall-open" data-action="open-pitfalls">查看挖坑手册</button>' : ''
  const resultSummary = reveal
    ? `<section class="result-summary"><div><span>${historical ? '历史作答' : '本套成绩'}</span><strong>${correctCount} / ${resultTotal}</strong></div><p>${historical ? `${escapeHtml(state.sessionTitle)}<br>` : ''}正确率 ${Math.round(correctCount / resultTotal * 100)}% · ${historical ? '当次用时' : '本套用时'} ${formatDuration(getSessionMilliseconds())}${pitfallButton}</p></section>${historical && state.historySkippedQuestions ? `<p class="history-review-note">原记录中有 ${state.historySkippedQuestions} 道题暂不可用，当前显示可回看的 ${state.session.length} 道题；上方保留当次总成绩和总用时。</p>` : ''}`
    : ''
  const answerSheet = state.session.map((item, index) => {
    const hasAnswer = Number.isInteger(state.sessionAnswers[item.id])
    let className = 'sheet-number'
    if (index === state.sessionIndex) className += ' current'
    if (hasAnswer) className += ' answered'
    if (reveal && (!historical || hasAnswer)) className += wasAnswerCorrect(item) ? ' correct' : ' incorrect'
    return `<button class="${className}" data-jump="${index}" ${reveal ? `title="本题用时 ${formatDuration(recordedQuestionMilliseconds(item.id))}"` : ''}>${index + 1}</button>`
  }).join('')
  const primaryAction = reveal
    ? (state.sessionIndex === state.session.length - 1 ? 'finish-review' : 'next')
    : (state.sessionIndex === state.session.length - 1 ? 'submit-session' : 'next')
  const primaryLabel = reveal
    ? (state.sessionIndex === state.session.length - 1 ? historical ? '返回练习记录' : '查看学习进度' : '下一题解析')
    : (state.sessionIndex === state.session.length - 1 ? '交卷并查看解析' : '下一题')
  const fontControls = renderFontControls()
  return `<section class="quiz-shell">
    ${resultSummary}
    <div class="quiz-topline"><div class="quiz-progress-copy"><b>${state.sessionIndex + 1}</b> / ${state.session.length}</div><div class="quiz-tools"><div class="quiz-meta"><span>${escapeHtml(question.paper)}</span><b>${reveal ? `答对 ${correctCount} 题` : `已答 ${answeredCount} 题`}</b></div>${fontControls}</div></div>
    <div class="progress-track"><i style="--progress:${progress}%"></i></div>
    <article class="question-card">
      <div class="question-head"><span class="tag question-type">单选题 · ${escapeHtml(question.source)}</span><div class="question-head-actions"><button type="button" class="question-pen-button" data-action="ink-toggle" aria-label="打开题目画笔" aria-pressed="false" title="在题目上圈画"><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 15 10-10 4 4-10 10-5 1 1-5Zm8-8 4 4M4 21h16"/></svg></button><button class="favorite-button ${isFavorite ? 'active' : ''}" data-action="favorite">★ ${isFavorite ? '已收藏' : '收藏'}</button></div></div>
      ${reveal ? `<p class="question-duration">本题用时 ${formatDuration(recordedQuestionMilliseconds(question.id))}</p>` : ''}
      <div class="question-ink-surface" data-ink-surface>${questionContent}${questionCheck}
      <div class="${optionsClass}">${options}</div></div>${feedback}${explanation}
    </article>
    <div class="quiz-actions"><button class="btn secondary" data-action="previous" ${state.sessionIndex === 0 ? 'disabled' : ''}>上一题</button><button class="btn primary" data-action="${primaryAction}">${primaryLabel}</button></div>
    <p class="swipe-hint">${reveal ? '左滑下一题，右滑上一题' : '选中后停留 0.5 秒自动下一题 · 可改选或左右滑动 · 返回自动保存'}</p>
    <details class="answer-sheet" ${reveal ? 'open' : ''}><summary>答题卡 · ${reveal ? `答对 ${correctCount} 题` : `已答 ${answeredCount}/${state.session.length} 题`}</summary><div>${answerSheet}</div></details>
  </section>`
}

function pitfallScope() {
  if (!state.sessionSubmitted || !state.session.length) return {questions:[],title:''}
  const first = state.session[0]
  const customPractice = ['随机十题', '错题练习', '收藏练习', '综合练习'].includes(state.sessionTitle)
  const singlePaper = !customPractice && state.session.every(question =>
    question.source === first.source && question.album === first.album && question.paper === first.paper)
  const questions = singlePaper
    ? state.data.questions.filter(question => question.source === first.source && question.album === first.album && question.paper === first.paper)
      .sort((a,b) => a.number - b.number)
    : [...new Map(state.session.map(question => [question.id,question])).values()]
  return {questions,singlePaper,title:singlePaper ? `${first.album} · ${first.paper}` : state.sessionTitle || '本次练习'}
}

function collectPitfalls(questions) {
  const entries = []
  questions.forEach((question,index) => {
    const formatted = formatReference(question)
    for (const item of formatted?.items || []) {
      if (item.verdict === 'incorrect') entries.push({question,questionNumber:index+1,item,number:entries.length+1})
    }
  })
  return entries
}

function openPitfallManual() {
  if (state.route !== 'quiz' || !state.sessionSubmitted || !state.session.some(question => !isOriginalAnnotated(question))) return false
  cancelAutoAdvance()
  swipeGesture = null
  state.pitfallOpen = true
  render()
  main.querySelector('#pitfallTitle')?.focus?.()
  window.scrollTo({top:0,behavior:'instant'})
  return true
}

function closePitfallManual() {
  if (state.route !== 'quiz' || !state.pitfallOpen) return false
  state.pitfallOpen = false
  render()
  window.scrollTo({top:0,behavior:'instant'})
  main.querySelector('[data-action="open-pitfalls"]')?.focus?.()
  return true
}

function resolvePitfall(key) {
  if (!validPitfallKey(key) || !state.data) return null
  const split = key.lastIndexOf(':')
  const question = state.data.questions.find(question => question.id === key.slice(0,split))
  if (!question) return null
  const item = formatReference(question)?.items.find(item => item.label === key.slice(split+1))
  if (!item) return null
  const paper = state.data.questions.filter(q => q.source === question.source && q.album === question.album && q.paper === question.paper).sort((a,b)=>a.number-b.number)
  return {question, item, questionNumber:paper.findIndex(q=>q.id===question.id)+1}
}

function savedPitfallEntries() {
  return state.pitfallFavorites.map(resolvePitfall).filter(Boolean).map((entry,index)=>({...entry,number:index+1}))
}

function renderPitfallFavorite(key, subject) {
  const saved = state.pitfallFavorites.includes(key)
  return `<button type="button" class="mini-btn pitfall-favorite ${saved ? 'active' : 'ghost'}" data-pitfall-favorite="${escapeHtml(key)}" aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏'}${escapeHtml(subject)}">${saved ? '★ 已收藏' : '☆ 收藏'}</button>`
}

function togglePitfallFavorite(key, button) {
  const review = state.route === 'quiz' && state.sessionSubmitted
  const collection = state.route === 'favorites' && state.favoriteTab === 'pitfalls' && state.pitfallFavorites.includes(key)
  if (!review && !collection) return false
  const entry = resolvePitfall(key)
  if (!entry) return false
  if (review && state.pitfallOpen) {
    if (entry.item.verdict !== 'incorrect' || !pitfallScope().questions.some(question => question.id === entry.question.id)) return false
  } else if (review && currentQuestion()?.id !== entry.question.id) return false

  const wasSaved = state.pitfallFavorites.includes(key)
  const next = wasSaved ? state.pitfallFavorites.filter(item=>item!==key) : [...state.pitfallFavorites,key]
  if (!writeStorage(PITFALL_FAVORITES_KEY,next)) { showToast('收藏未保存，请重试'); return false }
  state.pitfallFavorites = next
  if (collection) {
    const index = [...main.querySelectorAll('[data-pitfall-favorite]')].indexOf(button)
    const scroll = window.scrollY || 0
    render()
    window.scrollTo({top:scroll,behavior:'instant'})
    const remaining = main.querySelectorAll('[data-pitfall-favorite]')
    const focus = remaining[Math.max(0, Math.min(index, remaining.length - 1))] || main.querySelector('[data-favorite-tab="pitfalls"]')
    focus?.focus?.({preventScroll:true})
  } else if (button) {
    const saved = !wasSaved
    const label = button.getAttribute('aria-label') || '收藏此条表述'
    button.setAttribute('aria-pressed', String(saved))
    button.setAttribute('aria-label', label.replace(/^(?:取消)?收藏/, saved ? '取消收藏' : '收藏'))
    button.classList.toggle('active', saved)
    button.classList.toggle('ghost', !saved)
    button.textContent = saved ? '★ 已收藏' : '☆ 收藏'
  }
  showToast(wasSaved ? '已取消手册收藏' : '已收藏到挖坑手册')
  return true
}

function setFavoriteTab(tab) {
  if (state.route !== 'favorites' || !['questions','pitfalls'].includes(tab)) return false
  state.favoriteTab = tab
  render()
  main.querySelector(`[data-favorite-tab="${tab}"]`)?.focus?.({preventScroll:true})
  return true
}

function renderPitfallRows(entries,singlePaper=false) {
  return entries.map(({question,questionNumber,item,number}) => {
    const hasCorrection = item.correctedRule || item.segments.some(segment => segment.type === 'correction')
    const rule = item.correctedRule ? `<div class="reference-rule"><b>${item.verdict === 'unknown' ? '知识点说明' : '正确表述'}</b><p>${escapeQuizText(item.correctedRule)}</p></div>` : ''
    const reason = !hasCorrection && item.reason ? `<p class="reference-reason"><span>说明：</span>${escapeQuizText(conciseReferenceReason(item.reason,item.text))}</p>` : ''
    const originalOptions = question.options.map((text,index) => `<li><b>${'ABCD'[index]}</b><span>${escapeQuizText(text)}</span></li>`).join('')
    const source = singlePaper ? '' : `<small class="pitfall-source-detail">${escapeHtml(question.source)} · ${escapeHtml(question.album)} · ${escapeHtml(question.paper)} · 原第 ${escapeHtml(String(question.number))} 题</small>`
    const verdict = item.verdict === 'correct' ? 'correct' : 'unknown'
    const status = item.verdict === 'incorrect' ? '' : ` <span class="reference-verdict ${verdict}">${referenceStatus(item)}</span>`
    const subject = item.verdict === 'incorrect' ? '错误表述' : '参考答案'
    const favorite = renderPitfallFavorite(`${question.id}:${item.label}`, `第 ${questionNumber} 题 ${item.label} 的${subject}`)
    return `<li class="pitfall-entry" data-pitfall-entry="${number}" data-pitfall-id="${escapeHtml(question.id)}" data-pitfall-label="${escapeHtml(item.label)}"><span class="pitfall-number">${number}</span><div class="pitfall-content"><div class="pitfall-source"><span>第 ${questionNumber} 题 · ${escapeHtml(item.label)}${status}${source}</span>${favorite}</div><p class="pitfall-statement">${renderReferenceSegments(item.segments)}</p>${rule}${reason}<details class="pitfall-original"><summary>查看原题</summary><p>${escapeQuizText(displayQuestionStem(question))}</p><ul>${originalOptions}</ul></details></div></li>`
  }).join('')
}

function renderPitfallManual() {
  if (state.route !== 'quiz' || !state.sessionSubmitted || !state.pitfallOpen || !state.session.some(question => !isOriginalAnnotated(question))) return ''
  const scope = pitfallScope()
  const entries = collectPitfalls(scope.questions)
  const rows = renderPitfallRows(entries,scope.singlePaper)
  return `<section class="quiz-shell pitfall-manual" aria-labelledby="pitfallTitle"><header class="pitfall-heading"><span class="eyebrow">整套易错梳理</span><h1 id="pitfallTitle" tabindex="-1">挖坑手册</h1><p>${escapeHtml(scope.title)} · ${scope.questions.length} 题 · ${entries.length} 条错误表述</p><p>按题目顺序排列，错误词标红，正确表达标绿。</p></header><ol class="pitfall-list">${rows}</ol>${entries.length ? '' : '<div class="empty-state"><b>这套题没有需要收集的错误表述</b>可返回查看各题答案与解析。</div>'}<button type="button" class="btn secondary pitfall-return" data-action="close-pitfalls">返回答案解析</button></section>`
}

function selectedHistoryRecords() {
  return (state.user.history || []).filter(record => state.historySelection.has(record))
}

function endHistoryManagement() {
  if (state.pendingHistoryDeletion) document.querySelector('#modalRoot').innerHTML = ''
  state.historyManaging = false
  state.historySelection.clear()
  state.pendingHistoryDeletion = null
}

function toggleHistoryManagement() {
  if (state.route !== 'progress') return
  if (state.historyManaging) endHistoryManagement()
  else if (state.user.history.length) state.historyManaging = true
  render()
}

function selectHistoryRecord(index, checked) {
  if (state.route !== 'progress' || !state.historyManaging || state.pendingHistoryDeletion || !Number.isInteger(index)) return
  const record = state.user.history[index]
  if (!record) return
  const selected = checked === undefined ? !state.historySelection.has(record) : checked
  if (selected) state.historySelection.add(record)
  else state.historySelection.delete(record)
  render()
}

function selectAllHistoryRecords(checked) {
  if (state.route !== 'progress' || !state.historyManaging || state.pendingHistoryDeletion) return
  state.historySelection = checked ? new Set(state.user.history) : new Set()
  render()
}

function renderHistoryDeletionDialog(error = '') {
  const count = state.pendingHistoryDeletion?.length || 0
  document.querySelector('#modalRoot').innerHTML = `<div class="modal-backdrop"><section class="modal" role="alertdialog" aria-modal="true" aria-labelledby="historyDeleteTitle" aria-describedby="historyDeleteDescription"><h2 id="historyDeleteTitle">删除 ${count} 条练习记录？</h2><p id="historyDeleteDescription">删除后将无法回看这些记录。累计做题进度、错题、收藏和未交卷草稿都会保留。</p>${error ? `<p class="history-delete-error" role="alert">${escapeHtml(error)}</p>` : ''}<div class="modal-actions"><button class="btn secondary" data-action="history-delete-cancel">取消</button><button class="btn danger" data-action="history-delete-confirm">确认删除 ${count} 条</button></div></section></div>`
}

function requestHistoryDeletion() {
  if (state.route !== 'progress' || !state.historyManaging) return false
  const selected = selectedHistoryRecords()
  if (!selected.length) return false
  state.pendingHistoryDeletion = [...selected]
  renderHistoryDeletionDialog()
  return true
}

function cancelHistoryDeletion() {
  state.pendingHistoryDeletion = null
  document.querySelector('#modalRoot').innerHTML = ''
}

function confirmHistoryDeletion() {
  if (state.route !== 'progress' || !state.historyManaging || !state.pendingHistoryDeletion?.length) return false
  const removed = new Set(state.pendingHistoryDeletion)
  const history = state.user.history
  const nextHistory = history.filter(record => !removed.has(record))
  const count = history.length - nextHistory.length
  if (!count) { cancelHistoryDeletion(); render(); return false }
  const { draft, ...saved } = state.user
  // Persist first: failed storage must leave both the list and its selection intact.
  if (!writeStorage(STORAGE_KEY, { ...saved, history: nextHistory })) {
    renderHistoryDeletionDialog('删除未保存，记录仍然保留，请重试。')
    return false
  }
  state.user.history = nextHistory
  cancelHistoryDeletion()
  state.historySelection.clear()
  if (!nextHistory.length) state.historyManaging = false
  render()
  showToast(`已删除 ${count} 条练习记录`)
  return true
}

function renderTimingHistory() {
  const history = state.user.history || []
  const managing = state.historyManaging
  const selectedCount = selectedHistoryRecords().length
  const byId = new Map(state.data.questions.map(question => [question.id, question]))
  const records = history.map((record, recordIndex) => {
    const date = practiceDate(record)
    const canReview = record.questions.some(entry => byId.has(entry?.id))
    const rows = record.questions.map((entry, index) => {
      const selected = Number.isInteger(entry?.selected) && entry.selected >= 0 && entry.selected < 4 ? `选 ${'ABCD'[entry.selected]}` : '选项未记录'
      const verdict = entry?.correct === true ? '正确' : entry?.correct === false ? '错误' : '判定未记录'
      return `<button class="timing-question-row" data-history-record="${recordIndex}" data-history-question="${index}" ${byId.has(entry?.id) ? '' : 'disabled'} aria-label="查看第 ${index + 1} 题当次作答与解析"><span>第 ${index + 1} 题 · ${selected} · ${verdict}</span><b>${formatDuration((entry?.seconds || 0) * 1000)}</b></button>`
    }).join('')
    const selected = state.historySelection.has(record)
    const selection = managing ? `<label class="history-record-check"><input type="checkbox" data-history-select="${recordIndex}" aria-label="选择第 ${recordIndex + 1} 条练习记录" ${selected ? 'checked' : ''}></label>` : ''
    const details = managing ? '' : `<details class="timing-breakdown"><summary>逐题用时与作答</summary><div class="timing-summary">答对 ${record.correctCount ?? '—'} / ${record.questions.length} 题 · 总用时 ${formatDuration(record.totalSeconds * 1000)}</div><div class="timing-question-grid">${rows}</div></details>`
    return `<article class="timing-record ${managing ? 'history-selecting' : ''} ${managing && selected ? 'history-selected' : ''}">${selection}<button class="timing-record-open" data-history-record="${recordIndex}" ${canReview || managing ? '' : 'disabled'}><span><strong>${escapeHtml(record.title || '练习记录')}</strong><small>${escapeHtml(date)} · ${record.questions.length} 题</small><em>${managing ? selected ? '已选择' : '点击选择这条记录' : canReview ? '查看当次作答与解析' : '暂无可回看的题目'}</em></span><b>${formatDuration(record.totalSeconds * 1000)}</b></button>${details}</article>`
  }).join('')
  const controls = managing ? `<div class="history-bulk-controls"><label><input type="checkbox" data-history-all ${history.length && selectedCount === history.length ? 'checked' : ''}>全选</label><span aria-live="polite">已选 ${selectedCount} / ${history.length} 条</span><button class="mini-btn danger" data-action="history-delete-request" ${selectedCount ? '' : 'disabled'}>删除所选（${selectedCount}）</button></div>` : ''
  return `<section class="timing-history"><div class="section-head timing-history-head"><div class="timing-history-title"><h2>练习用时记录</h2><p>${managing ? '选择要删除的练习记录' : '点击记录，回看当次答案与解析'}</p></div><button class="mini-btn ghost history-manage-button" data-action="history-manage" aria-pressed="${managing}" ${history.length ? '' : 'disabled'}>${managing ? '取消' : '批量删除'}</button></div>${controls}${records || '<div class="empty-state"><b>还没有计时记录</b>完成一套练习后，可在这里回看作答与每题用时。</div>'}<p class="swipe-hint">记录保存在当前浏览器，保留最近的练习记录。</p></section>`
}

function renderProgress() {
  const totalAnswered = Object.keys(state.user.attempts).length
  const total = state.data.questions.length
  const percent = total ? Math.round(totalAnswered / total * 100) : 0
  const cards = state.data.albums.map(album => {
    const progress = albumProgress(album)
    return `<button type="button" class="progress-card" data-album="${escapeHtml(album.id)}" aria-label="查看${escapeHtml(album.title)}套卷列表，已完成 ${progress.done} / ${progress.total} 题"><span class="progress-card-head"><span class="progress-card-title">${escapeHtml(album.title)}</span><b>${progress.percent}%</b></span><span class="progress-card-count">${progress.done} / ${progress.total} 题已完成</span><span class="paper-progress"><i style="--progress:${progress.percent}%"></i></span></button>`
  }).join('')
  return `<section class="progress-hero"><div><span class="eyebrow">学习进度</span><h1>每一次作答，都算数</h1><p>累计作答 ${totalAnswered} 题，当前正确率 ${accuracy()}%。</p></div><div class="big-progress" style="--angle:${percent * 3.6}deg" data-value="${percent}%"></div></section><section class="progress-grid">${cards}</section>${renderTimingHistory()}`
}

function renderQuestionList(type) {
  if (type === 'favorites') return renderFavorites()
  const ids = type === 'wrong' ? state.user.wrong : state.user.favorites
  const title = type === 'wrong' ? '错题' : '收藏'
  const desc = type === 'wrong' ? '针对薄弱点再练一次，答对后自动移出错题本。' : '手动标记的题目，方便随时回来复习。'
  const questions = ids.map(id => state.data.questions.find(item => item.id === id)).filter(Boolean)
  if (!questions.length) return `<section class="list-hero"><span class="eyebrow">${title}夹</span><h1>${title}</h1><p>${desc}</p></section><div class="empty-state"><b>这里还是空的</b>${type === 'wrong' ? '开始答题后，答错的题会自动出现在这里。' : '在答题页点击收藏，就能把题目保存到这里。'}</div>`
  const cards = questions.map(question => `<article class="list-card"><small>${escapeHtml(question.album)} · ${escapeHtml(question.paper)}</small><p>${escapeQuizText(displayQuestionStem(question))}</p><p class="question-duration">上次用时 ${Number.isFinite(state.user.attempts[question.id]?.durationSeconds) ? formatDuration(state.user.attempts[question.id].durationSeconds * 1000) : '未计时'}</p><div class="list-actions"><button class="mini-btn" data-single="${question.id}">再做一次</button><button class="mini-btn ghost" data-remove="${question.id}" data-list="${type}">${type === 'wrong' ? '移出错题' : '取消收藏'}</button></div></article>`).join('')
  return `<section class="list-hero"><span class="eyebrow">${title}夹</span><h1>${title}</h1><p>${desc} · 共 ${questions.length} 题</p><div class="filter-row"><button class="filter-chip active" data-list-practice="${type}">练习全部 ${questions.length} 题</button></div></section><div class="question-list">${cards}</div>`
}

function renderFavorites() {
  const questions = state.user.favorites.map(id=>state.data.questions.find(question=>question.id===id)).filter(Boolean)
  const entries = savedPitfallEntries()
  const pitfalls = state.favoriteTab === 'pitfalls'
  const tabs = `<div class="favorites-tabs" role="group" aria-label="收藏分类"><button type="button" class="filter-chip ${pitfalls ? '' : 'active'}" data-favorite-tab="questions" aria-pressed="${!pitfalls}">题目收藏（${questions.length}）</button><button type="button" class="filter-chip ${pitfalls ? 'active' : ''}" data-favorite-tab="pitfalls" aria-pressed="${pitfalls}">挖坑手册收藏（${entries.length}）</button></div>`
  const heading = `<section class="list-hero"><span class="eyebrow">收藏夹</span><h1>收藏</h1><p>${pitfalls ? `从参考答案和挖坑手册收藏的表述 · 共 ${entries.length} 条` : `手动标记的题目，方便随时回来复习。 · 共 ${questions.length} 题`}</p>${tabs}</section>`
  if (pitfalls) return `${heading}<section aria-label="挖坑手册收藏">${entries.length ? `<ol class="pitfall-list">${renderPitfallRows(entries)}</ol>` : '<div class="empty-state"><b>还没有收藏的表述</b>交卷后，在参考答案或挖坑手册里点每条右上角的“收藏”。</div>'}</section>`
  if (!questions.length) return `${heading}<section aria-label="题目收藏"><div class="empty-state"><b>这里还是空的</b>在答题页点击收藏，就能把题目保存到这里。</div></section>`
  const cards = questions.map(question=>`<article class="list-card"><small>${escapeHtml(question.album)} · ${escapeHtml(question.paper)}</small><p>${escapeQuizText(displayQuestionStem(question))}</p><p class="question-duration">上次用时 ${Number.isFinite(state.user.attempts[question.id]?.durationSeconds) ? formatDuration(state.user.attempts[question.id].durationSeconds*1000) : '未计时'}</p><div class="list-actions"><button class="mini-btn" data-single="${escapeHtml(question.id)}">再做一次</button><button class="mini-btn ghost" data-remove="${escapeHtml(question.id)}" data-list="favorites">取消收藏</button></div></article>`).join('')
  return `${heading}<section aria-label="题目收藏"><div class="filter-row favorite-practice"><button class="filter-chip active" data-list-practice="favorites">练习全部 ${questions.length} 题</button></div><div class="question-list">${cards}</div></section>`
}

function submitSession() {
  cancelAutoAdvance()
  if (state.sessionSubmitted || !state.session.length) return
  const firstUnanswered = state.session.findIndex(item => !Number.isInteger(state.sessionAnswers[item.id]))
  if (firstUnanswered >= 0) {
    const remaining = state.session.length - state.session.filter(item => Number.isInteger(state.sessionAnswers[item.id])).length
    changeQuestion(firstUnanswered)
    return showToast(`还有 ${remaining} 道题未作答`)
  }
  pauseQuizTiming()
  const times = state.session.map(question => getQuestionMilliseconds(question.id))
  const totalSeconds = Math.floor(times.reduce((sum, time) => sum + time, 0) / 1000)
  const seconds = times.map(time => Math.floor(time / 1000))
  // Allocate the fractional seconds once, so the displayed question seconds add
  // up to the measured total without accumulating rounding drift.
  const ranked = times.map((time, index) => ({ index, fraction: time % 1000 })).sort((a, b) => b.fraction - a.fraction)
  const remainder = totalSeconds - seconds.reduce((sum, time) => sum + time, 0)
  for (let index = 0; index < remainder; index++) seconds[ranked[index].index]++
  const submittedAt = Date.now()
  const entries = state.session.map((question, index) => {
    const selected = state.sessionAnswers[question.id]
    const correct = selected === question.answer
    state.user.attempts[question.id] = { selected, correct, at: submittedAt, durationSeconds: seconds[index] }
    if (correct) state.user.wrong = state.user.wrong.filter(id => id !== question.id)
    else if (!state.user.wrong.includes(question.id)) state.user.wrong.push(question.id)
    return { id: question.id, seconds: seconds[index], durationMs: times[index], selected, correct }
  })
  state.sessionRecord = { id: `quiz-${submittedAt}-${Math.random().toString(36).slice(2, 8)}`, submittedAt, title: state.sessionTitle, totalSeconds, correctCount: entries.filter(entry => entry.correct).length, questions: entries }
  state.user.history.unshift(state.sessionRecord)
  let retainedRows = 0
  state.user.history = state.user.history.filter((record, index) => {
    retainedRows += record.questions.length
    return index < 50 && retainedRows <= 10000
  })
  state.sessionSubmitted = true
  state.sessionIndex = 0
  if (saveUserState()) { state.user.draft = null; writeStorage(DRAFT_KEY, null) }
  render()
  window.scrollTo({ top: 0, behavior: 'instant' })
  showToast('交卷成功，可以统一查看答案解析')
}

function changeQuestion(index) {
  cancelAutoAdvance()
  if (!Number.isInteger(index) || index < 0 || index >= state.session.length || index === state.sessionIndex) return false
  pauseQuizTiming()
  state.sessionIndex = index
  render()
  resumeQuizTiming()
  persistDraft()
  window.scrollTo({ top: 0, behavior: 'instant' })
  return true
}

function nextQuestion() {
  if (!changeQuestion(state.sessionIndex + 1)) showToast('已经是最后一题')
}

function previousQuestion() {
  if (!changeQuestion(state.sessionIndex - 1)) showToast('已经是第一题')
}

function toggleFavorite() {
  const question = currentQuestion()
  const index = state.user.favorites.indexOf(question.id)
  if (index >= 0) state.user.favorites.splice(index, 1)
  else state.user.favorites.push(question.id)
  saveUserState()
  render()
}

function openGuide() {
  document.querySelector('#modalRoot').innerHTML = `<div class="modal-backdrop"><section class="modal"><h2>三步开始刷题</h2><ol><li>在首页选择专辑或子卷。</li><li>点选答案后先显示选中框，停留 0.5 秒自动下一题，改选后重新等待 0.5 秒；也可左右滑动切题。最后一题选完后手动交卷，统一查看答案与解析。</li><li>在进度页查看每次练习及逐题用时；错题和收藏可随时复习。</li></ol><p>进入答题即开始计时，返回或切到后台暂停，交卷后停止。返回后可点“继续上次练习”恢复。</p><p>所有进度只保存在当前浏览器，不会覆盖其他人的记录。</p><button class="btn primary" data-action="close-modal">知道了</button></section></div>`
}

let swipeGesture = null
let suppressSwipeClickUntil = 0
let suppressAutoAnswerUntil = 0

function onTouchStart(event) {
  swipeGesture = null
  const target = event.target instanceof Element ? event.target : event.target?.parentElement
  if (state.route !== 'quiz' || state.pitfallOpen || window.QuizAnnotations?.active() || event.touches.length !== 1 || !target?.closest('.quiz-shell') || target.closest('.source-explanation, .answer-sheet, .font-controls, a, input, textarea, select, [contenteditable="true"]') || document.querySelector('#modalRoot').children.length || window.getSelection?.()?.isCollapsed === false) return
  const touch = event.touches[0]
  swipeGesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, startedAt: performance.now() }
}

function onTouchMove(event) {
  if (window.QuizAnnotations?.active()) { swipeGesture = null; return }
  if (!swipeGesture) return
  if (event.touches.length !== 1) { swipeGesture = null; return }
  const touch = event.touches[0]
  if (touch.identifier !== swipeGesture.id) { swipeGesture = null; return }
  const dx = touch.clientX - swipeGesture.x
  const dy = touch.clientY - swipeGesture.y
  if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipeGesture = null; return }
  if (Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.5 && event.cancelable) event.preventDefault()
}

function onTouchEnd(event) {
  const gesture = swipeGesture
  swipeGesture = null
  if (!gesture || state.route !== 'quiz' || state.pitfallOpen || window.QuizAnnotations?.active() || event.touches.length || performance.now() - gesture.startedAt > 1500 || document.querySelector('#modalRoot').children.length || window.getSelection?.()?.isCollapsed === false) return
  const touch = [...event.changedTouches].find(item => item.identifier === gesture.id)
  if (!touch) return
  const dx = touch.clientX - gesture.x
  const dy = touch.clientY - gesture.y
  if (Math.abs(dx) < 64 || Math.abs(dx) <= Math.abs(dy) * 1.5) return
  if (event.cancelable) event.preventDefault()
  suppressSwipeClickUntil = performance.now() + 450
  if (dx < 0) nextQuestion()
  else previousQuestion()
}

document.addEventListener('touchstart', onTouchStart, { passive: true })
document.addEventListener('touchmove', onTouchMove, { passive: false })
document.addEventListener('touchend', onTouchEnd, { passive: false })
document.addEventListener('touchcancel', () => { swipeGesture = null }, { passive: true })
document.addEventListener('click', event => {
  if (performance.now() < suppressSwipeClickUntil && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation() }
}, true)

document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : event.target.parentElement
  if (!target) return
  const quizFont = target.closest('button[data-quiz-font]')
  if (quizFont) return setQuizFont(quizFont.dataset.quizFont)
  const theme = event.target.closest('[data-theme]')
  if (theme) return setTheme(Number(theme.dataset.theme))
  const nav = event.target.closest('[data-route]')
  if (nav) return navigate(nav.dataset.route)
  const album = event.target.closest('[data-album]')
  if (album) return navigate('album', { albumId: album.dataset.album })
  const paper = event.target.closest('[data-paper]')
  if (paper) return startQuiz(questionsFor(state.selectedAlbum.id, paper.dataset.paper))
  const historyRecord = target.closest('[data-history-record]')
  if (historyRecord && !historyRecord.disabled) return state.historyManaging ? selectHistoryRecord(Number(historyRecord.dataset.historyRecord)) : openHistoryRecord(Number(historyRecord.dataset.historyRecord), Number(historyRecord.dataset.historyQuestion || 0))
  const option = event.target.closest('[data-option]')
  if (option && state.route === 'quiz' && !state.sessionSubmitted) {
    if (window.QuizAnnotations?.active()) return
    // A physical double tap must not accidentally answer the newly displayed question.
    if (event.detail !== 0 && performance.now() < suppressAutoAnswerUntil) { event.preventDefault(); return }
    const answer = Number(option.dataset.option)
    const question = currentQuestion()
    if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length) return
    state.sessionAnswers[question.id] = answer
    suppressAutoAnswerUntil = performance.now() + 250
    scheduleAutoAdvance()
    persistDraft()
    render()
    return
  }
  const jump = event.target.closest('[data-jump]')
  if (jump) return changeQuestion(Number(jump.dataset.jump))
  const pitfallFavorite = target.closest('[data-pitfall-favorite]')
  if (pitfallFavorite) return togglePitfallFavorite(pitfallFavorite.dataset.pitfallFavorite, pitfallFavorite)
  const favoriteTab = target.closest('[data-favorite-tab]')
  if (favoriteTab) return setFavoriteTab(favoriteTab.dataset.favoriteTab)
  const single = event.target.closest('[data-single]')
  if (single) return startQuiz(state.data.questions.filter(item => item.id === single.dataset.single))
  const remove = event.target.closest('[data-remove]')
  if (remove) {
    const list = remove.dataset.list
    state.user[list] = state.user[list].filter(id => id !== remove.dataset.remove)
    saveUserState(); return render()
  }
  const listPractice = event.target.closest('[data-list-practice]')
  if (listPractice) {
    const ids = state.user[listPractice.dataset.listPractice]
    return startQuiz(ids.map(id => state.data.questions.find(item => item.id === id)).filter(Boolean), 0, { title: listPractice.dataset.listPractice === 'wrong' ? '错题练习' : '收藏练习' })
  }
  const action = event.target.closest('[data-action]')?.dataset.action
  if (!action) return
  if (action === 'ink-toggle') {
    cancelAutoAdvance(); swipeGesture = null
    if (!window.QuizAnnotations) return showToast('画笔载入失败，请刷新页面重试')
    return window.QuizAnnotations.toggle()
  }
  if (action === 'retry-original-image') return retryOriginalImage(target.closest('[data-action]'))
  if (action === 'open-pitfalls') return openPitfallManual()
  if (action === 'close-pitfalls') return closePitfallManual()
  if (action === 'note-toggle') return toggleQuestionNote()
  if (action === 'note-retry') {
    const id = target.closest('[data-note-retry]')?.dataset.noteRetry
    if (id) return saveQuestionNote(id, state.notes[id] || '')
  }
  if (action === 'history-manage') return toggleHistoryManagement()
  if (action === 'history-delete-request') return requestHistoryDeletion()
  if (action === 'history-delete-cancel') return cancelHistoryDeletion()
  if (action === 'history-delete-confirm') return confirmHistoryDeletion()
  if (action === 'random') return startQuiz([...state.data.questions].sort(() => Math.random() - .5).slice(0, 10), 0, { title: '随机十题' })
  if (action === 'continue') {
    if (continueDraft()) return
    const firstUnanswered = state.data.questions.findIndex(item => !state.user.attempts[item.id])
    return startQuiz(state.data.questions, Math.max(0, firstUnanswered))
  }
  if (action === 'back-home') return navigate('home')
  if (action === 'start-album') return startQuiz(questionsFor(state.selectedAlbum.id))
  if (action === 'favorite') return toggleFavorite()
  if (action === 'submit-session') return submitSession()
  if (action === 'next') return nextQuestion()
  if (action === 'previous') return previousQuestion()
  if (action === 'finish-review') return navigate('progress')
  if (action === 'close-modal') document.querySelector('#modalRoot').innerHTML = ''
})

document.addEventListener('change', event => {
  const checkbox = event.target
  if (!(checkbox instanceof Element)) return
  if (checkbox.matches('[data-history-select]')) return selectHistoryRecord(Number(checkbox.dataset.historySelect), checkbox.checked)
  if (checkbox.matches('[data-history-all]')) selectAllHistoryRecords(checkbox.checked)
})

document.addEventListener('input', event => {
  const editor = event.target
  if (editor instanceof Element && editor.matches('[data-question-note]')) saveQuestionNote(editor.dataset.questionNote, editor.value)
})

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.pendingHistoryDeletion) cancelHistoryDeletion()
})

document.querySelector('#brandButton').addEventListener('click', () => navigate('home'))
document.querySelector('#backButton').addEventListener('click', goBack)
document.querySelector('#guideButton').addEventListener('click', openGuide)
document.querySelector('#fontButton').addEventListener('click', openFontSettings)

document.addEventListener('toggle', event => {
  const details = event.target
  if (!(details instanceof Element) || !details.matches('details.source-explanation') || !details.open) return
  details.querySelectorAll('img[data-source-src]').forEach(image => {
    if (image.getAttribute('src')) return
    image.hidden = false
    image.nextElementSibling.hidden = true
    image.src = image.dataset.sourceSrc
  })
}, true)

document.addEventListener('error', event => {
  const image = event.target
  if (image instanceof Element && image.matches('img.original-notes-image')) {
    image.hidden = true
    image.removeAttribute('src')
    const error = image.closest('.original-image-page')?.querySelector('.original-image-error')
    if (error) error.hidden = false
    return
  }
  if (!(image instanceof Element) || !image.matches('img.source-explanation-image')) return
  image.hidden = true
  image.removeAttribute('src')
  image.nextElementSibling.hidden = false
}, true)

// Keep the mobile page at its fitted width; use the font buttons for text size.
document.addEventListener('gesturestart', event => event.preventDefault(), { passive: false })
document.addEventListener('gesturechange', event => event.preventDefault(), { passive: false })
document.addEventListener('touchmove', event => {
  if (event.touches.length > 1) event.preventDefault()
}, { passive: false })

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseQuizTiming()
  else resumeQuizTiming()
})
window.addEventListener('pagehide', pauseQuizTiming)
window.addEventListener('pageshow', resumeQuizTiming)
window.addEventListener('beforeunload', pauseQuizTiming)
setInterval(() => {
  if (state.route !== 'quiz') return
  updateTimerDisplay()
  if (!document.hidden && !state.sessionSubmitted) persistDraft()
}, 1000)

async function init() {
  renderThemePicker()
  setTheme(state.user.theme || 0)
  setQuizFont(state.user.quizFont || 'small')
  try {
    const banks = await Promise.all(['./data/questions.json?v=20261121-5', './data/zhanggong/questions.json?v=20261123-10'].map(async url => {
      const response = await fetch(url, { cache: 'no-cache' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }))
    state.data = window.QuizBanks.merge(banks)
    render()
  } catch (error) {
    main.innerHTML = `<div class="empty-state"><b>题库载入失败</b>请刷新页面后重试。<br><small>${escapeHtml(error.message)}</small></div>`
  }
}

init()
