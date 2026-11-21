const STORAGE_KEY = 'xiaotian_quiz_state_v1'
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
  route: 'home',
  selectedAlbum: null,
  session: [],
  sessionIndex: 0,
  sessionAnswers: {},
  sessionSubmitted: false,
  user: loadUserState()
}

const main = document.querySelector('#mainContent')
const toast = document.querySelector('#toast')

function loadUserState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { attempts: {}, wrong: [], favorites: [], theme: 0 }
  } catch {
    return { attempts: {}, wrong: [], favorites: [], theme: 0 }
  }
}

function saveUserState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.user))
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

function renderThemePicker() {
  document.querySelector('#themePicker').innerHTML = themes.map((theme, index) =>
    `<button class="theme-dot ${state.user.theme === index ? 'active' : ''}" style="--dot:${theme.accent}" data-theme="${index}" aria-label="切换主题色"></button>`
  ).join('')
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
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
  state.route = route
  if (options.albumId) state.selectedAlbum = state.data.albums.find(item => item.id === options.albumId)
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route))
  window.scrollTo({ top: 0, behavior: 'smooth' })
  render()
}

function render() {
  if (!state.data) return
  const renderers = {
    home: renderHome,
    album: renderAlbum,
    quiz: renderQuiz,
    progress: renderProgress,
    wrong: () => renderQuestionList('wrong'),
    favorites: () => renderQuestionList('favorites')
  }
  main.innerHTML = (renderers[state.route] || renderHome)()
}

function renderHome() {
  const stats = state.data.stats
  const cards = state.data.albums.map((album, index) => `
    <article class="album-card" data-album="${album.id}">
      <div class="album-icon">${['⚡','法','卷','专'][index] || '题'}</div>
      <h3>${escapeHtml(album.title)}</h3>
      <p>${escapeHtml(album.subtitle)}</p>
      <div class="tag-row"><span class="tag">${album.count} 题</span><span class="tag neutral">${album.papers.length} 个子卷</span><span class="tag neutral">${album.source}</span></div>
    </article>`).join('')
  return `
    <section class="hero">
      <div><span class="eyebrow">小天爱刷题</span><h1>把题刷透，<strong>把分拿到</strong></h1><p class="hero-copy">政治理论精选题库，按专辑与套卷练习，自动记录进度。</p></div>
      <div class="hero-stats">
        <div class="stat-chip"><b>${stats.questionCount}</b><span>题目</span></div>
        <div class="stat-chip"><b>${stats.paperCount}</b><span>子卷</span></div>
        <div class="stat-chip"><b>${stats.albumCount}</b><span>专辑</span></div>
      </div>
    </section>
    <div class="action-row">
      <button class="soft-action" data-action="random">🎲 随机十题</button>
      <button class="soft-action" data-action="continue">▶ 继续练习</button>
    </div>
    <div class="section-head"><h2>专辑</h2><p>选择一个专辑或子卷开始练习</p></div>
    <section class="album-grid">${cards}</section>`
}

function renderAlbum() {
  const album = state.selectedAlbum || state.data.albums[0]
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
    <button class="start-banner" data-action="start-album"><div><strong>从头开始练</strong><small>按顺序完成全部 ${album.count} 题</small></div><span>开始</span></button>
    <div class="section-head"><h2>子卷</h2><p>共 ${album.papers.length} 个</p></div>
    <div class="paper-list">${rows}</div>`
}

function startQuiz(questions, startIndex = 0) {
  if (!questions.length) return showToast('当前没有可练习的题目')
  state.session = [...questions]
  state.sessionIndex = Math.min(startIndex, questions.length - 1)
  state.sessionAnswers = {}
  state.sessionSubmitted = false
  navigate('quiz')
}

function currentQuestion() { return state.session[state.sessionIndex] }

function renderQuiz() {
  const question = currentQuestion()
  if (!question) return '<div class="empty-state"><b>练习已完成</b>请选择其他题库继续。</div>'
  const isFavorite = state.user.favorites.includes(question.id)
  const progress = Math.round((state.sessionIndex + 1) / state.session.length * 100)
  const selectedOption = state.sessionAnswers[question.id]
  const reveal = state.sessionSubmitted
  const answeredCount = state.session.filter(item => Number.isInteger(state.sessionAnswers[item.id])).length
  const correctCount = state.sessionSubmitted
    ? state.session.filter(item => state.sessionAnswers[item.id] === item.answer).length
    : 0
  const options = question.options.map((option, index) => {
    let className = 'option'
    if (selectedOption === index) className += ' selected'
    if (reveal && index === question.answer) className += ' correct'
    if (reveal && selectedOption === index && index !== question.answer) className += ' incorrect'
    return `<button class="${className}" data-option="${index}" ${reveal ? 'disabled' : ''}><span class="option-letter">${'ABCD'[index]}</span><span class="option-text">${escapeHtml(option)}</span></button>`
  }).join('')
  const feedback = reveal
    ? `<div class="feedback ${selectedOption === question.answer ? 'correct' : 'incorrect'}">${selectedOption === question.answer ? '回答正确' : `回答错误，你选了 ${Number.isInteger(selectedOption) ? 'ABCD'[selectedOption] : '未作答'}，正确答案是 ${question.answerLetter}`}</div>`
    : ''
  const explanation = reveal ? `<div class="explanation"><strong>解析</strong>${escapeHtml(question.explanation || `正确答案：${question.answerLetter}`)}</div>` : ''
  const resultSummary = reveal
    ? `<section class="result-summary"><div><span>本套成绩</span><strong>${correctCount} / ${state.session.length}</strong></div><p>正确率 ${Math.round(correctCount / state.session.length * 100)}%，现在可以逐题查看答案与解析。</p></section>`
    : ''
  const answerSheet = state.session.map((item, index) => {
    const hasAnswer = Number.isInteger(state.sessionAnswers[item.id])
    let className = 'sheet-number'
    if (index === state.sessionIndex) className += ' current'
    if (hasAnswer) className += ' answered'
    if (reveal) className += state.sessionAnswers[item.id] === item.answer ? ' correct' : ' incorrect'
    return `<button class="${className}" data-jump="${index}">${index + 1}</button>`
  }).join('')
  const primaryAction = reveal
    ? (state.sessionIndex === state.session.length - 1 ? 'finish-review' : 'next')
    : (state.sessionIndex === state.session.length - 1 ? 'submit-session' : 'next')
  const primaryLabel = reveal
    ? (state.sessionIndex === state.session.length - 1 ? '查看学习进度' : '下一题解析')
    : (state.sessionIndex === state.session.length - 1 ? '交卷并查看解析' : '下一题')
  return `<section class="quiz-shell">
    ${resultSummary}
    <div class="quiz-topline"><div class="quiz-progress-copy"><b>${state.sessionIndex + 1}</b> / ${state.session.length}</div><div class="quiz-meta"><span>${escapeHtml(question.paper)}</span><b>${reveal ? `答对 ${correctCount} 题` : `已答 ${answeredCount} 题`}</b></div></div>
    <div class="progress-track"><i style="--progress:${progress}%"></i></div>
    <article class="question-card">
      <div class="question-head"><span class="tag question-type">单选题 · ${escapeHtml(question.source)}</span><button class="favorite-button ${isFavorite ? 'active' : ''}" data-action="favorite">★ ${isFavorite ? '已收藏' : '收藏'}</button></div>
      <p class="question-stem">${escapeHtml(question.stem)}</p>
      <div class="options">${options}</div>${feedback}${explanation}
    </article>
    <div class="quiz-actions"><button class="btn secondary" data-action="previous" ${state.sessionIndex === 0 ? 'disabled' : ''}>上一题</button><button class="btn primary" data-action="${primaryAction}">${primaryLabel}</button></div>
    <details class="answer-sheet" ${reveal ? 'open' : ''}><summary>答题卡 · ${reveal ? `答对 ${correctCount} 题` : `已答 ${answeredCount}/${state.session.length} 题`}</summary><div>${answerSheet}</div></details>
  </section>`
}

function renderProgress() {
  const totalAnswered = Object.keys(state.user.attempts).length
  const total = state.data.questions.length
  const percent = total ? Math.round(totalAnswered / total * 100) : 0
  const cards = state.data.albums.map(album => {
    const progress = albumProgress(album)
    return `<article class="progress-card"><div class="progress-card-head"><h3>${escapeHtml(album.title)}</h3><b>${progress.percent}%</b></div><p>${progress.done} / ${progress.total} 题已完成</p><div class="paper-progress"><i style="--progress:${progress.percent}%"></i></div></article>`
  }).join('')
  return `<section class="progress-hero"><div><span class="eyebrow">学习进度</span><h1>每一次作答，都算数</h1><p>累计作答 ${totalAnswered} 题，当前正确率 ${accuracy()}%。</p></div><div class="big-progress" style="--angle:${percent * 3.6}deg" data-value="${percent}%"></div></section><section class="progress-grid">${cards}</section>`
}

function renderQuestionList(type) {
  const ids = type === 'wrong' ? state.user.wrong : state.user.favorites
  const title = type === 'wrong' ? '错题' : '收藏'
  const desc = type === 'wrong' ? '针对薄弱点再练一次，答对后自动移出错题本。' : '手动标记的题目，方便随时回来复习。'
  const questions = ids.map(id => state.data.questions.find(item => item.id === id)).filter(Boolean)
  if (!questions.length) return `<section class="list-hero"><span class="eyebrow">${title}夹</span><h1>${title}</h1><p>${desc}</p></section><div class="empty-state"><b>这里还是空的</b>${type === 'wrong' ? '开始答题后，答错的题会自动出现在这里。' : '在答题页点击收藏，就能把题目保存到这里。'}</div>`
  const cards = questions.map(question => `<article class="list-card"><small>${escapeHtml(question.album)} · ${escapeHtml(question.paper)}</small><p>${escapeHtml(question.stem)}</p><div class="list-actions"><button class="mini-btn" data-single="${question.id}">再做一次</button><button class="mini-btn ghost" data-remove="${question.id}" data-list="${type}">${type === 'wrong' ? '移出错题' : '取消收藏'}</button></div></article>`).join('')
  return `<section class="list-hero"><span class="eyebrow">${title}夹</span><h1>${title}</h1><p>${desc} · 共 ${questions.length} 题</p><div class="filter-row"><button class="filter-chip active" data-list-practice="${type}">练习全部 ${questions.length} 题</button></div></section><div class="question-list">${cards}</div>`
}

function submitSession() {
  const firstUnanswered = state.session.findIndex(item => !Number.isInteger(state.sessionAnswers[item.id]))
  if (firstUnanswered >= 0) {
    const remaining = state.session.length - state.session.filter(item => Number.isInteger(state.sessionAnswers[item.id])).length
    state.sessionIndex = firstUnanswered
    render()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return showToast(`还有 ${remaining} 道题未作答`)
  }
  state.session.forEach(question => {
    const selected = state.sessionAnswers[question.id]
    const correct = selected === question.answer
    state.user.attempts[question.id] = { selected, correct, at: Date.now() }
    if (correct) state.user.wrong = state.user.wrong.filter(id => id !== question.id)
    else if (!state.user.wrong.includes(question.id)) state.user.wrong.push(question.id)
  })
  state.sessionSubmitted = true
  state.sessionIndex = 0
  saveUserState()
  render()
  window.scrollTo({ top: 0, behavior: 'smooth' })
  showToast('交卷成功，可以统一查看答案解析')
}

function nextQuestion() {
  if (state.sessionIndex >= state.session.length - 1) {
    showToast('本次练习已完成')
    return navigate('progress')
  }
  state.sessionIndex += 1
  render()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function previousQuestion() {
  if (state.sessionIndex === 0) return
  state.sessionIndex -= 1
  render()
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
  document.querySelector('#modalRoot').innerHTML = `<div class="modal-backdrop"><section class="modal"><h2>三步开始刷题</h2><ol><li>在首页选择专辑或子卷。</li><li>完成整套题目后统一交卷，再集中查看答案与解析。</li><li>错题自动进入错题本；重点题可手动收藏。</li></ol><p>所有进度只保存在当前浏览器，不会上传个人信息。</p><button class="btn primary" data-action="close-modal">知道了</button></section></div>`
}

document.addEventListener('click', event => {
  const theme = event.target.closest('[data-theme]')
  if (theme) return setTheme(Number(theme.dataset.theme))
  const nav = event.target.closest('[data-route]')
  if (nav) return navigate(nav.dataset.route)
  const album = event.target.closest('[data-album]')
  if (album) return navigate('album', { albumId: album.dataset.album })
  const paper = event.target.closest('[data-paper]')
  if (paper) return startQuiz(questionsFor(state.selectedAlbum.id, paper.dataset.paper))
  const option = event.target.closest('[data-option]')
  if (option && !state.sessionSubmitted) { state.sessionAnswers[currentQuestion().id] = Number(option.dataset.option); return render() }
  const jump = event.target.closest('[data-jump]')
  if (jump) { state.sessionIndex = Number(jump.dataset.jump); render(); return window.scrollTo({ top: 0, behavior: 'smooth' }) }
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
    return startQuiz(ids.map(id => state.data.questions.find(item => item.id === id)).filter(Boolean))
  }
  const action = event.target.closest('[data-action]')?.dataset.action
  if (!action) return
  if (action === 'random') return startQuiz([...state.data.questions].sort(() => Math.random() - .5).slice(0, 10))
  if (action === 'continue') {
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

document.querySelector('#brandButton').addEventListener('click', () => navigate('home'))
document.querySelector('#guideButton').addEventListener('click', openGuide)

async function init() {
  renderThemePicker()
  setTheme(state.user.theme || 0)
  try {
    const response = await fetch('./data/questions.json')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    state.data = await response.json()
    render()
  } catch (error) {
    main.innerHTML = `<div class="empty-state"><b>题库载入失败</b>请刷新页面后重试。<br><small>${escapeHtml(error.message)}</small></div>`
  }
}

init()
