# Object Styles Reference

Source: [Adobe Spectrum — Object Styles](https://spectrum.adobe.com/page/object-styles/)

Every object style carries semantic meaning. Shape and depth cues tell users how a component behaves and how interactive it is.

---

## Border Radius

| Variant | Desktop | Mobile | Use for |
|---------|---------|--------|---------|
| **Default** | 4 px | 5 px | Most components: buttons (non-CTA), text fields, dropdowns, chips, popovers, cards |
| **Small** | 2 px | 2 px | Compact / nested elements: checkbox inner, tight container corners |
| **Full (pill)** | 50% | 50% | CTA / primary action buttons, badges — use sparingly |
| **None** | 0 | 0 | Tooltip arrow tip — exception only |

**Rules:**
- Almost all components are rounded
- Pill radius draws attention — use only for high-importance primary actions
- Never mix radius variants in the same component family without design intent

---

## Border Widths

Border width is **scale-invariant** — the same on desktop and mobile.

| Width | Use for |
|-------|---------|
| 1 px | Decorative borders, popovers, tags, dividers (small), table cell borders |
| 2 px | Interactive component borders (buttons), focus rings, tabs, sliders, medium dividers |
| 4 px | Large dividers only |

---

## Shadows / Elevation

Shadows are **reserved for elevated and transient surfaces** — they are not applied broadly.

| Usage | Shadow |
|-------|--------|
| Modals, dialogs | Yes — highest elevation |
| Dropdowns, menus, popovers | Yes — mid elevation |
| Tooltips | Yes — low elevation |
| Cards (default) | No — use background color change for separation |
| Buttons | No — use border/color states |

**Shadow behavior across themes:**
- Shadow opacity increases on dark/darkest themes to maintain perceived depth
- Shadow dimensions scale proportionally between desktop and mobile

**Alternatives to shadow for separation:**
- Contrasting background layer colors (background layer 1 vs. 2)
- Stark color change (filled vs. unfilled regions)
- Background overlay (for modal backdrops)

---

## Summary: Choosing Styles

| Component | Radius | Border | Shadow |
|-----------|--------|--------|--------|
| Text input | Default (4/5 px) | 1 px | No |
| Dropdown / select | Default (4/5 px) | 1 px | No |
| Button (default) | Default (4/5 px) | 2 px | No |
| Button (CTA/primary) | Pill (50%) | None or 2 px | No |
| Checkbox | Small (2 px) | 2 px | No |
| Card | Default (4/5 px) | 1 px | No (use bg color) |
| Modal / dialog | Default (4/5 px) | No | Yes |
| Dropdown menu | Default (4/5 px) | 1 px | Yes |
| Tooltip | Default (4/5 px) | No | Yes |
| Chip / badge | Pill (50%) or Default | 1 px | No |
| Tab | None | 2 px bottom | No |
