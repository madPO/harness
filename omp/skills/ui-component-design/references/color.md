# Color Reference

Source: [Adobe Spectrum — Using Color](https://spectrum.adobe.com/page/using-color/) · [Color System](https://spectrum.adobe.com/page/color-system/)

---

## Color Token Roles

Adapt these semantic roles to any design system's token naming convention.

### Semantic Color Meanings

| Token role | Meaning | Usage |
|-----------|---------|-------|
| `accent` | Brand/primary action | CTAs, links, selected states, focus rings |
| `informative` | Neutral information | Info banners, tooltips |
| `positive` | Success, completion | Success toasts, valid field state |
| `notice` | Warning, caution | Warning banners, non-critical alerts |
| `negative` | Error, danger | Error states, destructive actions |

### Action and Selection Roles

Do not overload a single accent token. Define these separately when the same hue appears in multiple contexts:

| Token role | Usage | Contrast pair to verify |
|------------|-------|-------------------------|
| `color.action.primary.bg` | Solid primary action fill | `color.text.inverse` on this fill |
| `color.action.primary.fg` | Accent text, icons, and selected labels | Against each supporting surface |
| `color.action.primary.subtle` | Selected-row and quiet callout fill | `color.action.primary.fg` and body text on this fill |
| `color.focus.ring` | Keyboard focus indicator | Adjacent control and page surfaces |

Use one token for multiple roles only after every rendered pair passes contrast in every supported theme.

### Gray Scale Roles (Spectrum defaults — adapt to your token names)

| Gray level | Role |
|-----------|------|
| 50–200 | Background layers |
| 200–300 | Decorative borders, app framing |
| 400 | Field borders (text inputs) |
| 500 | Disabled text and disabled icons (does NOT need to meet contrast) |
| 600 | Control borders, icon default color |
| 700–900 | Text content (body, heading) |
| 600–900 | Icon content (meeting contrast minimums) |

The scale is a starting point, not a contrast guarantee. A semantic border, muted icon, or selected-state token MUST be adjusted when its rendered pair fails the applicable WCAG threshold.

### Color Scale Roles

| Color level | Role |
|------------|------|
| 100 | Light tinted backgrounds (informational chips, tags) |
| 300–600 | Decorative, low-contrast accents — never for conveying information |
| 600–800 | Borders with semantic color |
| 700–1100 | Icon and illustration fills |
| 900 | Colored text (accent and negative only) |
| 900+ (static) | Solid color backgrounds |

---


## Background Layers and App Framing

Background layers establish the application's visual architecture before individual components are styled:

| Layer | Usage |
|-------|-------|
| Base | Pasteboard, unused app space, or outermost application frame — never a component fill |
| Layer 1 | Persistent chrome or a primary app region |
| Layer 2 | Content/elevated regions, panels, or the alternate primary app region |
| Input | Text inputs, compact selectors, and editable controls |

**Rules:**
- Do not use global gray tokens for background layers — use dedicated semantic surface tokens.
- Background colors create dimension and hierarchy; they are NOT arbitrary component backgrounds.
- Choose one app-framing pattern for the product, then apply it consistently. Do not switch Layer 1 and Layer 2 per component to create incidental contrast.
- Use `Input`, action, selected, and status roles for controls; do not repurpose frame layers as control states.
- Use a subtle structural border only where a surface edge needs reinforcement. A required control boundary MUST still reach 3:1 against its adjacent surface.

### App Frame Patterns

**Professional editing apps (Photoshop-style):**
- Option A: Layer 1 = frame/toolbars, Layer 2 = content, Base = pasteboard.
- Option B: Layer 2 = everything (simpler, conforms to platform norms).

**Content-based apps (dashboards, CMS):**
- Layer 2 = header, sidebar, navigation.
- Layer 1 = content regions (cards, galleries).
- No Base within the application viewport.

Use a pure black base only when the product explicitly calls for it. Keep Layer 1, Layer 2, and input surfaces distinct enough to preserve region boundaries without adding gratuitous borders.

---

## Interactive State Colors

- Theme colors shift in contrast for each state
- Light themes → each state gets **darker**
- Dark themes → each state gets **lighter**
- The magnitude of change is consistent per state type

### Theme Mode Rules

- A light, dark, or darkest theme changes **values**, not semantic intent: the same `color.text.primary`, `color.surface.layer-1`, and action roles must exist in every mode.
- Bind production components to semantic names, not primitive values, so theme changes propagate predictably.
- For side-by-side theme reviews, use separate preview namespaces per board. Activating two competing global mode sets produces ambiguous token resolution.
- Never assume a light-mode pairing remains valid in dark mode. Recheck text, icons, selected rows, controls, and borders after every mode-value change.

### Contrast Verification Matrix

Check the resolved, rendered foreground/background pairs; token names alone are not evidence.

| Pair | Minimum |
|------|---------|
| Normal text, labels, helper text | 4.5:1 |
| Large text | 3:1 |
| Essential icons, focus indicators, input boundaries, selected indicators | 3:1 |
| Text or icons on action fills | 4.5:1 for normal text; 3:1 for essential non-text UI |

For each mode, test at least: primary and muted text on every surface; action foreground on its supporting and subtle surfaces; inverse text on action fills; selected labels/icons; and any border needed to identify a control.

---

## Transparency Rules

| Allowed | Not Allowed |
|---------|-------------|
| Background overlays (modal backdrop) | Replacing opaque colors with alpha equivalents |
| Drop shadows | Tinting backgrounds with transparent colors |
| Selection highlight styles | Using transparent colors on non-transparent backgrounds |

**On colored or image backgrounds:** use `transparent-white` tokens on dark, `transparent-black` tokens on light.

---

## Data Visualization Colors

- **Separate color palette** — never reuse UI semantic colors (accent, negative, etc.)
- Data viz colors are designed for categorical distinction, not semantic meaning
- Use sequentially (categorical series) or diverging (value polarity)
- Reference: [Adobe Spectrum — Color for Data Visualization](https://spectrum.adobe.com/page/color-for-data-visualization/)

---

## Key Rules Summary

| Rule | Detail |
|------|--------|
| Never create custom colors | Use only tokens from your design system |
| Never use transparency as color substitute | Opacity only for overlays and shadows |
| Never use color alone | Pair with text label or icon |
| Never use global grays for backgrounds | Use dedicated background layer tokens |
| Never use UI colors in charts | Use the data visualization palette |
| Never modify colors programmatically | No tint/shade functions on design tokens |
| Yellow/orange/cyan/chartreuse on backgrounds | Use with **black** text (not white) |
