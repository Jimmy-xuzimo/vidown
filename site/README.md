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

Project-owned code is MIT licensed. Third-party components retain their own licenses; see the repository's third-party notices.
