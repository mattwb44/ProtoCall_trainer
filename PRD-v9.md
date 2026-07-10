# PRD v9 — App Shell, Browse Redesign & Account Page

_2026-07-10 (part 6). Owner requests from live use of v8: lost admin nav icons after
re-login (bug); in-review scenarios polluting the Library; username click should open
a real profile/settings page, not a scenario list; wants top + left-side navigation on
all pages, left-side filters on Community/Library, and a 3-per-row grid of squarer
scenario cards. Also asked what "Library" vs the username page even was — the IA
overlap itself was the bug._

## Decisions
- **Login identity bug**: `/api/login`'s response lacks `role`/`department`; the
  client now re-fetches `/api/me` after login/signup so admin nav items survive.
- **Information architecture**:
  - **Community** (`#/public`) — public scenarios.
  - **Library** (`#/library`) — everything launchable (public + department + own).
    Absorbs "My Scenarios" management: Mine filter shows edit/delete and the
    deleted-restore block. Scenarios with `review_status='pending'` are hidden from
    the Library except under the author's own Mine filter (IN REVIEW chip) — they
    surface for reviewers in `#/review`.
  - **My Sessions** (`#/me`) — session archive only.
  - **Account** (`#/account`, via username in the top bar) — Profile (role, dept,
    display-name edit), Security (change password), Appearance (System/Light/Dark),
    Language (English placeholder).
- **Shell**: persistent top bar (burger, logo, account chip, logout) + left sidebar
  nav on every page; sidebar is an overlay on mobile and hidden entirely on the
  immersive routes (join / solo / host). Review-queue badge lives on the sidebar item.
- **Browse pages**: shared square-card grid (1/2/3 columns responsive), left filter
  rail (desktop) + stacked filter panel (mobile): search, category, subcategory,
  difficulty, objective, plus ownership (All/Mine/Department/Official) on Library.
  Filtering is client-side over the fetched list.
- **Theming**: dark stays the design source of truth. Light mode is a CSS override
  sheet under `html[data-theme=light]` remapping the slate utilities (plus white text
  pinned on saturated buttons). Preference in `localStorage.pcTheme`
  ('system'|'light'|'dark'), 'system' follows `prefers-color-scheme` live.
- **New endpoints**: `PUT /api/me` (display name), `POST /api/me/password`
  (current + new, rate-limited). Tests in `test/account.test.js`.

## Testing
- account.test.js: name change (+ blank/anon rejections); password change requires
  correct current password + 8-char minimum; old password stops working, new works.
- Browser-verified (preview): sidebar + top bar on desktop/mobile, Library grid +
  filters + Mine management, account page, light/dark toggle, contrast fixes.
