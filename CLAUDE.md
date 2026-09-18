# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Austin Coffman's personal portfolio site, hosted on GitHub Pages at the repo root. It is plain static HTML/CSS/JS built on the BootstrapMade **iPortfolio v3.8.1** template. There is no build step, package manager, linter, or test suite — `_config.yml` exists only to enable the `jekyll-seo-tag` plugin on GitHub Pages; Jekyll does no templating here.

## Running locally

Open `index.html` directly in a browser, or serve the folder with any static server. The author's VS Code Live Server config uses port 5501 (`.vscode/settings.json`, gitignored). Deploy is automatic: push to `main` publishes.

## Structure

- `index.html` — the entire single-page site. Sections are `<section id="...">` blocks in this order: `hero`, `about`, `facts`, `technologies`, `soft-skills`, `resume`, `portfolio`, `testimonials`, `contact`. The sidebar nav (`#navbar`) links to these by hash; `assets/js/main.js` highlights the active link on scroll and smooth-scrolls on click (`.scrollto`), so a new section needs a matching `id` and nav entry.
- `pages/<slug>-details.html` — one standalone page per portfolio project (`gps`, `amaro`, `eseat`, `terminal`, `pi-race-strategy`). All asset paths are `../`-relative and nav links point to `../index.html#<section>`.
- `assets/css/style.css` — template stylesheet with small local additions (`.portfolio .card-button`, `.portfolio .card-container`, `.contact .php-email-form .disable`).
- `assets/js/main.js` — unmodified template script (Typed.js hero, Waypoints skill bars, Isotope portfolio filter, GLightbox, Swiper sliders, AOS, PureCounter).
- `assets/js/contact.js` — EmailJS contact-form handler (site-specific).
- `assets/vendor/` — all third-party libraries are vendored; nothing is fetched at build time. The only CDN dependency is the EmailJS browser SDK in `index.html`'s `<head>`.

## Conventions that span multiple files

**The header/nav is duplicated verbatim** in `index.html` and every `pages/*.html`. A nav change must be applied to all six files (the detail pages use `../index.html#...` hrefs and mark Portfolio as `active`).

**Adding a portfolio project** touches three places:
1. Images in `assets/images/<slug>/` named `<slug>-N.ext` — `-0` is the card thumbnail, `-1..N` go in the detail page's Swiper slider.
2. A card in `index.html`'s `.portfolio-container` with class `portfolio-item filter-professional` or `filter-personal` (these classes are what the `#portfolio-flters` Isotope buttons match on) linking to `pages/<slug>-details.html`.
3. A new `pages/<slug>-details.html`, most easily copied from an existing one (breadcrumb, "Project Details" list, "Project Images" slider).

**Contact form** (`#contact-form` in `index.html`) is wired to EmailJS in `contact.js` with hardcoded public key / service ID / template ID. Input `name` attributes (`from_name`, `reply_to`, `subject`, `message`, hidden `contact_number`) must match the EmailJS template variables. Success/error feedback toggles the `disable` class on `#loading`, `#sent-message`, `#error-message`. Note `contact.js` is loaded in `<head>` and assigns `window.onload` directly — anything else that sets `window.onload` will clobber it.
