# Iconography Reference

Sources: [Adobe Spectrum — Iconography](https://spectrum.adobe.com/page/iconography/) · [Heroicons](https://heroicons.com/)

---

## Icon Sizing Principles (Design System-Agnostic)

| Context | Target Size | Notes |
|---------|-------------|-------|
| Dense / inline / badge | 16 px | Inside chips, tags, table cells, compact buttons |
| Inline with body text | 20 px | Beside paragraph text, form labels |
| Navigation / standalone | 24 px | Menu items, action bars, primary icon buttons |
| Large / decorative | 32–48 px | Empty states, illustrations, marketing UI |

Mobile contexts: add 25% — e.g., 24 px desktop → 30 px mobile equivalent. Prefer discrete design system sizes over fractional values.

---

## Heroicons: Variant Selection

| Variant | Size | Style | Best for |
|---------|------|-------|---------|
| `micro` | 16 × 16 px | Filled | Badges, tags, dense tables, chips |
| `mini` | 20 × 20 px | Filled | Inline with text, compact button labels |
| `outline` | 24 × 24 px | 1.5 px stroke | Navigation, standalone icons, default neutral state |
| `solid` | 24 × 24 px | Filled | Active/selected state, high-emphasis actions |

### Variant Decision Tree

```
Is the icon inside a badge, tag, or dense chip?
  → micro (16 px)

Is the icon inline with body text or inside a small button?
  → mini (20 px)

Is the component in a selected, active, or toggled-on state?
  → solid (24 px)

All other cases (navigation, action bar, standalone)?
  → outline (24 px)
```

---

## Heroicons Full Icon Reference

All variants include the same icon set. Browse at [heroicons.com](https://heroicons.com/).

### Navigation & Layout
`bars-3` · `bars-3-center-left` · `bars-3-bottom-left` · `bars-3-bottom-right` · `bars-4` · `home` · `home-modern` · `view-columns` · `square-2-stack` · `square-3-stack-3d` · `rectangle-stack` · `rectangle-group`

### Arrows & Direction
`arrow-up` · `arrow-down` · `arrow-left` · `arrow-right` · `arrow-up-right` · `arrow-down-left` · `arrow-long-up` · `arrow-long-down` · `arrow-long-left` · `arrow-long-right` · `arrow-path` (refresh) · `arrow-top-right-on-square` (external link) · `arrow-uturn-left` · `arrow-uturn-right` · `chevron-up` · `chevron-down` · `chevron-left` · `chevron-right` · `chevron-up-down` · `chevron-double-up` · `chevron-double-down` · `chevron-double-left` · `chevron-double-right` · `arrows-pointing-in` · `arrows-pointing-out` · `arrows-right-left` · `arrows-up-down`

### Feedback & Status
`check` · `check-circle` · `check-badge` · `x-mark` · `x-circle` · `exclamation-circle` · `exclamation-triangle` · `information-circle` · `question-mark-circle` · `no-symbol` · `shield-check` · `shield-exclamation`

### Actions
`plus` · `plus-circle` · `minus` · `minus-circle` · `pencil` · `pencil-square` · `trash` · `clipboard` · `clipboard-document` · `clipboard-document-check` · `clipboard-document-list` · `document-duplicate` · `share` · `eye` · `eye-slash` · `magnifying-glass` · `magnifying-glass-plus` · `magnifying-glass-minus` · `magnifying-glass-circle` · `funnel` · `bars-arrow-down` · `bars-arrow-up`

### Files & Documents
`document` · `document-text` · `document-check` · `document-plus` · `document-minus` · `document-arrow-up` · `document-arrow-down` · `document-magnifying-glass` · `document-chart-bar` · `folder` · `folder-open` · `folder-plus` · `folder-minus`

### Communication
`envelope` · `envelope-open` · `bell` · `bell-alert` · `bell-slash` · `bell-snooze` · `chat-bubble-left` · `chat-bubble-left-right` · `chat-bubble-left-ellipsis` · `megaphone` · `paper-airplane` · `phone` · `microphone`

### User & Identity
`user` · `user-circle` · `user-group` · `user-plus` · `user-minus` · `users` · `identification` · `finger-print`

### Data & Charts
`chart-bar` · `chart-pie` · `chart-bar-square` · `presentation-chart-bar` · `presentation-chart-line` · `table-cells` · `queue-list`

### Settings & System
`cog-6-tooth` · `cog-8-tooth` · `cog` · `wrench` · `wrench-screwdriver` · `adjustments-horizontal` · `adjustments-vertical` · `sliders-horizontal` (use `adjustments-horizontal`) · `command-line` · `code-bracket` · `code-bracket-square` · `cpu-chip` · `server` · `server-stack`

### UI Controls
`ellipsis-horizontal` · `ellipsis-vertical` · `ellipsis-horizontal-circle` · `lock-closed` · `lock-open` · `key` · `link` · `link-slash` · `tag` · `bookmark` · `bookmark-square` · `star` · `heart` · `flag`

### Media
`play` · `play-circle` · `pause` · `pause-circle` · `stop` · `stop-circle` · `forward` · `backward` · `play-pause` · `film` · `video-camera` · `video-camera-slash` · `photo` · `camera` · `speaker-wave` · `speaker-x-mark` · `musical-note`

### Time & Calendar
`clock` · `calendar` · `calendar-days` · `calendar-date-range`

### Commerce & Finance
`credit-card` · `banknotes` · `wallet` · `shopping-cart` · `shopping-bag` · `receipt-refund` · `receipt-percent` · `currency-dollar` · `currency-euro` · `currency-pound` · `currency-yen`

### Misc
`globe-alt` · `globe-americas` · `globe-europe-africa` · `globe-asia-australia` · `map` · `map-pin` · `sparkles` · `fire` · `light-bulb` · `rocket-launch` · `trophy` · `gift` · `sun` · `moon` · `wifi` · `signal` · `signal-slash` · `rss` · `qr-code` · `printer` · `trash` · `swatch` · `paint-brush` · `eye-dropper`

---

## Usage Rules

### Pairing Icons with Text
- Always pair icons with text labels when the action is critical or ambiguous
- Exception: universally understood icons (close ×, search, back) in appropriate context
- Tooltips on icon-only buttons are required for keyboard/screen reader users

### Alignment
- Align icon optical center with the text **cap-height**, not the bounding box center
- Icons placed before text: 4–8 px gap (use spacing tokens)
- Icons placed after text: same gap, use for trailing indicators (chevron, external link)

### Accessibility
```html
<!-- Decorative icon (label exists in text) -->
<svg aria-hidden="true" ...>...</svg>

<!-- Semantic icon (icon is the only label) -->
<button aria-label="Delete item">
  <svg aria-hidden="true" ...>...</svg>
</button>

<!-- Icon with status meaning -->
<span role="img" aria-label="Error">
  <svg ...>...</svg>
</span>
```

### What Not to Do
- Do not scale icons arbitrarily between variants — each variant has designed stroke weights
- Do not use different variants of the same icon interchangeably for the same meaning
- Do not use text letters in icons (except standardized formatting: B, I, U)
- Do not reuse the same icon for two different concepts in the same product
- Do not place colored icons on colored backgrounds without contrast verification
