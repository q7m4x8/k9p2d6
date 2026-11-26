/* Keep source books separate on disk and combine them without changing saved IDs. */
;(function (root) {
  function merge(banks) {
    const albums = []
    const questions = []
    const albumIds = new Set()
    const albumTitles = new Set()
    const questionIds = new Set()
    for (const bank of banks) {
      if (!Array.isArray(bank?.albums) || !Array.isArray(bank?.questions)) throw new Error('题库文件格式不完整')
      for (const album of bank.albums) {
        if (!album.id || !album.title || albumIds.has(album.id) || albumTitles.has(album.title)) throw new Error('题本编号重复或缺失')
        albumIds.add(album.id)
        albumTitles.add(album.title)
        albums.push(album)
      }
      for (const question of bank.questions) {
        if (!question.id || questionIds.has(question.id)) throw new Error('题目编号重复或缺失')
        questionIds.add(question.id)
        questions.push(question)
      }
    }
    for (const question of questions) {
      if (!albumTitles.has(question.album)) throw new Error('题目缺少所属题本')
    }
    return {
      appName: banks[0]?.appName || '小天爱刷题',
      version: banks.map(bank => bank.version || '').join('+'),
      albums,
      questions,
      stats: { questionCount: questions.length, paperCount: albums.reduce((sum, album) => sum + album.papers.length, 0), albumCount: albums.length }
    }
  }
  function createLoader(catalog, { fetch, caches, baseUrl, timeout = 10000 }) {
    const papers = catalog.albums.flatMap(album => album.papers).sort((a, b) => a.firstQuestionIndex - b.firstQuestionIndex)
    const paperByQuestion = new Map(papers.flatMap(paper => paper.questionIds.map(id => [id, paper])))
    const questionIds = [...paperByQuestion.keys()]
    const loaded = new Map()
    const inFlight = new Map()
    const failedUrls = new Set()
    const cache = caches?.open('xiaotian-quiz-papers-v1').catch(() => null)
    const referenceReviews = { sources: catalog.referenceSources || {}, entries: {}, questionReviews: {}, supplements: {}, displayFixes: {} }
    const optionReviews = { entries: {} }
    let questions = []

    function storeQuestions(entries, reviews) {
      for (const key of ['entries', 'questionReviews', 'supplements', 'displayFixes']) {
        Object.assign(referenceReviews[key], reviews.referenceReviews?.[key])
      }
      Object.assign(optionReviews.entries, reviews.optionReviews?.entries)
      for (const question of entries) loaded.set(question.id, question)
      questions = questionIds.map(id => loaded.get(id)).filter(Boolean)
    }

    async function read(url, validate) {
      const address = new URL(url, baseUrl)
      const storage = await cache
      const saved = await storage?.match(address).catch(() => null)
      if (saved) {
        try { return validate(await saved.json()) } catch {
          await storage.delete(address).catch(() => {})
        }
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        const response = await fetch(address, { signal: controller.signal, cache: failedUrls.has(url) ? 'reload' : 'default' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const copy = storage && response.clone()
        const result = validate(await response.json())
        if (copy) storage.put(address, copy).catch(() => {})
        failedUrls.delete(url)
        return result
      } catch (error) {
        failedUrls.add(url)
        throw error
      } finally {
        clearTimeout(timer)
      }
    }

    function getBlock(url, load) {
      if (!inFlight.has(url)) inFlight.set(url, load().finally(() => inFlight.delete(url)))
      return inFlight.get(url)
    }

    function checkQuestions(entries, ids) {
      if (!Array.isArray(entries) || entries.length !== ids.length ||
        entries.some((question, index) => question?.id !== ids[index] || !Array.isArray(question.options))) {
        throw new Error('题目数据不完整')
      }
      return entries
    }

    async function loadIds(ids) {
      const needed = [...new Set(ids.filter(id => !loaded.has(id)).map(id => paperByQuestion.get(id)).filter(Boolean))]
      // Large saved lists can span dozens of papers. Keep requests bounded on mobile.
      for (let offset = 0; offset < needed.length; offset += 6) {
        await Promise.all(needed.slice(offset, offset + 6).map(paper => getBlock(paper.url, async () => {
          if (loaded.has(paper.questionIds[0])) return
          const payload = await read(paper.url, data => {
            checkQuestions(data?.questions, paper.questionIds)
            return data
          })
          storeQuestions(payload.questions, payload)
        })))
      }
    }

    async function loadAll() {
      if (loaded.size === questionIds.length) return
      await Promise.all(catalog.sources.map(source => {
        const sourceAlbums = catalog.albums.filter(album => source.albumIds.includes(album.id))
        const sourcePapers = sourceAlbums.flatMap(album => album.papers).sort((a, b) => a.firstQuestionIndex - b.firstQuestionIndex)
        const ids = sourcePapers.flatMap(paper => paper.questionIds)
        if (ids.every(id => loaded.has(id))) return
        return getBlock(source.url, async () => {
          const [entries, reviews] = await Promise.all([
            read(source.url, data => checkQuestions(data?.questions, ids)),
            source.reviewUrl ? read(source.reviewUrl, data => {
              if (!data?.referenceReviews?.entries || !data?.optionReviews?.entries) throw new Error('解析数据不完整')
              return data
            }) : {}
          ])
          storeQuestions(entries, reviews)
        })
      }))
    }

    return {
      data: { ...catalog, get questions() { return questions } },
      referenceReviews,
      optionReviews,
      questionIds,
      has: id => paperByQuestion.has(id),
      needs: ids => ids.some(id => paperByQuestion.has(id) && !loaded.has(id)),
      loadIds,
      loadAll
    }
  }

  if (typeof module === 'object' && module.exports) module.exports = { merge, createLoader }
  else root.QuizBanks = { merge, createLoader }
})(typeof window !== 'undefined' ? window : globalThis)
