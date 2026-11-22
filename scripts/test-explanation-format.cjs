'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
global.QuizText = require('../text-format.js')
const formatter = require('../explanation-format.js')
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/questions.json'), 'utf8'))
const canonicalBefore = JSON.stringify(bank)
const labels = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const compact = value => global.QuizText.normalize(value).replace(/\s+/g, '')
let assertions = 0

function check(value, message) { assert.ok(value, message); assertions++ }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++ }
function question(overrides = {}) {
  return {
    id: 'test-source-only',
    stem: '下列说法正确的有几项？①第一条保留完整的原文内容②第二条保留完整的原文内容③第三条保留完整的原文内容④第四条保留完整的原文内容',
    options: ['1 项', '2 项', '3 项', '4 项'], answer: 1,
    explanation: '③错误：请以原始资料说明为准。④错误：请以原始资料说明为准。故本题答案为 B。',
    ...overrides
  }
}

const sample = bank.questions.find(item => item.id === 'xh-special-021')
const sampleReference = formatter.format(sample)
eq(sampleReference.items.length, 4, 'The approved example includes all four original statements')
eq(sampleReference.items.map(item => item.verdict), ['correct', 'correct', 'incorrect', 'incorrect'])
eq(sampleReference.items.flatMap(item => item.segments.filter(segment => segment.type === 'correction').map(segment => [segment.wrong, segment.correct])), [
  ['一致性中寻求多样性', '多样性中寻求一致性'], ['以人民为中心', '党的领导']
], 'The reviewed example marks complete phrases exactly')
check(sampleReference.inferredVerdicts, 'The verified positive count accounts for the two correct original statements')

const screenshotReference = formatter.format(bank.questions.find(item => item.id === 'xh-special-005'))
eq(screenshotReference.items.length, 5, 'The reported screenshot includes both correct and all incorrect statements')
eq(screenshotReference.items.map(item => item.verdict), ['correct', 'incorrect', 'correct', 'incorrect', 'incorrect'])
eq(screenshotReference.items.flatMap(item => item.segments.filter(segment => segment.type === 'correction').map(segment => [segment.wrong, segment.correct])), [
  ['矛盾的普遍性和客观性', '客观规律性和主观能动性的有机结合'],
  ['辩证唯物主义普遍联系的原理', '矛盾的普遍性和客观性'],
  ['客观规律性和主观能动性的有机结合', '辩证唯物主义普遍联系的原理']
], 'Explicit source contrasts produce exact noun-phrase corrections without changing 体现了')
for (const item of screenshotReference.items.filter(item => item.verdict === 'incorrect')) {
  check(item.segments.some(segment => segment.type === 'text' && segment.text.endsWith('体现了')))
  check(item.needsExplanation, 'The full factual explanation remains available with any inline edit')
  check(item.reason.includes('而非'), 'The canonical source reason remains intact for the renderer to shorten separately')
  check(item.segments.filter(segment => segment.type === 'correction').every(segment => !/而非|而不是/.test(segment.correct)))
}
const longWrong = '第一项原始表达中的完整概念名称和附带限定条件都应当完整保留'
const longCorrect = '第二项来源已经明确写明的另一概念名称以及它的全部限定条件'
eq(formatter.findDirectCorrection('本例体现了' + longWrong, '本例体现的是' + longCorrect + '，而非' + longWrong).filter(segment => segment.type === 'correction'),
  [{ type: 'correction', wrong: longWrong, correct: longCorrect }], 'Direct explicit evidence has no arbitrary 24-character or ratio ceiling')
eq(formatter.findDirectCorrection('本例采用原始方法', '本例不是原始方法，而是修正方法。').filter(segment => segment.type === 'correction'),
  [{ type: 'correction', wrong: '原始方法', correct: '修正方法' }], 'The reversed 不是…而是… contrast is source grounded')
eq(formatter.findDirectCorrection('本例采用原始方法', '“原始方法”应改为“修正方法”。').filter(segment => segment.type === 'correction'),
  [{ type: 'correction', wrong: '原始方法', correct: '修正方法' }])
eq(formatter.findDirectCorrection('原始方法出现两次，原始方法的第二次指另一对象', '应采用修正方法，而非原始方法。'), null, 'Ambiguous repeated terms do not select an arbitrary original occurrence')

const noInline = formatter.format(question())
eq(noInline.items.length, 4, 'A numbered question is retained even without a safe inline correction')
eq(noInline.coverage, { corrected: 0, incorrect: 2, unknown: 0 })
check(noInline.items[2].reason.includes('请以原始资料说明为准'), 'Unsupported inline corrections retain the source reason')
eq(noInline.items[2].segments, [{ type: 'text', text: '第三条保留完整的原文内容' }])

const negative = formatter.format(question({ stem: question().stem.replace('正确的有几项', '不正确的有几项') }))
eq(negative.items.map(item => item.verdict), ['unknown', 'unknown', 'incorrect', 'incorrect'], 'Negative counts never infer factual truth from the chosen option')
check(!negative.inferredVerdicts)
const combos = formatter.format(question({ options: ['①②', '①③', '②③', '③④'] }))
eq(combos.items.slice(0, 2).map(item => item.verdict), ['unknown', 'unknown'], 'Combination options are not presumed to encode factual truth')
const inconsistent = formatter.format(question({ answer: 0 }))
check(!inconsistent.inferredVerdicts, 'Contradictory answer counts cannot complete missing verdicts')
eq(inconsistent.items[0].verdict, 'unknown')
const conflicting = formatter.format(question({ explanation: '①正确：原始说明。①错误：另一个说明。' }))
eq(conflicting.items.map(item => item.verdict), ['unknown', 'unknown', 'unknown', 'unknown'], 'Conflicting source verdicts fall back to neutral complete originals')
check(!conflicting.hasCorrections)

const contextual = formatter.format(question({ explanation: '①②不符合题意：说法本身成立，但没有回答本题。③未体现：这是另一种方法。④错误，未体现，侧重点与本题不符。' }))
eq(contextual.items.map(item => item.verdict), ['unknown', 'unknown', 'unknown', 'unknown'], 'Relevance to the prompt is not a factual error')
check(!contextual.inferredVerdicts)
check(contextual.items[0].reason.includes('说法本身成立'), 'Grouped contextual verdicts retain their source context')
const quoted = formatter.format(question({ explanation: '材料中写道“示例 ①错误：这是一段引文”，不能据此判断。' }))
eq(quoted.items.map(item => item.verdict), ['unknown', 'unknown', 'unknown', 'unknown'], 'Quoted statement numbers are not treated as verdict labels')
const quotedAscii = formatter.format(question({ explanation: '原文为 "示例 ①错误"，仅供说明。' }))
eq(quotedAscii.items[0].verdict, 'unknown')
const grouped = formatter.format(question({ explanation: '①、②说法均正确：原文均成立。③④错误：请参照原始资料。' }))
eq(grouped.items.map(item => item.verdict), ['correct', 'correct', 'incorrect', 'incorrect'], 'Explicit grouped factual verdicts are supported')

eq(formatter.format({ stem: '普通单选题，不包含编号陈述。' }), null)
eq(formatter.format({ stem: '①第一条正确内容③编号并不连续的内容' }), null, 'Unclear source boundaries do not create truncated statement rows')
eq(formatter.findCorrection('这一句的所有内容都是需要保留的原始陈述', '另一个完全不同的知识点，不能用来替换本题内容。'), null)
eq(formatter.findCorrection('这一项认为科技强军是人民军队立军之本', '正确的应为政治建军，而不是科技强军。').filter(segment => segment.type === 'correction'),
  [{ type: 'correction', wrong: '科技强军', correct: '政治建军' }], 'An explicit source contrast identifies the two terms without rewriting shared prose')
eq(formatter.findCorrection('这一项认为科技强军是人民军队立军之本', '这一项并不是原文的完整表述，需要回到资料逐项核实。'), null, 'A negation without a source correction is not a drop-in replacement')
const englishSegments = formatter.findCorrection('在本例之中需要保持英文术语 Alpha Beta 并且完整呈现所有内容', '在本例之中需要保持英文术语 Gamma Delta 并且完整呈现所有内容')
check(englishSegments && englishSegments.some(segment => segment.correct === 'Gamma Delta'), 'Meaningful English word spacing survives mapped replacements')

const compoundExamples = [
  ['cg-066', '限权', '治权'], ['cg-090', '科技强军', '政治建军'],
  ['xh-500-123', '基本', '根本'], ['xh-500-147', '严格执法', '公正司法'],
  ['xh-special-026', '人工修复', '自然恢复'], ['xh-mock-059', '民办学位', '公办学位'],
  ['cg-178', '以人为单位', '以户为单位'], ['xh-500-318', '以攻促用', '以用促攻']
]
for (const [id, wrong, correct] of compoundExamples) {
  const result = formatter.format(bank.questions.find(item => item.id === id))
  check(result.items.some(item => item.segments.some(segment => segment.wrong === wrong && segment.correct === correct)), `${id} highlights readable complete phrases`)
}
const sourceContrastCases = [
  ['cg-035', '①', '底线思维', '辩证思维'],
  ['xh-500-115', '③', '全球治理倡议', '全球安全倡议'],
  ['xh-500-151', '②', '领导力量', '决定力量'],
  ['xh-newlaw-003', '②', '习近平法治思想', '习近平生态文明思想'],
  ['xh-newlaw-006', '②', '市级分局', '县级分局'],
  ['xh-newlaw-023', '④', '审判机关', '检察机关'],
  ['xh-special-028', '④', '坚持以经济建设为主线', '坚持以制度建设为主线']
]
for (const [id, label, wrong, correct] of sourceContrastCases) {
  const item = formatter.format(bank.questions.find(question => question.id === id)).items.find(item => item.label === label)
  eq(item.segments.filter(segment => segment.type === 'correction'), [{ type: 'correction', wrong, correct }], `${id}: exact reviewed contrast preserves unrelated prose`)
}
for (const [id, label] of [['cg-052', '④'], ['cg-109', '④'], ['xh-newlaw-048', '①'], ['xh-special-126', '①']]) {
  const item = formatter.format(bank.questions.find(question => question.id === id)).items.find(item => item.label === label)
  check(!item.segments.some(segment => segment.type === 'correction'), `${id}: a shared clause prefix/suffix alone is insufficient evidence`)
}
const groupedBank = formatter.format(bank.questions.find(item => item.id === 'xh-500-218'))
eq(groupedBank.items.slice(0, 2).flatMap(item => item.segments.filter(segment => segment.type === 'correction').map(segment => [segment.wrong, segment.correct])), [
  ['结构性问题', '总量性问题'], ['总量性问题', '结构性问题']
], 'Reviewed grouped explanations may correct separate statements without serial replacement')
const simultaneousSwap = formatter.format(bank.questions.find(item => item.id === 'xh-500-453')).items[1]
eq(simultaneousSwap.segments.filter(segment => segment.type === 'correction').map(segment => [segment.wrong, segment.correct]), [
  ['55%', '60％'], ['60%', '55％']
], 'Two numeric swaps use the two original positions, avoiding replacement of inserted values')
const ocrMixed = formatter.format(bank.questions.find(item => item.id === 'xh-500-375')).items[2]
eq(ocrMixed.segments.filter(segment => segment.type === 'correction'), [{ type: 'correction', wrong: '88%', correct: '95％' }], 'A reviewed numeric correction excludes the adjacent OCR mistake')
check(ocrMixed.reason.includes('人园率'), 'The unverified original explanation is retained faithfully')
check(ocrMixed.needsExplanation, 'An inline correction retains access to the rest of the explanation')
const changedSource = { ...bank.questions.find(item => item.id === 'xh-500-375'), explanation: '③错误：数值请参照原件。④错误：此处为95％。' }
check(!formatter.format(changedSource).items[2].segments.some(segment => segment.type === 'correction'), 'A reviewed replacement must remain in the specific statement source chunk, not another statement')
for (const [id, label] of [['cg-116', '②'], ['xh-special-150', '②'], ['xh-mock-047', '①'], ['xh-500-275', '②'], ['xh-mock-087', '②']]) {
  const item = formatter.format(bank.questions.find(question => question.id === id)).items.find(item => item.label === label)
  check(!item.segments.some(segment => segment.type === 'correction'), `${id}: added/removed prose does not get marked as a factual error`)
  check(item.reason, `${id}: the source reason remains available for manual reading`)
}

const summary = { totalQuestions: bank.questions.length, numberedQuestions: 0, statements: 0, questionsWithCorrections: 0, correctedStatements: 0, incorrectStatements: 0, unknownStatements: 0, inferredQuestions: 0 }
for (const original of bank.questions) {
  const result = formatter.format(original)
  const statements = formatter.extractStatements(original.stem)
  if (!statements.length) { eq(result, null); continue }
  check(result, `${original.id}: all well-delimited numbered questions have a reference answer`)
  summary.numberedQuestions++
  summary.statements += result.items.length
  summary.questionsWithCorrections += Number(result.hasCorrections)
  summary.correctedStatements += result.coverage.corrected
  summary.incorrectStatements += result.coverage.incorrect
  summary.unknownStatements += result.coverage.unknown
  summary.inferredQuestions += Number(result.inferredVerdicts)
  eq(result.items.map(item => item.label).join(''), labels.slice(0, statements.length), `${original.id}: complete label coverage`)
  eq(result.items.map(item => item.text), statements.map(item => item.text), `${original.id}: all original statements remain complete`)
  for (const item of result.items) {
    eq(item.segments.map(segment => segment.type === 'correction' ? segment.wrong : segment.text).join(''), item.text, `${original.id} ${item.label}: display segments reconstruct the complete original`)
    for (const segment of item.segments) {
      if (segment.type !== 'correction') continue
      eq(item.verdict, 'incorrect', `${original.id}: only explicitly incorrect statements get corrections`)
      check(compact(original.explanation).includes(compact(segment.correct)), `${original.id}: every correction exists in the original explanation`)
      check(compact(item.text).includes(compact(segment.wrong)), `${original.id}: the marked text exists in the original statement`)
    }
  }
}
eq(summary.numberedQuestions, 693)
eq(summary.statements, 3002)
eq(JSON.stringify(bank), canonicalBefore, 'Formatting never changes any question, answer, explanation, or canonical field')

const browserFallback = { window: {}, Intl: {} }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../explanation-format.js'), 'utf8'), browserFallback)
const fallbackResult = browserFallback.window.QuizExplanationFormatter.format(sample)
eq(fallbackResult.items.length, 4, 'Browsers without a word segmenter still receive all full original statements')
eq(fallbackResult.coverage.corrected, 2, 'The explicitly reviewed correction does not depend on Intl.Segmenter')

console.log(`Explanation formatter passed ${assertions} assertions.`)
console.log(JSON.stringify(summary, null, 2))
