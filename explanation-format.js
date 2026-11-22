/* Display-only, source-grounded reference answers. The question bank is never mutated. */
(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.QuizExplanationFormatter = api
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function (root) {
  'use strict'

  const labels = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
  const nonFactualStatus = /^(?:不符合题意|不合题意|未体现|不体现|不属于|不当选|不选|应排除|排除)/

  function cleanText(value) {
    if (root && root.QuizText && typeof root.QuizText.normalize === 'function') return root.QuizText.normalize(value)
    // Standalone consumers may not load text-format.js. Preserve English word spaces and paragraphs.
    return String(value ?? '').replace(/([\u3400-\u9fff])[ \t\u00a0]+(?=[\u3400-\u9fff，。；：？！、）])/g, '$1')
      .replace(/([，。；：？！、（])[ \t\u00a0]+(?=[\u3400-\u9fff])/g, '$1').trim()
  }

  function compact(value) { return cleanText(value).replace(/\s+/g, '') }

  function extractStatements(stem) {
    const source = String(stem ?? '')
    const markers = [...source.matchAll(/[①-⑳]/g)]
    if (markers.length < 2 || markers.length > labels.length) return []
    if (markers.some((match, index) => match[0] !== labels[index])) return []
    const items = markers.map((match, index) => ({
      label: match[0],
      text: cleanText(source.slice(match.index + 1, markers[index + 1]?.index ?? source.length))
    }))
    return items.every(item => item.text.length >= 3) ? items : []
  }

  function removeConclusion(value) {
    return value.replace(/(?:故|因此|所以)(?:本题(?:的)?(?:正确)?答案|本题(?:应)?选|答案)[\s\S]*$/, '').trim()
  }

  function insideQuotation(text, index) {
    const stack = []
    const closers = { '“': '”', '「': '」', '『': '』' }
    for (const character of text.slice(0, index)) {
      if (closers[character]) stack.push(closers[character])
      else if (character === stack[stack.length - 1]) stack.pop()
      else if (character === '"') {
        if (stack[stack.length - 1] === '"') stack.pop()
        else stack.push('"')
      }
    }
    return stack.length > 0
  }

  function parseVerdicts(explanation, itemCount) {
    const text = cleanText(explanation)
    // The leading boundary deliberately excludes quotation marks and ordinary text.
    // A quoted “①错误” or a reference to another statement is not a new verdict.
    const pattern = /(^|[。；;\n\r，,：:\s])(?:故|因此|所以)?([①-⑳](?:[、，,和及与]?[①-⑳])*)\s*(?:项)?\s*(?:(?:的)?(?:说法|表述|判断))?\s*(?:均|都)?\s*(不符合题意|不合题意|未体现|不体现|不属于|不当选|不正确|错误|正确)/g
    const matches = [...text.matchAll(pattern)].filter(match => !insideQuotation(text, match.index + match[1].length))
    const verdicts = Object.create(null)
    const chunks = Object.create(null)
    const reasons = Object.create(null)
    const contextual = new Set()
    const conflicting = new Set()
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index]
      const applicable = [...match[2]].filter(label => labels.includes(label) && labels.indexOf(label) < itemCount)
      const body = removeConclusion(text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length)
        .replace(/^[\s，,：:；;。]+/, ''))
      const status = match[3]
      let verdict = status === '正确' ? 'correct' : /^(?:错误|不正确)$/.test(status) ? 'incorrect' : 'unknown'
      // Some source books call a statement “wrong” solely because it does not answer the prompt.
      if (verdict === 'incorrect' && nonFactualStatus.test(body)) verdict = 'unknown'
      for (const label of applicable) {
        if (verdict === 'unknown') contextual.add(label)
        if (verdicts[label] && verdicts[label] !== verdict) conflicting.add(label)
        verdicts[label] = verdict
        const sourceReason = applicable.length === 1 ? body : cleanText(match[2] + status + (body ? '：' + body : ''))
        if (sourceReason) {
          if (!reasons[label]) reasons[label] = []
          reasons[label].push(sourceReason)
        }
        if (applicable.length === 1 && verdict === 'incorrect' && body) {
          if (!chunks[label]) chunks[label] = []
          chunks[label].push(body)
        }
      }
    }
    // Contradictory source labels must not silently select one interpretation.
    for (const label of conflicting) verdicts[label] = 'unknown'
    return { verdicts, chunks, reasons, contextual, conflict: conflicting.size > 0, explicitCount: Object.keys(verdicts).length }
  }

  function countFromOption(value) {
    const match = compact(value).match(/^([0-9]+|[零一二三四五六七八九十])项$/)
    if (!match) return null
    return /^\d+$/.test(match[1]) ? Number(match[1]) : '零一二三四五六七八九十'.indexOf(match[1])
  }

  function inferPositiveCount(question, items, parsed) {
    const introduction = compact(String(question.stem ?? '').split('①')[0])
    if (!/正确的?(?:有|是)几项/.test(introduction)) return false
    if (/不正确|错误|不准确|不属于|不包括|不符合|未体现|不体现/.test(introduction)) return false
    if (!Number.isInteger(question.answer) || !Array.isArray(question.options)) return false
    if (question.options.some(option => countFromOption(option) === null)) return false
    const count = countFromOption(question.options[question.answer])
    if (count === null || count < 0 || count > items.length || !parsed.explicitCount || parsed.conflict || parsed.contextual.size) return false
    const wrongCount = items.filter(item => parsed.verdicts[item.label] === 'incorrect').length
    const correctCount = items.filter(item => parsed.verdicts[item.label] === 'correct').length
    if (wrongCount !== items.length - count || correctCount > count) return false
    let inferred = false
    for (const item of items) {
      if (!parsed.verdicts[item.label]) { parsed.verdicts[item.label] = 'correct'; inferred = true }
    }
    return inferred
  }

  function compactOffsets(text) {
    let value = ''
    const offsets = []
    for (let index = 0; index < text.length; index++) {
      if (/\s/.test(text[index])) continue
      value += text[index]
      offsets.push(index)
    }
    offsets.push(text.length)
    return { value, offsets }
  }

  function compactSlice(text, start, end) {
    const source = compactOffsets(text)
    return text.slice(source.offsets[start], end >= source.value.length ? text.length : source.offsets[end])
  }

  function makeSegments(text, wrong, correct) {
    const source = compactOffsets(text)
    const wrongCompact = compact(wrong)
    const start = source.value.indexOf(wrongCompact)
    if (!wrongCompact || start < 0 || source.value.indexOf(wrongCompact, start + 1) !== -1) return null
    const end = start + wrongCompact.length
    const beginOffset = source.offsets[start]
    const endOffset = end === source.value.length ? text.length : source.offsets[end]
    const segments = []
    if (beginOffset) segments.push({ type: 'text', text: text.slice(0, beginOffset) })
    segments.push({ type: 'correction', wrong: text.slice(beginOffset, endOffset), correct: cleanText(correct) })
    if (endOffset < text.length) segments.push({ type: 'text', text: text.slice(endOffset) })
    return segments
  }

  function sentenceVariants(text, source) {
    const variants = new Map()
    function add(value) {
      const display = cleanText(value).replace(/^[，,：:；;]+|[，,：:；;]+$/g, '')
      const valueCompact = compact(display)
      if (valueCompact && !variants.has(valueCompact)) variants.set(valueCompact, display)
    }
    for (const raw of cleanText(text).split(/[。！？\n]/)) {
      const sentence = cleanText(raw)
      const value = compact(sentence)
      if (!value || value.length > 500 || /[“”「」『』]/.test(value)) continue
      // Negated quotations and explanations about an option are not replacement sentences.
      if (/(?:说法|表述|选项).*(?:错误|不正确)|正确(?:的)?(?:应为|是)|应改为|应为|并非|不是/.test(value)) continue
      add(sentence)
      for (let index = 0; index < value.length; index++) {
        if (/[，,；;]/.test(value[index])) add(compactSlice(sentence, 0, index))
      }
      // Source explanations often append one extra explanatory clause to the corrected sentence.
      for (const tailLength of [20, 16, 12]) {
        if (source.length < tailLength) continue
        const tail = source.slice(-tailLength)
        const position = value.indexOf(tail)
        if (position >= 0 && value.indexOf(tail, position + 1) === -1) add(compactSlice(sentence, 0, position + tailLength))
      }
    }
    return [...variants.entries()].map(([value, display]) => ({ value, display }))
  }

  function wordBoundaries(value) {
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null
    const result = new Set([0, value.length])
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    for (const item of segmenter.segment(value)) result.add(item.index)
    return result
  }

  function phraseRange(source, target, prefix, suffix) {
    const sourceBoundaries = wordBoundaries(source)
    const targetBoundaries = wordBoundaries(target)
    if (!sourceBoundaries || !targetBoundaries) return null
    while (prefix > 0 && (!sourceBoundaries.has(prefix) || !targetBoundaries.has(prefix))) prefix--
    while (suffix > 0 && (!sourceBoundaries.has(source.length - suffix) || !targetBoundaries.has(target.length - suffix))) suffix--
    // A dictionary may split individual characters of these common compounds. Keep their shared tail
    // inside the highlighted phrase; these are spelling boundaries, not factual replacement rules.
    const commonTail = source.slice(source.length - suffix)
    const compoundTail = commonTail.match(/^(?:接税|亿斤|落户|形资产|循环|办学位|收入|分配|位规划|民主|创新|理论|税|军|权|法|本|性)/)
    if (compoundTail && source.length - suffix > prefix && target.length - suffix > prefix) suffix -= compoundTail[0].length
    // “人为” is a dictionary word, but in “以人为单位” the complete unit phrase is the relevant span.
    for (const pattern of [/以[\u3400-\u9fff]{1,3}为单位/g, /以[\u3400-\u9fff]促[\u3400-\u9fff]/g]) {
      const sourcePhrase = [...source.matchAll(pattern)].find(match => match.index <= prefix && match.index + match[0].length >= source.length - suffix)
      const targetPhrase = [...target.matchAll(pattern)].find(match => match.index <= prefix && match.index + match[0].length >= target.length - suffix)
      if (sourcePhrase && targetPhrase && sourcePhrase.index === targetPhrase.index &&
        source.length - sourcePhrase.index - sourcePhrase[0].length === target.length - targetPhrase.index - targetPhrase[0].length) {
        prefix = sourcePhrase.index
        suffix = source.length - sourcePhrase.index - sourcePhrase[0].length
      }
    }
    return { prefix, suffix }
  }

  function hasSeparatedChanges(wrong, correct) {
    // A long unchanged interior means more than one edit (possibly OCR mixed into a real correction).
    // A single replacement must not silently absorb those unrelated changes.
    for (let index = 1; index + 4 < wrong.length; index++) {
      const middle = wrong.slice(index, index + 4)
      const position = correct.indexOf(middle, 1)
      if (position > 0 && position + 4 < correct.length) return true
    }
    return false
  }

  function hasProseRewrite(wrong, correct) {
    // Added/removed pronouns and auxiliaries can accompany a factual change in an explanation.
    // Do not color those unchanged instructions as if they were the factual mistake.
    const auxiliary = /^(?:我们|要|应当|必须|需要|持续|进一步)/
    const wrongLead = wrong.match(auxiliary)?.[0]
    const correctLead = correct.match(auxiliary)?.[0]
    if (wrongLead !== correctLead && (wrongLead || correctLead)) return true
    for (let length = 2; length <= Math.min(6, wrong.length - 1, correct.length - 1); length++) {
      if (correct.indexOf(wrong.slice(0, length), 1) > 0 || wrong.indexOf(correct.slice(0, length), 1) > 0) return true
    }
    return false
  }

  function findCorrection(original, explanationChunk) {
    const display = cleanText(original)
    const source = compact(display).replace(/[。；;]+$/, '')
    if (source.length < 16) return null
    const candidates = []
    for (const candidate of sentenceVariants(explanationChunk, source)) {
      const target = candidate.value
      if (target === source || target.length < source.length * 0.8 || target.length > source.length * 1.25) continue
      let prefix = 0
      while (prefix < Math.min(source.length, target.length) && source[prefix] === target[prefix]) prefix++
      let suffix = 0
      while (suffix < Math.min(source.length, target.length) - prefix && source[source.length - 1 - suffix] === target[target.length - 1 - suffix]) suffix++
      // Retain short shared endings within the correction so “性/化/的” is not split off a phrase.
      if (suffix < 4) suffix = 0
      const sharedRatio = (prefix + suffix) / Math.max(source.length, target.length)
      if (Math.max(prefix, suffix) < 10 || sharedRatio < 0.75) continue
      const range = phraseRange(source, target, prefix, suffix)
      if (!range) continue
      prefix = range.prefix
      suffix = range.suffix
      const wrong = source.slice(prefix, source.length - suffix)
      const correct = target.slice(prefix, target.length - suffix)
      if (!wrong || !correct || wrong.length > source.length * 0.3 || Math.max(wrong.length, correct.length) > 24 || /[，,；;。！？：:、]/.test(wrong + correct)) continue
      if (!/[\p{L}\p{N}]/u.test(wrong) || !/[\p{L}\p{N}]/u.test(correct)) continue
      if ((wrong.length < 2 || correct.length < 2) && /[\u3400-\u9fff]/.test(wrong + correct)) continue
      if (hasSeparatedChanges(wrong, correct)) continue
      if (hasProseRewrite(wrong, correct)) continue
      const correctionDisplay = compactSlice(candidate.display, prefix, target.length - suffix)
      const segments = makeSegments(display, wrong, correctionDisplay)
      if (segments) candidates.push({ segments, wrong, correct, score: sharedRatio - Math.abs(correct.length - wrong.length) / source.length * 0.05 })
    }
    candidates.sort((a, b) => b.score - a.score)
    if (!candidates.length) return null
    // Several plausible, different replacements require a human reading of the original explanation.
    if (candidates.some(candidate => candidates[0].score - candidate.score < 0.025 &&
      (candidates[0].wrong !== candidate.wrong || candidates[0].correct !== candidate.correct))) return null
    return candidates[0].segments
  }

  function exampleCorrection(question, item, chunks) {
    if (question.id !== 'xh-special-021') return null
    const correction = item.label === '③'
      ? { wrong: '一致性中寻求多样性', correct: '多样性中寻求一致性' }
      : item.label === '④' ? { wrong: '以人民为中心', correct: '党的领导' } : null
    if (!correction || !chunks?.some(chunk => compact(chunk).includes(correction.correct))) return null
    return makeSegments(item.text, correction.wrong, correction.correct)
  }

  function format(question) {
    if (!question || typeof question !== 'object') return null
    const statements = extractStatements(question.stem)
    if (!statements.length) return null
    const parsed = parseVerdicts(question.explanation, statements.length)
    const inferredVerdicts = inferPositiveCount(question, statements, parsed)
    const items = statements.map(item => {
      const verdict = parsed.conflict ? 'unknown' : parsed.verdicts[item.label] || 'unknown'
      let segments = null
      if (verdict === 'incorrect') {
        segments = exampleCorrection(question, item, parsed.chunks[item.label])
        if (!segments) {
          for (const chunk of parsed.chunks[item.label] || []) {
            segments = findCorrection(item.text, chunk)
            if (segments) break
          }
        }
      }
      const result = { ...item, verdict, segments: segments || [{ type: 'text', text: item.text }] }
      if (parsed.reasons[item.label]?.length) result.reason = [...new Set(parsed.reasons[item.label])].join('\n')
      return result
    })
    const corrected = items.filter(item => item.segments.some(segment => segment.type === 'correction')).length
    return {
      items,
      hasCorrections: corrected > 0,
      inferredVerdicts,
      coverage: { corrected, incorrect: items.filter(item => item.verdict === 'incorrect').length, unknown: items.filter(item => item.verdict === 'unknown').length }
    }
  }

  return Object.freeze({ format, extractStatements, parseVerdicts, findCorrection })
})
