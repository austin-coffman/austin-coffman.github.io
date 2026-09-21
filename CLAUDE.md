# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Austin Coffman's personal portfolio site, hosted on GitHub Pages at the repo root. Plain static HTML/CSS/JS — no build step, package manager, linter or test suite. `_config.yml` exists only to enable `jekyll-seo-tag` on GitHub Pages; Jekyll does no templating here. Deploy is automatic: push to `main` publishes.

The home page is a live three.js scene: a GT3 R lapping a real track model, and the page scrolls as the lap. Detail pages are plain dark pages with no scene. Both share one design system.

## Running locally

Serve the folder with any static server (ES modules and glTF loading need `http://`, not `file://`). `.claude/launch.json` starts `python -m http.server 5501`; the author's VS Code Live Server also uses 5501.

three.js is loaded from jsdelivr through an import map in each page that needs it (`index.html`, `lab/*.html`). Google Fonts is the only other network dependency.

## Structure

- `index.html` — home. Sections: `hero`, `about`, `projects` (featured cards + "the log"), `contact`, separated by empty `.breather` gaps where the scene shows through. Inline module script wires scrolling, HUD, the Track settings panel, eased in-page navigation, and the loading curtain.
- `about.html` — About & Resume (experience timeline, awards, technologies, soft skills, education, contact).
- `projects/index.html` — the full project log with a Play / Read / Watch filter; `projects/<slug>.html` — one page per project (`terminal.html` is the template). A project page is the blog post; there is no separate blog. Numbering is by build date: 001 Terminal (Nov 2021), 002 Vent (Jul 2023), 003 Spare (Nov 2025), 004 Chain (Jul 2026), 005 Rep Zero (Sep 2026). Personal “why” paragraphs and lessons the author has not written stay as `[BRACKETS]`. Vent lives at `vent-tool.vercel.app` (the repo’s homepage field is stale).
- `design.html` — the design guide (internal, not linked). Renders every component from `site.css`; keep it truthful when changing styles.
- `assets/css/site.css` — the design system: tokens, base type, nav, footer, components, detail-page shell. `assets/css/home.css` imports it and adds home-page-only rules (scene layers, HUD, Track panel, section backdrops).
- `assets/js/scene.js` — the world: spline, sky/sun/weather, rain, light poles, cameras (helmet / hood / chase ride inside the player car), cars, the loading gate (`scene.ready`). `createTrackScene(canvas, { track, onProgress })`.
- `assets/js/car.js` — `loadCarModel(url)` normalises any GLB/glTF car to one contract (forward +Z, hub-pivoted wheels, steering wheel, paint/livery, glow materials); `buildProceduralGT3()` is the fallback. `setCarPaint(car, hex|null)`.
- `assets/js/track.js` — `loadTrackModel(url)`: render flags only, never edits geometry or textures.
- `assets/models/` — `2024_porsche_992_gt3_r/` (CC BY 4.0), `drift_race_track_free/` (CC BY-ND 4.0 — must ship unmodified; no re-encoding, stripping or compression), `drift_track.path.json` (our traced driving line for the ring, 117 waypoints). Both are credited in the home footer; keep the credits if the models stay.
- `assets/images/` — `headshot.jpeg`, favicon/touch icon, and `<slug>/<slug>-N.jpg` per project (`-0` is the card thumbnail, 16:10).
- `lab/car.html` — car showroom (orbit, turntable, paint, tri count). `lab/track.html` — track lab: loads a track model, finds boundary loops, traces a centreline, exports `path.json`.

## Conventions

- **Nav and footer are duplicated per page** (`index.html`, `about.html`, `design.html`, `projects/*.html`). Nav is Projects · About · Contact; About and Contact point at the home page sections (`index.html#about`, `index.html#contact`), Projects at `projects/`. Change all copies together.
- **Adding a project**: images under `assets/images/<slug>/`; copy `projects/terminal.html` to `projects/<slug>.html` (eyebrow `PROJECT NNN — BUILD · MON YYYY`, meta, story sectors, "Try it", pager); add a row to the log in `projects/index.html` (`<li data-kind="play|read|watch">`) and, if recent, to the home log; add a featured card on the home page and `projects/index.html` if it is showcase-worthy.
- **Voice**: interest, not hustle — the site is about things built because they were interesting, never “nights and weekends” or “after hours”.
- **Design rules live in `design.html`** — one amber accent, mono eyebrows, condensed display type, square corners, hairlines not shadows, no invented facts (unknowns stay as visible `[BRACKETS]`). Read it before restyling anything.
- **Home page scroll** drives the car by distance in either direction (odometer), damped with a critically-damped spring; the camera aims in the car's own frame so it never looks backward. In-page links ride to their target and any user input cancels the ride. Defaults: 16:00, rain 15%, grain 65%, soft 10%, helmet cam (the only camera).
- **Cache-busting**: `index.html` imports `scene.js?v=N`; bump N when changing `scene.js` (browsers cache the module aggressively during local dev).
- **Licences**: no game captures, no NC-licensed models, no third-party logos we did not license. Sponsor boards in the track model are hidden at render time (`hideMatch` in `track.js`).
