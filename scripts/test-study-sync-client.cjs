const assert = require('node:assert/strict')
const test = require('node:test')
const { createSecret, isSecret, connect } = require('../study-sync-client.js')

const ENDPOINT = 'https://example.com/api/study-sync'

test('secret generation and endpoint validation enforce canonical, secure values', async () => {
  const secret = createSecret()
  assert.equal(secret.length, 43)
  assert(isSecret(secret))
  assert.notEqual(createSecret(), secret)
  const malformed = `${secret.slice(0, -1)}B`
  assert(!isSecret(malformed))
  assert(!isSecret(`${secret}=`))
  assert(!isSecret(`${secret}\n`))
  await assert.rejects(connect(malformed, ENDPOINT), { code: 'invalid-secret' })
  await assert.rejects(connect(secret, 'http://example.com/api/study-sync'), { code: 'invalid-endpoint' })
  await assert.rejects(connect(secret, `${ENDPOINT}#sync=${secret}`), { code: 'invalid-endpoint' })
  await assert.rejects(connect(secret, `${ENDPOINT}?secret=${secret}`), { code: 'invalid-endpoint' })
  assert.equal(typeof (await connect(secret, 'http://127.0.0.1:8999/api/study-sync')).read, 'function')
})

test('encrypted records synchronize across devices and preserve the latest revision', async t => {
  const requests = []
  const rows = new Map()
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    requests.push({ url, ...request })
    const token = request.headers.Authorization.slice('Bearer '.length)
    const row = rows.get(token)
    if (request.method === 'GET') return row ? Response.json(row) : new Response(null, { status: 404 })
    const record = JSON.parse(request.body)
    if (record.revision !== (row?.revision ?? 0)) return new Response(null, { status: 409 })
    const updated = { revision: record.revision + 1, envelope: record.envelope }
    rows.set(token, updated)
    return Response.json(updated)
  })

  const secret = createSecret()
  const desktop = await connect(secret, ENDPOINT)
  const phone = await connect(secret, ENDPOINT)
  const other = await connect(createSecret(), ENDPOINT)
  const sample = { name: '专属练习', notes: { q1: '需要留意的错题' } }

  assert.equal(await desktop.read(), null)
  assert.deepEqual(await desktop.write(0, sample), { revision: 1, value: sample })
  assert.deepEqual(await phone.read(), { revision: 1, value: sample })
  assert.equal(await other.read(), null)
  const revised = { ...sample, favorites: ['q1'] }
  assert.deepEqual(await phone.write(1, revised), { revision: 2, value: revised })
  assert.equal(await desktop.write(1, sample), null)
  assert.deepEqual(await desktop.read(), { revision: 2, value: revised })

  const bodies = requests.filter(request => request.method === 'PUT').map(request => JSON.parse(request.body))
  assert.equal(bodies.length, 3)
  assert.notEqual(bodies[0].envelope.iv, bodies[1].envelope.iv)
  for (const request of requests) {
    assert.equal(request.url, ENDPOINT)
    assert.equal(request.cache, 'no-store')
    assert.equal(request.credentials, 'omit')
    assert.equal(request.redirect, 'error')
    const token = request.headers.Authorization.slice('Bearer '.length)
    assert(isSecret(token))
    assert.notEqual(token, secret)
    assert(!request.body?.includes(secret))
    assert(!request.body?.includes(sample.notes.q1))
  }
})

test('tampering, missing response fields and oversized uploads surface typed errors', async t => {
  let row
  let nextResponse
  let requestCount = 0
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    requestCount++
    if (request.method === 'PUT') {
      const { revision, envelope } = JSON.parse(request.body)
      row = { revision: revision + 1, envelope }
      return Response.json(row)
    }
    return nextResponse ?? Response.json(row)
  })
  const device = await connect(createSecret(), ENDPOINT)
  const sample = { notes: { q1: '有效数据' } }
  assert.deepEqual(await device.write(0, sample), { revision: 1, value: sample })

  const validRow = row
  row = { ...validRow, revision: 2 }
  await assert.rejects(device.read(), { code: 'invalid-response' })
  const { ciphertext } = validRow.envelope
  const tampered = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`
  row = { ...validRow, envelope: { ...validRow.envelope, ciphertext: tampered } }
  await assert.rejects(device.read(), { code: 'invalid-response' })
  nextResponse = Response.json(null)
  await assert.rejects(device.read(), { code: 'invalid-response' })
  nextResponse = new Response(null, { status: 403 })
  await assert.rejects(device.read(), { code: 'unauthorized' })

  const before = requestCount
  await assert.rejects(device.write(1, { notes: { q1: '字'.repeat(400000) } }), { code: 'too-large' })
  await assert.rejects(device.write(-1, sample), { code: 'invalid-data' })
  await assert.rejects(device.write(1, { toJSON: () => undefined }), { code: 'invalid-data' })
  assert.equal(requestCount, before)
})
