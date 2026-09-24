# UI overrides and markup changes

The visual design is frozen (see the build prompt, §0.1). This file lists
every place where v2 touches existing markup or overrides an existing CSS
rule, plus every mask or `compareHeight` used by the visual-regression suite.

## CSS overrides (`public/css/trainsync-ext.css`)

None yet. `trainsync-ext.css` only defines `--ts-*` design tokens so far.

## Non-visual markup changes to existing pages (Phase 1)

These changes don't alter rendering. The visual suite shows 0 diffs at 1440×900
and 390×844.

| Page | Change | Why |
|---|---|---|
| all 8 existing pages | Inline `<script>` blocks moved to `public/js/<page>.js`, loaded with `common.js` before `</body>` | Helmet CSP (`script-src 'self'`) blocks inline script; shared `escapeHTML`/`api()` helpers |
| all 8 existing pages | `<link rel="stylesheet" href="css/trainsync-ext.css">` added after the page stylesheet | Single extension stylesheet |
| `trainermatch.html` | `onclick="nextTrainer()"` / `onclick="matchTrainer()"` removed from `#reject` / `#match`; handlers bound in `js/trainermatch.js` | CSP `script-src-attr 'none'` blocks inline handlers |
| `registration.html` | `#role` gets `list="role-options" autocomplete="off"` + `<datalist>` (trainer, trainee) | Suggestions; the input stays a text box |
| `workoutplans.html`, `dietplans.html` | `#currentType` / `#goalType` get `list=… autocomplete="off"` + `<datalist>`s | Suggestions; values are also normalised server-side |

## Behaviour changes that keep the look

- `homepage1.html` sends logged-out visitors to `login.html`. The user menu still
  starts open, as in the original, and ☰ now toggles it.
- `login.html` no longer shows the `alert("Login successful!")` pop-up before
  redirecting.
- Plan and gym cards skip fields that are empty (e.g. `Description`) instead of
  printing `undefined`.

## New pages

- `updateprofile.html` is a clone of `registration.html`, using the same
  `.Registration` box and `registration.css`. Trainee and trainer field groups
  are toggled with the `hidden` attribute.

## Visual-regression masks / compareHeight

None. Every baseline is compared over its full page.
