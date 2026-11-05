// Story Time: a tiny, dependency-free server for reading short stories at the bathroom sink.
//
// Stories are plain text files on disk, one folder per topic:
//
//   stories/
//     powers/
//       topic.json          optional: { "name": "Powers", "emoji": "⚡", "color": "#f59e0b", "blurb": "..." }
//       01-the-spark.md     "# Title" on the first line, then the story; files are read in name order
//       02-...
//
//   GET /api/health   -> { ok: true }
//   GET /api/library  -> { topics: [{ id, name, emoji, color, blurb, stories: [{ id, title, words, text }] }] }
//   anything else     -> the reader app in public/ (hash routing, so every page is index.html)
//
// The folder is read on every request, so a story dropped in with File Station shows up on the next
// page load without restarting anything. The server never writes to disk.

import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
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

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

async function readTopic(dir, folder) {
  const path = join(dir, folder)
  let meta = {}
  try {
    meta = JSON.parse(await readFile(join(path, 'topic.json'), 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`Ignoring ${join(folder, 'topic.json')}: ${e.message}`)
  }
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
    const story = parseStory(file, await readFile(join(path, file), 'utf8'))
    // Two files that slug the same ("01-Hello.md", "hello.txt") would share a link; keep both reachable.
    let id = story.id
    for (let n = 2; seen.has(id); n++) id = `${story.id}-${n}`
    seen.add(id)
    stories.push({ ...story, id })
  }
  const id = slug(folder) || folder
  return {
    id,
    name: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : titleCase(id),
    emoji: typeof meta.emoji === 'string' ? meta.emoji : '📖',
    color: typeof meta.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(meta.color) ? meta.color : '',
    blurb: typeof meta.blurb === 'string' ? meta.blurb : '',
    order: Number.isFinite(meta.order) ? meta.order : null,
    stories,
  }
}

/** Every topic folder with at least one story, in `order` then name order. */
export async function readLibrary(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const folders = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('@')).map((e) => e.name)
  const topics = (await Promise.all(folders.map((f) => readTopic(dir, f)))).filter((t) => t.stories.length > 0)
  topics.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || byName(a.name, b.name))
  return { topics }
}

/** The first folder that exists and holds at least one topic (the mounted one, else the bundled samples). */
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

export function createApp({ staticDir, storiesDirs }) {
  const root = resolve(staticDir)

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
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' })
      if (path === '/api/health') return send(res, 200, { ok: true })
      if (path === '/api/library') {
        const dir = await pickStoriesDir(storiesDirs)
        try {
          return send(res, 200, await readLibrary(dir))
        } catch (e) {
          console.error(`Cannot read stories in ${dir}:`, e.message)
          return send(res, 500, { error: `Cannot read the stories folder (${e.code ?? e.message})` })
        }
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const port = Number(process.env.PORT ?? 8090)
  const staticDir = process.env.STATIC_DIR ?? join(here, 'public')
  const bundled = process.env.BUNDLED_STORIES_DIR ?? join(here, 'stories')
  const storiesDirs = [...new Set([process.env.STORIES_DIR, bundled].filter(Boolean))]

  // The container starts as root only to check that the app user (PUID/PGID, default 1000) can read the
  // stories folder; Synology shared-folder ACLs sometimes say no. It drops root when it can, else stays
  // root (the server only ever reads) and says how to fix it.
  if (process.getuid?.() === 0 && process.env.PUID !== '0') {
    const uid = Number(process.env.PUID ?? 1000)
    const gids = String(process.env.PGID ?? '1000')
      .split(',')
      .map((g) => Number(g.trim()))
      .filter((g) => Number.isInteger(g) && g >= 0)
    const gid = gids[0] ?? 1000
    const canRead = async () => {
      for (const dir of storiesDirs) {
        try {
          await readLibrary(dir)
        } catch (e) {
          if (e.code !== 'ENOENT') return false
        }
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
        `uid ${uid} cannot read the stories folder (Synology shared-folder ACLs can do this), so the server keeps ` +
          'running as root; it only reads files. To avoid that, set PUID/PGID to a DSM user that can read the folder.',
      )
    }
  }

  const dir = await pickStoriesDir(storiesDirs)
  const server = createApp({ staticDir, storiesDirs })
  server.listen(port, () => {
    console.log(`Story Time ${process.env.APP_VERSION || 'dev'} on http://0.0.0.0:${port} as uid ${process.getuid?.()}, stories from ${dir}`)
  })
  const stop = () => {
    server.close(() => process.exit(0))
    server.closeAllConnections()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
