const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')
const { mergeSnapshots, normalizeSnapshot, serializeBackup, parseBackup, mergeBackup } = require('../study-sync-data.js')

function record(id, submittedAt, question = 'q1') {
  return { id, submittedAt, title: '练习', totalSeconds: 12, correctCount: 1,
    questions: [{ id: question, selected: 0, correct: true, seconds: 12 }] }
}

function draft(id, updatedAt, selected = 2) {
  return { version: 1, ids: [id], index: 0, answers: { [id]: selected }, times: { [id]: 500 },
    returnTo: { route: 'album', albumId: 'demo' }, title: '未完成', updatedAt }
}

test('exports the merge interface for static browsers and Node', () => {
  const window = {}
  vm.runInNewContext(fs.readFileSync(require.resolve('../study-sync-data.js'), 'utf8'), { window })
  assert.equal(typeof window.StudySyncData.normalizeSnapshot, 'function')
  assert.equal(typeof window.StudySyncData.mergeSnapshots, 'function')
  assert.deepEqual(Object.keys(normalizeSnapshot(null)), ['user', 'notes', 'pitfallFavorites', 'draft'])
})

test('first pairing preserves local and remote practice data, note versions and settings', () => {
  const old = { submittedAt: 100, title: '旧记录', questions: [{ id: 'old-bank-q', seconds: 5 }] }
  const local = {
    user: { attempts: { q1: { selected: 0, correct: true, at: 150 }, q2: { correct: false } },
      wrong: ['q2'], favorites: ['q1'], history: [record('l', 110), old], theme: 2 },
    notes: { q1: '手机笔记', q2: '只在手机' }, pitfallFavorites: ['q1:①'], draft: draft('q1', 200)
  }
  const remote = {
    user: { attempts: { q1: { selected: 2, correct: false, at: 300 }, q3: { correct: true } },
      wrong: ['q1'], favorites: ['q3'], history: [record('r', 130), old], quizFont: 'large', autoRemoveCorrectFromWrong: true },
    notes: { q1: '电脑笔记', q3: '只在电脑' }, pitfallFavorites: ['q1:A'], draft: draft('q3', 201)
  }
  const before = JSON.stringify([local, remote])
  const merged = mergeSnapshots(null, local, remote)
  assert.deepEqual(merged.user.wrong, ['q1', 'q2'])
  assert.deepEqual(merged.user.favorites, ['q3', 'q1'])
  assert.equal(merged.user.attempts.q1.at, 300)
  assert.ok(merged.user.attempts.q2 && merged.user.attempts.q3)
  assert.deepEqual(merged.user.history.map(item => item.id ?? item.title), ['r', 'l', '旧记录'])
  assert.equal(merged.user.history[2].questions[0].selected, undefined)
  assert.equal(merged.user.theme, 2)
  assert.equal(merged.user.quizFont, 'large')
  assert.equal(merged.user.autoRemoveCorrectFromWrong, true)
  assert.match(merged.notes.q1, /手机笔记/)
  assert.match(merged.notes.q1, /电脑笔记/)
  assert.equal(merged.notes.q2, '只在手机')
  assert.equal(merged.notes.q3, '只在电脑')
  assert.deepEqual(merged.pitfallFavorites, ['q1:A', 'q1:①'])
  assert.deepEqual(merged.draft, draft('q3', 201))
  assert.equal(JSON.stringify([local, remote]), before)
  assert.deepEqual(normalizeSnapshot(merged), merged)
})

test('a shared baseline propagates clears and removals while preserving independent additions', () => {
  const oldRecord = record('old', 100)
  const recentRecord = record('new', 105)
  const base = { user: { wrong: ['q1'], favorites: ['q2'], history: [oldRecord], autoRemoveCorrectFromWrong: true },
    notes: { q1: '旧笔记' }, pitfallFavorites: ['q1:A'], draft: draft('q1', 101) }
  const local = { ...base, user: { ...base.user, wrong: [], autoRemoveCorrectFromWrong: false }, notes: {}, draft: null }
  const remote = { ...base, user: { ...base.user, wrong: ['q1', 'q3'], favorites: [], history: [recentRecord] }, pitfallFavorites: [] }
  const merged = mergeSnapshots(base, local, remote)
  assert.deepEqual(merged.user.wrong, ['q3'])
  assert.deepEqual(merged.user.favorites, [])
  assert.deepEqual(merged.user.history.map(item => item.id), ['new'])
  assert.equal(merged.user.autoRemoveCorrectFromWrong, false)
  assert.deepEqual(merged.notes, {})
  assert.deepEqual(merged.pitfallFavorites, [])
  assert.equal(merged.draft, null)
})

test('stale retry preserves the newest attempt and does not duplicate merged note copies', () => {
  const base = { user: { attempts: { q1: { at: 100, correct: false } }, theme: 2 }, notes: { q1: '原文' }, draft: draft('q1', 100) }
  const local = { user: { attempts: { q1: { at: 200, correct: true } }, theme: 1 }, notes: { q1: '本机新版' }, draft: null }
  const remote = { user: { attempts: { q1: { at: 50, correct: false } }, theme: 3 }, notes: { q1: '另一台新版' }, draft: draft('q1', 205, 1) }
  const merged = mergeSnapshots(base, local, remote)
  assert.equal(merged.user.attempts.q1.at, 200)
  assert.equal(merged.user.theme, 3)
  assert.deepEqual(merged.draft, draft('q1', 205, 1))
  assert.deepEqual(mergeSnapshots(base, local, merged), merged)
  assert.deepEqual(mergeSnapshots(merged, merged, merged), merged)
  assert.equal(mergeSnapshots(null, local, remote).notes.q1, merged.notes.q1)
})

test('normalization filters malformed data and blocks prototype-like question keys', () => {
  const bad = JSON.parse(`{
    "user": {"attempts":{"__proto__":{"correct":true},"constructor":{"correct":true},"ok":{"selected":4,"correct":false,"durationSeconds":-1}},
      "wrong":[null,"ok","ok","<bad>","q\\n"],"favorites":{},"theme":6,"quizFont":"huge","autoRemoveCorrectFromWrong":1,
      "history":[null,{"id":"old","questions":[null,{"id":"ok","selected":7,"correct":"maybe","durationMs":1500}]}]},
    "notes":{"__proto__":"bad","constructor":"bad","ok":"好","empty":"","nontext":3},
    "pitfallFavorites":["ok:A","ok:①","ok:A","ok:Z","ok:A\\n"],
    "draft":{"ids":["ok"],"index":9,"answers":{"ok":2,"other":1},"times":{"ok":-1},"returnTo":{"route":"unknown","albumId":"bad/album"}}
  }`)
  const normalized = normalizeSnapshot(bad)
  assert.deepEqual(normalized.user.attempts, { ok: { correct: false } })
  assert.deepEqual(normalized.user.wrong, ['ok'])
  assert.deepEqual(normalized.user.favorites, [])
  assert.equal(normalized.user.theme, 0)
  assert.equal(normalized.user.quizFont, 'small')
  assert.equal(normalized.user.autoRemoveCorrectFromWrong, false)
  assert.deepEqual(normalized.user.history, [{ id: 'old', questions: [{ id: 'ok', durationMs: 1500 }] }])
  assert.deepEqual(normalized.notes, { ok: '好' })
  assert.deepEqual(normalized.pitfallFavorites, ['ok:A', 'ok:①'])
  assert.deepEqual(normalized.draft, { version: 1, ids: ['ok'], index: 0, answers: { ok: 2 }, times: {}, returnTo: { route: 'home' }, title: '', updatedAt: 0 })
  assert.equal(normalizeSnapshot({ draft: { ids: ['ok', 'ok'] } }).draft, null)
})

test('history respects recent record and question limits and distinguishes reused legacy IDs', () => {
  const many = Array.from({ length: 55 }, (_, index) => record(`r-${index}`, index))
  const normalized = normalizeSnapshot({ user: { history: many } })
  assert.equal(normalized.user.history.length, 50)
  assert.equal(normalized.user.history[0].id, 'r-54')
  assert.equal(normalized.user.history.at(-1).id, 'r-5')

  const repeated = record('reused', 30, 'q1')
  const distinct = record('reused', 30, 'q2')
  assert.equal(mergeSnapshots(null, { user: { history: [repeated] } }, { user: { history: [repeated, distinct] } }).user.history.length, 2)

  const questions = Array.from({ length: 2000 }, (_, index) => ({ id: `q${index}` }))
  const large = Array.from({ length: 7 }, (_, index) => ({ ...record(`z-${index}`, index), questions }))
  const merged = mergeSnapshots(null, { user: { history: large.slice(0, 3) } }, { user: { history: large.slice(3) } })
  assert.equal(merged.user.history.length, 5)
  assert.equal(merged.user.history[0].id, 'z-6')
  assert.equal(merged.user.history.at(-1).id, 'z-2')
})

test('transfer files round-trip practice data and do not include account credentials', () => {
  const local = {
    user: { favorites: ['q1'], history: [record('exported', 100)] },
    notes: { q1: '笔记' }, draft: draft('q1', 90),
    account: { secret: 'private-test-key' }
  }
  const text = serializeBackup(local)
  assert(!text.includes('private-test-key'))
  assert.deepEqual(parseBackup(text), normalizeSnapshot(local))
  assert.throws(() => parseBackup('{"notes":{}}'), /文件格式不匹配/)
  assert.throws(() => parseBackup('invalid JSON'), /文件无法读取/)
  const wrongVersion = { ...JSON.parse(text), version: 2 }
  assert.throws(() => parseBackup(JSON.stringify(wrongVersion)), /文件格式不匹配/)
})

test('manual merge preserves the active local draft and display choices and deduplicates repeated imports', () => {
  const local = {
    user: { attempts: { q1: { at: 200, correct: true } }, wrong: ['q1'], quizFont: 'large', theme: 3 },
    notes: { q1: '手机' }, draft: draft('q1', 50)
  }
  const incoming = {
    user: { attempts: { q1: { at: 150, correct: false } }, favorites: ['q2'], autoRemoveCorrectFromWrong: true, history: [record('remote', 110)] },
    notes: { q1: '电脑' }, draft: draft('q2', 100)
  }
  const merged = mergeBackup(local, incoming)
  assert.equal(merged.user.attempts.q1.at, 200)
  assert.equal(merged.user.quizFont, 'large')
  assert.equal(merged.user.theme, 3)
  assert.equal(merged.user.autoRemoveCorrectFromWrong, false)
  assert.deepEqual(merged.user.wrong, ['q1'])
  assert.deepEqual(merged.user.favorites, ['q2'])
  assert.deepEqual(merged.user.history.map(item => item.id), ['remote'])
  assert.match(merged.notes.q1, /手机/)
  assert.match(merged.notes.q1, /电脑/)
  assert.deepEqual(merged.draft, local.draft)
  assert.deepEqual(mergeBackup(merged, incoming), merged)
  assert.deepEqual(mergeBackup({}, incoming).draft, incoming.draft)
})
