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
    const data = window.StudySyncData
    const button = document.querySelector('#studySyncButton')
    const dialog = document.querySelector('#studySyncDialog')
    if (!client || !data || !button || !dialog) return null

    let account, connection, database, timer, running
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

    function renderDialog() {
      const content = account
        ? `<p>在另一台设备打开你的专属链接，即可连接同一个账号。请仅发送给自己。</p><button type="button" class="btn primary" data-sync-action="link">复制专属链接</button><input class="sync-field" aria-label="专属链接" data-sync-link readonly hidden><button type="button" class="btn secondary" data-sync-action="now">立即同步</button>`
        : incoming
          ? `<p>连接这个同步账号，并合并此设备已有的做题记录。</p><button type="button" class="btn primary" data-sync-action="join">连接并合并</button>`
          : `<form data-sync-create><label for="syncAccountName">账号名称</label><input class="sync-field" id="syncAccountName" name="name" maxlength="24" autocomplete="nickname" required placeholder="例如 小天"><p>创建后，在另一台设备打开一次专属链接即可同步。</p><button type="submit" class="btn primary">创建同步账号</button></form>`
      dialog.innerHTML = `<h2 id="studySyncTitle">电脑手机同步</h2><p data-sync-name hidden></p>${content}<p data-sync-status role="status"></p><button type="button" class="btn secondary" data-sync-action="close">关闭</button>`
      if (account) {
        const name = dialog.querySelector('[data-sync-name]')
        name.textContent = account.name
        name.hidden = false
      }
      status(message, failed)
    }

    function open() {
      renderDialog()
      if (!dialog.open) dialog.showModal()
    }

    function schedule(delay = 900) {
      if (!account || timer !== undefined) return
      timer = window.setTimeout(() => { timer = undefined; runSync() }, delay)
    }

    async function mergeAndSave(syncConnection, name, base, original) {
      for (let retry = 0; retry < 4; retry++) {
        const record = await syncConnection.read()
        if (!canSync()) throw new Error('本次答题结束或返回后会继续同步。')
        if (!record && !original) throw new Error('这个专属链接对应的账号还未建立。')
        const remote = record ? unpack(record) : null
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
      if (attaching || account || !database) return
      if (!canSync()) { status('结束答题或笔记编辑后再连接同步。', true); return }
      attaching = true
      const action = dialog.querySelector(creating ? 'button[type="submit"]' : '[data-sync-action="join"]')
      if (action) action.disabled = true
      status(creating ? '正在创建账号…' : '正在合并记录…')
      try {
        await saveRecord(database, 'before-sync', getSnapshot())
        const remote = await client.connect(secret, endpoint)
        const result = await mergeAndSave(remote, name, null, creating)
        const profile = { secret, name: result.name, base: result.base, revision: result.revision }
        await saveRecord(database, accountKey, profile)
        connection = remote
        account = profile
        incoming = ''
        if (dialog.open) renderDialog()
        status('已同步')
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
      try { attach(client.createSecret(), name.trim(), true) }
      catch (error) { status(error.message || '此浏览器暂时无法创建同步账号。', true) }
    })

    dialog.addEventListener('click', async event => {
      const action = event.target.closest('button[data-sync-action]')?.dataset.syncAction
      if (action === 'close') dialog.close()
      if (action === 'join' && incoming) attach(incoming, '', false)
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

    const whenVisible = () => { if (!document.hidden) schedule(0) }
    document.addEventListener('visibilitychange', whenVisible)
    window.addEventListener('online', whenVisible)
    window.addEventListener('focus', whenVisible)
    window.setInterval(whenVisible, 30000)
    return { schedule }
  }

  window.QuizStudySync = { setup }
})(window)
