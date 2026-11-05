# Story Time 🪥

Two-minute stories to read while brushing teeth. Pick a **topic**, then a **story**. That's it.

- Big, tap-friendly buttons for a phone, tablet or wall panel, with light and dark colours.
- Each topic is a series: stories are listed in order, the next unread one is marked **Up next**,
  stories you finish get a ✓ (on that device), and the end of each story has a **Next** button.
- A 🪥 two-minute brushing timer starts when you open a story and keeps going into the next one.
  Tap it to pause or restart.
- **A− / A+** change the text size (remembered on that device). The screen stays on while reading where the
  browser allows it (HTTPS only).
- No accounts, no database, no internet needed. Stories are plain text files you can add with File Station.

## Adding stories

The `stories` folder holds one folder per topic, with one file per story:

```
stories/
  powers/
    topic.json            optional, see below
    01-the-spark.md
    02-leos-turn.md
  pokemon/
    01-a-partner-at-last.md
  unicorns/
    01-the-quiet-horn.md
```

- **Order**: stories are read in file-name order, so start names with a number (`01-`, `02-`, … `10-` sorts
  after `9-` correctly). The number isn't shown.
- **Title**: the first line, written as `# The Title`. Without one, the file name is used.
- **Text**: leave a blank line between paragraphs. `*italic*`, `**bold**`, a line with just `---` for a scene
  break, and `## Heading` all work. `.md` and `.txt` files are both fine.
- **topic.json** (optional) sets how a topic looks; a topic without one is named after its folder:

  ```json
  { "name": "Pokémon", "emoji": "🔴", "color": "#ef4444", "blurb": "Shown above the story list.", "order": 2 }
  ```

  `order` puts topics in a fixed order on the first page; otherwise they are alphabetical.

New and changed stories show up the next time the page opens: no restart needed. The stories in this folder
are samples; while the NAS's `stories` folder is empty, the app shows them.

### Koda story series: naming scheme

Koda's stories are written in Claude chats and pushed here. Each series is its own topic folder:

| Folder | Series |
| --- | --- |
| `stories/koda-pokemon/` | Koda's Pokémon Journey (main canon, in reading order) |
| `stories/koda-powers/` | Koda & Wren in the Powers universe (add when stories arrive) |
| `stories/koda-rion/` | Koda & Rion: a separate arc where Koda's partner is Pikachu and Rion becomes a Lapras |
| `stories/koda-side-stories/` | Standalone / non-canon stories (Entei, PokePark Kanto, space, hot springs) |

File names are `NNN-<story-slug>.md` with a three-digit number for reading order:

- **Gaps are on purpose.** `koda-pokemon` starts at `020`; `001`–`019` are kept free for the earliest
  stories (Abra, Growlithe, Brock, Misty, first Team Rocket attack) from older chats. New stories continue
  from the highest number.
- **Stories that belong together share a slug.** A multi-part story uses `-part-1`, `-part-2`
  (`027-the-vermilion-challenge-part-1.md` … `029-the-vermilion-challenge-part-3.md`) and its title ends in
  `, Part One`, `, Part Two` and so on. A set of linked short stories uses `-1-`, `-2-` after the shared slug
  (`046-five-roads-with-athena-1-the-rattata-problem.md`).
- **Each file is one two-minute read** (about 300–500 words, the length of a toothbrushing session). A longer
  story is split into parts at its scene breaks, and the numbers after it move up.
- The first line is always `# Title`; no other metadata goes in the file, since everything in it is shown to the reader.

## Running on the Synology NAS

### Option A: pull the image GitHub builds

Every push to `main` runs the **Story Time image** workflow, which tests the app and
publishes `ghcr.io/3willie/lore-time` for Intel/AMD and ARM NASes. If the repository is private, so is the
package: make it public (GitHub → profile → **Packages** → `lore-time` → **Package settings** → **Change
visibility**; it holds only the app and sample stories), or log the NAS in once: create a GitHub personal access
token (classic) with only `read:packages`, then in **Container Manager → Registry → Settings → Add** use
`https://ghcr.io` with your GitHub username and that token.

1. In File Station create `/volume1/docker/lore-time/stories`, and inside it a folder per topic with your
   stories (or copy this repository's `stories` folder to start).
2. **Container Manager → Project → Create**: path `/volume1/docker/lore-time`, source
   **Create docker-compose.yml**, paste [`docker-compose.ghcr.yml`](docker-compose.ghcr.yml). Start it.
3. Open `http://<nas-address>:8090`.

### Option B: build on the NAS

Copy or `git clone` this repository to the NAS and create the project from it; it uses
[`docker-compose.yml`](docker-compose.yml), which builds the image there.

| Setting | Default | What it does |
| --- | --- | --- |
| `ports` | `8090:8090` | Change the left number if 8090 is taken |
| `./stories:/stories:ro` | | Your stories. Mounted read-only: the app never changes them |
| `PUID` / `PGID` | `1000` / `1000` | The user the app runs as. If it can't read the folder (Synology ACLs), the app stays root and logs how to fix it; set these to a DSM user that can read it (`id <user>` over SSH) |

Without Docker: `node server.mjs` (Node 20+) serves the bundled stories on port 8090; set `STORIES_DIR` to use
another folder and `PORT` to change the port.

## Adding it to Home Assistant

1. **Settings → Dashboards → Add dashboard → Webpage**, URL `http://<nas-address>:8090`, give it a name and an
   icon (e.g. `mdi:book-open-variant`). Or add a **Webpage** card to an existing dashboard.
2. Add `?theme=dark` or `?theme=light` to the URL to fix the colours, e.g. `http://<nas-address>:8090/?theme=dark`.
3. To open straight to a topic, add it after `#/`: `http://<nas-address>:8090/#/powers`.

**If Home Assistant is opened over HTTPS** (Nabu Casa, or your own certificate), browsers block an `http://`
page inside it and the dashboard shows blank. Give Story Time an HTTPS address too: in DSM, **Control Panel →
Login Portal → Advanced → Reverse Proxy → Create**, source `HTTPS`, a host name such as `stories.your-nas.synology.me`
port 443, destination `HTTP localhost 8090`, then use that `https://` address in Home Assistant (and attach a
certificate to it under **Control Panel → Security → Certificate**). This also lets the screen stay awake while
reading.

## Development

```sh
npm test        # node --test, no dependencies to install
npm start       # http://localhost:8090
```

The app in `public/` is plain HTML, CSS and JavaScript with no build step.
