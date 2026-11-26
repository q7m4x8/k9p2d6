;(function (root) {
  'use strict'

  const MAX_BODY_BYTES = 1500000
  const PROTOCOL = 'xiaotian-study-sync:v1'
  const BASE64URL = /^[A-Za-z0-9_-]+$/
  const MESSAGES = {
    unsupported: '当前浏览器无法使用加密同步。',
    'invalid-secret': '专属链接不完整，请重新复制。',
    'invalid-endpoint': '同步服务配置有误。',
    unavailable: '暂时连不上同步服务，请稍后重试。',
    unauthorized: '暂时无法连接这个账号，请检查专属链接。',
    'too-large': '记录超过同步容量，请保留本机记录。',
    'invalid-data': '暂时无法处理这份同步记录。',
    'invalid-response': '同步服务返回的记录无法读取，请稍后重试。'
  }

  function error(code) {
    return Object.assign(new Error(MESSAGES[code]), { code })
  }

  function toBase64url(bytes) {
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
    }
    return root.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function fromBase64url(value) {
    const binary = root.atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  }

  function isSecret(value) {
    return typeof value === 'string' && value.length === 43 && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value)
  }

  function createSecret() {
    if (!root.crypto?.subtle) throw error('unsupported')
    return toBase64url(root.crypto.getRandomValues(new Uint8Array(32)))
  }

  function checkedEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || !endpoint) throw error('invalid-endpoint')
    let target
    try { target = new URL(endpoint, root.location?.href) } catch { throw error('invalid-endpoint') }
    const loopback = target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
    if ((!loopback && target.protocol !== 'https:') || target.username || target.password || target.search || target.hash) {
      throw error('invalid-endpoint')
    }
    return target.href
  }

  async function readResponse(response) {
    const reader = response.body?.getReader()
    if (!reader) throw error('invalid-response')
    const decoder = new TextDecoder('utf-8', { fatal: true })
    try {
      let size = 0
      let raw = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_BODY_BYTES) throw error('invalid-response')
        raw += decoder.decode(value, { stream: true })
      }
      const result = JSON.parse(raw + decoder.decode())
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw error('invalid-response')
      return result
    } finally {
      reader.releaseLock()
    }
  }

  async function deriveCredentials(secret, includeEncryption) {
    if (!isSecret(secret)) throw error('invalid-secret')
    if (!root.crypto?.subtle) throw error('unsupported')
    const subtle = root.crypto.subtle
    const utf8 = new TextEncoder()
    const salt = utf8.encode(PROTOCOL)
    const hkdf = label => ({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(label) })

    try {
      const usages = includeEncryption ? ['deriveBits', 'deriveKey'] : ['deriveBits']
      const material = await subtle.importKey('raw', fromBase64url(secret), 'HKDF', false, usages)
      const [authentication, key] = await Promise.all([
        subtle.deriveBits(hkdf('authorization'), material, 256),
        includeEncryption ? subtle.deriveKey(hkdf('encryption'), material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) : null
      ])
      return { token: toBase64url(new Uint8Array(authentication)), key }
    } catch {
      throw error('unsupported')
    }
  }

  async function deriveAuth(secret) {
    return (await deriveCredentials(secret, false)).token
  }

  async function connect(secret, endpoint) {
    if (!isSecret(secret)) throw error('invalid-secret')
    if (!root.crypto?.subtle) throw error('unsupported')
    const url = checkedEndpoint(endpoint)
    const { token, key } = await deriveCredentials(secret, true)
    const subtle = root.crypto.subtle
    const utf8 = new TextEncoder()
    const algorithm = (iv, revision) => ({ name: 'AES-GCM', iv, additionalData: utf8.encode(`${PROTOCOL}:${revision}`) })

    async function request(method, body) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      try {
        let response
        try {
          const headers = { Authorization: `Bearer ${token}` }
          if (body !== undefined) headers['Content-Type'] = 'application/json'
          response = await root.fetch(url, {
            method, headers, body, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error'
          })
        } catch {
          throw error('unavailable')
        }

        if ((method === 'GET' && response.status === 404) || (method === 'PUT' && response.status === 409)) return null
        if (response.status === 401 || response.status === 403) throw error('unauthorized')
        if (response.status === 413) throw error('too-large')
        if (!response.ok) throw error('unavailable')
        try { return await readResponse(response) } catch { throw error('invalid-response') }
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    }

    async function openSnapshot(record, expectedRevision) {
      const revision = record?.revision
      const envelope = record?.envelope
      if (!Number.isSafeInteger(revision) || revision < 1 || (expectedRevision !== undefined && revision !== expectedRevision) ||
          envelope?.version !== 1 || typeof envelope.iv !== 'string' || envelope.iv.length !== 16 || !BASE64URL.test(envelope.iv) ||
          typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length < 22 || !BASE64URL.test(envelope.ciphertext)) {
        throw error('invalid-response')
      }
      let value
      try {
        const plaintext = await subtle.decrypt(algorithm(fromBase64url(envelope.iv), revision), key, fromBase64url(envelope.ciphertext))
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext))
      } catch {
        throw error('invalid-response')
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('invalid-response')
      return { revision, value }
    }

    return {
      async read() {
        const record = await request('GET')
        return record === null ? null : openSnapshot(record)
      },
      async write(revision, value) {
        if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER ||
            !value || typeof value !== 'object' || Array.isArray(value)) throw error('invalid-data')
        let serialized
        try { serialized = JSON.stringify(value) } catch { throw error('invalid-data') }
        if (!serialized?.startsWith('{')) throw error('invalid-data')
        const plaintext = utf8.encode(serialized)
        if (Math.ceil((plaintext.byteLength + 16) * 4 / 3) > MAX_BODY_BYTES) throw error('too-large')
        const iv = root.crypto.getRandomValues(new Uint8Array(12))
        let ciphertext
        try { ciphertext = await subtle.encrypt(algorithm(iv, revision + 1), key, plaintext) } catch { throw error('invalid-data') }
        const envelope = { version: 1, iv: toBase64url(iv), ciphertext: toBase64url(new Uint8Array(ciphertext)) }
        const body = JSON.stringify({ revision, envelope })
        if (body.length > MAX_BODY_BYTES) throw error('too-large')
        const record = await request('PUT', body)
        return record === null ? null : openSnapshot(record, revision + 1)
      }
    }
  }

  const api = { createSecret, isSecret, connect, deriveAuth }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.StudySyncClient = api
})(typeof window === 'object' ? window : globalThis)
