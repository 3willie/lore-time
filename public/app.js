// Story Time reader. No build step: plain modules served as-is.
//
// Pages (hash routes, so Home Assistant can link straight to one):
//   #/                    pick a topic
//   #/<topic>             pick a story in that topic
//   #/<topic>/<story>     read it

import { esc, inline, plain, renderStory } from './story-format.js'

const app = document.getElementById('app')

const STORE_KEY = 'storytime.v1'
const BRUSH_SECONDS = 120
const READ_ALOUD_WPM = 150
const SIZE_MIN = 18
const SIZE_MAX = 44

/** Fallback colours for topics without one in topic.json. */
const PALETTE = ['#4f46e5', '#0891b2', '#16a34a', '#ea580c', '#db2777', '#7c3aed', '#0d9488']

// ---------- per-device memory (which stories are read, text size) ----------

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    return { read: p.read && typeof p.read === 'object' ? p.read : {}, size: Number(p.size) || 0 }
  } catch {
    return { read: {}, size: 0 }
  }
}
const prefs = loadPrefs()
function savePrefs() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs))
  } catch {
    /* private mode or storage blocked: the app still works, it just won't remember */
  }
}
const readKey = (topic, story) => `${topic.id}/${story.id}`
const isRead = (topic, story) => Boolean(prefs.read[readKey(topic, story)])
function markRead(topic, story) {
  if (isRead(topic, story)) return
  prefs.read[readKey(topic, story)] = Date.now()
  savePrefs()
}

function defaultSize() {
  return window.innerWidth < 600 ? 22 : 28
}
function applySize() {
  document.documentElement.style.setProperty('--story-size', `${prefs.size || defaultSize()}px`)
}
applySize()

// ---------- library ----------

let library = null
let loadError = ''

async function loadLibrary() {
  try {
    const res = await fetch('api/library', { cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `The server said ${res.status}`)
    library = body
    loadError = ''
  } catch (e) {
    // Keep showing what we already have if a refresh fails.
    if (!library) loadError = e.message || String(e)
  }
}

const topicColor = (topic, i) => topic.color || PALETTE[i % PALETTE.length]
const upNext = (topic) => topic.stories.find((s) => !isRead(topic, s))
const minutes = (story) => Math.max(1, Math.round(story.words / READ_ALOUD_WPM))

// ---------- tiny helpers ----------

const href = (...parts) => '#/' + parts.map(encodeURIComponent).join('/')

// ---------- brushing timer (keeps running from one story into the next) ----------

const timer = { left: BRUSH_SECONDS, running: false, id: 0 }

function timerLabel() {
  if (timer.left <= 0) return '🪥 Done!'
  const m = Math.floor(timer.left / 60)
  const s = String(timer.left % 60).padStart(2, '0')
  return `🪥 ${m}:${s}`
}
function paintTimer() {
  const el = document.getElementById('timer')
  if (!el) return
  el.textContent = timerLabel()
  el.classList.toggle('done', timer.left <= 0)
  el.classList.toggle('paused', !timer.running && timer.left > 0 && timer.left < BRUSH_SECONDS)
  el.setAttribute(
    'aria-label',
    timer.left <= 0 ? 'Two minutes done. Tap to start again.' : `${timerLabel().slice(3)} of brushing left. Tap to ${timer.running ? 'pause' : 'start'}.`,
  )
}
function startTimer() {
  if (timer.running) return
  if (timer.left <= 0) timer.left = BRUSH_SECONDS
  timer.running = true
  timer.id = setInterval(() => {
    timer.left -= 1
    if (timer.left <= 0) stopTimer()
    paintTimer()
  }, 1000)
  paintTimer()
}
function stopTimer() {
  timer.running = false
  clearInterval(timer.id)
  paintTimer()
}
function resetTimer() {
  stopTimer()
  timer.left = BRUSH_SECONDS
}

// ---------- keep the screen on while reading ----------

let wakeLock = null
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => (wakeLock = null))
    } else if (!on && wakeLock) {
      await wakeLock.release()
      wakeLock = null
    }
  } catch {
    /* not allowed here (e.g. plain http): the screen just follows its normal timeout */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.querySelector('.reader')) keepAwake(true)
})

// ---------- pages ----------

const settingsButton = '<a class="btn icon" href="#/settings" aria-label="Settings">⚙️</a>'

/** The colour choice saved on this device: 'light', 'dark' or '' (follow the device). */
function savedTheme() {
  try {
    return localStorage.getItem('storytime.theme') || ''
  } catch {
    return ''
  }
}
function setTheme(theme) {
  try {
    if (theme) localStorage.setItem('storytime.theme', theme)
    else localStorage.removeItem('storytime.theme')
  } catch {
    /* storage blocked: still applies until the page reloads */
  }
  if (theme) document.documentElement.dataset.theme = theme
  else delete document.documentElement.dataset.theme
}

function renderSettings(settings) {
  const { names, characters, canSave, version } = settings
  const fields = characters
    .map(
      (c) => `<label class="field">
        <span class="field-label">${esc(c.label)}</span>
        <input name="${esc(c.key)}" value="${esc(names[c.key] ?? '')}" placeholder="${esc(c.default || c.label)}"
          maxlength="40" autocomplete="off" autocapitalize="words" spellcheck="false" />
        <span class="hint">${c.default ? `Leave blank for “${esc(c.default)}”. ` : ''}In ${c.topics.map(esc).join(', ')}.</span>
      </label>`,
    )
    .join('')
  const nameSection = characters.length
    ? `<form id="names-form" class="fields">${fields}
        <div class="form-actions">
          <button class="btn primary" type="submit"${canSave ? '' : ' disabled'}>Save names</button>
          <span id="save-status" class="hint" role="status"></span>
        </div>
        ${canSave ? '' : '<p class="warn">The app can’t save on the NAS right now: its <code>data</code> folder isn’t writable. See the README.</p>'}
      </form>`
    : '<p class="hint">None of the stories use changeable names yet. Stories written with names like <code>{{hero}}</code> list them here.</p>'
  const theme = savedTheme()
  const choice = (value, label) =>
    `<button class="seg" data-action="theme-set" data-value="${value}" aria-pressed="${theme === value}">${label}</button>`
  return `<div class="settings">
    <div class="bar">
      <a class="btn" href="#/" aria-label="All topics">← <span class="label">Topics</span></a>
      <h1>Settings</h1>
    </div>
    <section class="panel">
      <h2>Character names</h2>
      <p class="hint">Saved on the NAS, so every device reads the same names.</p>
      ${nameSection}
    </section>
    <section class="panel">
      <h2>This device</h2>
      <div class="setting">
        <span class="setting-label">Colours</span>
        <div class="segmented" role="group" aria-label="Colours">${choice('', 'Auto')}${choice('light', '☀️ Light')}${choice('dark', '🌙 Dark')}</div>
      </div>
      <div class="setting">
        <span class="setting-label">Story text size</span>
        <div class="size-row">
          <button class="btn icon" data-action="smaller" aria-label="Smaller text">A−</button>
          <span class="size-sample">Once upon a time</span>
          <button class="btn icon" data-action="bigger" aria-label="Bigger text">A+</button>
        </div>
      </div>
      <div class="setting">
        <span class="setting-label">Reading progress</span>
        <button class="link" data-action="reset-all">Clear every ✓ mark on this device</button>
      </div>
    </section>
    <p class="hint version">App version ${esc(version || 'unknown')}. After an update, this should match the newest
      commit on GitHub.</p>
  </div>`
}

async function showSettings() {
  app.innerHTML = '<p class="loading">Opening settings…</p>'
  document.title = 'Settings · Story Time'
  try {
    const res = await fetch('api/settings', { cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `The server said ${res.status}`)
    if (parseRoute().topicId === 'settings') app.innerHTML = renderSettings(body)
  } catch (e) {
    app.innerHTML = `<div class="message"><h1>Can't open settings</h1><p>${esc(e.message || e)}</p>
      <p><button class="btn primary" data-action="retry">Try again</button> <a class="btn" href="#/">Topics</a></p></div>`
  }
}

async function saveNames(form) {
  const status = document.getElementById('save-status')
  const button = form.querySelector('button[type=submit]')
  const names = {}
  for (const input of form.querySelectorAll('input[name]')) names[input.name] = input.value
  button.disabled = true
  status.textContent = 'Saving…'
  try {
    const res = await fetch('api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `The server said ${res.status}`)
    for (const input of form.querySelectorAll('input[name]')) input.value = body.names[input.name] ?? ''
    library = null // re-read so the stories use the new names
    status.textContent = 'Saved ✓'
  } catch (e) {
    status.textContent = `Not saved: ${e.message || e}`
  } finally {
    button.disabled = false
  }
}

function renderHome() {
  const topics = library.topics
  if (!topics.length) {
    return `<div class="bar"><span class="spacer"></span>${settingsButton}</div><div class="message"><h1>No stories yet</h1><p>Add a folder for each topic, with a story file or two inside, to the stories folder. The README explains how.</p></div>`
  }
  const cards = topics
    .map((t, i) => {
      const next = upNext(t)
      const done = t.stories.filter((s) => isRead(t, s)).length
      return `<a class="topic" href="${href(t.id)}" style="--c:${esc(topicColor(t, i))}">
        <span class="emoji" aria-hidden="true">${esc(t.emoji)}</span>
        <span class="name">${esc(t.name)}</span>
        <span class="meta">${t.stories.length} ${t.stories.length === 1 ? 'story' : 'stories'}${done ? ` · ${done} read` : ''}</span>
        <span class="next">${next ? `Up next: ${inline(next.title)}` : 'All read! 🎉'}</span>
      </a>`
    })
    .join('')
  return `<div class="bar"><h1>Story Time 🪥</h1>${settingsButton}</div><nav class="topics" aria-label="Topics">${cards}</nav>`
}

function renderTopic(topic, index) {
  const next = upNext(topic)
  const items = topic.stories
    .map((s, i) => {
      const read = isRead(topic, s)
      const isNext = s === next
      return `<li><a class="story${read ? ' read' : ''}${isNext ? ' upnext' : ''}" href="${href(topic.id, s.id)}">
        <span class="num" aria-hidden="true">${read ? '✓' : i + 1}</span>
        <span class="title">${inline(s.title)}${isNext ? '<span class="badge">Up next</span>' : ''}${read ? '<span class="sr-only"> (read)</span>' : ''}</span>
        <span class="mins">${minutes(s)} min</span>
      </a></li>`
    })
    .join('')
  const anyRead = topic.stories.some((s) => isRead(topic, s))
  return `<div style="--c:${esc(topicColor(topic, index))}">
    <div class="bar">
      <a class="btn" href="#/" aria-label="All topics">← <span class="label">Topics</span></a>
      <h1>${esc(topic.emoji)} ${esc(topic.name)}</h1>
    </div>
    ${topic.blurb ? `<p class="blurb">${esc(topic.blurb)}</p>` : ''}
    <ol class="stories">${items}</ol>
    ${anyRead ? '<div class="footer-actions"><button class="link" data-action="reset">Clear the ✓ marks to start this series over</button></div>' : ''}
  </div>`
}

function renderReader(topic, index, story) {
  const i = topic.stories.indexOf(story)
  const next = topic.stories[i + 1]
  return `<div class="reader" style="--c:${esc(topicColor(topic, index))}">
    <div class="bar">
      <a class="btn" href="${href(topic.id)}" aria-label="Back to ${esc(topic.name)}">← <span class="label">${esc(topic.name)}</span></a>
      <span class="crumb">${i + 1} of ${topic.stories.length}</span>
      <button class="btn timer" id="timer" data-action="timer"></button>
      <button class="btn icon" data-action="smaller" aria-label="Smaller text">A−</button>
      <button class="btn icon" data-action="bigger" aria-label="Bigger text">A+</button>
    </div>
    <article>
      <header><div class="emoji" aria-hidden="true">${esc(topic.emoji)}</div><h2>${inline(story.title)}</h2></header>
      <div class="story-text">${renderStory(story.text)}</div>
      <p class="the-end" id="the-end">The End</p>
      <div class="end-actions">
        ${next ? `<a class="btn primary" href="${href(topic.id, next.id)}" data-action="next">Next: ${inline(next.title)} →</a>` : ''}
        <a class="btn" href="${href(topic.id)}">All ${esc(topic.name)} stories</a>
        <a class="btn" href="#/">Topics</a>
      </div>
    </article>
  </div>`
}

// ---------- router ----------

const READ_FRACTION = 0.75
let stopReadWatch = null
let current = { topic: null, story: null }

/**
 * Marks the story read once the reader has scrolled until three quarters of its text has come into view.
 * Only scrolling counts (opening a story at the top never does), so it isn't ticked off just by tapping in.
 */
function watchReading(topic, story) {
  if (isRead(topic, story)) return null
  const text = app.querySelector('.story-text')
  let frame = 0
  const check = () => {
    frame = 0
    if (window.scrollY <= 0) return
    const box = text.getBoundingClientRect()
    if (window.innerHeight - box.top >= box.height * READ_FRACTION) {
      markRead(topic, story)
      stop()
    }
  }
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(check)
  }
  const stop = () => {
    window.removeEventListener('scroll', onScroll)
    cancelAnimationFrame(frame)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  return stop
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  return { topicId: parts[0] || '', storyId: parts[1] || '' }
}

async function route() {
  const { topicId, storyId } = parseRoute()
  stopReadWatch?.()
  stopReadWatch = null
  current = { topic: null, story: null }
  if (topicId === 'settings') {
    keepAwake(false)
    resetTimer()
    window.scrollTo(0, 0)
    return showSettings()
  }
  if (!storyId || !library) await loadLibrary()

  if (!library) {
    app.innerHTML = `<div class="message"><h1>Can't open the story books</h1><p>${esc(loadError)}</p>
      <p><button class="btn primary" data-action="retry">Try again</button></p></div>`
    return
  }

  const index = library.topics.findIndex((t) => t.id === topicId)
  const topic = library.topics[index]
  const story = topic?.stories.find((s) => s.id === storyId)

  if (topic && story) {
    current = { topic, story }
    app.innerHTML = renderReader(topic, index, story)
    document.title = `${plain(story.title)} · Story Time`
    // The timer starts only when tapped; one already running carries on into the next story.
    paintTimer()
    keepAwake(true)
    stopReadWatch = watchReading(topic, story)
  } else {
    keepAwake(false)
    resetTimer()
    if (topic) {
      if (storyId) return void location.replace(href(topic.id))
      app.innerHTML = renderTopic(topic, index)
      document.title = `${topic.name} · Story Time`
    } else {
      if (topicId) return void location.replace('#/')
      app.innerHTML = renderHome()
      document.title = 'Story Time'
    }
  }
  window.scrollTo(0, 0)
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]')
  if (!el) return
  const action = el.dataset.action
  if (action === 'timer') {
    if (timer.running) stopTimer()
    else startTimer()
  } else if (action === 'bigger' || action === 'smaller') {
    const now = prefs.size || defaultSize()
    prefs.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, now + (action === 'bigger' ? 2 : -2)))
    savePrefs()
    applySize()
  } else if (action === 'next') {
    if (current.topic) markRead(current.topic, current.story)
  } else if (action === 'theme-set') {
    setTheme(el.dataset.value)
    for (const b of el.parentElement.children) b.setAttribute('aria-pressed', String(b === el))
  } else if (action === 'reset-all') {
    if (!el.dataset.armed) {
      el.dataset.armed = '1'
      el.textContent = 'Tap again to clear them all'
      return
    }
    prefs.read = {}
    savePrefs()
    el.textContent = 'Cleared ✓'
    el.disabled = true
  } else if (action === 'reset') {
    // Two taps rather than confirm(), which some Home Assistant webviews block.
    if (!el.dataset.armed) {
      el.dataset.armed = '1'
      el.textContent = 'Tap again to clear the ✓ marks'
      return
    }
    const { topicId } = parseRoute()
    for (const key of Object.keys(prefs.read)) if (key.startsWith(`${topicId}/`)) delete prefs.read[key]
    savePrefs()
    route()
  } else if (action === 'retry') {
    route()
  }
})

app.addEventListener('submit', (e) => {
  if (e.target.id !== 'names-form') return
  e.preventDefault()
  saveNames(e.target)
})

window.addEventListener('hashchange', route)
route()
