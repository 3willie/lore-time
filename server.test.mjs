import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createApp, parseStory, readLibrary, storyId } from './server.mjs'
import { inline, plain, renderStory } from './public/story-format.js'

const here = new URL('.', import.meta.url).pathname

describe('story files', () => {
  it('drops the order prefix and extension from ids', () => {
    assert.equal(storyId('02-The Big Race.md'), 'the-big-race')
    assert.equal(storyId('10_unicorn party.txt'), 'unicorn-party')
  })

  it('takes the title from the first heading and counts words in the body', () => {
    const s = parseStory('01-x.md', '﻿# The Spark\r\n\r\nMax was first.\r\n\r\nLeo was second.')
    assert.equal(s.title, 'The Spark')
    assert.equal(s.text, 'Max was first.\n\nLeo was second.')
    assert.equal(s.words, 6)
  })

  it('falls back to the file name when there is no heading', () => {
    assert.equal(parseStory('03-a-new-friend.txt', 'Once upon a time.').title, 'A New Friend')
  })
})

describe('library', () => {
  let dir
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stories-'))
    await mkdir(join(dir, 'powers'))
    await mkdir(join(dir, 'empty'))
    await mkdir(join(dir, '@eaDir')) // Synology thumbnail folders
    await writeFile(join(dir, 'powers', 'topic.json'), JSON.stringify({ name: 'Powers', emoji: '⚡', color: '#f59e0b' }))
    await writeFile(join(dir, 'powers', '10-ten.md'), '# Ten\n\nLast.')
    await writeFile(join(dir, 'powers', '2-two.md'), '# Two\n\nSecond.')
    await writeFile(join(dir, 'powers', '1-one.md'), '# One\n\nFirst.')
    await writeFile(join(dir, 'powers', 'notes.docx'), 'ignored')
    await mkdir(join(dir, '02-Unicorns'))
    await writeFile(join(dir, '02-Unicorns', 'pip.txt'), 'No heading here.')
  })
  after(() => rm(dir, { recursive: true, force: true }))

  it('lists topics with stories in number order and skips empty and hidden folders', async () => {
    const { topics } = await readLibrary(dir)
    assert.deepEqual(
      topics.map((t) => t.id),
      ['powers', 'unicorns'],
    )
    assert.deepEqual(
      topics[0].stories.map((s) => s.title),
      ['One', 'Two', 'Ten'],
    )
    assert.equal(topics[0].emoji, '⚡')
    assert.equal(topics[1].name, 'Unicorns')
    assert.equal(topics[1].stories[0].title, 'Pip')
  })

  it('reads the bundled stories', async () => {
    const { topics } = await readLibrary(join(here, 'stories'))
    assert.deepEqual(
      topics.map((t) => t.id),
      ['koda-pokemon', 'koda-rion', 'koda-side-stories'],
    )
  })
})

describe('server', () => {
  let dir, server, base
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'storytime-'))
    await mkdir(join(dir, 'public'))
    await mkdir(join(dir, 'mounted'))
    await writeFile(join(dir, 'public', 'index.html'), '<!doctype html><title>Story Time</title>')
    await writeFile(join(dir, 'secret.txt'), 'nope')
    // The mounted folder is empty, so the bundled stories are served.
    server = createApp({ staticDir: join(dir, 'public'), storiesDirs: [join(dir, 'mounted'), join(here, 'stories')] })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}/`
  })
  after(async () => {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
    await rm(dir, { recursive: true, force: true })
  })

  it('serves the library, falling back to the bundled stories', async () => {
    const res = await fetch(base + 'api/library')
    assert.equal(res.status, 200)
    const { topics } = await res.json()
    assert.equal(topics.length, 3)
    assert.ok(topics[0].stories[0].text.length > 100)
  })

  it('picks up stories added to the mounted folder without a restart', async () => {
    await mkdir(join(dir, 'mounted', 'dragons'))
    await writeFile(join(dir, 'mounted', 'dragons', '01-hello.md'), '# Hello\n\nRoar.')
    const { topics } = await (await fetch(base + 'api/library')).json()
    assert.deepEqual(
      topics.map((t) => t.id),
      ['dragons'],
    )
  })

  it('serves the app for any page and refuses paths outside it', async () => {
    assert.match(await (await fetch(base + 'some/page')).text(), /Story Time/)
    const res = await fetch(base + '%2e%2e/secret.txt')
    assert.notEqual(await res.text(), 'nope')
    assert.equal((await fetch(base + 'api/nope')).status, 404)
    assert.equal((await fetch(base + 'api/library', { method: 'POST' })).status, 405)
  })
})

describe('story text', () => {
  it('renders emphasis in titles', () => {
    assert.equal(inline('The Roar That Meant *Come With Me*'), 'The Roar That Meant <em>Come With Me</em>')
    assert.equal(plain('The Roar That Meant *Come With Me*'), 'The Roar That Meant Come With Me')
  })

  it('renders paragraphs, emphasis and scene breaks, and escapes HTML', () => {
    const html = renderStory('Hi *there*, **you**.\nNew line.\n\n---\n\n<b>no</b> it_s fine')
    assert.equal(
      html,
      '<p>Hi <em>there</em>, <strong>you</strong>.<br>New line.</p>\n<p class="break" aria-hidden="true">✦ ✦ ✦</p>\n<p>&lt;b&gt;no&lt;/b&gt; it_s fine</p>',
    )
  })
})
