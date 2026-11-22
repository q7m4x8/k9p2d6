const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { normalize } = require('../text-format.js')

let passed = 0
function test(name, run) {
  run()
  passed++
  console.log(`PASS ${name}`)
}

test('repairs Chinese PDF extraction gaps without rewriting characters', () => {
  assert.equal(normalize('坚持以人民为中 心，推动社 会 发 展'), '坚持以人民为中心，推动社会发展')
  assert.equal(normalize('中国\t特色\u00a0社会\u3000主义\u2009现代化'), '中国特色社会主义现代化')
  assert.equal(normalize('画 出最大同心圆'), '画出最大同心圆')
})

test('tidies Chinese punctuation and statement labels', () => {
  assert.equal(normalize('① 统一战线 ， 要坚持 “ 求同存异 ” 。 ② 大团结大联合'), '①统一战线，要坚持“求同存异”。②大团结大联合')
  assert.equal(normalize('依据 《 条例 》 的规定 （ 试行 ） 。'), '依据《条例》的规定（试行）。')
  assert.equal(normalize('① ②正确，③ 错误'), '① ②正确，③错误')
})

test('preserves English, mixed-language and numeric/unit spacing', () => {
  const english = 'Whole process democracy and New  York'
  const mixed = 'GDP 增长与 AI 技术；“ Whole process democracy ”'
  const units = '2026 年 8 月 17 日，5 000 人，20 km，3.5 kg，5 %，CO2 排放'
  assert.equal(normalize(english), english)
  assert.equal(normalize(mixed), 'GDP 增长与 AI 技术；“Whole process democracy”')
  assert.equal(normalize(units), units)
  assert.equal(normalize('New\u00a0York 20\u00a0km'), 'New\u00a0York 20\u00a0km')
  assert.equal(normalize('A 正确，B 错误，C 不符合题意'), 'A 正确，B 错误，C 不符合题意')
})

test('preserves paragraph breaks and is idempotent', () => {
  const paragraphs = '第一段 原文。\n\n第二段 内容。\n第三段。'
  const expected = '第一段原文。\n\n第二段内容。\n第三段。'
  assert.equal(normalize(paragraphs), expected)
  assert.equal(normalize('First paragraph.\nSecond paragraph.'), 'First paragraph.\nSecond paragraph.')
  assert.equal(normalize(normalize(paragraphs)), expected)
  assert.equal(normalize(null), '')
  assert.equal(normalize(undefined), '')
  assert.equal(normalize(0), '0')
})

test('exposes the same API in the browser without a module loader', () => {
  const source = fs.readFileSync(path.join(__dirname, '../text-format.js'), 'utf8')
  const context = vm.createContext({ window: {} })
  new vm.Script(source).runInContext(context)
  assert.equal(context.window.QuizText.normalize('中 国'), '中国')
})

test('all bank changes are display-only whitespace changes', () => {
  const bankPath = path.join(__dirname, '../data/questions.json')
  const before = fs.readFileSync(bankPath)
  const beforeHash = crypto.createHash('sha256').update(before).digest('hex')
  const bank = JSON.parse(before.toString('utf8'))
  const changed = { stems: 0, options: 0, explanations: 0 }
  const examples = []
  for (const question of bank.questions) {
    const fields = [
      ['stems', question.stem],
      ['explanations', question.explanation],
      ...question.options.map(option => ['options', option])
    ]
    for (const [kind, original] of fields) {
      const display = normalize(original)
      assert.equal(display.replace(/\s/gu, ''), original.replace(/\s/gu, ''), `${question.id} changed a non-whitespace character`)
      assert.equal(normalize(display), display, `${question.id} is not idempotent`)
      if (display !== original) {
        changed[kind]++
        if (examples.length < 5) examples.push({ id: question.id, field: kind, before: original.slice(0, 105), after: display.slice(0, 105) })
      }
    }
  }
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(bankPath)).digest('hex'), beforeHash)
  assert.equal(bank.questions.length, 1100)
  console.log(JSON.stringify({ questionCount: bank.questions.length, changedFields: changed, originalBankSHA256: beforeHash, examples }, null, 2))
})

console.log(`PASS: ${passed} whitespace formatting scenarios`)
