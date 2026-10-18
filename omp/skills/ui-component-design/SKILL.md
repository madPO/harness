---
name: ui-component-design
description: Use when designing, reviewing, or building UI components. Provides design system-agnostic principles for color, typography, spacing, motion, interactive states, iconography, and UX writing — distilled from Adobe Spectrum and industry best practices. Includes guidance for finding and applying Heroicons at the correct size and variant. Load when asked to design a component, create a UI, review a design, write UI copy, choose icons, or apply a design system.
metadata:
  author: madPO <social@madpo.me>
  version: '1.1'
  sources: >
    Adobe Spectrum (spectrum.adobe.com), including Using Color, Color Fundamentals,
    Color Palette, and app-framing guidance; Heroicons (heroicons.com)
---

# UI Component Design Skill

## When to Use This Skill

Load this skill when:

- Designing or building UI components (buttons, forms, modals, navigation, cards, tables, etc.)
- Reviewing a design or component for consistency and accessibility
- Choosing and applying icons from Heroicons
- Writing UI copy: labels, error messages, tooltips, onboarding text
- Adapting design system principles to any framework or token system

This skill is **design system-agnostic**. All principles apply universally. Adobe Spectrum values are provided as concrete reference defaults — adapt them to the active design system's tokens when available.

---

## Workflow

1. **Identify the frame before the component** — identify the app canvas, chrome, content layers, component type, context, and platform
2. **Load the relevant reference file** based on what the task requires (see References below)
3. **Assign semantic surface roles** — establish base, frame, elevated/content, and input surfaces before styling controls
4. **Apply design tokens** from the active design system; fall back to Spectrum defaults when none exist
5. **Choose icons** using the Heroicons lookup workflow (see Iconography section)
6. **Verify states and accessibility** — every interactive component must handle all required states and meet contrast in every supported theme
7. **Review UX copy** — labels, errors, and helper text must follow the Writing section rules

---

## References

Load these reference files when working on the relevant topic. They contain full lookup tables and extended rules.

| File | Load when... |
|------|-------------|
| `references/color.md` | Working with app framing, color tokens, backgrounds, semantic meaning, data viz |
| `references/typography.md` | Setting font sizes, weights, line heights, text hierarchy |
| `references/object-styles.md` | Choosing border radius, borders, shadows, elevation |
| `references/motion.md` | Adding transitions or animations to components |
| `references/states.md` | Implementing interactive states (hover, focus, disabled, error, etc.) |
| `references/iconography.md` | Choosing, sizing, and placing icons |
| `references/platform-scale.md` | Sizing for desktop vs. mobile, touch targets |
| `references/writing.md` | UI copy, error messages, voice, tone, grammar |

---

## Core Principles (Always Apply)

### 1. Design Token First

Never hard-code raw values in components. Always reference the design system's token layer:

- Colors → semantic tokens (`color.action.primary`, `color.feedback.error`, etc.)
- Spacing → spacing scale tokens (`space.2`, `space.4`)
- Typography → type scale tokens (`font.size.md`, `font.weight.bold`)
- Motion → duration and easing tokens
- Radius → radius tokens (`radius.sm`, `radius.full`)

When a design system token doesn't exist: use the Spectrum defaults from the reference files as concrete fallbacks.

### 2. Accessibility Is Not Optional

Every component must meet these non-negotiable requirements:

- **Color contrast**: text on background ≥ 4.5:1 (normal text), ≥ 3:1 (large text / UI components)
- **Actual pairs, not token names**: test each resolved foreground/background pair in every theme, including selected states, muted icons, borders needed to identify controls, and text on action fills
- **Action colors need separate roles**: do not reuse one action token for action backgrounds, colored text, and on-action content unless every pairing passes; define separate semantic roles when needed
- **Never use color alone** to communicate meaning — always pair with text, icon, or pattern
- **Keyboard navigability**: all interactive elements must be reachable and operable via keyboard
- **Focus ring**: always visible on keyboard focus — minimum 2 px ring, high contrast
- **Touch targets**: minimum 48 × 48 px on mobile/touch interfaces
- **ARIA**: provide `aria-label`, `aria-describedby`, or `role` where native semantics are insufficient

### 3. Semantic States

Every interactive component must explicitly handle all applicable states:

| State | Trigger | Required Visual Change |
|-------|---------|------------------------|
| Default | Resting | Base appearance |
| Hover | Cursor over element | Subtle background/color shift |
| Active (Down) | Press/click in progress | Pressed visual feedback |
| Keyboard Focus | Tab navigation | Visible focus ring (2 px) |
| Disabled | Not interactive | Reduced opacity/contrast, no pointer |
| Selected | User chose this option | Clear selected indicator |
| Error | Invalid input or system failure | Error color + error message |
| Loading | Async operation pending | Spinner or skeleton, disabled interaction |

See `references/states.md` for full rules per state.

### 4. Responsive Scale

Design components for two scales simultaneously:

| Property | Desktop | Mobile |
|----------|---------|--------|
| Base font | 14 px | 17 px |
| Icon size | 18 px | 22 px |
| Border radius | 4 px | 5 px |
| Min touch target | — | 48 × 48 px |
| Scale multiplier | 1× | 1.25× |

Components on mobile are 25% larger than their desktop counterparts. Never manually adjust individual values — scale them consistently using the design system's scale tokens.

### 5. App Framing and Theme Verification

Establish large surfaces before component color. Use the active system's semantic equivalents of:

| Role | Use | Never use for |
|------|-----|---------------|
| Base/canvas | Pasteboard, unused app space, outermost frame | Cards, inputs, buttons |
| Layer 1 | Persistent chrome or a primary content region | Arbitrary component fills |
| Layer 2 | Content/elevated surfaces and panels | A substitute for semantic control states |
| Input | Editable or compact interactive surfaces | General app framing |

- Create hierarchy through these large surface layers first. Borders are secondary cues, not the primary layout system.
- Apply only the system's subtle-border token to structural edges. If a border is necessary to identify a control, it still must meet the applicable 3:1 non-text contrast threshold.
- Keep light, dark, and darkest palettes role-equivalent. Change semantic token values per mode; never carry a light-mode literal into a dark mode by default.
- Theme switching requires semantic-token bindings. For simultaneous side-by-side theme studies, use a clearly namespaced preview palette per board rather than activating competing global mode sets.

---


## Color (Summary)

Full rules in `references/color.md`.

- **Use semantic tokens**: `accent`, `informative`, `positive`, `notice`, `negative` map to user-facing meaning
- **Backgrounds create hierarchy**: use background layers to separate app chrome from content
- **Never use custom/ad-hoc colors** — always pick from the design system's defined palette
- **Never use transparency as a color substitute** — opacity is only acceptable for overlays, shadows, and selection highlights
- **Pair color with text or icons** — never rely on color alone for meaning
- **Data visualization uses a dedicated color palette** — do not reuse UI semantic colors for charts

---

## Typography (Summary)

Full rules in `references/typography.md`.

- **Use the type scale** — never arbitrary pixel values
- **Sentence case everywhere** — `"Create project"`, not `"Create Project"`
- **Optimal line width**: ~44 characters per line; never under 23 or unconstrained
- **Line height**: 1.3× for headings and compact labels; 1.5× for body and code
- **Bold**: for emphasis and CTAs | **Italic**: only placeholder/caption text | **Underline**: only links
- **Tabular numbers** for data tables (right-aligned)
- **No full-justification** — use left-aligned text

---

## Object Styles (Summary)

Full rules in `references/object-styles.md`.

- **Default border radius**: 4 px desktop / 5 px mobile — applies to most interactive components
- **Small radius** (2 px): for checkbox and compact elements
- **Pill radius** (50%): CTA/primary buttons only — use sparingly to avoid visual noise
- **Border widths**: 1 px decorative, 2 px interactive/focus, 4 px large dividers
- **Shadows** are reserved for elevated/transient surfaces (modals, dropdowns, tooltips) — not for general components

---

## Motion (Summary)

Full rules in `references/motion.md`.

Motion must be **purposeful, intuitive, and seamless**.

| Easing | Use when |
|--------|----------|
| Ease-out `cubic-bezier(0,0,0.40,1)` | Element enters view / fades in |
| Ease-in `cubic-bezier(0.50,0,1,1)` | Element exits / fades out |
| Ease-in-out `cubic-bezier(0.45,0,0.40,1)` | Element moves from place to place |

| Duration range | Type |
|---------------|------|
| 130–220 ms | Micro (hover, color change, tooltip) |
| 250–500 ms | Macro (panel reveal, drawer, large movement) |

- **Respect `prefers-reduced-motion`** — always provide a no-motion fallback
- Motion must never slow the user down or block interaction

---

## Iconography and Heroicons

Full rules in `references/iconography.md`.

### Heroicons Overview

Heroicons ([heroicons.com](https://heroicons.com)) provides four variants:

| Variant | Size | Stroke | Use when |
|---------|------|--------|----------|
| `outline` | 24 × 24 px | 1.5 px | Default — body content, navigation, standalone icons |
| `solid` | 24 × 24 px | Filled | Selected state, active indicator, high-emphasis |
| `mini` | 20 × 20 px | Filled | Inline with text (paragraph, button labels), compact UI |
| `micro` | 16 × 16 px | Filled | Badges, tags, dense tables, small chips |

### Choosing the Right Variant

```
Icon near 16–18 px text     → micro  (16 px)
Icon inline with body text  → mini   (20 px)
Icon standalone or in nav   → outline (24 px)
Icon in selected/active UI  → solid  (24 px)
```

### Usage Rules

1. **Match icon size to context density** — use micro in dense UIs, outline for standalone or navigational icons
2. **Pair icons with labels** when the meaning may be ambiguous — never rely on icon alone for critical actions
3. **Align icon optical center** with text baseline, not the bounding box center
4. **One meaning per icon** — do not reuse the same icon for two different concepts in the same product
5. **Use `aria-hidden="true"`** when the icon is decorative (label exists) — use `aria-label` when icon is the only label
6. **Do not change stroke width** — each variant's stroke is part of its designed weight; scaling breaks this
7. **Respect the fill semantics**: outline = neutral/inactive, solid = filled/active/selected

### Finding Icons

When choosing an icon:
1. Think of the concept's metaphor (not the literal word)
2. Check these common mappings first:

| Action / Concept | Heroicon name |
|-----------------|---------------|
| Settings / Config | `cog-6-tooth`, `adjustments-horizontal` |
| Search | `magnifying-glass` |
| Add / Create | `plus`, `plus-circle` |
| Delete / Remove | `trash`, `minus`, `x-mark` |
| Edit | `pencil`, `pencil-square` |
| Close / Dismiss | `x-mark`, `x-circle` |
| Success / Done | `check`, `check-circle`, `check-badge` |
| Warning | `exclamation-triangle` |
| Error | `exclamation-circle` |
| Info | `information-circle` |
| Navigation (menu) | `bars-3` |
| Back | `arrow-left`, `chevron-left` |
| Forward | `arrow-right`, `chevron-right` |
| Download | `arrow-down-tray` |
| Upload | `arrow-up-tray` |
| External link | `arrow-top-right-on-square` |
| User / Account | `user`, `user-circle` |
| Notification | `bell` |
| Email | `envelope` |
| Lock / Security | `lock-closed`, `shield-check` |
| Copy | `clipboard`, `clipboard-document` |
| Share | `share` |
| Filter | `funnel` |
| Sort | `bars-arrow-down`, `bars-arrow-up` |
| Calendar | `calendar`, `calendar-days` |
| Chart | `chart-bar`, `chart-pie` |
| Refresh | `arrow-path` |
| Eye / Preview | `eye` |
| Code | `code-bracket`, `command-line` |
| Star / Favorite | `star` |
| Tag / Label | `tag` |
| Folder | `folder`, `folder-open` |
| Document | `document`, `document-text` |
| Home | `home` |
| Globe / Web | `globe-alt` |
| Link | `link`, `link-slash` |
| Drag handle | `bars-2` |
| Collapse all | `arrows-pointing-in` |
| Expand all | `arrows-pointing-out` |

3. If no exact match: choose the closest metaphor — prefer conceptual clarity over literal accuracy
4. Browse the full icon list at [heroicons.com](https://heroicons.com) when needed

---

## UX Writing (Summary)

Full rules in `references/writing.md`.

### Voice

- **Rational** — clear, grammar-correct, not trendy
- **Human** — friendly, honest, varied sentence structure
- **Focused** — concise; only describe what is needed

### Tone

Use **Instructive** (neutral, direct) as the default. Shift toward:
- Motivational for positive moments (onboarding success, completion)
- Supportive for serious errors or blocking problems

### Copy Rules

- Sentence case everywhere: `"Save changes"`, not `"Save Changes"`
- Use contractions: `"can't"`, `"you're"`, `"isn't"`
- Active voice: `"Your file couldn't be saved"` not `"An error occurred while saving"`
- Avoid passive voice in errors
- ~44 characters per line for paragraph text

### Error Messages

Every error must answer three questions:
1. **What happened?** — the headline
2. **Why did it happen?** — body (if known)
3. **How to fix it?** — actionable instruction

```
✅ "File upload failed
    The file exceeds the 10 MB limit.
    Try compressing the file or choose a smaller one."

❌ "An error occurred."
```

---

## Component Design Checklist

Use this checklist before finalizing any component:

### Structure
- [ ] All values reference design tokens (no hard-coded pixels/colors)
- [ ] Component handles both desktop and mobile scale
- [ ] Correct border radius variant used for component type
- [ ] Shadows only on elevated/transient components

### Color & Typography
- [ ] Color contrast ≥ 4.5:1 for text
- [ ] Color not used as the sole means of communication
- [ ] Sentence case on all labels
- [ ] Correct font size token used for context

### States
- [ ] Default state defined
- [ ] Hover state defined
- [ ] Active / pressed state defined
- [ ] Keyboard focus state with visible ring
- [ ] Disabled state (reduced contrast, no interaction)
- [ ] Error state with error message (if input component)
- [ ] Loading state (if async)

### Icons
- [ ] Correct Heroicons variant for the size context
- [ ] Icon paired with label if meaning is ambiguous
- [ ] `aria-hidden="true"` on decorative icons
- [ ] `aria-label` on icon-only interactive elements

### Accessibility
- [ ] All interactive elements keyboard-accessible
- [ ] Touch targets ≥ 48 × 48 px on mobile
- [ ] ARIA attributes where native semantics are insufficient
- [ ] Motion respects `prefers-reduced-motion`

### Writing
- [ ] Labels are clear, sentence case, no title case
- [ ] Error messages explain what, why, and how to fix
- [ ] Contractions used for natural conversational tone
- [ ] No passive voice in errors or instructions
