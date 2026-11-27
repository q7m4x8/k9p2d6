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
    const passwordClient = window.StudyPasswordClient
    const data = window.StudySyncData
    const button = document.querySelector('#studySyncButton')
    const dialog = document.querySelector('#studySyncDialog')
    if (!client || !data || !button || !dialog) return null

    let account, connection, database, timer, running
    let phoneRequest, approver, pairTimer, approvedCode
    let checkingPair = false
    let startingPair = false
    let approvingPair = false
    let passwordBusy = false
    let backupCandidate = null
    let backupReading = false
    let backupReadId = 0
    let backupMessage = ''
    let backupFailed = false
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

    let showReachabilityCheck = false
    function status(text, error = false, code = '') {
      message = text
      failed = error
      showReachabilityCheck = error && (code === 'network' || code === 'timeout')
      button.textContent = account?.name || '登录'
      button.title = text || '登录小天爱刷题'
      button.setAttribute('aria-label', account ? `${account.name}的账号` : '登录')
      button.classList.toggle('sync-account-linked', !!account)
      button.classList.toggle('sync-account-error', error)
      const label = dialog.querySelector('[data-sync-status]')
      if (label) { label.textContent = text; label.classList.toggle('sync-error', error) }
      const check = dialog.querySelector('[data-sync-check]')
      if (check) check.hidden = !showReachabilityCheck
    }

    function reportFailure(error, fallback) {
      status(error.message || fallback, true, error.code)
    }

    function updatePairForm() {
      const form = dialog.querySelector('[data-sync-create]')
      if (!form) return
      const busy = startingPair || passwordBusy
      form.setAttribute('aria-busy', String(busy))
      for (const submit of form.querySelectorAll('button[type="submit"]')) submit.disabled = busy
    }

    function backupStatus(text, error = false) {
      backupMessage = text
      backupFailed = error
      const label = dialog.querySelector('[data-backup-status]')
      if (!label) return
      label.textContent = text
      label.classList.toggle('sync-error', error)
      dialog.querySelector('[data-backup-review]').hidden = !backupCandidate
      dialog.querySelector('[data-sync-action="backup-choose"]').disabled = backupReading
    }

    function exportBackup() {
      try {
        const contents = data.serializeBackup(getSnapshot())
        const url = window.URL.createObjectURL(new Blob([contents], { type: 'application/json;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = '小天爱刷题-练习记录.json'
        dialog.append(link)
        try { link.click() } finally {
          link.remove()
          window.setTimeout(() => window.URL.revokeObjectURL(url), 60000)
        }
        backupStatus('已开始下载记录文件。')
      } catch (error) {
        backupStatus(error.message || '记录导出失败，请重试。', true)
      }
    }

    async function readBackup(file) {
      if (!file) return
      const readId = ++backupReadId
      backupCandidate = null
      backupReading = true
      backupStatus('正在读取记录文件…')
      try {
        if (file.size > data.backupLimit) throw new Error('记录文件超过 12 MB，请选择较小的文件。')
        const snapshot = data.parseBackup(await file.text())
        if (readId !== backupReadId || !dialog.open) return
        backupCandidate = snapshot
        const attempts = Object.keys(snapshot.user.attempts).length
        const history = snapshot.user.history.length
        const notes = Object.keys(snapshot.notes).length
        backupStatus(`文件包含 ${attempts} 道已答题、${history} 次练习和 ${notes} 条笔记。历史最多保留最近 50 次练习。`)
      } catch (error) {
        if (readId === backupReadId && dialog.open) backupStatus(error.message || '记录文件无法读取。', true)
      } finally {
        if (readId === backupReadId) {
          backupReading = false
          backupStatus(backupMessage, backupFailed)
        }
      }
    }

    function confirmBackup() {
      if (!backupCandidate) return
      if (running || attaching) return backupStatus('当前的云同步请求还在处理，请稍后再合并。', true)
      if (!canSync()) return backupStatus('请先结束当前答题或保存正在编辑的笔记，再合并记录。', true)
      try {
        const local = getSnapshot()
        const combined = data.mergeBackup(local, backupCandidate)
        if (!same(local, combined)) applySnapshot(combined)
        backupCandidate = null
        backupStatus('已合并到本机。')
        schedule()
      } catch (error) {
        backupStatus(error.message || '记录暂时无法合并，本机记录已保留。', true)
      }
    }

    function renderDialog() {
      let content
      if (account) {
        const inbox = pairing ? '<section class="sync-pairing" aria-labelledby="syncInboxTitle"><h3 id="syncInboxTitle">新设备登录</h3><p data-pair-status role="status">正在查看登录申请…</p><ul class="sync-request-list" data-pair-inbox></ul></section>' : ''
        const passwordSettings = passwordClient ? '<details class="study-backup" data-password-settings><summary>设置登录密码</summary><form data-password-enroll><label for="syncNewPassword">新密码</label><input class="sync-field" id="syncNewPassword" name="password" type="password" autocomplete="new-password" required><label for="syncConfirmPassword">确认密码</label><input class="sync-field" id="syncConfirmPassword" name="confirm" type="password" autocomplete="new-password" required><p class="sync-password-hint">使用 15 个以上字符，方便记忆的短语也可以。</p><button type="submit" class="btn primary">保存密码</button></form></details>' : ''
        content = `${passwordSettings}${inbox}<button type="button" class="btn secondary" data-sync-action="link">复制专属链接</button><input class="sync-field" aria-label="专属链接" data-sync-link readonly hidden><button type="button" class="btn secondary" data-sync-action="now">立即同步</button>`
      } else if (incoming) {
        content = '<p>登录后可继续账号里的练习。</p><button type="button" class="btn primary" data-sync-action="join">登录此账号</button>'
      } else if (phoneRequest) {
        content = `<p>在已登录的电脑打开账号，核对识别码并允许登录。验证通过后，手机会自动登录。</p><div class="sync-pairing-code"><span>识别码</span><strong data-pair-code></strong></div><p data-pair-status role="status">等待电脑允许登录…</p><button type="button" class="btn primary" data-sync-action="pair-confirm" ${phoneRequest.retryLogin ? '' : 'hidden'}>重试登录</button><button type="button" class="btn secondary" data-sync-action="pair-retry">重新输入名称</button>`
      } else {
        const field = passwordClient ? '<label for="syncPassword">密码</label><input class="sync-field" id="syncPassword" name="password" type="password" autocomplete="current-password" required><button type="submit" value="password-login" class="btn primary">登录</button>' : ''
        const lookup = pairing ? `<button type="submit" value="pair" class="btn ${passwordClient ? 'secondary' : 'primary'}" formnovalidate>${passwordClient ? '免密码验证' : '登录'}</button>` : ''
        content = `<form data-sync-create><label for="syncAccountName">账号名称</label><input class="sync-field" id="syncAccountName" name="name" maxlength="24" autocomplete="username" required placeholder="例如 tian">${field}${lookup}<button type="submit" value="create" class="btn ${pairing ? 'secondary' : 'primary'}" formnovalidate>创建账号</button></form>`
      }
      const checkCode = showReachabilityCheck ? 'network' : ''
      const backupOpen = dialog.querySelector('[data-study-backup]')?.open
      const backup = `<details class="study-backup" data-study-backup ${backupOpen ? 'open' : ''}><summary>记录文件</summary><div class="study-backup-actions"><button type="button" class="btn secondary" data-sync-action="backup-export">导出记录</button><button type="button" class="btn secondary" data-sync-action="backup-choose">选择记录文件</button></div><input type="file" data-backup-file accept=".json,application/json" hidden><p data-backup-status role="status"></p><div class="study-backup-actions" data-backup-review hidden><button type="button" class="btn primary" data-sync-action="backup-confirm">合并到本机</button><button type="button" class="btn secondary" data-sync-action="backup-cancel">取消合并</button></div></details>`
      dialog.innerHTML = `<h2 id="studySyncTitle">${account ? '我的账号' : '登录小天爱刷题'}</h2><p data-sync-name hidden></p>${content}<p data-sync-status role="status"></p><div class="sync-connection-check" data-sync-check hidden><a target="_blank" rel="noopener noreferrer">检测同步服务器 ↗</a><small>出现 authorization 表示当前网络可以访问服务器。</small></div>${backup}<button type="button" class="btn secondary" data-sync-action="close">关闭</button>`
      dialog.querySelector('[data-sync-check] a').href = endpoint
      if (account || phoneRequest) {
        const name = dialog.querySelector('[data-sync-name]')
        name.textContent = account?.name || phoneRequest.name
        name.hidden = false
      }
      if (phoneRequest) {
        dialog.querySelector('[data-pair-code]').textContent = pairing.requestCode(phoneRequest.handle.id)
        if (phoneRequest.expired) pairStatus('登录申请已过期，请重新登录。', true)
        if (phoneRequest.retryLogin) pairStatus('身份已验证，可以重试登录。')
      }
      status(message, failed, checkCode)
      updatePairForm()
      backupStatus(backupMessage, backupFailed)
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

    async function loginApprovedDevice(request) {
      if (phoneRequest !== request || attaching || !request.secret) return
      const retry = dialog.querySelector('[data-sync-action="pair-confirm"]')
      request.retryLogin = false
      if (retry) retry.hidden = true
      pairStatus('身份已验证，正在登录…')
      await attach(request.secret, request.name, false)
      if (phoneRequest !== request) return
      request.retryLogin = true
      pairStatus('身份已验证，可以重试登录。')
      const retryButton = dialog.querySelector('[data-sync-action="pair-confirm"]')
      if (retryButton) retryButton.hidden = false
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
          button.textContent = '允许登录'
          button.setAttribute('aria-label', `允许识别码 ${code.textContent} 的登录`)
          button.addEventListener('click', () => approvePair(request, button))
          row.append(code, button)
          return row
        }))
      }
      pairStatus(approvedCode ? `已允许 ${approvedCode}，手机会自动登录。` : requests.length
        ? '核对手机显示的识别码，再允许对应的登录申请。' : '等待新设备发来登录申请。')
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
          if (phoneRequest === request && dialog.open) {
            if (secret) { request.secret = secret; await loginApprovedDevice(request) }
            else pairStatus('等待电脑允许登录…')
          }
        }
      } catch (error) {
        if (request && phoneRequest === request && (error.code === 'expired' || Date.now() >= request.handle.expiresAt)) {
          request.expired = true
          pairStatus('登录申请已过期，请重新登录。', true)
        } else if (!request || phoneRequest === request) {
          pairStatus(error.message || '暂时无法检查登录申请。', true)
        }
        delay = 6000
      } finally {
        checkingPair = false
        schedulePair(delay)
      }
    }

    async function startPair(name) {
      if (!pairing || account || incoming || startingPair || passwordBusy || attaching || !database) return
      startingPair = true
      updatePairForm()
      status('正在验证登录…')
      try {
        const handle = await pairing.startRequest(name, endpoint, {
          onRetry: () => status('正在重试登录…')
        })
        phoneRequest = { name, handle }
        status('')
        if (dialog.open) renderDialog()
        schedulePair(0)
      } catch (error) {
        reportFailure(error, '暂时无法发起登录，请稍后重试。')
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
        pairStatus(`已允许 ${approvedCode}，手机会自动登录。`)
      } catch (error) {
        pairStatus(error.message || '暂时无法允许登录，请稍后重试。', true)
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
      if (backupReading || backupCandidate) {
        if (manual) status('请先完成或取消文件合并。')
        return
      }
      if (!canSync()) {
        if (manual) status('结束答题或笔记编辑后会继续同步。')
        return
      }
      if (manual) status('正在同步…')
      if (running) return running
      running = performSync().catch(error => reportFailure(error, '同步暂时失败，请稍后重试。')).finally(() => { running = null })
      return running
    }

    let attaching = false

    async function usePassword(form, values, name) {
      if (!passwordClient || passwordBusy || attaching || startingPair || !database) return
      const setting = form.matches('[data-password-enroll]')
      if (setting && !account) return
      const password = values.get('password')
      if (setting && password !== values.get('confirm')) { status('两次输入的密码需要一致。', true); return }
      passwordBusy = true
      const submit = form.querySelector(setting ? 'button[type="submit"]' : '[value="password-login"]')
      if (submit) submit.disabled = true
      updatePairForm()
      status(setting ? '正在设置密码…' : '正在验证账号密码…')
      try {
        if (setting) {
          await passwordClient.enroll(account, password, endpoint)
          form.reset()
          status('登录密码已设置。')
        } else {
          const secret = await passwordClient.signIn(name, password, endpoint)
          const passwordInput = form.querySelector('[name="password"]')
          if (passwordInput) passwordInput.value = ''
          await attach(secret, name, false)
        }
      } catch (error) {
        reportFailure(error, setting ? '暂时无法设置密码，请重试。' : '暂时无法登录，请重试。')
      } finally {
        passwordBusy = false
        if (submit) submit.disabled = false
        updatePairForm()
      }
    }

    async function attach(secret, name, creating) {
      if (attaching || startingPair || account || !database) return
      if (backupReading || backupCandidate) { status('请先完成或取消文件合并。'); return }
      if (!canSync()) { status('请先结束当前答题或笔记编辑，再登录。', true); return }
      attaching = true
      const action = dialog.querySelector(creating ? 'button[value="create"]' : name ? '[data-sync-action="pair-confirm"]' : '[data-sync-action="join"]')
      if (action) action.disabled = true
      status(creating ? '正在创建账号…' : '正在登录…')
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
        status('已登录')
        schedulePair(0)
        if (result.needsSync) schedule()
      } catch (error) {
        reportFailure(error, '登录失败，请稍后重试。')
      } finally {
        attaching = false
        if (action) action.disabled = false
      }
    }

    dialog.addEventListener('submit', event => {
      event.preventDefault()
      const form = event.target
      const values = new FormData(form)
      if (form.matches('[data-password-enroll]')) { usePassword(form, values); return }
      if (passwordBusy) return
      const name = values.get('name')
      if (!validName(name)) { status('请输入 1 到 24 个字的名称。', true); return }
      if (event.submitter?.value === 'password-login') { usePassword(form, values, name.trim()); return }
      if (event.submitter?.value === 'pair') { startPair(name.trim()); return }
      try { attach(client.createSecret(), name.trim(), true) }
      catch (error) { status(error.message || '此浏览器暂时无法创建同步账号。', true) }
    })
    dialog.addEventListener('change', event => {
      const input = event.target
      if (!input.matches('[data-backup-file]')) return
      const file = input.files?.[0]
      input.value = ''
      readBackup(file)
    })

    dialog.addEventListener('click', async event => {
      const action = event.target.closest('button[data-sync-action]')?.dataset.syncAction
      if (action === 'backup-export') return exportBackup()
      if (action === 'backup-choose') return dialog.querySelector('[data-backup-file]').click()
      if (action === 'backup-confirm') return confirmBackup()
      if (action === 'backup-cancel') {
        backupCandidate = null
        backupStatus('已取消合并。')
        schedule()
        return
      }
      if (action === 'close') dialog.close()
      if (action === 'join' && incoming) attach(incoming, '', false)
      if (action === 'pair-confirm' && phoneRequest?.retryLogin) loginApprovedDevice(phoneRequest)
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
      backupReadId++
      backupReading = false
      backupCandidate = null
      backupStatus('')
      schedule()
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
