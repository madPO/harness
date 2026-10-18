# UX Writing Reference

Sources: [Adobe Spectrum — Voice and Tone](https://spectrum.adobe.com/page/voice-and-tone/) · [Writing for Errors](https://spectrum.adobe.com/page/writing-for-errors/) · [Grammar and Mechanics](https://spectrum.adobe.com/page/grammar-and-mechanics/) · [Writing for Onboarding](https://spectrum.adobe.com/page/writing-for-onboarding/)

---

## Voice

Three constant characteristics that define the product's voice:

| Voice | Sub-principle | How it sounds |
|-------|--------------|---------------|
| **Rational** | Clear and understandable | Grammar-informed decisions, avoids trendy/opinionated language |
| **Human** | Friendly, honest, responsible | Varied sentence structure, acknowledges user emotions |
| **Focused** | Concise and simple | Only says what's needed, avoids creating new concepts |

---

## Tone

Tone is a sliding scale — choose based on the moment's emotional context.

| Tone | Character | When to use |
|------|-----------|------------|
| **Motivational** | Positive, encouraging | Onboarding completion, milestones, positive reinforcement |
| **Helpful** | Polite, respectful | Optional guidance, tips, feature discovery |
| **Instructive** | Neutral, direct | **Default** — most UI copy, task flows |
| **Reassuring** | Professional, reliable | Confirmations, security-related actions |
| **Supportive** | Concerned, empathetic | Serious errors, data loss, blocking failures |

Tone is not binary — use the spectrum between adjacent tones when needed.

---

## Core Grammar Rules

### Capitalization
- **Sentence case for ALL UI content** — no exceptions
- Capitalize: first word of a sentence, proper nouns, product names
- ✅ `"Create project"` ❌ `"Create Project"`
- ✅ `"Save changes"` ❌ `"Save Changes"`

### Contractions
Always use contractions — they sound natural and human.

| ✅ Use | ❌ Avoid |
|--------|---------|
| can't | cannot |
| you're | you are |
| isn't | is not |
| aren't | are not |
| didn't | did not |
| doesn't | does not |
| we'll | we will |
| you'll | you will |
| what's | what is |

### Voice
- Active voice always preferred
- ✅ `"Your file couldn't be saved"` ❌ `"The file could not be saved due to an error"`
- ✅ `"Check your connection"` ❌ `"A connection error was detected"`

### Punctuation
- Em dash (—) not double hyphen (--)
- Follow AP style for serial comma and quotation marks
- No period on standalone labels, button copy, or headings

---

## Error Messages

Every error message must answer three questions:

1. **What happened?** → Headline / title
2. **Why did it happen?** → Body (include if known — omit if no useful info)
3. **How to fix it?** → Actionable step

```
Error title:   "File couldn't be uploaded"
Body:          "The file exceeds the 10 MB size limit."
Resolution:    "Compress the file or choose a smaller one, then try again."
```

### Good vs. Bad Error Examples

| ✅ Good | ❌ Bad |
|--------|-------|
| "Your session expired. Sign in again to continue." | "Session error occurred." |
| "The server isn't responding. Try again in a few minutes." | "Error 503." |
| "Enter your admin password to continue. Check for an OS prompt." | "Permission denied." |
| "The installer shut down unexpectedly. Select Retry to restart. (Error code: 305)" | "Installation failed." |

### Error Writing Principles

- **Empathize with the user, not the system** — focus on what they can do next
- **Positive framing** — describe the path forward, not what went wrong
- **Be specific** — catch-all messages are a last resort; prefer case-specific copy
- **Avoid blame** — never phrase the error as "you did X wrong"
- Use **Supportive** tone for severe errors (data loss, security issues)
- Use **Instructive** tone for routine validation errors

---

## Labels and UI Copy

| Element | Rule | Example |
|---------|------|---------|
| Button labels | Verb + noun, sentence case | `"Save changes"`, `"Delete project"` |
| Placeholder text | Hint format, sentence case | `"Enter your email"` |
| Tooltip copy | Brief, sentence case, no period | `"Copy to clipboard"` |
| Section headings | Sentence case | `"Recent activity"` |
| Column headers | Sentence case | `"Last modified"` |
| Confirmation dialogs | Action-first title | `"Delete this project?"` |
| Empty states | Explain why empty + next action | `"No projects yet. Create one to get started."` |

---

## Onboarding Copy

Source: [Adobe Spectrum — Writing for Onboarding](https://spectrum.adobe.com/page/writing-for-onboarding/)

- Lead with value, not feature name
- Show users what they can do, not what the product has
- Use motivational tone — users are optimistic at onboarding
- Keep it short: one key benefit per step
- ✅ `"Connect your team — invite members to collaborate in real time"` ❌ `"Team collaboration feature"`

---

## Paragraph and Text Layout

| Rule | Spec |
|------|------|
| Optimal line width | ~44 characters |
| Minimum line width | 23 characters |
| Alignment | Left (never full-justify) |
| Paragraph separation | Margin between paragraphs (not indentation) |

---

## In-Product Word List

For consistent terminology across the product, refer to [Adobe Spectrum In-Product Word List](https://spectrum.adobe.com/page/in-product-word-list/) for standardized terms. When building a design system, maintain an equivalent word list specific to your product.
