# Typography Reference

Source: [Adobe Spectrum — Typography](https://spectrum.adobe.com/page/typography/)

---

## Scale Defaults

| Scale | Base Font Size |
|-------|---------------|
| Desktop | 14 px |
| Mobile | 17 px |

Never use arbitrary pixel values. Always reference a type scale token (e.g., `font-size-100` through `font-size-800+`).

---

## Type Components

| Component | Purpose |
|-----------|---------|
| **Heading** | Page and section titles — defines visual hierarchy levels |
| **Body** | Prose, descriptions, help text |
| **Detail** | Supporting information, metadata, secondary labels |
| **Code** | Source code, commands, technical strings |

---

## Line Heights

| Context | Line Height |
|---------|-------------|
| Heading | 1.3× |
| Detail / compact labels | 1.3× |
| Body text | 1.5× |
| Code | 1.5× |
| Component-level text | 1.3× |

**CJK scripts (Chinese, Japanese, Korean):** always use 1.5× regardless of context.

---

## Text Formatting Rules

| Format | Allowed use | Not allowed |
|--------|------------|-------------|
| **Bold** | Emphasis within sentences, button labels, CTAs | Decorative use without semantic meaning |
| *Italic* | Placeholder/ghost text, image captions ONLY | General emphasis, titles |
| Underline | Text links only (hover and default) | Any emphasis other than links |
| Strong | Semantic weight/importance | Decorative purposes |
| Emphasis | Semantic stress | Section headers |

---

## Paragraph and Layout Rules

| Rule | Spec |
|------|------|
| Optimal line width | ~44 characters |
| Minimum line width | 23 characters |
| Maximum line width | Constrained — never unconstrained full-width prose |
| Alignment | Left-aligned always |
| Justification | Never full-justification |
| Indentation | Never — use margin between paragraphs |
| Paragraph spacing | Use margin (not indentation) to separate paragraphs |

---

## Capitalization

- **Sentence case for ALL UI content**
- Only capitalize first word of a sentence and proper nouns

```
✅  "Create project"
✅  "Save changes"
✅  "Sign in with Google"
❌  "Create Project"
❌  "Save Changes"
```

---

## Numeric Data

- Use **tabular numbers** (`font-feature-settings: "tnum"`) in tables and data displays
- Numbers in tables: **right-aligned**

---

## Heading Semantics vs. Visual Appearance

Heading HTML level (h1–h6) can differ from visual size:
- Use semantic levels for document structure and screen readers
- Use visual size tokens independently for appearance
- Example: an h2 can visually render at the h4 size when needed for hierarchy

---

## Spectrum Typefaces (Reference Only)

| Typeface | Usage |
|----------|-------|
| Adobe Clean | Primary sans-serif |
| Adobe Clean Serif | Serif variant |
| Adobe Clean Han | CJK scripts |
| Source Code Pro | Monospace / code |

Adapt these to the active design system's font stack. The principles (scale, weight, line height) apply universally.
