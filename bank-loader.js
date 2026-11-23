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
  if (typeof module === 'object' && module.exports) module.exports = { merge }
  else root.QuizBanks = { merge }
})(typeof window !== 'undefined' ? window : globalThis)
