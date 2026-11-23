const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')

const prefix = 'xiaotian_quiz_ink_v1:'
const source = fs.readFileSync(path.resolve(__dirname, '..', 'annotation.js'), 'utf8')
// Loading the data API must not require a browser, initialize a canvas, or bind UI.
const context = { window: {}, console, setTimeout, clearTimeout }
vm.createContext(context)
vm.runInContext(source, context, { filename: 'annotation.js' })
const annotations = context.window.QuizAnnotations || context.QuizAnnotations
assert.equal(typeof annotations?.createStore, 'function', 'Expose QuizAnnotations.createStore')

function storageFixture(entries = []) {
  const values = new Map(entries)
  const fixture = {
    values, failRead: false, failWrite: false, writes: [],
    getItem(key) {
      if (fixture.failRead) throw new Error('Storage access denied')
      return values.get(key) ?? null
    },
    setItem(key, value) {
      if (fixture.failWrite) throw new Error('QuotaExceededError')
      fixture.writes.push(key)
      values.set(key, String(value))
    },
    removeItem(key) {
      if (fixture.failWrite) throw new Error('Storage access denied')
      fixture.writes.push(key)
      values.delete(key)
    }
  }
  return fixture
}

const plain = value => JSON.parse(JSON.stringify(value))
const stroke = (x = 0.1, y = 0.2) => ({ color: '#e03c45', width: 3, points: [[x, y], [Math.min(1, x + 0.1), Math.min(1, y + 0.1)]] })
const red = '#e03c45'
const allowedColors = new Set([red, '#2878e8', '#202b39'])
function checkSafe(snapshot) {
  assert(Array.isArray(snapshot.strokes), 'Snapshot contains a stroke array')
  assert(snapshot.strokes.length <= 300, 'Bound the number of stored strokes')
  let totalPoints = 0
  for (const item of snapshot.strokes) {
    assert.match(item.color, /^#[0-9a-f]{6}$/i)
    assert(allowedColors.has(item.color), 'Only palette colors enter stored strokes')
    assert(item.width >= 1 && item.width <= 12 && Number.isFinite(item.width), 'Width stays within 1–12')
    assert(Array.isArray(item.points) && item.points.length > 0 && item.points.length <= 2000, 'Bound and validate stroke points')
    totalPoints += item.points.length
    for (const point of item.points) {
      assert(Array.isArray(point) && point.length === 2)
      for (const coordinate of point) assert(Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1, 'Coordinates are finite and normalized')
    }
  }
  assert(totalPoints <= 20000, 'Bound the total points per question')
}

// Use the module's own persistence envelope when seeding dirty data, so the
// tests check validation without prescribing a serialized format.
function storedPayload(strokes) {
  const storage = storageFixture()
  const store = annotations.createStore(storage)
  store.add('template', stroke())
  const payload = JSON.parse(storage.values.get(prefix + 'template'))
  if (Array.isArray(payload)) return JSON.stringify(strokes)
  assert(payload && typeof payload === 'object' && Array.isArray(payload.strokes), 'Persistence contains strokes')
  return JSON.stringify({ ...payload, strokes })
}

let passed = 0
function test(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { console.error(`FAIL ${name}`); throw error }
}

test('loading an empty store and reading unseen questions leaves unrelated storage untouched', () => {
  const storage = storageFixture([['xiaotian_quiz_notes_v1', '{"q-a":"我的笔记"}'], ['xiaotian_quiz_state_v1', '{"history":["keep"]}']])
  const before = [...storage.values]
  const store = annotations.createStore(storage)
  const empty = store.get('q-a')
  assert.deepEqual(plain(empty.strokes), [])
  assert.equal(empty.canUndo, false)
  assert.equal(empty.canRedo, false)
  assert.deepEqual([...storage.values], before)
})

test('valid normalized geometry persists and reloads independently for each question', () => {
  const storage = storageFixture([['xiaotian_quiz_notes_v1', 'notes'], ['xiaotian_quiz_draft_v1', 'draft'], ['xiaotian_quiz_state_v1', 'history']])
  const first = annotations.createStore(storage)
  const second = annotations.createStore(storage)
  const a = stroke(0, 0)
  a.points.push([1, 1])
  assert.equal(first.add('q-a', a).saved, true)
  assert.equal(second.add('q-b', stroke(0.5, 0.6)).saved, true)
  assert(storage.values.has(prefix + 'q-a'))
  assert(storage.values.has(prefix + 'q-b'))
  assert(storage.writes.every(key => key.startsWith(prefix)))
  const reloaded = annotations.createStore(storage)
  assert.deepEqual(plain(reloaded.get('q-a').strokes), [a])
  assert.deepEqual(plain(reloaded.get('q-b').strokes), [stroke(0.5, 0.6)])
  assert.equal(storage.values.get('xiaotian_quiz_notes_v1'), 'notes')
  assert.equal(storage.values.get('xiaotian_quiz_draft_v1'), 'draft')
  assert.equal(storage.values.get('xiaotian_quiz_state_v1'), 'history')
})

test('every palette color, boundary width, and a single-point dot is accepted', () => {
  const store = annotations.createStore(storageFixture())
  for (const color of allowedColors) {
    store.add('palette', { color, width: 1, points: [[0, 0]] })
    store.add('palette', { color, width: 12, points: [[1, 1]] })
  }
  assert.equal(store.get('palette').strokes.length, 6)
  checkSafe(store.get('palette'))
})

test('undo and redo are independent per question and a new stroke clears only its own redo stack', () => {
  const store = annotations.createStore(storageFixture())
  store.add('q-a', stroke(0.1))
  store.add('q-a', stroke(0.2))
  store.add('q-b', stroke(0.7))
  assert.equal(store.undo('q-a').strokes.length, 1)
  assert.equal(store.get('q-a').canRedo, true)
  assert.equal(store.get('q-b').strokes.length, 1)
  assert.equal(store.undo('q-b').strokes.length, 0)
  assert.equal(store.redo('q-a').strokes.length, 2)
  assert.equal(store.get('q-b').strokes.length, 0)
  store.undo('q-a')
  store.add('q-a', stroke(0.4))
  assert.equal(store.get('q-a').canRedo, false)
  assert.equal(store.get('q-b').canRedo, true)
  assert.deepEqual(plain(store.get('q-a').strokes), [stroke(0.1), stroke(0.4)])
})

test('eraser and clear persist, undo restores them, and another question is preserved', () => {
  const storage = storageFixture()
  const store = annotations.createStore(storage)
  store.add('q-a', stroke(0.1))
  store.add('q-a', stroke(0.3))
  store.add('q-b', stroke(0.7))
  assert.deepEqual(plain(store.erase('q-a', 0).strokes), [stroke(0.3)])
  assert.deepEqual(plain(annotations.createStore(storage).get('q-a').strokes), [stroke(0.3)])
  assert.equal(store.undo('q-a').strokes.length, 2)
  assert.equal(store.redo('q-a').strokes.length, 1)
  assert.equal(store.clear('q-a').strokes.length, 0)
  assert.equal(annotations.createStore(storage).get('q-a').strokes.length, 0)
  assert.deepEqual(plain(store.undo('q-a').strokes), [stroke(0.3)])
  assert.deepEqual(plain(store.get('q-b').strokes), [stroke(0.7)])
  for (const index of [-1, 999, NaN, '0']) {
    assert.doesNotThrow(() => store.erase('q-a', index))
    checkSafe(store.get('q-a'))
  }
  assert.deepEqual(plain(annotations.createStore(storage).get('q-b').strokes), [stroke(0.7)])
})

test('a bounded undo history retains the latest state and redo reaches it again', () => {
  const store = annotations.createStore(storageFixture())
  for (let i = 0; i < 35; i++) store.add('q-a', stroke(i / 100))
  let undone = 0
  while (store.get('q-a').canUndo && undone < 100) { store.undo('q-a'); undone++ }
  assert(undone > 0 && undone <= 30, 'Keep at most thirty undo steps')
  assert.equal(store.get('q-a').strokes.length, 35 - undone)
  assert.equal(store.get('q-a').canUndo, false)
  for (let i = 0; i < undone; i++) store.redo('q-a')
  assert.equal(store.get('q-a').strokes.length, 35)
  assert.equal(store.get('q-a').canRedo, false)
})

test('input objects and returned snapshots cannot mutate saved strokes or history', () => {
  const store = annotations.createStore(storageFixture())
  const input = stroke()
  const added = store.add('q-a', input)
  input.points[0][0] = 0.9
  input.color = '#000000'
  assert.deepEqual(plain(store.get('q-a').strokes), [stroke()])
  added.strokes[0].points[0][0] = 0.8
  added.strokes.push(stroke())
  assert.deepEqual(plain(store.get('q-a').strokes), [stroke()])
  store.add('q-a', stroke(0.4))
  const undone = store.undo('q-a')
  undone.strokes.length = 0
  assert.deepEqual(plain(store.get('q-a').strokes), [stroke()])
  assert.equal(store.redo('q-a').strokes.length, 2)
})

test('invalid colors, widths, points and non-object inputs never produce unsafe geometry', () => {
  const store = annotations.createStore(storageFixture())
  const invalid = [null, undefined, 42, 'stroke', [], {},
    { ...stroke(), color: 'url(javascript:alert(1))' },
    { ...stroke(), color: '#123456' },
    { ...stroke(), color: '#fff' },
    { ...stroke(), color: 'red' },
    { ...stroke(), width: -1 }, { ...stroke(), width: 0 },
    { ...stroke(), width: 13 }, { ...stroke(), width: Infinity },
    { ...stroke(), width: '3' }, { ...stroke(), points: null },
    { ...stroke(), points: [] }, { ...stroke(), points: [[NaN, 0]] },
    { ...stroke(), points: [[Infinity, 0]] }, { ...stroke(), points: [[0, -1]] },
    { ...stroke(), points: [[1.2, 0]] }, { ...stroke(), points: [['0.1', 0.2]] },
    { ...stroke(), points: [[0.1], null, {}, [0.1, 0.2, 0.3]] }]
  for (const item of invalid) {
    assert.doesNotThrow(() => store.add('dirty', item))
    const snapshot = store.get('dirty')
    checkSafe(snapshot)
    for (const saved of snapshot.strokes) assert(allowedColors.has(saved.color), 'Never accept arbitrary CSS colors')
  }
  assert.equal(store.add('valid', stroke()).strokes.length, 1, 'Bad input does not disable subsequent valid drawing')
})

test('rejected strokes leave existing drawing, persistence and undo history intact', () => {
  const storage = storageFixture()
  const store = annotations.createStore(storage)
  store.add('q-a', stroke())
  const before = plain(store.get('q-a').strokes)
  const persisted = storage.values.get(prefix + 'q-a')
  for (const invalid of [null, {}, { ...stroke(), color: 'url(x)' }, { ...stroke(), width: -1 }, { ...stroke(), points: [[NaN, 0]] }]) {
    store.add('q-a', invalid)
    assert.deepEqual(plain(store.get('q-a').strokes), before)
    assert.equal(storage.values.get(prefix + 'q-a'), persisted)
  }
  assert.equal(store.undo('q-a').strokes.length, 0, 'Rejected inputs do not consume undo steps')
})

test('stroke and point limits apply to input and persisted data', () => {
  const storage = storageFixture()
  const store = annotations.createStore(storage)
  const dense = { ...stroke(), points: Array.from({ length: 2050 }, (_, i) => [i / 2050, 0.4]) }
  store.add('dense', dense)
  checkSafe(store.get('dense'))
  for (let i = 0; i < 305; i++) store.add('many', stroke(i / 1000))
  assert.equal(store.get('many').strokes.length, 300)
  const dirty = storageFixture([[prefix + 'persisted-many', storedPayload(Array.from({ length: 320 }, () => stroke()))], [prefix + 'persisted-dense', storedPayload([dense])]])
  const reloaded = annotations.createStore(dirty)
  checkSafe(reloaded.get('persisted-many'))
  checkSafe(reloaded.get('persisted-dense'))
  const longStroke = { ...stroke(), points: Array.from({ length: 2000 }, (_, i) => [i / 2000, 0.4]) }
  for (let i = 0; i < 12; i++) {
    store.add('total-points', longStroke)
    checkSafe(store.get('total-points'))
  }
  assert(store.get('total-points').strokes.length > 0)
  storage.values.set(prefix + 'persisted-total', storedPayload(Array.from({ length: 12 }, () => longStroke)))
  checkSafe(annotations.createStore(storage).get('persisted-total'))
})

test('malformed and hostile JSON is safely isolated to its own question', () => {
  const storage = storageFixture()
  const badPayloads = ['{broken', 'null', '17', '"text"', '{}', '{"strokes":null}', '{"strokes":{}}']
  for (let i = 0; i < badPayloads.length; i++) storage.values.set(prefix + `bad-${i}`, badPayloads[i])
  storage.values.set(prefix + 'bad-geometry', storedPayload([stroke(), { ...stroke(), color: 'url(x)' }, { ...stroke(), points: [[null, 1]] }]))
  storage.values.set(prefix + '__proto__', storedPayload([stroke(0.6)]))
  storage.values.set(prefix + 'constructor', '{"__proto__":{"polluted":true},"strokes":[]}')
  const store = annotations.createStore(storage)
  for (let i = 0; i < badPayloads.length; i++) {
    assert.doesNotThrow(() => store.get(`bad-${i}`))
    checkSafe(store.get(`bad-${i}`))
    assert.equal(store.get(`bad-${i}`).strokes.length, 0)
  }
  checkSafe(store.get('bad-geometry'))
  assert.deepEqual(plain(store.get('__proto__').strokes), [])
  assert.doesNotThrow(() => store.get('constructor'))
  assert.equal({}.polluted, undefined)
  store.add('healthy', stroke(0.8))
  assert.deepEqual(plain(store.get('healthy').strokes), [stroke(0.8)])
})

test('save failures retain in-memory drawing and a successful retry survives reconstruction', () => {
  const storage = storageFixture()
  const store = annotations.createStore(storage)
  store.add('q-a', stroke(0.1))
  const persisted = storage.values.get(prefix + 'q-a')
  storage.failWrite = true
  const failed = store.add('q-a', stroke(0.4))
  assert.equal(failed.saved, false)
  assert(failed.error, 'Expose a retryable save error')
  assert.equal(store.get('q-a').strokes.length, 2)
  assert.equal(storage.values.get(prefix + 'q-a'), persisted)
  assert.equal(annotations.createStore(storage).get('q-a').strokes.length, 1)
  const failedAgain = store.save('q-a')
  assert.equal(failedAgain.saved, false)
  assert.equal(failedAgain.strokes.length, 2)
  storage.failWrite = false
  const retried = store.save('q-a')
  assert.equal(retried.saved, true)
  assert(!retried.error)
  assert.deepEqual(plain(annotations.createStore(storage).get('q-a').strokes), [stroke(0.1), stroke(0.4)])
})

test('storage read errors do not prevent the data API from operating in memory', () => {
  const storage = storageFixture()
  storage.failRead = true
  const store = annotations.createStore(storage)
  assert.doesNotThrow(() => store.get('q-a'))
  checkSafe(store.get('q-a'))
  assert.equal(store.add('q-a', stroke()).strokes.length, 1)
})

console.log(`${passed} annotation tests passed`)
