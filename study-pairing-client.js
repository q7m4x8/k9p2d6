;(function (root) {
  'use strict'

  const commonJS = typeof module === 'object' && module.exports
  const sync = commonJS ? require('./study-sync-client.js') : root.StudySyncClient
  const PROTOCOL = 'xiaotian-study-pairing:v1'
  const SYNC_PATH = '/api/study-sync'
  const PAIRING_PATH = '/api/study-pairing'
  const MAX_RESPONSE_BYTES = 8192
  const MAX_INBOX_SIZE = 32
  const curve = { name: 'ECDH', namedCurve: 'P-256' }
  const utf8 = new TextEncoder()
  const MESSAGES = {
    'invalid-name': '请输入有效的同步账号名称。',
    'invalid-endpoint': '同步服务配置有误。',
    'invalid-response': '连接申请的数据无法验证，请重新发起申请。',
    'name-taken': '已有其他同步账号使用该名称，请用你的专属链接连接。',
    'request-stale': '这条连接申请已处理或过期，请在手机重新申请。',
    'too-many': '同一名称有多条待处理的申请，请稍后重试。',
    denied: '同步服务暂时无法验证本机，请重试。',
    expired: '连接申请已过期，请重新申请。',
    unsupported: '当前浏览器无法使用加密连接。',
    unavailable: '暂时连不上同步服务，请稍后重试。'
  }

  function error(code) {
    return Object.assign(new Error(MESSAGES[code]), { code })
  }

  function encode(value) {
    return root.btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function decode(value) {
    return Uint8Array.from(root.atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
  }

  function isEncoded(value, byteLength) {
    if (typeof value !== 'string' || value.length !== Math.ceil(byteLength * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) return false
    return encode(decode(value)) === value
  }

  function isExpiry(value) {
    return Number.isSafeInteger(value) && value > 0
  }

  function normalizeName(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 24) return ''
    const normalized = value.normalize('NFKC').trim().toLowerCase()
    return /[\u0000-\u001f\u007f-\u009f]/.test(normalized) ? '' : normalized
  }

  function requestCode(id) {
    return isEncoded(id, 16) ? id.slice(0, 6).toUpperCase() : ''
  }

  function targetFor(endpoint) {
    if (typeof endpoint !== 'string' || !endpoint) throw error('invalid-endpoint')
    let target
    try { target = new URL(endpoint, root.location?.href) } catch { throw error('invalid-endpoint') }
    const loopback = target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
    if ((!loopback && target.protocol !== 'https:') || target.username || target.password || target.search || target.hash || target.pathname !== SYNC_PATH) {
      throw error('invalid-endpoint')
    }
    return target.origin + PAIRING_PATH
  }

  async function connectionNameKey(name) {
    const normalized = normalizeName(name)
    if (!normalized) throw error('invalid-name')
    if (!root.crypto?.subtle || !sync) throw error('unsupported')
    return encode(await root.crypto.subtle.digest('SHA-256', utf8.encode(normalized)))
  }

  async function responseJson(response) {
    const reader = response.body?.getReader()
    if (!reader) throw error('invalid-response')
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let raw = ''
    let size = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_RESPONSE_BYTES) throw error('invalid-response')
        raw += decoder.decode(value, { stream: true })
      }
      const object = JSON.parse(raw + decoder.decode())
      if (!object || typeof object !== 'object' || Array.isArray(object)) throw error('invalid-response')
      return object
    } catch {
      throw error('invalid-response')
    } finally {
      reader.releaseLock()
    }
  }

  function apiRequest(target, token, method, path, body, conflictCode, onRetry) {
    const headers = { Authorization: `Bearer ${token}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    // The server recognizes a repeated request by the same ID, polling token and public key.
    const retry = method === 'GET' || path === '/name' || path === '/requests'
    return sync.transportRequest(target + path, { method, headers, body: JSON.stringify(body) }, async response => {
      if (response.status === 409 && conflictCode) throw error(conflictCode)
      if (response.status === 404) throw error(path.startsWith('/requests/') ? 'expired' : 'unavailable')
      if (response.status === 401 || response.status === 403) throw error('denied')
      if (response.status === 429) throw error('too-many')
      if (!response.ok) throw error('unavailable')
      return path === '/name' ? null : await responseJson(response)
    }, { timeoutMs: 8000, retry, onRetry })
  }

  async function keyPair() {
    try {
      const subtle = root.crypto.subtle
      const pair = await subtle.generateKey(curve, false, ['deriveBits'])
      return { privateKey: pair.privateKey, publicKey: encode(await subtle.exportKey('raw', pair.publicKey)) }
    } catch {
      throw error('unsupported')
    }
  }

  async function grantKey(privateKey, peer, nameKey, id, usage) {
    const subtle = root.crypto.subtle
    const publicKey = await subtle.importKey('raw', decode(peer), curve, false, [])
    const shared = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
    const material = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
    return subtle.deriveKey({
      name: 'HKDF', hash: 'SHA-256', salt: utf8.encode(PROTOCOL), info: utf8.encode(`${nameKey}:${id}`)
    }, material, { name: 'AES-GCM', length: 256 }, false, [usage])
  }

  function grantAlgorithm(nameKey, id, iv) {
    return { name: 'AES-GCM', iv, additionalData: utf8.encode(`${PROTOCOL}:${nameKey}:${id}`) }
  }

  function validRequest(request) {
    return isEncoded(request?.id, 16) && isEncoded(request?.publicKey, 65) && isExpiry(request?.expiresAt)
  }

  async function requestId(nameKey, publicKey) {
    // Bind the displayed code to the phone's ephemeral key, not just a database row.
    const digest = await root.crypto.subtle.digest('SHA-256', utf8.encode(`${PROTOCOL}:request:${nameKey}:${publicKey}`))
    return encode(digest.slice(0, 16))
  }

  async function verifyRequest(nameKey, request) {
    return validRequest(request) && await requestId(nameKey, request.publicKey) === request.id
  }

  async function startRequest(name, endpoint, { onRetry } = {}) {
    const target = targetFor(endpoint)
    const nameKey = await connectionNameKey(name)
    const token = sync.createSecret()
    const { privateKey, publicKey } = await keyPair()
    const id = await requestId(nameKey, publicKey)
    const { expiresAt } = await apiRequest(target, token, 'POST', '/requests', { nameKey, id, publicKey }, 'request-stale', onRetry)
    if (!isExpiry(expiresAt)) throw error('invalid-response')
    return {
      id, expiresAt,
      async poll() {
        const state = await apiRequest(target, token, 'GET', `/requests/${id}`)
        if (state.expiresAt !== expiresAt) throw error('invalid-response')
        const grant = state.grant
        if (grant === null) return null
        if (!isEncoded(grant?.publicKey, 65) || !isEncoded(grant?.iv, 12) || !isEncoded(grant?.ciphertext, 59)) {
          throw error('invalid-response')
        }
        try {
          const key = await grantKey(privateKey, grant.publicKey, nameKey, id, 'decrypt')
          const plain = await root.crypto.subtle.decrypt(grantAlgorithm(nameKey, id, decode(grant.iv)), key, decode(grant.ciphertext))
          const secret = new TextDecoder('utf-8', { fatal: true }).decode(plain)
          if (!sync.isSecret(secret)) throw error('invalid-response')
          return secret
        } catch {
          throw error('invalid-response')
        }
      }
    }
  }

  async function connectApprover(secret, name, endpoint) {
    const target = targetFor(endpoint)
    const nameKey = await connectionNameKey(name)
    const token = await sync.deriveAuth(secret)
    await apiRequest(target, token, 'PUT', '/name', { nameKey }, 'name-taken')
    return {
      async list() {
        const { requests } = await apiRequest(target, token, 'GET', '/inbox')
        if (!Array.isArray(requests) || requests.length > MAX_INBOX_SIZE) throw error('invalid-response')
        const valid = await Promise.all(requests.map(request => verifyRequest(nameKey, request)))
        return requests.filter((_, index) => valid[index])
      },
      async approve(request) {
        if (!await verifyRequest(nameKey, request)) throw error('invalid-response')
        const { id, publicKey: peer } = request
        const { privateKey, publicKey } = await keyPair()
        const iv = root.crypto.getRandomValues(new Uint8Array(12))
        let ciphertext
        try {
          const key = await grantKey(privateKey, peer, nameKey, id, 'encrypt')
          ciphertext = await root.crypto.subtle.encrypt(grantAlgorithm(nameKey, id, iv), key, utf8.encode(secret))
        } catch {
          throw error('invalid-response')
        }
        const result = await apiRequest(target, token, 'PUT', `/requests/${id}/grant`, {
          publicKey, iv: encode(iv), ciphertext: encode(ciphertext)
        }, 'request-stale')
        if (result.approved !== true) throw error('invalid-response')
        return true
      }
    }
  }

  const api = { normalizeName, requestCode, startRequest, connectApprover }
  if (commonJS) module.exports = api
  else root.StudyPairingClient = api
})(typeof window === 'object' ? window : globalThis)
