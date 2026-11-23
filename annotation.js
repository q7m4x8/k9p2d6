;(function (root) {
  'use strict'
  const PREFIX = 'xiaotian_quiz_ink_v1:'
  const COLORS = ['#e03c45', '#2878e8', '#202b39']
  const clone = value => JSON.parse(JSON.stringify(value))
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id) && !['constructor', '__proto__', 'prototype'].includes(id)
  function validStroke(value) {
    if (!value || !COLORS.includes(value.color) || !Number.isFinite(value.width) || value.width < 1 || value.width > 12 || !Array.isArray(value.points) || !value.points.length || value.points.length > 2000) return null
    if (!value.points.every(point => Array.isArray(point) && point.length === 2 && point.every(n => Number.isFinite(n) && n >= 0 && n <= 1))) return null
    return { color: value.color, width: value.width, points: value.points.map(point => [...point]) }
  }
  function cleanStrokes(values) {
    const strokes = []; let points = 0
    if (!Array.isArray(values)) return strokes
    for (const value of values) {
      const stroke = validStroke(value)
      if (!stroke) continue
      if (strokes.length >= 300 || points + stroke.points.length > 20000) continue
      strokes.push(stroke); points += stroke.points.length
    }
    return strokes
  }
  function createStore(storage) {
    const records = new Map()
    function record(id) {
      if (!validId(id)) return null
      if (!records.has(id)) {
        let strokes = []; let error = ''
        try { const saved = JSON.parse(storage.getItem(PREFIX + id)); if (saved?.version === 1) strokes = cleanStrokes(saved.strokes) } catch { error = '画笔记录暂时无法读取' }
        records.set(id, { strokes, undo: [], redo: [], saved: !error, error })
      }
      return records.get(id)
    }
    function snapshot(item) { return item ? { strokes: clone(item.strokes), canUndo: !!item.undo.length, canRedo: !!item.redo.length, saved: item.saved, error: item.error } : { strokes: [], canUndo: false, canRedo: false, saved: false, error: '无效题目' } }
    function save(id) {
      const item = record(id)
      if (!item) return snapshot(null)
      try { storage.setItem(PREFIX + id, JSON.stringify({ version: 1, strokes: item.strokes })); item.saved = true; item.error = '' } catch { item.saved = false; item.error = '保存失败，笔迹仍在本页，请点保存重试' }
      return snapshot(item)
    }
    function change(id, next) {
      const item = record(id)
      if (!item) return snapshot(null)
      item.undo.push(clone(item.strokes)); if (item.undo.length > 30) item.undo.shift()
      item.redo = []; item.strokes = clone(next); item.saved = false
      return save(id)
    }
    return {
      get(id) { return snapshot(record(id)) }, save,
      add(id, value) {
        const item = record(id), stroke = validStroke(value)
        if (!item) return snapshot(null)
        if (!stroke || item.strokes.length >= 300 || item.strokes.reduce((n, s) => n + s.points.length, 0) + stroke.points.length > 20000) return { ...snapshot(item), error: '本次笔迹无效或本题笔迹过多，请先擦除部分' }
        return change(id, [...item.strokes, stroke])
      },
      erase(id, index) { const item = record(id); return item && Number.isInteger(index) && index >= 0 && index < item.strokes.length ? change(id, item.strokes.filter((_, i) => i !== index)) : snapshot(item) },
      clear(id) { const item = record(id); return item?.strokes.length ? change(id, []) : snapshot(item) },
      undo(id) {
        const item = record(id); if (!item?.undo.length) return snapshot(item)
        item.redo.push(clone(item.strokes)); item.strokes = item.undo.pop(); return save(id)
      },
      redo(id) {
        const item = record(id); if (!item?.redo.length) return snapshot(item)
        item.undo.push(clone(item.strokes)); if (item.undo.length > 30) item.undo.shift()
        item.strokes = item.redo.pop(); return save(id)
      }
    }
  }
  const api = { createStore }
  if (typeof module === 'object' && module.exports) module.exports = api
  root.QuizAnnotations = api
  if (!root?.document) return
  const document = root.document
  const NS = 'http://www.w3.org/2000/svg'
  let storage
  try { storage = root.localStorage } catch { storage = { getItem() { throw Error() }, setItem() { throw Error() } } }
  const store = createStore(storage)
  let current = null
  let editing = false
  let tool = 'pen'
  let color = COLORS[0]
  let drawing = null
  let observer = null
  let cursor = [0.5, 0.5]
  const icons = {
    pen: '<path d="m5 15 10-10 4 4-10 10-5 1 1-5Zm8-8 4 4M4 21h16"/>',
    undo: '<path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12"/>',
    redo: '<path d="m16 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
    eraser: '<path d="m4 12 9-9 8 8-10 10H7l-5-5 2-4Zm2-2 8 8m-3 3h11"/>',
    clear: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    move: '<path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4"/>',
    save: '<path d="M4 3h14l3 3v15H3V3h1Zm3 0v7h10V3M7 21v-7h10v7"/>',
    exit: '<path d="m5 5 14 14M19 5 5 19"/>'
  }
  const icon = name => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`
  function stop(event) { event.preventDefault(); event.stopPropagation() }
  function node(name, attributes) { const element = document.createElementNS(NS, name); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value); return element }
  function path(stroke) {
    if (stroke.points.length === 1) return node('path', { d: `M${stroke.points[0][0] * 1000} ${stroke.points[0][1] * 1000}l.001 0`, fill: 'none', stroke: stroke.color, 'stroke-width': stroke.width, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' })
    return node('path', { d: stroke.points.map((p, i) => `${i ? 'L' : 'M'}${p[0] * 1000} ${p[1] * 1000}`).join(' '), fill: 'none', stroke: stroke.color, 'stroke-width': stroke.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' })
  }
  function paint() {
    if (!current) return
    const saved = store.get(current.id)
    current.svg.replaceChildren(...saved.strokes.map(path))
    if (drawing && drawing.kind === 'pen') current.svg.appendChild(path(drawing.stroke))
    if (editing && document.activeElement === current.svg && !drawing) current.svg.appendChild(node('circle', { cx: cursor[0] * 1000, cy: cursor[1] * 1000, r: 5, fill: color, opacity: '.5', 'vector-effect': 'non-scaling-stroke' }))
    current.surface.classList.toggle('ink-editing', editing)
    current.surface.classList.toggle('ink-moving', editing && tool === 'move')
    current.svg.setAttribute('tabindex', editing ? '0' : '-1')
    current.toolbar.hidden = !editing
    current.button?.classList.toggle('active', editing)
    current.button?.setAttribute('aria-pressed', String(editing))
    for (const button of current.toolbar.querySelectorAll('[data-ink-tool]')) {
      const action = button.dataset.inkTool
      button.disabled = action === 'undo' ? !saved.canUndo : action === 'redo' ? !saved.canRedo : false
      button.classList.toggle('active', action === tool)
      if (['pen', 'eraser', 'move'].includes(action)) button.setAttribute('aria-pressed', String(action === tool))
    }
    for (const button of current.toolbar.querySelectorAll('[data-ink-color]')) button.setAttribute('aria-pressed', String(button.dataset.inkColor === color))
    current.status.textContent = saved.error || (saved.saved ? '已自动保存' : '尚未保存')
    current.status.classList.toggle('ink-save-error', !!saved.error)
  }
  function finish() {
    if (!drawing || !current) return
    const stroke = drawing
    drawing = null
    if (stroke.kind === 'pen') {
      const result = store.add(current.id, stroke.stroke)
      if (result.error) current.notify?.(result.error)
    }
    paint()
  }
  function point(event, rect) { return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))].map(n => Math.round(n * 1e6) / 1e6) }
  function eraseAt(p, rect) {
    const strokes = store.get(current.id).strokes
    const px = p[0] * rect.width, py = p[1] * rect.height
    for (let index = strokes.length - 1; index >= 0; index--) {
      const stroke = strokes[index]
      for (let j = 0; j < stroke.points.length; j++) {
        const a = stroke.points[Math.max(0, j - 1)], b = stroke.points[j]
        const ax = a[0] * rect.width, ay = a[1] * rect.height, dx = (b[0] - a[0]) * rect.width, dy = (b[1] - a[1]) * rect.height
        const ratio = dx * dx + dy * dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0
        if (Math.hypot(px - ax - ratio * dx, py - ay - ratio * dy) <= Math.max(10, stroke.width + 6)) { store.erase(current.id, index); paint(); return }
      }
    }
  }
  function detach() { observer?.disconnect(); observer = null; if (current) { current.svg.remove(); current.toolbar.remove() } }
  api.active = () => editing && !!current
  api.beforeRender = () => { finish(); detach() }
  api.toggle = () => {
    if (!current) return false
    finish()
    if (editing && !store.save(current.id).saved) { paint(); return true }
    editing = !editing; tool = 'pen'; paint()
    if (editing) current.svg.focus({ preventScroll: true })
    return editing
  }
  api.mount = (surface, id, button, notify) => {
    const previous = current?.id
    if (!surface || !validId(id)) { current = null; editing = false; return }
    if (previous !== id) { editing = false; tool = 'pen'; cursor = [0.5, 0.5] }
    const svg = node('svg', { class: 'question-ink-layer', viewBox: '0 0 1000 1000', preserveAspectRatio: 'none', role: 'img', 'aria-label': '题目画布：空格开始画线，方向键移动，回车结束，Esc退出', tabindex: '-1' })
    const toolbar = document.createElement('aside'); toolbar.className = 'ink-toolbar'; toolbar.setAttribute('aria-label', '题目画笔工具'); toolbar.hidden = true
    toolbar.innerHTML = `<div class="ink-colors">${COLORS.map((c, i) => `<button type="button" data-ink-color="${c}" aria-label="${['红色', '蓝色', '黑色'][i]}画笔" aria-pressed="${c === color}" style="--ink-color:${c}"><i></i></button>`).join('')}</div>${[['pen', '画笔'], ['undo', '撤销'], ['redo', '反撤销'], ['eraser', '橡皮'], ['clear', '清空'], ['move', '滚动'], ['save', '保存'], ['exit', '退出']].map(([name, label]) => `<button type="button" data-ink-tool="${name}" aria-label="${name === 'eraser' ? '橡皮：整笔擦除' : label}">${icon(name)}<span>${label}</span></button>`).join('')}<p class="ink-save-status" role="status"></p>`
    surface.appendChild(svg); document.body.appendChild(toolbar)
    current = { id, surface, svg, toolbar, button, notify, status: toolbar.querySelector('.ink-save-status') }
    toolbar.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return
      stop(event); finish()
      if (button.dataset.inkColor) { color = button.dataset.inkColor; tool = 'pen' }
      const action = button.dataset.inkTool
      if (['pen', 'eraser', 'move'].includes(action)) tool = action
      else if (['undo', 'redo', 'clear', 'save'].includes(action)) store[action](id)
      else if (action === 'exit') { if (store.save(id).saved) editing = false }
      paint()
    })
    svg.addEventListener('pointerdown', event => {
      if (!editing || tool === 'move' || event.isPrimary === false || event.button !== 0) return
      stop(event); finish()
      const rect = surface.getBoundingClientRect(); if (!rect.width || !rect.height) return
      svg.setPointerCapture(event.pointerId)
      const p = point(event, rect)
      drawing = { pointerId: event.pointerId, rect, kind: tool, stroke: { color, width: 3, points: [p] } }
      if (tool === 'eraser') eraseAt(p, rect)
      paint()
    })
    svg.addEventListener('pointermove', event => {
      if (!drawing || drawing.pointerId !== event.pointerId) return
      stop(event)
      const p = point(event, drawing.rect)
      if (drawing.kind === 'eraser') eraseAt(p, drawing.rect)
      else if (drawing.stroke.points.length < 2000) {
        const last = drawing.stroke.points.at(-1)
        if (Math.hypot((p[0] - last[0]) * drawing.rect.width, (p[1] - last[1]) * drawing.rect.height) >= 1) { drawing.stroke.points.push(p); paint() }
      }
    })
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) svg.addEventListener(type, event => { if (drawing?.pointerId === event.pointerId) { stop(event); finish() } })
    svg.addEventListener('keydown', event => {
      if (!editing) return
      if (event.key === 'Escape') { stop(event); api.toggle(); return }
      if (event.key === ' ' || event.key === 'Enter') {
        stop(event)
        if (drawing) finish()
        else if (tool === 'eraser') eraseAt(cursor, surface.getBoundingClientRect())
        else { tool = 'pen'; drawing = { kind: 'pen', stroke: { color, width: 3, points: [[...cursor]] } }; paint() }
      }
      const direction = { ArrowLeft: [-.01, 0], ArrowRight: [.01, 0], ArrowUp: [0, -.01], ArrowDown: [0, .01] }[event.key]
      if (direction) {
        stop(event); cursor = cursor.map((n, i) => Math.max(0, Math.min(1, n + direction[i])))
        if (drawing?.kind === 'pen' && drawing.stroke.points.length < 2000) drawing.stroke.points.push([...cursor])
        paint()
      }
    })
    if (root.ResizeObserver) { observer = new root.ResizeObserver(() => { finish(); paint() }); observer.observe(surface) }
    paint()
  }
  document.addEventListener('click', event => { if (editing && event.target.closest?.('[data-ink-surface]')) { event.preventDefault(); event.stopImmediatePropagation() } }, true)
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish() })
  document.addEventListener('scroll', finish, { capture: true, passive: true })
  root.addEventListener('pagehide', finish)
})(typeof window !== 'undefined' ? window : globalThis)
