;(function (window) {
  const accountKey = 'account'
  const linkPrefix = '#study-sync='
  const snapshotVersion = 1
  const validName = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 24
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open('xiaotian-study-sync', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('records')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error('浏览器暂时无法保存同步设置'))
      request.onblocked = () => reject(new Error('请关闭旧版刷题页面后重试'))
    })
  }

  function readRecord(database, key) {
    return new Promise((resolve, reject) => {
      const request = database.transaction('records').objectStore('records').get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error('读取同步账号失败'))
    })
  }

  function saveRecord(database, key, value) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('records', 'readwrite')
      transaction.objectStore('records').put(value, key)
      transaction.oncomplete = resolve
      transaction.onabort = () => reject(new Error('浏览器暂时无法保存同步设置'))
    })
  }

  function setup({ endpoint, getSnapshot, applySnapshot, canSync }) {
    const client = window.StudySyncClient
    const pairing = window.StudyPairingClient
    const data = window.StudySyncData
    const button = document.querySelector('#studySyncButton')
    const dialog = document.querySelector('#studySyncDialog')
    if (!client || !data || !button || !dialog) return null

    let account, connection, database, timer, running
    let phoneRequest, approver, pairTimer, approvedCode
    let checkingPair = false
    let startingPair = false
    let approvingPair = false
    let incoming = window.location.hash.startsWith(linkPrefix) ? window.location.hash.slice(linkPrefix.length) : ''
    let message = ''
    let failed = false
    if (incoming) {
      try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search) } catch {}
      if (!client.isSecret(incoming)) { incoming = ''; message = '专属链接不完整，请从已连接的设备重新复制。'; failed = true }
    }

    function payload(name, snapshot) {
      return { version: snapshotVersion, name, snapshot }
    }

    function unpack(record) {
      const value = record?.value
      const snapshot = value?.snapshot
      if (value?.version !== snapshotVersion || !validName(value.name) || !snapshot?.user?.attempts ||
          !Array.isArray(snapshot.user.history) || !Array.isArray(snapshot.user.wrong) ||
          !Array.isArray(snapshot.user.favorites) || !snapshot.notes || !Array.isArray(snapshot.pitfallFavorites) ||
          !Object.hasOwn(snapshot, 'draft')) throw new Error('同步记录的格式无法读取，本机记录已保留。')
      return payload(value.name, data.normalizeSnapshot(snapshot))
    }

    function status(text, error = false) {
      message = text
      failed = error
      button.textContent = account?.name || '同步'
      button.title = text || '电脑手机同步'
      button.setAttribute('aria-label', account ? `${account.name}的同步账号` : '电脑手机同步')
      button.classList.toggle('sync-account-linked', !!account)
      button.classList.toggle('sync-account-error', error)
      const label = dialog.querySelector('[data-sync-status]')
      if (label) { label.textContent = text; label.classList.toggle('sync-error', error) }
    }

    function updatePairForm() {
      const form = dialog.querySelector('[data-sync-create]')
      if (!form) return
      form.setAttribute('aria-busy', String(startingPair))
      for (const submit of form.querySelectorAll('button[type="submit"]')) submit.disabled = startingPair
    }

    function renderDialog() {
      let content
      if (account) {
        const inbox = pairing ? '<section class="sync-pairing" aria-labelledby="syncInboxTitle"><h3 id="syncInboxTitle">连接申请</h3><p data-pair-status role="status">正在查看连接申请…</p><ul class="sync-request-list" data-pair-inbox></ul></section>' : ''
        content = `${inbox}<button type="button" class="btn secondary" data-sync-action="link">复制专属链接</button><input class="sync-field" aria-label="专属链接" data-sync-link readonly hidden><button type="button" class="btn secondary" data-sync-action="now">立即同步</button>`
      } else if (incoming) {
        content = '<p>连接这个同步账号，并合并此设备已有的做题记录。</p><button type="button" class="btn primary" data-sync-action="join">连接并合并</button>'
      } else if (phoneRequest) {
        content = '<p>在已连接的电脑打开「同步」，核对识别码后点「允许连接」。</p><div class="sync-pairing-code"><span>识别码</span><strong data-pair-code></strong></div><p data-pair-status role="status">等待电脑允许…</p><button type="button" class="btn primary" data-sync-action="pair-confirm" hidden>连接并合并</button><button type="button" class="btn secondary" data-sync-action="pair-retry">重新输入名称</button>'
      } else {
        const lookup = pairing ? '<button type="submit" value="pair" class="btn primary">按名称连接</button>' : ''
        content = `<form data-sync-create><label for="syncAccountName">账号名称</label><input class="sync-field" id="syncAccountName" name="name" maxlength="24" autocomplete="nickname" required placeholder="例如 tian">${lookup}<button type="submit" value="create" class="btn ${pairing ? 'secondary' : 'primary'}">创建同步账号</button></form>`
      }
      dialog.innerHTML = `<h2 id="studySyncTitle">电脑手机同步</h2><p data-sync-name hidden></p>${content}<p data-sync-status role="status"></p><button type="button" class="btn secondary" data-sync-action="close">关闭</button>`
      if (account || phoneRequest) {
        const name = dialog.querySelector('[data-sync-name]')
        name.textContent = account?.name || phoneRequest.name
        name.hidden = false
      }
      if (phoneRequest) {
        dialog.querySelector('[data-pair-code]').textContent = pairing.requestCode(phoneRequest.handle.id)
        if (phoneRequest.expired) pairStatus('申请已过期，请重新发起。', true)
        if (phoneRequest.secret) showPairApproval()
      }
      status(message, failed)
      updatePairForm()
    }

    function open() {
      renderDialog()
      if (!dialog.open) dialog.showModal()
      schedulePair(0)
    }

    function pairStatus(text, error = false) {
      const label = dialog.querySelector('[data-pair-status]')
      if (label) {
        if (label.textContent !== text) label.textContent = text
        label.classList.toggle('sync-error', error)
      }
    }

    function showPairApproval() {
      pairStatus('已收到连接许可。确认自己的电脑显示「已允许」后，点「连接并合并」。')
      const confirm = dialog.querySelector('[data-sync-action="pair-confirm"]')
      if (confirm) confirm.hidden = false
    }

    function renderInbox(requests) {
      const inbox = dialog.querySelector('[data-pair-inbox]')
      if (!inbox) return
      const signature = requests.map(request => request.id).join(' ')
      if (inbox.dataset.ids !== signature) {
        inbox.dataset.ids = signature
        inbox.replaceChildren(...requests.map(request => {
          const row = document.createElement('li')
          const code = document.createElement('strong')
          code.textContent = pairing.requestCode(request.id)
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'mini-btn'
          button.textContent = '允许连接'
          button.setAttribute('aria-label', `允许识别码 ${code.textContent} 的连接`)
          button.addEventListener('click', () => approvePair(request, button))
          row.append(code, button)
          return row
        }))
      }
      pairStatus(approvedCode ? `已允许 ${approvedCode}，请回到手机完成连接。` : requests.length
        ? '核对手机显示的识别码，再允许对应的申请。' : '等待手机发来申请。')
    }

    function schedulePair(delay = 2000) {
      if (!pairing || !dialog.open || document.hidden || pairTimer !== undefined) return
      if (!account && (!phoneRequest || phoneRequest.secret || phoneRequest.expired)) return
      pairTimer = window.setTimeout(() => { pairTimer = undefined; refreshPair() }, delay)
    }

    async function refreshPair() {
      if (checkingPair || !dialog.open || document.hidden) return
      checkingPair = true
      const request = phoneRequest
      let delay = 2000
      try {
        if (account) {
          approver ||= await pairing.connectApprover(account.secret, account.name, endpoint)
          const requests = await approver.list()
          if (dialog.open && !approvingPair) renderInbox(requests)
        } else if (request && !request.secret && !request.expired) {
          const secret = await request.handle.poll()
          if (phoneRequest === request) {
            if (secret) { request.secret = secret; showPairApproval() }
            else pairStatus('等待电脑允许…')
          }
        }
      } catch (error) {
        if (request && phoneRequest === request && (error.code === 'expired' || Date.now() >= request.handle.expiresAt)) {
          request.expired = true
          pairStatus('申请已过期，请重新发起。', true)
        } else if (!request || phoneRequest === request) {
          pairStatus(error.message || '暂时无法检查连接申请。', true)
        }
        delay = 6000
      } finally {
        checkingPair = false
        schedulePair(delay)
      }
    }

    async function startPair(name) {
      if (!pairing || account || incoming || startingPair || attaching || !database) return
      startingPair = true
      updatePairForm()
      status('正在发起连接申请…')
      try {
        const handle = await pairing.startRequest(name, endpoint, {
          onRetry: () => status('正在重试连接申请…')
        })
        phoneRequest = { name, handle }
        status('')
        if (dialog.open) renderDialog()
        schedulePair(0)
      } catch (error) {
        status(error.message || '暂时无法发起连接申请，请稍后重试。', true)
      } finally {
        startingPair = false
        updatePairForm()
      }
    }

    async function approvePair(request, button) {
      if (!approver || approvingPair) return
      approvingPair = true
      button.disabled = true
      try {
        await approver.approve(request)
        approvedCode = pairing.requestCode(request.id)
        button.remove()
        pairStatus(`已允许 ${approvedCode}，请回到手机完成连接。`)
      } catch (error) {
        pairStatus(error.message || '暂时无法允许连接，请稍后重试。', true)
      } finally {
        approvingPair = false
        button.disabled = false
        schedulePair(0)
      }
    }

    function schedule(delay = 900) {
      if (!account || timer !== undefined) return
      timer = window.setTimeout(() => { timer = undefined; runSync() }, delay)
    }

    async function mergeAndSave(syncConnection, name, base, original, expectedName = '') {
      for (let retry = 0; retry < 4; retry++) {
        const record = await syncConnection.read()
        if (!canSync()) throw new Error('本次答题结束或返回后会继续同步。')
        if (!record && !original) throw new Error('这个专属链接对应的账号还未建立。')
        const remote = record ? unpack(record) : null
        if (expectedName && pairing.normalizeName(remote?.name) !== pairing.normalizeName(expectedName)) {
          throw new Error('收到的账号名称不一致，请重新发起申请。')
        }
        const local = getSnapshot()
        const next = remote ? data.mergeSnapshots(base, local, remote.snapshot) : local
        const value = payload(remote?.name || name, next)
        const receipt = remote && same(remote.snapshot, next) ? record : await syncConnection.write(record?.revision || 0, value)
        if (!receipt) continue
        if (!canSync()) throw new Error('本次答题结束或返回后会继续同步。')
        const current = getSnapshot()
        const combined = same(local, current) ? next : data.mergeSnapshots(local, current, next)
        if (!same(current, combined)) applySnapshot(combined)
        return { name: value.name, base: next, revision: receipt.revision, needsSync: !same(combined, next) }
      }
      throw new Error('另一台设备正在同步，请稍后重试。')
    }

    async function performSync() {
      if (!account || !canSync()) return
      connection ||= await client.connect(account.secret, endpoint)
      const result = await mergeAndSave(connection, account.name, account.base, false)
      if (account.revision !== result.revision) {
        const next = { secret: account.secret, name: result.name, revision: result.revision, base: result.base }
        await saveRecord(database, accountKey, next)
        account = next
      }
      if (result.needsSync) schedule()
      status('已同步')
    }

    function runSync(manual = false) {
      if (!account) return
      if (!canSync()) {
        if (manual) status('结束答题或笔记编辑后会继续同步。')
        return
      }
      if (manual) status('正在同步…')
      if (running) return running
      running = performSync().catch(error => status(error.message || '同步暂时失败，请稍后重试。', true)).finally(() => { running = null })
      return running
    }

    let attaching = false
    async function attach(secret, name, creating) {
      if (attaching || startingPair || account || !database) return
      if (!canSync()) { status('结束答题或笔记编辑后再连接同步。', true); return }
      attaching = true
      const action = dialog.querySelector(creating ? 'button[value="create"]' : name ? '[data-sync-action="pair-confirm"]' : '[data-sync-action="join"]')
      if (action) action.disabled = true
      status(creating ? '正在创建账号…' : '正在合并记录…')
      try {
        await saveRecord(database, 'before-sync', getSnapshot())
        const remote = await client.connect(secret, endpoint)
        const result = await mergeAndSave(remote, name, null, creating, creating ? '' : name)
        const profile = { secret, name: result.name, base: result.base, revision: result.revision }
        await saveRecord(database, accountKey, profile)
        connection = remote
        account = profile
        incoming = ''
        phoneRequest = null
        if (dialog.open) renderDialog()
        status('已同步')
        schedulePair(0)
        if (result.needsSync) schedule()
      } catch (error) {
        status(error.message || '连接失败，请稍后重试。', true)
      } finally {
        attaching = false
        if (action) action.disabled = false
      }
    }

    dialog.addEventListener('submit', event => {
      event.preventDefault()
      const name = new FormData(event.target).get('name')
      if (!validName(name)) { status('请输入 1 到 24 个字的名称。', true); return }
      if (event.submitter?.value === 'pair') { startPair(name.trim()); return }
      try { attach(client.createSecret(), name.trim(), true) }
      catch (error) { status(error.message || '此浏览器暂时无法创建同步账号。', true) }
    })

    dialog.addEventListener('click', async event => {
      const action = event.target.closest('button[data-sync-action]')?.dataset.syncAction
      if (action === 'close') dialog.close()
      if (action === 'join' && incoming) attach(incoming, '', false)
      if (action === 'pair-confirm' && phoneRequest?.secret) attach(phoneRequest.secret, phoneRequest.name, false)
      if (action === 'pair-retry' && !attaching) { phoneRequest = null; status(''); renderDialog() }
      if (action === 'now') runSync(true)
      if (action === 'link' && account) {
        const input = dialog.querySelector('[data-sync-link]')
        input.value = window.location.origin + window.location.pathname + linkPrefix + account.secret
        try {
          await window.navigator.clipboard.writeText(input.value)
          status('已复制。请只发给自己的另一台设备。')
        } catch {
          input.hidden = false
          input.select()
          status('请复制上方链接，并只发给自己的另一台设备。')
        }
      }
    })
    dialog.addEventListener('close', () => {
      window.clearTimeout(pairTimer)
      pairTimer = undefined
      approvedCode = undefined
      const input = dialog.querySelector('[data-sync-link]')
      if (input) { input.value = ''; input.hidden = true }
    })
    button.addEventListener('click', open)

    openDatabase().then(async opened => {
      database = opened
      const saved = await readRecord(database, accountKey)
      if (client.isSecret(saved?.secret) && validName(saved.name)) account = saved
      status(incoming && account && incoming !== account.secret ? '此浏览器已经连接一个同步账号。' : message, failed)
      button.disabled = false
      if (incoming) open()
      if (account) schedule(0)
    }).catch(error => { button.disabled = false; status(error.message, true) })

    const whenVisible = () => { if (!document.hidden) { schedule(0); schedulePair(0) } }
    document.addEventListener('visibilitychange', whenVisible)
    window.addEventListener('online', whenVisible)
    window.addEventListener('focus', whenVisible)
    window.setInterval(whenVisible, 30000)
    return { schedule }
  }

  window.QuizStudySync = { setup }
})(window)
