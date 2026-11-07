# Story Time 🪥

Two-minute stories to read while brushing teeth. Pick a **topic**, then a **story**. That's it.

- Big, tap-friendly buttons for a phone, tablet or wall panel, with light and dark colours.
- Each topic is a series: stories are listed in order, the next unread one is marked **Up next**,
  stories get a ✓ (on that device) once you've scrolled through three quarters of them, and the end of each story has a **Next** button.
- A 🪥 two-minute brushing timer: tap it to start or pause. Once started it keeps going into the next story.
- **A− / A+** change the text size (remembered on that device). The screen stays on while reading where the
  browser allows it (HTTPS only).
- A ⚙️ **Settings** page: character names (saved on the NAS, shared by every device), and for this device the
  colours (auto, light or dark), text size and clearing the ✓ marks.
- No accounts, no database, no internet needed. Stories are plain text files in this repository's `stories`
  folder, built into the image, so pushing a new story and updating the container is all it takes.

## Adding stories

The `stories` folder holds one folder per topic, with one file per story:

```
stories/
  koda-pokemon/
    topic.json            optional, see below
    020-koda-and-the-sky-rival.md
    021-the-three-way-test.md
    ...
  koda-rion/
    001-the-storm-and-the-sea.md
    ...
  koda-side-stories/
    ...
```

- **Order**: stories are read in file-name order, so start names with a number (`01-`, `02-`, … `10-` sorts
  after `9-` correctly). The number isn't shown.
- **Title**: the first line, written as `# The Title`. Without one, the file name is used.
- **Text**: leave a blank line between paragraphs. `*italic*`, `**bold**`, a line with just `---` for a scene
  break, and `## Heading` all work. `.md` and `.txt` files are both fine.
- **topic.json** (optional) sets how a topic looks; a topic without one is named after its folder:

  ```json
  { "name": "Koda's Pokémon Journey", "emoji": "🌪️", "color": "#0ea5e9", "blurb": "Shown above the story list.", "order": 3 }
  ```

  `order` puts topics in a fixed order on the first page; otherwise they are alphabetical.

The stories here are built into the image, so after a push they reach the NAS with the next image update (see
below). To try stories without a push, you can instead mount a folder from the NAS at `/stories` (see the
compose file); while that folder has any topics in it, the app shows it instead of the built-in stories, and
picks up changes the next time the page opens, with no restart.

### Character names (placeholders)

A story can use a placeholder instead of a real name, so the names can be changed and real names never have
to be in this repository or the image:

```md
# {{hero}} and the Lantern Fox

{{hero}} pulled on his boots while {{sidekick}} was still yawning.
```

- Write `{{name}}` wherever the character's name goes. `{{hero}}'s` works for possessives, and placeholders
  work in titles and in the topic's `name` and `blurb` too.
- Give each placeholder a made-up default in the topic's `topic.json`, so the story reads properly anywhere:

  ```json
  { "name": "The Lantern Keepers", "characters": { "hero": "Sam", "sidekick": "Leo" } }
  ```

- Set the real names in the app: ⚙️ **Settings → Character names** lists every placeholder the stories use.
  Type a name and **Save names**; leave one blank to use the default. Names are saved on the NAS (in the
  project's `data` folder), so every device sees them, and they never go into the repository or the image.
  A name applies to every topic that uses the same placeholder, so a character can carry across series.
- A placeholder with no name anywhere stays visible as `{{name}}`, so a typo is easy to spot.
- Only names change: pronouns are written into the story, so keep each character's pronouns in mind.

### Koda story series: naming scheme

Stories are written in Claude chats and pushed here. Each series is its own topic folder. The three newer
series use `{{hero}}`, `{{brother}}`, `{{dad}}` and `{{mom}}` placeholders, named in ⚙️ Settings:

| Folder | Series |
| --- | --- |
| `stories/koda-pokemon/` | Koda's Pokémon Journey (main canon, in reading order) |
| `stories/koda-powers/` | Koda & Wren in the Powers universe (add when stories arrive) |
| `stories/koda-rion/` | Koda & Rion: a separate arc where Koda's partner is Pikachu and Rion becomes a Lapras |
| `stories/koda-side-stories/` | Standalone / non-canon stories (Entei, PokePark Kanto, space, hot springs) |
| `stories/lantern-keepers/` | The Lantern Keepers: a summer on a foggy island whose lamps light for patience, honesty and trust |
| `stories/star-rangers/` | Star Rangers: a tiny ship, a nervous robot, and the map to the Hidden Star |
| `stories/the-map/` | The Map That Draws Itself: Grandpa's map adds a place after each truly kind or brave day |

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
visibility**), or keep it private and log the NAS in once: create a GitHub personal access token (classic) with
only `read:packages`, then in **Container Manager → Registry → Settings → Add** use `https://ghcr.io` with your
GitHub username and that token. **The image contains all the stories**, so keep it private if they use family
names you'd rather not publish.

1. In File Station create the folder `/volume1/docker/lore-time`.
2. **Container Manager → Project → Create**: path `/volume1/docker/lore-time`, source
   **Create docker-compose.yml**, paste [`docker-compose.ghcr.yml`](docker-compose.ghcr.yml) as it is (there is
   nothing to edit in it). Start it.
3. Open `http://<nas-address>:8090`, then ⚙️ **Settings** to set the character names.

The app keeps its settings in a `data` folder it creates inside the project folder; include that folder in
Hyper Backup if you want the names backed up.

**Getting new stories onto the NAS:** push them to `main`, wait for the workflow to finish, then in Container
Manager open the project and choose **Action → Build** (it pulls the new `latest`). To do this automatically,
add a DSM **Task Scheduler** task (user `root`, e.g. nightly) that runs:

```sh
cd /volume1/docker/lore-time && docker compose pull && docker compose up -d && docker image prune -f
```

### Option B: build on the NAS

Copy or `git clone` this repository to the NAS and create the project from it; it uses
[`docker-compose.yml`](docker-compose.yml), which builds the image there.

The compose files need no changes. Only if you run into one of these:

| If… | Then |
| --- | --- |
| port 8090 is already used on the NAS | change the left number under `ports`, e.g. `"8091:8090"` |
| you want to try stories from a NAS folder before pushing them | uncomment the `./stories:/stories:ro` line; while that folder has topics in it, the app shows them instead of the built-in stories |
| the log says the app user can't use the project folder (Synology ACLs) | it keeps working as root; to avoid that, add `environment:` with `PUID` / `PGID` set to a DSM user with access (`id <user>` over SSH) |

Without Docker: `node server.mjs` (Node 20+) serves the bundled stories on port 8090 and keeps settings in
`./data`; `STORIES_DIR`, `DATA_DIR` and `PORT` change those.

## Adding it to Home Assistant

1. **Settings → Dashboards → Add dashboard → Webpage**, URL `http://<nas-address>:8090`, give it a name and an
   icon (e.g. `mdi:book-open-variant`). Or add a **Webpage** card to an existing dashboard.
2. Colours follow the device; to fix them for the dashboard, pick Light or Dark in ⚙️ Settings on that device, or add
   `?theme=dark` / `?theme=light` to the URL.
3. To open straight to a topic, add it after `#/`: `http://<nas-address>:8090/#/koda-pokemon`.

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
