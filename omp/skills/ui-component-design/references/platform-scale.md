# Platform Scale Reference

Source: [Adobe Spectrum — Platform Scale](https://spectrum.adobe.com/page/platform-scale/)

---

## Scale Ratio

- Desktop → Mobile: **1 : 1.25**
- Mobile components are **25% larger** than desktop equivalents
- Desktop components are **20% smaller** than mobile equivalents

---

## Property Values by Scale

| Property | Desktop | Mobile |
|----------|---------|--------|
| Base font size | 14 px | 17 px |
| Icon size (workflow) | 18 px | 22 px |
| Default border radius | 4 px | 5 px |
| Min. touch target | — | 48 × 48 px |
| Border width | Same as desktop | Same as desktop |
| Drop shadow | Scales proportionally | Scales proportionally |

---

## Platform → Scale Mapping

| Platform / Context | Scale to use |
|-------------------|-------------|
| Web (viewport > 768 px) | Desktop |
| Web (viewport ≤ 768 px) | Mobile |
| macOS | Desktop |
| iOS | Mobile |
| Android | Mobile |
| Windows UWP Desktop | Desktop |
| Windows UWP Mobile | Mobile |
| Touch-enabled desktop | Both (provide toggle or responsive) |

---

## Hit Areas

Three types of hit areas exist for any interactive component:

| Type | Definition |
|------|-----------|
| **Placement area** | The component's visual bounding box — used for layout and spacing |
| **Cursor hit area** | The interactive target for pointer devices; can match or be smaller than placement area |
| **Touch hit area** | The tappable zone — must be **at least 48 × 48 px** on mobile |

**Critical rule:** The touch hit area must meet 48 × 48 px even if the visual component is smaller. Extend the hit area with padding or a transparent click region.

---

## Responsive Component Rules

1. Always design for both scales — never only desktop or only mobile
2. Use responsive tokens that automatically switch values at the breakpoint
3. Border widths do NOT change between scales
4. When a component is used on a touch-enabled desktop: provide the mobile-scale version for touch interaction targets

---

## Breakpoint Reference

```
≤ 768 px  → Mobile scale
> 768 px  → Desktop scale
```

These are Spectrum defaults. Adapt to the active design system's breakpoint tokens.
