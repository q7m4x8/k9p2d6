import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bank = JSON.parse(fs.readFileSync(path.join(root, 'data/questions.json'), 'utf8'))
const errors = []
const review = []
const seen = new Set()
const stemsInPaper = new Map()
const circled = '①②③④⑤⑥⑦⑧⑨⑩'
const normalize = text => text.replace(/\s+/g, '')
const quantity = text => /^[1-9]项$/.test(normalize(text))
// These exact source pairs intentionally reuse a stem with different options.
// Never exempt an entire album, or the same pair with duplicated options.
const verifiedDuplicatePairs = new Set([
  'xh-500-386\0xh-500-387', // 强化刷题 PDF p116 (printed p110).
  'xh-newlaw-098\0xh-newlaw-100', // 新法100题 PDF pp43–44 (printed pp37–38).
  'xh-special-197\0xh-special-198' // 专项十套卷 PDF p77 (printed p69).
])
// Special PDF p66 (printed p58), Q164 explicitly asks for chronological order.
// Accept only the four sequences actually printed, not arbitrary bad sequences.
const verifiedOrderOptions = new Map([
  ['xh-special-164', ['②①④③', '②①③④', '④①③②', '④②①③']]
])

for (const q of bank.questions) {
  if (seen.has(q.id)) errors.push({ id: q.id, type: 'duplicate-id' })
  seen.add(q.id)
  if (!q.stem?.trim() || !q.explanation?.trim()) errors.push({ id: q.id, type: 'missing-content' })
  if (![2, 4].includes(q.options.length) || q.options.some(o => !o.trim())) errors.push({ id: q.id, type: 'invalid-options' })
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length || q.answerLetter !== 'ABCD'[q.answer]) errors.push({ id: q.id, type: 'invalid-answer' })
  const quantities = q.options.filter(quantity).length
  const orderQuestion = /顺序|排序|先后|排列/.test(q.stem)
  // Plain numeric answers are legitimate. Only a group containing actual circled
  // statement references should be checked as a circled option group.
  const circleOptions = q.options.filter(o => /^[①②③④⑤⑥⑦⑧⑨⑩]+$/.test(normalize(o))).length
  const stemKey = `${q.album}\0${q.paper}\0${normalize(q.stem)}`
  if (normalize(q.stem).length >= 25 && stemsInPaper.has(stemKey)) {
    const otherId = stemsInPaper.get(stemKey)
    const pair = [otherId, q.id].sort().join('\0')
    const other = bank.questions.find(item => item.id === otherId)
    const sameOptions = JSON.stringify(q.options.map(normalize)) === JSON.stringify(other.options.map(normalize))
    if (!verifiedDuplicatePairs.has(pair) || sameOptions) errors.push({ id: q.id, otherId, type: 'duplicate-stem-in-paper' })
  } else {
    stemsInPaper.set(stemKey, q.id)
  }
  if (q.id.startsWith('xh-500-')) {
    const markers = [...q.stem].filter(c => circled.includes(c))
    if (markers.some((c, index) => c !== circled[index])) errors.push({ id: q.id, type: 'invalid-statement-sequence' })
  }
  q.options.forEach((option, index) => {
    const text = normalize(option)
    if (/根据题目要求|答对题数|用时[（(〈<]|参考答案|黑十专项卷|小黑金卷|【小黑政治理论】/.test(text)) errors.push({ id: q.id, option: index, type: 'foreign-content-in-option' })
    if (/(?<![A-Za-z])A[.．、].*B[.．、].*C[.．、].*D[.．、]/.test(text)) errors.push({ id: q.id, option: index, type: 'another-option-group' })
    if (quantities >= 3 && !quantity(option)) errors.push({ id: q.id, option: index, type: 'contaminated-quantity-option' })
    if (circleOptions >= 2) {
      const nums = [...text].map(c => circled.indexOf(c))
      const sourceOrder = verifiedOrderOptions.get(q.id)?.[index] === text
      if (nums.some(n => n < 0) || new Set(nums).size !== nums.length || (!orderQuestion && !sourceOrder && nums.some((n, i) => i > 0 && n <= nums[i - 1]))) errors.push({ id: q.id, option: index, type: 'invalid-circled-sequence' })
    }
  })
  if (new Set(q.options.map(normalize)).size !== q.options.length) errors.push({ id: q.id, type: 'duplicate-option-text' })
  // 100%, 2008 and other ordinary source numbers are not OCR circle artifacts.
  if (/(?:0|囹|@|\(D|（D|[0O]{2,})(?:说法)?(?:错误|正确|符合|属于)|(?<!\d)[0O]{2,}(?!\d)/.test(q.explanation)) review.push({ id: q.id, type: 'suspected-explanation-ocr' })
}

// Regressions reconstructed from the scanned source pages. Structural counts
// alone cannot catch a complete option set accidentally borrowed from a neighbor.
const byId = new Map(bank.questions.map(q => [q.id, q]))
const expectText = (id, field, required) => {
  const q = byId.get(id)
  const text = q && (Array.isArray(q[field]) ? q[field].join('\n') : q[field])
  if (!text || required.some(fragment => !normalize(text).includes(normalize(fragment)))) errors.push({ id, field, type: 'source-regression' })
}
const expectOptions = (id, options) => {
  const actual = byId.get(id)?.options.map(normalize)
  if (JSON.stringify(actual) !== JSON.stringify(options.map(normalize))) errors.push({ id, field: 'options', type: 'source-regression' })
}
const expectMarkers = (id, markers) => {
  const actual = [...(byId.get(id)?.stem || '')].filter(c => circled.includes(c)).join('')
  if (actual !== markers) errors.push({ id, field: 'stem', type: 'source-regression' })
}
// User-reported question-boundary regressions: special PDF p11, pp11–12,
// and p15. Q009 is structural here; its OCR explanation is audited separately.
expectText('xh-special-006', 'stem', ['⑤党的领导直接关系中国式现代化的根本方向、前途命运、最终成败'])
expectText('xh-special-007', 'stem', ['①人均国内生产总值迈上新的大台阶，达到中等发达国家水平', '②实现高水平科技自立自强，进入创新型国家前列'])
expectText('xh-special-009', 'stem', ['坚持以人民为中心', '③为民造福是党的最大政绩，发展是增进民生福祉的根本目的'])
expectText('xh-special-020', 'stem', ['③党内民主集中制是实现我国全过程人民民主的重要制度载体', '④基层民主是全过程人民民主的重要体现'])
for (const id of ['xh-special-006', 'xh-special-007', 'xh-special-009']) expectMarkers(id, '①②③④⑤')
expectMarkers('xh-special-020', '①②③④')
expectOptions('xh-special-006', ['2项', '3项', '4项', '5项'])
expectOptions('xh-special-007', ['2项', '3项', '4项', '5项'])
expectOptions('xh-special-009', ['5项', '4项', '3项', '2项'])
expectOptions('xh-special-020', ['1项', '2项', '3项', '4项'])
expectOptions('xh-special-164', verifiedOrderOptions.get('xh-special-164'))
expectText('xh-500-041', 'stem', ['①文化强国之“强”最终要体现在为人民提供文化服务和文化产品的能力上'])
expectText('xh-500-075', 'stem', ['④推进线上办事“一网通办”'])
expectText('xh-500-081', 'options', ['建设法治政府对建设法治社会具有重要引领和带动作用', '法治国家是依法治国的主体，是法治社会建设的先导和示范'])
expectText('xh-500-092', 'stem', ['②“结合”是深刻的“化学反应”', '实现了马克思主义中国化时代化新的飞跃'])
expectText('xh-500-132', 'stem', ['①以坚持党的领导为核心', '④坚持系统治理、依法治理、综合治理、源头治理'])
expectText('xh-500-168', 'stem', ['①事物发展的总趋势是前进性与曲折性的统一', '④实践是认识的基础，认识在实践中不断发展'])
expectText('xh-500-173', 'stem', ['到未来时，只见“诗和远方”而不见“眼前的苟且”'])
if (bank.questions.length !== 1100) errors.push({ type: 'unexpected-question-count', count: bank.questions.length })
for (const album of bank.albums) {
  const questions = bank.questions.filter(q => q.album === album.title)
  if (questions.length !== album.count) errors.push({ type: 'album-count', album: album.title })
  for (const paper of album.papers) {
    if (questions.filter(q => q.paper === paper.name).length !== paper.count) errors.push({ type: 'paper-count', album: album.title, paper: paper.name })
  }
}
console.log(JSON.stringify({ questionCount: bank.questions.length, errors, manualReview: review, note: 'Structural checks do not certify every OCR character; source comparison is required.' }, null, 2))
if (errors.length) process.exitCode = 1
