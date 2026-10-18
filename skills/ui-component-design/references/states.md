# Interactive States Reference

Source: [Adobe Spectrum — States](https://spectrum.adobe.com/page/states/)

---

## State Categories

| Category | Triggered by |
|----------|-------------|
| **User-initiated** | User action: hover, keyboard navigation, press |
| **Component option** | Set by designer/developer: disabled, selected, error, dragged |

---

## All States

### Default
- Resting state — no interaction
- Must convey full component identity (affordance, label, type)

### Hover
- Trigger: cursor moves over interactive element
- Visual: subtle background or color shift (1 step darker in light theme)
- Do not change size, layout, or position
- Do not show hover state on touch devices

### Active (Down)
- Trigger: mouse/touch pressed and held
- Visual: pressed/depressed feedback — stronger color shift than hover
- Duration: only while press is held

### Keyboard Focus
- Trigger: Tab navigation reaches the element
- Visual: **2 px focus ring**, high-contrast color (accent or white/black depending on theme)
- The focus ring must be visible on all backgrounds
- Do not remove or suppress focus rings (critical for accessibility)
- Focus ring sits outside the component boundary (not clipped)

### Disabled
- Trigger: developer sets `disabled` attribute or state
- Visual: reduced contrast (gray-500 for text and icons — below contrast minimums intentionally)
- No hover, active, or focus states
- Maintains layout space — disabled components do not collapse
- Signals that the action may become available later
- Do not use disabled for permanently unavailable features — hide them instead
- Do not add tooltip to disabled element without special handling (focus not reachable)

### Selected
- Trigger: user chose this option (checkbox, radio, tab, toggle)
- Visual: clear selected indicator — accent color, checkmark, fill, or background
- Must be distinguishable from default in more than one dimension (not color alone)

### Dragged
- Trigger: user presses and begins moving an item
- Visual: elevated appearance (shadow), reduced opacity on origin slot
- Drag handle cursor (`grab` → `grabbing`)

### Error
- Trigger: invalid user input or system error
- Visual: negative/error semantic color on border and icon; error message below or beside component
- **Error alone is NOT enough** — always pair with a written error message
- Error state blocks progression when input is required and invalid
- See `writing.md` for error message copy rules

### Loading
- Trigger: async operation in progress (data fetch, submit, file upload)
- Visual: spinner or skeleton state; interactive elements disabled during load
- Provide feedback within 1 second of action initiation
- For long operations (>3 seconds), provide progress indication

---

## State Hierarchy

States can stack. Priority order when multiple states apply:

```
Disabled > Error > Loading > Selected > Focus > Active > Hover > Default
```

Example: a disabled input with an error value — shows disabled visuals, not error.

---

## Quick Implementation Checklist

For every interactive component, verify:

- [ ] Default renders correctly with no state modifier
- [ ] Hover has subtle visual feedback (non-touch only)
- [ ] Active/pressed has distinct from-hover feedback
- [ ] Focus ring is visible, 2 px, not clipped
- [ ] Disabled state uses reduced contrast, no interaction
- [ ] Error state has both visual indicator AND written message
- [ ] Selected state is unambiguous (multi-dimensional, not color alone)
- [ ] Loading state disables interaction

---

## CSS State Pseudo-class Mapping

| State | CSS / HTML |
|-------|-----------|
| Hover | `:hover` |
| Active | `:active` |
| Focus | `:focus-visible` (prefer over `:focus`) |
| Disabled | `[disabled]`, `:disabled` |
| Selected (radio/checkbox) | `:checked` |
| Selected (custom) | `aria-selected="true"`, `aria-pressed="true"` |
| Error | `aria-invalid="true"` |
| Loading | `aria-busy="true"` |
