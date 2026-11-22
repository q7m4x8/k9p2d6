/* Display-only whitespace repair. Question-bank text and file paths stay intact. */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.QuizText = api
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict'

  // Horizontal Unicode whitespace only: paragraph breaks are meaningful and stay.
  const gap = '[\\t\\v\\f \\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000\\ufeff]+'
  const han = '\\p{Script=Han}'
  const withinChinese = new RegExp(`(${han})${gap}(?=${han})`, 'gu')
  const beforeChinesePunctuation = new RegExp(`${gap}(?=[，。；：？！、）】》〉」』”’])`, 'gu')
  const afterOpeningPunctuation = new RegExp(`([（【《〈「『“‘])${gap}`, 'gu')
  const afterChinesePunctuation = new RegExp(`([，。；：？！、）】》〉」』”’])${gap}(?=[${han}①-⑳])`, 'gu')
  const afterStatementMarker = new RegExp(`([①-⑳])${gap}(?=${han})`, 'gu')
  const beforeOpeningPunctuation = new RegExp(`(${han})${gap}(?=[（【《〈「『“‘])`, 'gu')

  function normalize(value) {
    return String(value ?? '')
      .replace(withinChinese, '$1')
      .replace(beforeChinesePunctuation, '')
      .replace(afterOpeningPunctuation, '$1')
      .replace(afterChinesePunctuation, '$1')
      .replace(afterStatementMarker, '$1')
      .replace(beforeOpeningPunctuation, '$1')
      .trim()
  }

  return Object.freeze({ normalize })
})
