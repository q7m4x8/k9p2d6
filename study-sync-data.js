;(function (root) {
  'use strict'

  const historyLimit = 50
  const historyQuestionLimit = 10000
  const backupFormat = 'xiaotian-study-backup'
  const backupLimit = 12 * 1024 * 1024
  const noteSeparator = '\n\n—— 同步保留的另一份笔记 ——\n\n'
  const routes = ['home', 'album', 'wrong', 'favorites', 'progress']
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const isNumber = value => Number.isFinite(value) && value >= 0
  const isChoice = value => Number.isInteger(value) && value >= 0 && value < 4
  const isId = value => typeof value === 'string' && !/\s/.test(value) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(value) && !Object.hasOwn(Object.prototype, value)
  const isPitfallKey = value => typeof value === 'string' && !/\s/.test(value) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}:[A-D①-⑳]$/u.test(value)
  const compareText = (first, second) => first < second ? -1 : first > second ? 1 : 0
  const same = (first, second) => first === second || JSON.stringify(first) === JSON.stringify(second)

  function uniqueValues(value, valid) {
    return Array.isArray(value) ? [...new Set(value.filter(valid))] : []
  }

  function cleanQuestionMap(value, normalizeValue) {
    if (!isRecord(value)) return {}
    const entries = []
    for (const id of Object.keys(value).filter(isId).sort()) {
      const item = normalizeValue(value[id])
      if (item !== undefined) entries.push([id, item])
    }
    return Object.fromEntries(entries)
  }

  function cleanAttempt(value) {
    if (!isRecord(value)) return undefined
    const result = {}
    if (isChoice(value.selected)) result.selected = value.selected
    if (typeof value.correct === 'boolean') result.correct = value.correct
    if (isNumber(value.at)) result.at = value.at
    if (isNumber(value.durationSeconds)) result.durationSeconds = value.durationSeconds
    return Object.keys(result).length ? result : undefined
  }

  function cleanHistoryQuestion(value) {
    if (!isRecord(value) || !isId(value.id)) return null
    const question = { id: value.id }
    if (isNumber(value.seconds)) question.seconds = value.seconds
    if (isNumber(value.durationMs)) question.durationMs = value.durationMs
    // Older records can omit the choice or verdict; keep that distinction.
    if (isChoice(value.selected)) question.selected = value.selected
    if (typeof value.correct === 'boolean') question.correct = value.correct
    return question
  }

  function cleanHistoryRecord(value) {
    if (!isRecord(value) || !Array.isArray(value.questions)) return null
    const questions = value.questions.map(cleanHistoryQuestion).filter(Boolean)
    const result = {}
    if (isId(value.id)) result.id = value.id
    if (isNumber(value.submittedAt)) result.submittedAt = value.submittedAt
    if (typeof value.title === 'string') result.title = value.title
    if (isNumber(value.totalSeconds)) result.totalSeconds = value.totalSeconds
    if (Number.isInteger(value.correctCount) && value.correctCount >= 0 && value.correctCount <= questions.length) result.correctCount = value.correctCount
    result.questions = questions
    return result
  }

  function indexHistory(records) {
    // Records are immutable. Include their content to distinguish old entries without
    // IDs and legacy records that happened to reuse an ID.
    return new Map(records.map(record => [JSON.stringify(record), record]))
  }

  function recentHistory(indexed) {
    const sorted = [...indexed.entries()].sort(([firstKey, first], [secondKey, second]) =>
      (second.submittedAt ?? 0) - (first.submittedAt ?? 0) || compareText(firstKey, secondKey)
    )
    const history = []
    let rows = 0
    for (const [, record] of sorted) {
      rows += record.questions.length
      if (history.length >= historyLimit || rows > historyQuestionLimit) break
      history.push(record)
    }
    return history
  }

  function cleanDraft(value) {
    if (!isRecord(value) || !Array.isArray(value.ids) || !value.ids.length) return null
    const ids = uniqueValues(value.ids, isId)
    if (ids.length !== value.ids.length) return null
    const index = Number.isInteger(value.index) ? Math.max(0, Math.min(value.index, ids.length - 1)) : 0
    const idSet = new Set(ids)
    const answers = cleanQuestionMap(value.answers, item => isChoice(item) ? item : undefined)
    const times = cleanQuestionMap(value.times, item => isNumber(item) ? item : undefined)
    const returnTo = { route: routes.includes(value.returnTo?.route) ? value.returnTo.route : 'home' }
    if (isId(value.returnTo?.albumId)) returnTo.albumId = value.returnTo.albumId
    return {
      version: 1,
      ids,
      index,
      answers: Object.fromEntries(Object.entries(answers).filter(([id]) => idSet.has(id))),
      times: Object.fromEntries(Object.entries(times).filter(([id]) => idSet.has(id))),
      returnTo,
      title: typeof value.title === 'string' ? value.title : '',
      updatedAt: isNumber(value.updatedAt) ? value.updatedAt : 0
    }
  }

  function normalizeSnapshot(input) {
    const user = isRecord(input?.user) ? input.user : {}
    const history = Array.isArray(user.history) ? user.history.map(cleanHistoryRecord).filter(Boolean) : []
    return {
      user: {
        attempts: cleanQuestionMap(user.attempts, cleanAttempt),
        wrong: uniqueValues(user.wrong, isId),
        favorites: uniqueValues(user.favorites, isId),
        history: recentHistory(indexHistory(history)),
        theme: Number.isInteger(user.theme) && user.theme >= 0 && user.theme < 6 ? user.theme : 0,
        quizFont: ['small', 'medium', 'large'].includes(user.quizFont) ? user.quizFont : 'small',
        autoRemoveCorrectFromWrong: user.autoRemoveCorrectFromWrong === true
      },
      notes: cleanQuestionMap(input?.notes, value => typeof value === 'string' && value ? value : undefined),
      pitfallFavorites: uniqueValues(input?.pitfallFavorites, isPitfallKey),
      draft: cleanDraft(input?.draft)
    }
  }

  function mergeValue(base, local, remote, onConflict = (_local, incoming) => incoming) {
    if (same(local, remote) || same(remote, base)) return local
    if (same(local, base)) return remote
    return onConflict(local, remote)
  }

  function mergeSets(base, local, remote) {
    const previous = new Set(base)
    const here = new Set(local)
    const there = new Set(remote)
    return [...new Set([...there, ...here])].filter(id => !previous.has(id) || (here.has(id) && there.has(id)))
  }

  function mergeAttempts(local, remote) {
    const attempts = new Map(Object.entries(remote))
    for (const [id, attempt] of Object.entries(local)) {
      const incoming = attempts.get(id)
      if (!incoming || (attempt.at ?? -1) > (incoming.at ?? -1)) attempts.set(id, attempt)
    }
    return Object.fromEntries([...attempts.entries()].sort(([first], [second]) => compareText(first, second)))
  }

  function mergeHistory(base, local, remote) {
    const previous = indexHistory(base)
    const here = indexHistory(local)
    const there = indexHistory(remote)
    const keys = mergeSets(previous.keys(), here.keys(), there.keys())
    return recentHistory(new Map(keys.map(key => [key, there.get(key) ?? here.get(key)])))
  }

  function combineNotes(local, remote) {
    if (!local || !remote) return local || remote
    const versions = new Set([...local.split(noteSeparator), ...remote.split(noteSeparator)])
    return [...versions].sort(compareText).join(noteSeparator)
  }

  function mergeNotes(base, local, remote) {
    const ids = [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort()
    return Object.fromEntries(ids.flatMap(id => {
      const merged = mergeValue(base[id], local[id], remote[id], combineNotes)
      return merged ? [[id, merged]] : []
    }))
  }

  function mergeSnapshots(base, local, remote) {
    const previous = normalizeSnapshot(base)
    const here = normalizeSnapshot(local)
    const there = normalizeSnapshot(remote)
    return {
      user: {
        attempts: mergeAttempts(here.user.attempts, there.user.attempts),
        wrong: mergeSets(previous.user.wrong, here.user.wrong, there.user.wrong),
        favorites: mergeSets(previous.user.favorites, here.user.favorites, there.user.favorites),
        history: mergeHistory(previous.user.history, here.user.history, there.user.history),
        theme: mergeValue(previous.user.theme, here.user.theme, there.user.theme),
        quizFont: mergeValue(previous.user.quizFont, here.user.quizFont, there.user.quizFont),
        autoRemoveCorrectFromWrong: mergeValue(previous.user.autoRemoveCorrectFromWrong, here.user.autoRemoveCorrectFromWrong, there.user.autoRemoveCorrectFromWrong)
      },
      notes: mergeNotes(previous.notes, here.notes, there.notes),
      pitfallFavorites: mergeSets(previous.pitfallFavorites, here.pitfallFavorites, there.pitfallFavorites),
      draft: mergeValue(previous.draft, here.draft, there.draft, (current, incoming) => {
        if (!current || !incoming) return current || incoming
        return current.updatedAt > incoming.updatedAt ? current : incoming
      })
    }
  }

  function serializeBackup(snapshot) {
    const text = JSON.stringify({ format: backupFormat, version: 1, snapshot: normalizeSnapshot(snapshot) })
    if (new TextEncoder().encode(text).length > backupLimit) throw new Error('本机记录超过 12 MB，无法导出为单个记录文件。')
    return text
  }

  function parseBackup(text) {
    let value
    try { value = JSON.parse(text) } catch { throw new Error('文件无法读取，请选择小天爱刷题导出的记录文件。') }
    const snapshot = value?.snapshot
    const user = snapshot?.user
    if (value?.format !== backupFormat || value.version !== 1 || !isRecord(user?.attempts) ||
      !Array.isArray(user.wrong) || !Array.isArray(user.favorites) || !Array.isArray(user.history) ||
      !isRecord(snapshot.notes) || !Array.isArray(snapshot.pitfallFavorites) ||
      (snapshot.draft !== null && !isRecord(snapshot.draft))) {
      throw new Error('文件格式不匹配，请选择小天爱刷题导出的记录文件。')
    }
    return normalizeSnapshot(snapshot)
  }

  function mergeBackup(local, incoming) {
    const here = normalizeSnapshot(local)
    const merged = mergeSnapshots(null, here, incoming)
    merged.user.theme = here.user.theme
    merged.user.quizFont = here.user.quizFont
    merged.user.autoRemoveCorrectFromWrong = here.user.autoRemoveCorrectFromWrong
    merged.draft = here.draft || merged.draft
    return merged
  }

  const api = { normalizeSnapshot, mergeSnapshots, backupLimit, serializeBackup, parseBackup, mergeBackup }
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.StudySyncData = api
})(typeof window === 'undefined' ? null : window)
