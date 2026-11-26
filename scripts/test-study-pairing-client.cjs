const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const test = require('node:test')
const sync = require('../study-sync-client.js')
const pairing = require('../study-pairing-client.js')

const ENDPOINT = 'https://example.com/api/study-sync'
const PAIRING_PREFIX = '/api/study-pairing'
const localSha = text => createHash('sha256').update(text).digest('base64url')
const empty = status => new Response(null, { status })

function mockService(t) {
  const aliases = new Map()
  const records = new Map()
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    const serviceUrl = new URL(url)
    assert.equal(serviceUrl.origin, 'https://example.com')
    assert(serviceUrl.pathname.startsWith(PAIRING_PREFIX))
    assert.equal(serviceUrl.search, '')
    assert.equal(serviceUrl.hash, '')
    const path = serviceUrl.pathname.slice(PAIRING_PREFIX.length)
    const { Authorization } = options.headers
    assert.match(Authorization, /^Bearer [A-Za-z0-9_-]{43}$/)
    const token = Authorization.slice('Bearer '.length)
    const body = options.body ? JSON.parse(options.body) : null
    if (path === '/name') {
      const previous = aliases.get(body.nameKey)
      if (previous && previous !== token) return empty(409)
      aliases.set(body.nameKey, token)
      return empty(204)
    }
    if (path === '/inbox') {
      const requests = [...records.values()]
        .filter(record => aliases.get(record.nameKey) === token && !record.grant && !record.expired)
        .map(({ id, publicKey, expiresAt }) => ({ id, publicKey, expiresAt }))
      return Response.json({ requests })
    }
    if (path === '/requests') {
      const previous = records.get(body.id)
      if (previous) {
        assert.equal(previous.token, token)
        assert.equal(previous.nameKey, body.nameKey)
        assert.equal(previous.publicKey, body.publicKey)
        return Response.json({ expiresAt: previous.expiresAt })
      }
      const expiresAt = Date.now() + 300000
      records.set(body.id, { ...body, token, expiresAt, grant: null })
      return Response.json({ expiresAt })
    }
    const match = /^\/requests\/([A-Za-z0-9_-]{22})(\/grant)?$/.exec(path)
    assert(match)
    const [, id, grantPath] = match
    const record = records.get(id)
    if (grantPath) {
      if (!record || record.expired || record.grant || aliases.get(record.nameKey) !== token) return empty(409)
      record.grant = body
      return Response.json({ approved: true })
    }
    if (!record || record.expired || record.token !== token) return empty(404)
    return Response.json({ expiresAt: record.expiresAt, grant: record.grant })
  })
  return { records, calls }
}

test('connection names and endpoints are normalized or rejected before any request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected fetch') })
  assert.equal(pairing.normalizeName('  Ｔｉａｎ  '), 'tian')
  assert.equal(pairing.normalizeName('小天 好'), '小天 好')
  assert.equal(pairing.normalizeName(' '), '')
  assert.equal(pairing.normalizeName('tian\ninvalid'), '')
  assert.equal(pairing.normalizeName(42), '')
  assert.equal(pairing.normalizeName('x'.repeat(25)), '')
  await assert.rejects(pairing.startRequest(' ', ENDPOINT), { code: 'invalid-name' })
  for (const url of ['http://example.com/api/study-sync', 'https://example.com/other', ENDPOINT + '?foo=name', ENDPOINT + '#secret']) {
    await assert.rejects(pairing.startRequest('tian', url), { code: 'invalid-endpoint' })
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test('a phone and authorized desktop exchange the existing secret without exposing it to the relay', async t => {
  const service = mockService(t)
  const secret = sync.createSecret()
  // Request first to cover the desktop opening Sync after the phone.
  const phone = await pairing.startRequest('Ｔｉａｎ', ENDPOINT)
  assert.equal(await phone.poll(), null)
  const otherPhone = await pairing.startRequest('elsewhere', ENDPOINT)
  const desktop = await pairing.connectApprover(secret, 'tian', ENDPOINT)
  const [candidate] = await desktop.list()
  assert.equal(candidate.id, phone.id)
  assert.equal(candidate.expiresAt, phone.expiresAt)
  assert.match(pairing.requestCode(phone.id), /^[A-Z0-9_-]{6}$/)
  assert.equal(pairing.requestCode(candidate.id), pairing.requestCode(phone.id))
  assert.equal(await desktop.approve(candidate), true)
  assert.equal(await phone.poll(), secret)
  assert.equal(await otherPhone.poll(), null)
  assert.deepEqual(await desktop.list(), [])
  const accountToken = await sync.deriveAuth(secret)
  const record = service.records.get(phone.id)
  assert(sync.isSecret(record.token))
  assert.notEqual(record.token, accountToken)
  assert.equal(record.nameKey, localSha('tian'))
  assert.equal(record.id, Buffer.from(localSha(`xiaotian-study-pairing:v1:request:${record.nameKey}:${record.publicKey}`), 'base64url').subarray(0, 16).toString('base64url'))
  assert.equal(record.grant.iv.length, 16)
  assert.equal(record.grant.ciphertext.length, 79)
  for (const { url, options } of service.calls) {
    assert.equal(options.cache, 'no-store')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert(!url.includes(secret))
    assert(!options.headers.Authorization.includes(secret))
    assert(!options.body?.includes(secret))
  }
})

test('the inbox rejects a substituted receiver key and a grant cannot be tampered with or replayed', async t => {
  const service = mockService(t)
  const secret = sync.createSecret()
  const desktop = await pairing.connectApprover(secret, '小天', ENDPOINT)
  const first = await pairing.startRequest('小天', ENDPOINT)
  const second = await pairing.startRequest('小天', ENDPOINT)
  const receivedFirst = service.records.get(first.id)
  const receivedSecond = service.records.get(second.id)
  const originalKey = receivedFirst.publicKey
  receivedFirst.publicKey = receivedSecond.publicKey
  assert.deepEqual((await desktop.list()).map(request => request.id), [second.id])
  await assert.rejects(desktop.approve(receivedFirst), { code: 'invalid-response' })
  receivedFirst.publicKey = originalKey

  const [original] = await desktop.list()
  await desktop.approve(original)
  const good = receivedFirst.grant
  receivedSecond.grant = good
  await assert.rejects(second.poll(), { code: 'invalid-response' })
  receivedFirst.grant = { ...good, ciphertext: (good.ciphertext[0] === 'A' ? 'B' : 'A') + good.ciphertext.slice(1) }
  await assert.rejects(first.poll(), { code: 'invalid-response' })
  receivedFirst.grant = good
  assert.equal(await first.poll(), secret)
})

test('same-name ownership, stale approvals and expired requests return distinguishable errors', async t => {
  const service = mockService(t)
  const owner = sync.createSecret()
  const desktop = await pairing.connectApprover(owner, 'tian', ENDPOINT)
  await pairing.connectApprover(owner, 'ＴＩＡＮ', ENDPOINT)
  await assert.rejects(pairing.connectApprover(sync.createSecret(), 'Tian', ENDPOINT), { code: 'name-taken' })
  const phone = await pairing.startRequest('tian', ENDPOINT)
  const [request] = await desktop.list()
  service.records.get(phone.id).expired = true
  await assert.rejects(phone.poll(), { code: 'expired' })
  await assert.rejects(desktop.approve(request), { code: 'request-stale' })
})

test('a lost pairing receipt retries the same request without raising another approval', async t => {
  const service = mockService(t)
  const serviceFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const response = await serviceFetch(url, options)
    if (service.calls.length === 1) throw new TypeError('Lost pairing response')
    return response
  })
  let retries = 0
  const phone = await pairing.startRequest('test pairing retry', ENDPOINT, { onRetry: () => retries++ })
  const [initial, repeated] = service.calls
  assert.equal(service.calls.length, 2)
  assert.equal(retries, 1)
  assert.equal(initial.options.body, repeated.options.body)
  assert.equal(initial.options.headers.Authorization, repeated.options.headers.Authorization)
  assert.equal(initial.options.signal.aborted, true)
  assert.notEqual(initial.options.signal, repeated.options.signal)
  assert.equal(service.records.size, 1)
  assert.equal(service.records.get(phone.id).expiresAt, phone.expiresAt)
  assert.equal(await phone.poll(), null)
})

test('a pairing request times out with a distinct error after a bounded retry', async t => {
  const originalTimeout = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
    originalTimeout(callback, delay === 8000 ? 0 : delay, ...args))
  const fetch = t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  await assert.rejects(pairing.startRequest('test pairing timeout', ENDPOINT), { code: 'timeout' })
  assert.equal(fetch.mock.callCount(), 2)
})

test('a lost approval response does not resend the one-time grant', async t => {
  const service = mockService(t)
  const secret = sync.createSecret()
  const phone = await pairing.startRequest('test approval retry', ENDPOINT)
  const desktop = await pairing.connectApprover(secret, 'test approval retry', ENDPOINT)
  const [candidate] = await desktop.list()
  const serviceFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const response = await serviceFetch(url, options)
    if (url.endsWith('/grant')) throw new TypeError('Lost approval response')
    return response
  })
  await assert.rejects(desktop.approve(candidate), { code: 'network' })
  assert.equal(service.calls.filter(call => call.url.endsWith('/grant')).length, 1)
  assert.equal(await phone.poll(), secret)
})
