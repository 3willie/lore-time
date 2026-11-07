// Story Time: a tiny, dependency-free server for reading short stories at the bathroom sink.
//
// Stories are plain text files on disk, one folder per topic:
//
//   stories/
//     koda-pokemon/
//       topic.json                      optional: { "name": "...", "emoji": "🌪️", "color": "#0ea5e9", "blurb": "...", "order": 3 }
//       020-koda-and-the-sky-rival.md   "# Title" on the first line, then the story; files are read in name order
//       021-...
//
//   GET /api/health    -> { ok: true }
//   GET /api/library   -> { topics: [{ id, name, emoji, color, blurb, stories: [{ id, title, words, text }] }], characters }
//   GET /api/settings  -> { names, characters: [{ key, label, default, topics }], canSave }
//   PUT /api/settings  <- { names: { hero: 'Koda' } } -> { names }
//   anything else      -> the reader app in public/ (hash routing, so every page is index.html)
//
// Character names can be placeholders: a story says {{hero}}, the topic's topic.json gives it a made-up
// default ("characters": { "hero": "Sam" }), and the real name is set on the app's Settings page. Real names
// are saved only in DATA_DIR/settings.json on the NAS, never in the repository or the image.
//
// The stories folder is read on every request, so changes show up on the next page load without a restart.
// The only file the server writes is settings.json.

import { createReadStream } from 'node:fs'
import { constants } from 'node:fs'
import { access, chown, lstat, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest'])
const STORY_EXT = new Set(['.md', '.txt'])
const MAX_STORY_BYTES = 256 * 1024
const MAX_BODY = 16 * 1024
const MAX_NAME_LENGTH = 40
const MAX_NAMES = 100

/** "02 The Big Race" -> "the-big-race" (a leading number is only for sorting). */
export function slug(name) {
  return name
    .replace(/^\d+[\s._-]*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** "02-the-big-race.md" -> "the-big-race" */
export const storyId = (file) => slug(file.slice(0, file.length - extname(file).length))

/** "the-big-race" -> "The Big Race" */
function titleCase(id) {
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Pulls the "# Title" line off the top of a story; falls back to the file name. */
export function parseStory(file, raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
  const id = storyId(file) || 'story'
  const match = /^#[ \t]+(.+)\n?/.exec(text)
  const title = match ? match[1].trim() : titleCase(id)
  const body = (match ? text.slice(match[0].length) : text).trim()
  const words = body.split(/\s+/).filter((w) => /\w/.test(w)).length
  return { id, title, words, text: body }
}

/** "Little_Brother" -> "little-brother": how placeholders are matched, whatever their case or spacing. */
export const nameKey = (k) => k.trim().toLowerCase().replace(/[_\s]+/g, '-')
const TOKEN = /\{\{\s*([A-Za-z][\w -]*?)\s*\}\}/g

/** Every placeholder key in a text, in order of appearance. */
function placeholders(text) {
  return [...text.matchAll(TOKEN)].map((m) => nameKey(m[1]))
}

/** Replaces {{hero}} with that character's name. Unknown placeholders are left showing, so they get noticed. */
export function fillNames(text, names) {
  return text.replace(TOKEN, (token, key) => names[nameKey(key)] ?? token)
}

function topicCharacters(meta) {
  const names = {}
  if (meta.characters && typeof meta.characters === 'object') {
    for (const [key, value] of Object.entries(meta.characters)) if (typeof value === 'string' && value.trim()) names[nameKey(key)] = value.trim()
  }
  return names
}

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

async function readTopic(dir, folder, names) {
  const found = new Set()
  const path = join(dir, folder)
  let meta = {}
  try {
    meta = JSON.parse(await readFile(join(path, 'topic.json'), 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`Ignoring ${join(folder, 'topic.json')}: ${e.message}`)
  }
  // Names saved in Settings win over the topic's defaults.
  const defaults = topicCharacters(meta)
  const cast = { ...defaults, ...names }
  for (const key of Object.keys(defaults)) found.add(key)
  for (const field of [meta.name, meta.blurb]) if (typeof field === 'string') placeholders(field).forEach((k) => found.add(k))
  const files = (await readdir(path, { withFileTypes: true }))
    .filter((f) => f.isFile() && STORY_EXT.has(extname(f.name).toLowerCase()) && !f.name.startsWith('.'))
    .map((f) => f.name)
    .sort(byName)
  const stories = []
  const seen = new Set()
  for (const file of files) {
    const info = await stat(join(path, file))
    if (info.size > MAX_STORY_BYTES) {
      console.warn(`Skipping ${join(folder, file)}: larger than ${MAX_STORY_BYTES / 1024} KB`)
      continue
    }
    const raw = await readFile(join(path, file), 'utf8')
    placeholders(raw).forEach((k) => found.add(k))
    const story = parseStory(file, fillNames(raw, cast))
    // Two files that slug the same ("01-Hello.md", "hello.txt") would share a link; keep both reachable.
    let id = story.id
    for (let n = 2; seen.has(id); n++) id = `${story.id}-${n}`
    seen.add(id)
    stories.push({ ...story, id })
  }
  const id = slug(folder) || folder
  return {
    id,
    name: typeof meta.name === 'string' && meta.name.trim() ? fillNames(meta.name.trim(), cast) : titleCase(id),
    emoji: typeof meta.emoji === 'string' ? meta.emoji : '📖',
    color: typeof meta.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(meta.color) ? meta.color : '',
    blurb: typeof meta.blurb === 'string' ? fillNames(meta.blurb, cast) : '',
    order: Number.isFinite(meta.order) ? meta.order : null,
    stories,
    cast: [...found].map((key) => ({ key, default: defaults[key] ?? '' })),
  }
}

/** Every topic folder with at least one story, in `order` then name order. */
export async function readLibrary(dir, names = {}) {
  const entries = await readdir(dir, { withFileTypes: true })
  const folders = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('@')).map((e) => e.name)
  const topics = (await Promise.all(folders.map((f) => readTopic(dir, f, names)))).filter((t) => t.stories.length > 0)
  topics.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || byName(a.name, b.name))
  // Every character placeholder, in the order topics list them, with the topics that use it.
  const characters = new Map()
  for (const topic of topics) {
    for (const { key, default: name } of topic.cast) {
      const c = characters.get(key) ?? { key, label: titleCase(key), default: '', topics: [] }
      if (!c.default) c.default = name
      c.topics.push(topic.name)
      characters.set(key, c)
    }
    delete topic.cast
  }
  return { topics, characters: [...characters.values()] }
}

/** Character names saved from the Settings page ({} until something is saved). */
export async function readSettings(dataDir) {
  try {
    const saved = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'))
    return { names: cleanNames(saved.names) ?? {} }
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`Ignoring ${join(dataDir, 'settings.json')}: ${e.message}`)
    return { names: {} }
  }
}

/** Keeps sensible names only: known-shaped keys, trimmed text, nothing empty or very long. Null if not an object. */
export function cleanNames(names) {
  if (!names || typeof names !== 'object' || Array.isArray(names)) return null
  const clean = {}
  for (const [rawKey, value] of Object.entries(names).slice(0, MAX_NAMES)) {
    const key = nameKey(String(rawKey))
    if (!/^[a-z][a-z0-9-]*$/.test(key) || typeof value !== 'string') continue
    const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
    if (name) clean[key] = name
  }
  return clean
}

/** The first folder that exists and holds at least one topic (the mounted one, else the built-in stories). */
async function pickStoriesDir(dirs) {
  for (const dir of dirs) {
    try {
      if ((await readLibrary(dir)).topics.length) return dir
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`Cannot read stories in ${dir}: ${e.code ?? e.message}`)
    }
  }
  return dirs[0]
}

export function createApp({ staticDir, storiesDirs, dataDir }) {
  const root = resolve(staticDir)
  const settingsFile = join(dataDir, 'settings.json')
  let saving = Promise.resolve()

  async function saveNames(names) {
    await mkdir(dataDir, { recursive: true })
    const tmp = `${settingsFile}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ names, updatedAt: new Date().toISOString() }, null, 2))
    await rename(tmp, settingsFile)
  }

  async function canSave() {
    try {
      await mkdir(dataDir, { recursive: true })
      await access(dataDir, constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  function readBody(req) {
    return new Promise((done, fail) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY) {
          fail(Object.assign(new Error('Too large'), { status: 413 }))
          req.destroy()
        } else chunks.push(c)
      })
      req.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
      req.on('error', fail)
    })
  }

  function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  async function serveStatic(req, res, path) {
    let file = resolve(root, '.' + normalize(decodeURIComponent(path)))
    if (file !== root && !file.startsWith(root + sep)) return send(res, 403, { error: 'Forbidden' })
    let info = await stat(file).catch(() => null)
    if (!info || info.isDirectory()) {
      file = join(root, 'index.html')
      info = await stat(file).catch(() => null)
      if (!info) return send(res, 404, { error: 'Not found' })
    }
    const ext = extname(file)
    const gzip = COMPRESSIBLE.has(ext) && info.size > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': info.size }),
      Vary: 'Accept-Encoding',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    if (req.method === 'HEAD') return res.end()
    const stream = createReadStream(file)
    if (gzip) stream.pipe(createGzip()).pipe(res)
    else stream.pipe(res)
  }

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    try {
      if (path === '/api/settings' && req.method === 'PUT') {
        let names
        try {
          names = cleanNames(JSON.parse(await readBody(req)).names)
        } catch (e) {
          return send(res, e.status ?? 400, { error: e.status ? 'Too much to save' : 'Expected JSON' })
        }
        if (!names) return send(res, 400, { error: 'Expected { names: { ... } }' })
        try {
          await (saving = saving.then(() => saveNames(names), () => saveNames(names)))
        } catch (e) {
          console.error(`Cannot save ${settingsFile}:`, e.message)
          return send(res, 500, { error: `The NAS wouldn't let the app save settings (${e.code ?? e.message}).` })
        }
        return send(res, 200, { names })
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' })
      if (path === '/api/health') return send(res, 200, { ok: true })
      if (path === '/api/library' || path === '/api/settings') {
        const dir = await pickStoriesDir(storiesDirs)
        const { names } = await readSettings(dataDir)
        let library
        try {
          library = await readLibrary(dir, names)
        } catch (e) {
          console.error(`Cannot read stories in ${dir}:`, e.message)
          return send(res, 500, { error: `Cannot read the stories folder (${e.code ?? e.message})` })
        }
        if (path === '/api/library') return send(res, 200, library)
        return send(res, 200, { names, characters: library.characters, canSave: await canSave() })
      }
      if (path.startsWith('/api/')) return send(res, 404, { error: 'Not found' })
      await serveStatic(req, res, path)
    } catch (e) {
      console.error(e)
      if (!res.headersSent) send(res, 500, { error: 'Server error' })
      else res.end()
    }
  })
}

async function chownTree(path, uid, gid) {
  const info = await lstat(path)
  if (info.uid !== uid || info.gid !== gid) await chown(path, uid, gid)
  if (info.isDirectory()) for (const entry of await readdir(path)) await chownTree(join(path, entry), uid, gid)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const port = Number(process.env.PORT ?? 8090)
  const staticDir = process.env.STATIC_DIR ?? join(here, 'public')
  const bundled = process.env.BUNDLED_STORIES_DIR ?? join(here, 'stories')
  const storiesDirs = [...new Set([process.env.STORIES_DIR, bundled].filter(Boolean))]
  const dataDir = process.env.DATA_DIR ?? join(here, 'data')

  // The container starts as root only to give the settings folder to the app user (PUID/PGID, default 1000)
  // and check that user can read the stories and write settings; Synology shared-folder ACLs sometimes say
  // no. It drops root when it can, else stays root and says how to fix it.
  if (process.getuid?.() === 0 && process.env.PUID !== '0') {
    const uid = Number(process.env.PUID ?? 1000)
    const gids = String(process.env.PGID ?? '1000')
      .split(',')
      .map((g) => Number(g.trim()))
      .filter((g) => Number.isInteger(g) && g >= 0)
    const gid = gids[0] ?? 1000
    try {
      await mkdir(dataDir, { recursive: true })
      await chownTree(dataDir, uid, gid)
    } catch (e) {
      console.warn(`Could not hand ${dataDir} to ${uid}:${gid} (${e.code ?? e.message}).`)
    }
    const canRead = async () => {
      for (const dir of storiesDirs) {
        try {
          await readLibrary(dir)
        } catch (e) {
          if (e.code !== 'ENOENT') return false
        }
      }
      const probe = join(dataDir, `.write-test-${process.pid}`)
      try {
        await writeFile(probe, '')
        await unlink(probe)
      } catch {
        return false
      }
      return true
    }
    const rootGroups = process.getgroups()
    process.setgroups(gids.length ? gids : [gid])
    process.setegid(gid)
    process.seteuid(uid)
    const readable = await canRead()
    process.seteuid(0)
    process.setegid(0)
    if (readable) {
      process.setgid(gid)
      process.setuid(uid)
    } else {
      process.setgroups(rootGroups)
      console.warn(
        `uid ${uid} cannot read the stories or write ${dataDir} (Synology shared-folder ACLs can do this), so the ` +
          'server keeps running as root. To avoid that, set PUID/PGID to a DSM user with access to the project folder.',
      )
    }
  }

  const dir = await pickStoriesDir(storiesDirs)
  const server = createApp({ staticDir, storiesDirs, dataDir })
  server.listen(port, () => {
    console.log(`Story Time ${process.env.APP_VERSION || 'dev'} on http://0.0.0.0:${port} as uid ${process.getuid?.()}, stories from ${dir}, settings in ${dataDir}`)
  })
  const stop = () => {
    server.close(() => process.exit(0))
    server.closeAllConnections()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
