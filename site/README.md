# Vidown project website

Static GitHub Pages website. The existing `pages.yml` workflow deploys this directory on changes to `main`.

- `index.html`: complete Chinese content, semantic sections and official download links. Core content remains available without JavaScript.
- `app.js`: English translations, language/theme preferences, accessible screenshot tabs and mobile navigation.
- `theme.js`: early theme initialization. Preferences use localStorage, with system appearance as the default.
- `style.css`: responsive layouts, light/dark tokens, reduced-motion and forced-color support.
- `images/*.webp`: optimized versions of real repository screenshots. Screenshots illustrate the application UI; appearance may vary by release.
- `images/social.png`: 1200 × 630 sharing image.

No framework, CDN, analytics, remote fonts or build step is required. To preview, serve this directory with any static HTTP server. Test the `/vidown/` base path before deployment.

When publishing an app release, update the version and all five platform asset links together. Verify filenames against GitHub Releases and review Chinese/English feature and limitation copy in `index.html` and `app.js`. Keep app packages separate from the verification/materials release. Review OS requirements and signing status against current documentation.

Android uses a separate preview card, version and release tag. Its single APK
does not change the five desktop links or imply desktop feature/account parity.
Link to `android/ACCEPTANCE.md` for the current Android validation scope. Verify
the Android card in both languages, both themes and compact/wide layouts.

The first screen pairs the project slogan and download/source links with a real
application screenshot. Its framing is decorative CSS, with no animation loop.

The theme button toggles the currently visible light/dark palette in one click;
system appearance is only the initial default, not a third button state. Explicit
choices persist across visits. View Transitions reveals the new palette from the
button centre in 520 ms; unsupported browsers use a short opacity fade. Rapid
input retains the latest choice. Reduced motion and forced colours skip effects.

Motion uses native Web Animations and one-shot IntersectionObserver reveals for
headings, screenshots, cards and the footer, plus screenshot/menu/disclosure
transitions. Most effects animate opacity and transform; supported browsers also
animate disclosure height briefly. There are no scroll handlers, parallax loops,
blur layers, external animation libraries or permanently promoted layers. Hidden
pages cancel active effects. Content remains readable without animation APIs or
JavaScript. Reduced motion suppresses both CSS and JavaScript effects.

`#history` records published desktop and Android releases on one shared timeline,
with China Standard Time dates. Cards alternate sides on wide windows and use a
single left axis on narrow windows. All cards use the same native `<details>`
component, initially collapsed; titles, versions and dates remain visible.
Details are readable without JavaScript. Match entries to GitHub Release notes and
`docs/CHANGELOG.md`; do not present materials releases or unpublished intermediate
builds as application versions. Update English strings together with Chinese copy.

Project-owned code is MIT licensed. Third-party components retain their own licenses; see the repository's third-party notices.

Run `node scripts/verify-site.mjs` from the repository root for local `/vidown/`
base-path checks, or append `--url https://jimmy-xuzimo.github.io/vidown/` for
production checks. It tests 72 viewport/theme/language combinations across 18
phone, tablet and desktop portrait/landscape sizes, first-screen slogan/actions
and screenshot visibility, timeline layout and expansion, keyboard navigation,
mobile navigation, translations and no-JavaScript reading. Screenshots
and the report remain in ignored `work/site-history-qa/`.

Run `node scripts/verify-site-motion.mjs` (optionally with the same `--url`) for
normal-motion checks at four phone/tablet/desktop window sizes: radial origin,
one-click and rapid input, keyboard, persistence, disclosure/reveal completion,
idle state, legacy preferences, system changes, reduced motion, forced colours
and unsupported View Transitions. `work/site-motion-qa/summary.json` also includes
local idle main-thread and 4× CPU-throttled frame measurements. These are browser
observations on the test machine, not a performance guarantee on real devices.
