;(function (root) {
  'use strict'

  const commonJS = typeof module === 'object' && module.exports
  const sync = commonJS ? require('./study-sync-client.js') : root.StudySyncClient
  const pairing = commonJS ? require('./study-pairing-client.js') : root.StudyPairingClient
  const utf8 = new TextEncoder()
  const protocol = 'xiaotian-study-password:v1'
  const rounds = 600000

  function problem(code, message) {
    return Object.assign(new Error(message), { code })
  }

  function encode(bytes) {
    return root.btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function decode(value, length) {
    if (typeof value !== 'string' || value.length !== Math.ceil(length * 4 / 3) || !/^[\w-]+$/.test(value)) {
      throw problem('invalid-response', '登录服务返回的数据无法读取，请重试。')
    }
    const bytes = Uint8Array.from(root.atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0))
    if (encode(bytes) !== value) throw problem('invalid-response', '登录服务返回的数据无法读取，请重试。')
    return bytes
  }

  function targetFor(endpoint) {
    const url = new URL(endpoint, root.location?.href)
    const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if ((!loopback && url.protocol !== 'https:') || url.username || url.password ||
        url.search || url.hash || url.pathname !== '/api/study-sync') {
      throw problem('invalid-endpoint', '登录服务地址无效。')
    }
    return url.origin + '/api/study-password/'
  }

  function normalizedPassword(password, name) {
    const value = typeof password === 'string' ? password.normalize('NFC') : ''
    const length = [...value].length
    if (length < 15 || length > 128) throw problem('password-length', '请输入 15 到 128 个字符的密码。')
    const simple = value.toLowerCase()
    const repeated = /^(.{1,8})\1+$/u.test(simple)
    const common = /^(?:123456789012345|123456789123456|password123456789|qwertyuiopasdfghj)$/u.test(simple)
    if (simple === pairing.normalizeName(name) || repeated || common || value.trim().length < 15) {
      throw problem('password-weak', '这组密码太容易猜中，请换一组。')
    }
    return value
  }

  async function nameKeyFor(name) {
    const normalized = pairing.normalizeName(name)
    if (!normalized) throw problem('invalid-name', '请输入有效的账号名称。')
    if (!root.crypto?.subtle) throw problem('unsupported', '当前浏览器无法使用加密登录。')
    return encode(await root.crypto.subtle.digest('SHA-256', utf8.encode(normalized)))
  }

  async function passwordKeys(password, salt, nameKey) {
    const subtle = root.crypto.subtle
    const input = await subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveBits'])
    const stretched = new Uint8Array(await subtle.deriveBits({
      name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds
    }, input, 256))
    try {
      const key = await subtle.importKey('raw', stretched, 'HKDF', false, ['deriveKey', 'deriveBits'])
      const params = purpose => ({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(`${protocol}:${nameKey}:${purpose}`) })
      const [proof, wrapKey] = await Promise.all([
        subtle.deriveBits(params('login'), key, 256),
        subtle.deriveKey(params('wrap'), key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      ])
      return { proof: encode(proof), wrapKey }
    } finally {
      stretched.fill(0)
    }
  }

  function wrapAlgorithm(iv, salt, nameKey) {
    return { name: 'AES-GCM', iv, additionalData: utf8.encode(`${protocol}:${nameKey}:${encode(salt)}`) }
  }

  function request(url, method, value, token) {
    const headers = {}
    if (value) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`
    return sync.transportRequest(url, { method, headers, body: value ? JSON.stringify(value) : undefined }, async response => {
      if (response.status === 401) {
        if (token) throw problem('unauthorized', '请从已有账号的设备重新登录后设置密码。')
        throw problem('invalid-password', '账号或密码未通过验证。连续尝试后请稍等再登录。')
      }
      if (!response.ok) throw problem('service-unavailable', '账号密码登录服务暂时不可用。')
      try { return await response.json() } catch { throw problem('invalid-response', '登录服务返回的数据无法读取，请重试。') }
    }, { timeoutMs: 8000, retry: method === 'GET' })
  }

  async function enroll(account, password, endpoint) {
    const { name, secret } = account
    if (!sync.isSecret(secret)) throw problem('unauthorized', '请登录已有账号后设置密码。')
    const value = normalizedPassword(password, name)
    const target = targetFor(endpoint)
    const nameKey = await nameKeyFor(name)
    const salt = root.crypto.getRandomValues(new Uint8Array(16))
    const iv = root.crypto.getRandomValues(new Uint8Array(12))
    const { proof, wrapKey } = await passwordKeys(value, salt, nameKey)
    const ciphertext = await root.crypto.subtle.encrypt(wrapAlgorithm(iv, salt, nameKey), wrapKey, decode(secret, 32))
    const token = await sync.deriveAuth(secret)
    await pairing.connectApprover(secret, name, endpoint)
    const result = await request(target + 'enrollment', 'PUT', { nameKey, salt: encode(salt), proof, iv: encode(iv), ciphertext: encode(ciphertext) }, token)
    if (result?.enrolled !== true) throw problem('invalid-response', '登录服务未确认密码设置。')
  }

  async function signIn(name, password, endpoint) {
    const value = normalizedPassword(password, name)
    const target = targetFor(endpoint)
    const nameKey = await nameKeyFor(name)
    const challenge = await request(target + 'challenge?nameKey=' + nameKey, 'GET')
    const salt = decode(challenge?.salt, 16)
    const { proof, wrapKey } = await passwordKeys(value, salt, nameKey)
    const result = await request(target + 'login', 'POST', { nameKey, proof })
    try {
      const iv = decode(result?.iv, 12)
      const ciphertext = decode(result?.ciphertext, 48)
      const secret = encode(await root.crypto.subtle.decrypt(wrapAlgorithm(iv, salt, nameKey), wrapKey, ciphertext))
      if (sync.isSecret(secret)) return secret
    } catch {}
    throw problem('invalid-password', '账号或密码未通过验证，请重试。')
  }

  const api = { enroll, signIn }
  if (commonJS) module.exports = api
  else root.StudyPasswordClient = api
})(typeof window === 'object' ? window : globalThis)
