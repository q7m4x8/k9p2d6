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
      else if (character === stack[stack.length - 1] || (character === '”' && stack[stack.length - 1] === '"')) stack.pop()
      else if (character === '"') {
        // OCR frequently pairs a Chinese opening quote with an ASCII closing quote.
        if (stack[stack.length - 1] === '"' || stack[stack.length - 1] === '”') stack.pop()
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
        if (verdict === 'incorrect' && body) {
          if (!chunks[label]) chunks[label] = []
          // Grouped verdicts can share an explanation; every actual edit still needs its own
          // exact original phrase and an independently aligned source phrase below.
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

  function segmentsFromPairs(text, pairs) {
    const source = compactOffsets(text)
    const ranges = []
    for (const pair of pairs) {
      const wrong = compact(pair.wrong)
      const correct = cleanText(pair.correct)
      const start = source.value.indexOf(wrong)
      if (!wrong || !correct || wrong === compact(correct) || start < 0 || source.value.indexOf(wrong, start + 1) !== -1) continue
      ranges.push({ start, end: start + wrong.length, correct })
    }
    ranges.sort((a, b) => a.start - b.start || a.end - b.end)
    const selected = []
    for (const range of ranges) {
      const previous = selected[selected.length - 1]
      if (previous && range.start < previous.end) {
        if (range.start === previous.start && range.end === previous.end && compact(range.correct) === compact(previous.correct)) continue
        return null // Conflicting or nested edits need a human reading of the source.
      }
      selected.push(range)
    }
    if (!selected.length) return null
    const segments = []
    let cursor = 0
    for (const range of selected) {
      const start = source.offsets[range.start]
      const end = range.end === source.value.length ? text.length : source.offsets[range.end]
      if (start > cursor) segments.push({ type: 'text', text: text.slice(cursor, start) })
      segments.push({ type: 'correction', wrong: text.slice(start, end), correct: range.correct })
      cursor = end
    }
    if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) })
    return segments
  }

  function unquote(value) {
    return cleanText(value).replace(/^[“”"「」『』'（(\s]+|[“”"「」『』'）)\s]+$/g, '')
  }

  function quotedPhrases(value) {
    return [...value.matchAll(/[“"「『]([^“”"「」『』\n]{2,100})[”"」』]/g)].map(match => cleanText(match[1]))
  }

  function affirmativePhrase(original, wrong, beforeContrast) {
    const originalCompact = compact(original)
    const position = originalCompact.indexOf(compact(wrong))
    if (position < 0) return null
    const originalLead = originalCompact.slice(0, position).split(/[，,。；;！？：:—]/).pop()
    const before = cleanText(beforeContrast).replace(/[，,（(\s]+$/, '')
    const clause = before.split(/[，,。；;！？\n]/).pop()
    const clauseCompact = compact(clause)
    const quoted = quotedPhrases(clause)
    if (originalLead.length >= 2 && quoted.length === 1 && clauseCompact.startsWith(originalLead) &&
      /^[“"「『]/.test(compactSlice(clause, originalLead.length, clauseCompact.length))) return quoted[0]
    if (originalLead.length >= 2 && clauseCompact.startsWith(originalLead)) {
      const result = unquote(compactSlice(clause, originalLead.length, clauseCompact.length))
      if (result) return result
    }
    // Preserve the original's shared prose, e.g. “体现了”, while reading the noun phrase after
    // the source's equivalent “体现的是”. Only these explicit copular variants are interchangeable.
    const relation = originalLead.match(/^(体现|反映|表明|说明|表现|强调|对应|属于)(?:了|的是|的|是|为)?$/)
    if (relation) {
      const expected = new RegExp('^' + relation[1] + '(?:的是|的应当是|的应是|的是|是|为|了)')
      const prefix = clauseCompact.match(expected)?.[0]
      if (prefix) return unquote(compactSlice(clause, prefix.length, clauseCompact.length))
    }
    const explicit = clause.match(/(?:体现的是|反映的是|表明的是|说明的是|对应的是|属于|赋予的是|正确的应为|正确的是|应改为|应当为|应为|^是)([\s\S]+)$/)
    if (explicit) return unquote(explicit[1])
    const attribution = clause.match(/是([^“”"「」『』]+)的(?:核心内容|核心主张)$/)
    if (!originalLead && attribution) return cleanText(attribution[1])
    if (quoted.length === 1 && /对应的是|应改为|应当为|应为/.test(clause)) return quoted[0]
    return null
  }

  function trimRepeatedContext(original, wrong, correct) {
    const source = compact(original)
    const start = source.indexOf(compact(wrong))
    if (start < 0) return correct
    const suffix = source.slice(start + compact(wrong).length)
    const target = compact(correct)
    for (let length = Math.min(suffix.length, target.length - 2); length >= 4; length--) {
      if (target.endsWith(suffix.slice(0, length))) return compactSlice(correct, 0, target.length - length)
    }
    return correct
  }

  function directContrastPairs(original, explanationChunk) {
    const text = cleanText(explanationChunk)
    const pairs = []
    // Affirmation followed by explicit rejection: “X，而非Y / 而不是Y”. The rejected phrase
    // must occur verbatim and uniquely in the original; the correction comes from the same clause.
    for (const marker of text.matchAll(/而非|而不是/g)) {
      const after = text.slice(marker.index + marker[0].length)
      const tail = after.split(/[，,。；;！？\n）)]/)[0]
      const quoted = quotedPhrases(tail)
      const candidates = [unquote(tail), ...quoted]
      for (const wrong of candidates) {
        if (!wrong || compact(wrong).length < 2 || !compact(original).includes(compact(wrong))) continue
        const before = text.slice(0, marker.index).split(/[。；;！？\n]/).pop()
        const affirmative = affirmativePhrase(original, wrong, before)
        const correct = affirmative && trimRepeatedContext(original, wrong, affirmative)
        if (correct && compact(text).includes(compact(correct)) && !/[①-⑳]/.test(correct)) pairs.push({ wrong, correct })
      }
    }
    // The opposite order is equally explicit: “不是Y，而是X”. Avoid cross-sentence matches.
    for (const match of text.matchAll(/(?:并非|不是)([^。；;！？\n]+?)[，,]?而是([^，,。；;！？\n]+)/g)) {
      const wrong = unquote(match[1].replace(/[，,]$/, ''))
      const correct = unquote(match[2])
      if (compact(wrong).length >= 2 && compact(original).includes(compact(wrong))) pairs.push({ wrong, correct })
    }
    // Explicit editorial instructions with both terms quoted have no similarity/length ceiling.
    for (const match of text.matchAll(/[“"「『]([^“”"「」『』\n]+)[”"」』](?:应改为|应为|应当为|应是)[“"「『]([^“”"「」『』\n]+)[”"」』]/g)) {
      pairs.push({ wrong: match[1], correct: match[2] })
    }
    return pairs
  }

  function findDirectCorrection(original, explanationChunk) {
    return segmentsFromPairs(cleanText(original), directContrastPairs(original, explanationChunk))
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
    const direct = findDirectCorrection(display, explanationChunk)
    if (direct) return direct
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

  // Each entry was checked against this bank's source explanation. These are positive, exact
  // source mappings, not word-wide replacement rules. A changed source or original fails closed.
  const reviewedPairs = Object.freeze({
    'xh-special-021:③': [['一致性中寻求多样性', '多样性中寻求一致性']],
    'xh-special-021:④': [['以人民为中心', '党的领导']],
    'xh-500-041:①': [['为人民提供文化服务和文化产品的能力', '人民的思想境界、精神状态、文化修养']],
    'xh-500-117:①': [['社会主义法治国家', '中国特色社会主义法治体系']],
    'xh-500-123:④': [['处理民族关系的基本原则', '我国民族关系的特征']],
    'xh-500-169:③': [['直观反映', '能动反映']],
    'xh-500-218:①': [['结构性问题', '总量性问题']],
    'xh-500-218:②': [['总量性问题', '结构性问题']],
    'xh-500-227:②': [['外延式扩张', '内涵式发展']],
    'xh-500-227:③': [['城乡融合发展', '城市更新']],
    'xh-500-235:⑤': [['财政政策调控', '货币政策调控和宏观审慎管理']],
    'xh-500-239:①': [['功能发挥要服从盈利目标', '盈利要服从功能发挥']],
    'xh-500-253:②': [['创造的经济价值大不大', '老百姓口碑好不好']],
    'xh-500-290:①': [['财产至上', '生命至上']],
    'xh-500-290:③': [['救灾为主', '预防为主']],
    'xh-500-295:①': [['监督责任', '主体责任']],
    'xh-500-295:②': [['主体责任', '监督责任']],
    'xh-500-375:③': [['88%', '95％']],
    'xh-500-378:③': [['60%', '40％']],
    'xh-500-430:③': [['12小时', '8小时']],
    'xh-500-440:③': [['1小时', '2小时']],
    'xh-500-453:②': [['55%', '60％'], ['60%', '55％']],
    'xh-special-001:②': [['十八大', '十九大']],
    'xh-special-004:①': [['物质文化需要同落后的社会生产', '美好生活需要和不平衡不充分的发展']],
    'xh-special-006:②': [['同步富裕', '共同富裕']],
    'xh-special-007:⑤': [['基本实现', '取得更为明显的实质性进展']],
    'xh-special-013:②': [['各个区域逐步形成自我小循环', '经济循环的畅通无阻']],
    'xh-special-013:④': [['高水平对外开放', '高水平的自立自强']],
    'xh-special-028:④': [['坚持以经济建设为主线', '坚持以制度建设为主线']],
    'xh-special-030:④': [['坚持中国特色社会主义制度', '建设中国特色社会主义法治体系']],
    'xh-special-033:①': [['首要任务', '根本任务']],
    'xh-special-071:②': [['世界第一', '世界第二']],
    'xh-special-157:④': [['全面实现', '基本实现']],
    'xh-special-184:③': [['5年', '3年']],
    'xh-mock-039:④': [['完全法典化', '适度法典化']],
    'xh-mock-068:②': [['人民代表大会制度', '民主集中制']]
  })

  function reviewedCorrection(question, item, chunks) {
    const entries = reviewedPairs[question.id + ':' + item.label]
    if (!entries) return null
    const original = compact(item.text)
    if (entries.some(([wrong]) => {
      const position = original.indexOf(compact(wrong))
      return position < 0 || original.indexOf(compact(wrong), position + 1) !== -1
    })) return null
    const explanation = compact((chunks || []).join('\n'))
    const pairs = entries.filter(([, correct]) => explanation.includes(compact(correct)))
      .map(([wrong, correct]) => ({ wrong, correct }))
    // In particular, simultaneous numeric swaps are always mapped to original offsets, never
    // applied serially where an inserted number might accidentally be replaced again.
    return pairs.length === entries.length ? segmentsFromPairs(item.text, pairs) : null
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
        segments = reviewedCorrection(question, item, parsed.chunks[item.label])
        if (!segments) {
          for (const chunk of parsed.chunks[item.label] || []) {
            segments = findCorrection(item.text, chunk)
            if (segments) break
          }
        }
      }
      const result = { ...item, verdict, segments: segments || [{ type: 'text', text: item.text }] }
      if (parsed.reasons[item.label]?.length) result.reason = [...new Set(parsed.reasons[item.label])].join('\n')
      if (verdict === 'incorrect' && result.reason) result.needsExplanation = true
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

  return Object.freeze({ format, extractStatements, parseVerdicts, findCorrection, findDirectCorrection })
})
