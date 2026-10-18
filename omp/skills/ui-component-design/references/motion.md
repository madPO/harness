# Motion Reference

Source: [Adobe Spectrum — Motion](https://spectrum.adobe.com/page/motion/)

---

## Three Core Principles

| Principle | Meaning |
|-----------|---------|
| **Purposeful** | Every animation has intent: reveals relationships, draws attention, provides feedback |
| **Intuitive** | Mirrors real-world physics (acceleration, gravity) for naturalness |
| **Seamless** | Just enough motion — never distracts or slows the user down |

---

## Easing Functions

| Name | CSS value | Use when |
|------|-----------|----------|
| Ease-out | `cubic-bezier(0, 0, 0.40, 1)` | Element **enters** viewport, fades **in**, appears |
| Ease-in | `cubic-bezier(0.50, 0, 1, 1)` | Element **exits** viewport, fades **out**, disappears |
| Ease-in-out | `cubic-bezier(0.45, 0, 0.40, 1)` | Element **moves** from place to place (position change) |

**Rule:** Ease-out is the most common default for all appearance animations.

---

## Duration Tokens

| Token | Duration | Category |
|-------|----------|----------|
| duration-100 | 130 ms | Micro |
| duration-200 | 160 ms | Micro |
| duration-300 | 190 ms | Micro |
| duration-400 | 220 ms | Micro |
| duration-500 | 250 ms | Macro |
| duration-600 | 300 ms | Macro |
| duration-700 | 350 ms | Macro |
| duration-800 | 400 ms | Macro |
| duration-900 | 450 ms | Macro |
| duration-1000 | 500 ms | Macro |

---

## When to Use Each Duration

| Animation type | Duration range | Examples |
|---------------|---------------|---------|
| **Micro** | 130–220 ms | Color change on hover, toggle, tooltip appear, checkbox check |
| **Macro** | 250–500 ms | Panel/drawer open/close, modal enter/exit, navigation transition |

**Rule:** Never use durations longer than 500 ms for UI animations. Long animations feel sluggish and interrupt workflow.

---

## Effect Types

| Effect | Best for |
|--------|----------|
| Fade in / Fade out | Tooltips, overlays, toasts |
| Slide fade | Panels, drawers, notifications |
| Slide | Carousels, side navigation |
| Fill | Progress bars, loading indicators |
| Color | State changes (hover, active, selected) |
| Expand down | Accordions, dropdowns |
| Scale | Modals, focus zoom effects |
| Scale fade | Popovers, context menus |

---

## Accessibility: Reduced Motion

**Always respect `prefers-reduced-motion`.**

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- Provide instant or cross-fade alternatives to slide/scale animations
- State changes (color, border) can remain — only remove motion-based transforms

---

## Quick Decision Guide

```
Element appearing  → ease-out  + micro (tooltip) or macro (modal)
Element disappearing → ease-in  + micro (tooltip) or macro (modal)
Element repositioning → ease-in-out + macro
Color / border change → no easing needed, micro duration
```
