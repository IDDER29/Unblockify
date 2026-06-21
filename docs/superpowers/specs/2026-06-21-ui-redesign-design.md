# Unblockify UI/UX Redesign — Design Doc

Date: 2026-06-21

## Goal
A clean, modern SaaS visual + UX overhaul of all three pages (login/sign-up, student
dashboard, admin dashboard). **No architecture change**: stays plain HTML/CSS/vanilla JS
with `localStorage`. **No behavior change**: every selector and `data-id` the scripts in
`functions/*.js` query is preserved. The `functions/*.js` files are NOT edited.

## Hard constraint — preserved JS hooks
Cards on both dashboards are generated *inside* the JS (`addBlockagesInfoCards`,
admin render loop), so they are styled via CSS only. Selectors that must remain intact:
`.userName`, `.add_btn`, `.add_new_blockage`, `.edit_blockage`, `#details_model`,
`.modal-content`, `.modal_Verefied`, `#myModal`, `.table_body`, `.blockage-detail`,
`.btn`, `.details_btn`, `.status_btn`, `.Delete`, `.edit-btn`, `.Edit`, `.buttons`,
`.status_date`, `.status_info`, `.blockage-date`, `.blockage-date-complet`,
`.close-modal`, `.logOut`, `#supportForm`, `.formator`/`.name`/`.bootcamp`/`.Brief`/
`.BlockageTitle`/`.blockageDiscription`, form field ids (`#title`,`#admin`,`#bootcamp`,
`#Brief`,`#problem`,`#problemDetails`, `#name`,`#email`,`#password`,`#confirm-password`,
`#login-form-btn`, `#selectedMethod`, `#adminNotes`). Inline styles set by
`updateStutusButtons()` (green status / tinted action buttons on resolved blockages) win
over CSS by design — the resolved = green language is intentional.

## Design system (tokens in `stylesheet.main.css`, loaded by every page)
- Font: **Plus Jakarta Sans** (replaces the Inter/Roboto/Nunito/Playfair/Press-Start mix).
- Primary `#4F46E5` indigo; ink `#0F172A`/`#475569`; canvas `#F8FAFC`; surface `#FFFFFF`;
  border `#E2E8F0`; success `#16A34A`; warning `#D97706`; danger `#DC2626`.
- Radius 8/12/16; sm card + md modal shadows; 4/8px spacing; 150–200ms ease-out
  transitions; `prefers-reduced-motion` honored; visible focus rings; 4.5:1+ contrast.

## Per page
- **Login / Sign-up** — two-column: form card + branded gradient panel replacing the empty
  `.hero-section`. Visible labels, focus rings, styled inline field errors (JS injects a
  `<p>` after the input; CSS styles it), disabled/hover button states. One column < 768px.
- **Student dashboard** — sticky top bar (logo, "Welcome {name}", icon actions incl.
  `.logOut`), toolbar with the `+` `.add_btn` as a real primary button, blockage cards as a
  responsive grid with status pill (pending amber / resolved green via existing `isVerfied`
  styling), de-emphasized fake "5 days ago", duplicate Details button hidden via CSS, real
  icon action buttons ≥44px, empty `.table_body` shows a styled placeholder via CSS.
  Modals become centered dialog cards with scrim + scale-in; forms restyled.
- **Admin dashboard** — same shell + cards; resolve flow (`#supportForm` radios + note)
  restyled inside the modal; verified-details modal (`#myModal`) restyled.

## Files touched
`stylesheet.main.css` (rewritten: tokens + base + shared header + auth pages),
`dashboard.css` (rewritten: dashboard shell, cards, modals, forms),
`desktop.css`/`tablet.css` (folded into main; left as minimal),
`index.html`, `singUp.html`, `student_dashbord.html`, `admin_dashbord.html`
(head/font swap + structural wrappers/classes for styling; JS hooks untouched).
`functions/*.js` — untouched.
