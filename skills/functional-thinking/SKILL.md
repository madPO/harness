---
name: functional-thinking
description: Teach functional programming thinking and principles when writing or reviewing code. Load when the user asks to write code in a functional style, refactor code to be more functional, review code for side effects and purity, design immutable data structures, use higher-order functions, or apply layered architecture. Language-agnostic — principles apply to any language. Covers actions/calculations/data distinction, immutability, first-class functions, functional iteration, timeline analysis for async code, and reactive/layered architecture patterns.
metadata:
  author: distilled from Eric Normand "Grokking Simplicity"
  version: '1.0'
---

# Functional Thinking

A language-agnostic guide to functional programming principles. These are thinking tools, not syntax rules — they apply equally to Go, C#, TypeScript, Python, Rust, or any other language.

## Core Mental Model

Every piece of code belongs to one of three categories. Identify which category each piece of code belongs to before writing or reviewing it.

### 1. Actions (A) — time-dependent code

Code whose result depends on **when** or **how many times** it is called.

Characteristics:
- Reads from or writes to external state (database, file, network, clock, random)
- Mutates shared mutable state
- Has observable side effects outside its own scope
- Calling it zero times vs. once vs. ten times produces different outcomes in the world

Examples: sending an email, saving to a database, reading the current time, writing to a log, modifying a global variable, rendering to UI.

Rule: **treat actions as dangerous**. Contain them, minimize them, push them to the edges of the system.

### 2. Calculations (C) — pure transformations

Code that maps inputs to outputs with no observable effects outside itself. Same inputs always produce same outputs.

Characteristics:
- No external reads or writes
- No mutation of anything outside its scope
- Can be called any number of times, in any order, without consequence
- Trivially testable: no setup, no teardown, no mocks

Examples: computing a total price, validating an email format, filtering a list, sorting, parsing.

Rule: **prefer calculations over actions wherever possible**. Most "business logic" should be calculations.

### 3. Data (D) — inert facts

Passive values that represent facts. Data does not execute. It is transparent and inspectable.

Characteristics:
- Records, lists, maps, primitive values
- No behavior, no side effects
- Can be serialized, logged, compared, sent over the wire as-is

Rule: **prefer data over calculations, prefer calculations over actions**. The more your system is built from data, the simpler it is to reason about.

---

## Principle 1: Separate Actions from Calculations

When you see a function that mixes time-dependent behavior with pure logic, split it.

**Smell:** a function that both reads/writes state AND computes something.

**Refactoring pattern — extract the calculation:**
```
// Before: action + calculation mixed
function applyDiscount() {
    var price = cart.total          // implicit input (action)
    cart.total = price * 0.9        // implicit output (action)
}

// After: calculation is pure, action is thin
function discountedPrice(price) {   // calculation: input → output
    return price * 0.9
}

function applyDiscount() {           // action: thin wrapper
    cart.total = discountedPrice(cart.total)
}
```

**How to extract:**
1. Identify implicit inputs (reads from outside arguments) → make them explicit parameters
2. Identify implicit outputs (writes to outside, mutations) → return values instead
3. The residual function that still has side effects is your action; everything else is a calculation

---

## Principle 2: Minimize Implicit Inputs and Outputs

Every implicit input or output is a coupling point that limits when and where you can call the function.

- **Implicit input**: anything the function reads that isn't an argument (global variable, closure over mutable state, `this`, current time, database)
- **Implicit output**: anything the function affects beyond its return value (mutation of a passed-in reference, global write, I/O)

**Goal:** make inputs and outputs explicit. Not always possible for actions, but minimize them.

```
// Implicit input: reads global `taxRate`
function calcTax(price) {
    return price * taxRate
}

// Explicit: testable anywhere, reusable
function calcTax(price, taxRate) {
    return price * taxRate
}
```

A function with only explicit inputs/outputs is a **calculation**. A function with any implicit input or output is an **action**.

---

## Principle 3: Immutability via Copy-on-Write

When you need to "modify" data, produce a new copy with the change applied. Leave the original untouched.

**Three steps of copy-on-write:**
1. Make a copy of the data structure
2. Modify the copy
3. Return the copy (do not return or use the original)

```
// Mutable (action — mutates input)
function addItem(cart, item) {
    cart.push(item)          // modifies original
    return cart
}

// Copy-on-write (calculation — returns new value)
function addItem(cart, item) {
    var newCart = cart.slice()  // 1. copy
    newCart.push(item)          // 2. modify copy
    return newCart              // 3. return copy
}
```

**Shallow copy is sufficient** when inner structures are not mutated. For nested mutations, copy each level you touch.

**Defensive copying:** when passing data to untrusted code (third-party libraries, legacy systems), deep copy before passing in and deep copy whatever comes back. This creates a safe zone around your immutable code.

---

## Principle 4: First-Class Functions and Higher-Order Functions

Functions are values. Pass them, return them, store them. This is the primary tool for eliminating duplication and creating composable abstractions.

### Code smell: implicit argument in function name

When multiple functions differ only in a value that is baked into the name, that value should be an explicit argument.

```
// Smell: three nearly identical functions
function setPriceByName(cart, name, price) { ... }
function setQuantityByName(cart, name, qty) { ... }
function setShippingByName(cart, name, ship) { ... }

// Refactor: extract the varying part
function setFieldByName(cart, name, field, value) { ... }
```

### Refactoring: replace body with callback

When multiple pieces of code share structure but differ in a central block, extract the structure and pass the varying block as a function.

```
// Before: duplicated loop structure
function processOrders(orders) {
    for (var i = 0; i < orders.length; i++) {
        doSomethingSpecific(orders[i])
    }
}

// After: structure extracted, behavior injected
function forEach(array, fn) {
    for (var i = 0; i < array.length; i++) {
        fn(array[i])
    }
}
forEach(orders, doSomethingSpecific)
```

### Returning functions from functions

Use closures to capture configuration and produce specialized functions.

```
function makeMultiplier(factor) {
    return function(x) { return x * factor }
}
var double = makeMultiplier(2)
var triple = makeMultiplier(3)
```

---

## Principle 5: Functional Iteration (map / filter / reduce)

Replace explicit loops with declarative transformations when operating on collections.

| Tool | Purpose | Returns |
|------|---------|---------|
| `map` | Transform each element | New collection of same length |
| `filter` | Keep elements matching predicate | Subset collection |
| `reduce` / `fold` | Accumulate elements into a single value | Any value |

**Tips for chaining:**
- **Name intermediate steps** when chains get long — assign each step to a named variable or function
- **Name callbacks** when their logic is non-trivial — gives the code readable intent
- **Use many small steps** — prefer several simple transformations over one complex one
- **Work on whole collections** — avoid mixing loop-level logic with element-level logic

`reduce` is the most powerful: it can implement `map`, `filter`, and arbitrary aggregations. Use it when you need to build up a value (sum, object, tree) from a sequence.

---

## Principle 6: Layered (Stratified) Design

Organize code into layers where each function calls only functions from the same layer or below. Higher layers depend on lower layers, never the reverse.

```
[Business rules layer]        ← knows only domain concepts
        ↓
[Domain model layer]          ← knows about carts, products, users
        ↓
[Data structure utilities]    ← knows about arrays, maps, records
        ↓
[Language primitives]         ← arithmetic, string ops, etc.
```

**Four patterns of stratified design:**

1. **Straightforward implementation** — every function is written at a single level of abstraction. If one line reads as high-level domain language and the next as low-level array manipulation, split them.

2. **Abstract barrier** — a layer of functions that hides the representation of a data structure. Code above the barrier uses only the barrier functions; it does not know whether a "cart" is an array, a map, or a database row. Change the representation freely without touching the upper layers.

3. **Minimal interface** — keep each layer's API as small as possible. Every function added to a layer is a function that upper layers may become dependent on. Prefer adding to a higher layer.

4. **Comfort layers** — a thin layer of convenience functions that wraps lower-level primitives for a specific use case. These exist to make calling code more expressive.

**What to read from the call graph:**
- Functions at the **top** are easy to change (business rules) and hard to reuse
- Functions at the **bottom** are hard to change (primitives) but highly reusable
- Functions at the **bottom** deserve the most rigorous testing
- Functions at the **top** should be tested at integration/acceptance level

---

## Principle 7: Timeline Analysis for Concurrent/Async Code

Actions that share mutable state across concurrent timelines are the source of race conditions.

**Timeline diagram rules:**
- Sequential steps on the same thread go in a single column, top to bottom
- Each new async call (callback, goroutine, thread) starts a new parallel column
- Concurrent columns can interleave in any order

**Three principles for safe timelines:**
1. **Fewer timelines** — the fewer independent threads of execution, the fewer possible orderings
2. **Shorter timelines** — the fewer steps per timeline, the fewer interleavings
3. **No shared mutable state** — timelines that share no mutable resources cannot interfere

**Tools for timeline coordination:**

- **Queue** — serialize concurrent updates to shared state. Instead of multiple timelines updating a value directly, they enqueue updates; a single consumer processes them in order.

- **Cut / barrier / join** — wait for N parallel timelines to complete before proceeding. Useful when you fire multiple async operations and need all results before the next step.

- **Once** — a primitive that ensures an action executes at most once regardless of how many timelines trigger it. Prevents double-send and double-initialize bugs.

**Async output principle:** in an async context, use a callback (or promise/continuation) as the explicit output instead of a return value. The callback is the return value.

---

## Principle 8: Reactive and Layered Architecture

### Reactive architecture

Decouple cause from effect by modeling state as observable cells. Instead of calling downstream effects directly, update a cell; interested parties subscribe to changes.

```
// Imperative: cause directly triggers all effects
function updateCart(item) {
    cart.add(item)
    renderCart()
    updateShippingEstimate()
    logAnalytics()
}

// Reactive: cause updates state; effects subscribe
cart.onChange(renderCart)
cart.onChange(updateShippingEstimate)
cart.onChange(logAnalytics)

function updateCart(item) {
    cart.add(item)   // triggers all subscribers automatically
}
```

Benefits: decouples producers from consumers; new effects can be added without touching the cause.

Trade-off: the indirect flow can make execution order less obvious. Use where the number of effect handlers is likely to grow; avoid for simple one-to-one causes.

### FormulaCell

A derived reactive value that recomputes automatically when its dependencies change. Like a spreadsheet formula. Pure calculation, triggered reactively.

### Functional architecture layers

```
[Actions]          ← entry points: HTTP handlers, event handlers, cron jobs
      ↓
[Service layer]    ← orchestrates calculations, calls actions at edges
      ↓
[Domain layer]     ← pure calculations: rules, transformations, validations
      ↓
[Data layer]       ← data definitions, schemas, immutable structures
```

The key insight: **actions wrap calculations**. The farther you push actions toward the edges of the system, the more of your system is testable, reusable calculation.

---

## Applying the Principles: a Decision Checklist

When writing a new function or reviewing existing code, work through these questions:

1. **Classify it.** Is this function an action, a calculation, or data? Can you tell at a glance?

2. **Extract calculations.** Is there pure logic mixed into an action? Extract it into a separate function with explicit inputs and outputs.

3. **Minimize implicit I/O.** Does the function read global state or mutate shared state? Can any of those be converted to explicit parameters or return values?

4. **Copy-on-write.** Does the function mutate any data structure it receives? Convert to copy-on-write if the caller expects the original to remain unchanged.

5. **First-class abstraction.** Is there duplicated structure that differs only by a value or a behavior? Apply "explicit argument" or "replace body with callback" refactoring.

6. **Right level of abstraction.** Does the function mix different levels (domain + primitives)? Split into layers.

7. **Timeline safety.** If there is concurrency, does this action share mutable state with other timelines? Apply a queue, barrier, or once primitive as needed.

---

## Code Smell Reference

| Smell | Diagnosis | Fix |
|-------|-----------|-----|
| Function name contains a value (e.g. `setPriceByName`, `setQtyByName`) | Implicit argument in name | Make value an explicit argument |
| Function reads global/closure state | Implicit input | Pass as parameter |
| Function mutates argument or global | Implicit output | Return new value; copy-on-write |
| Action contains business logic | Mixed action and calculation | Extract calculation |
| Identical loops differing only in body | Duplicated structure | Extract loop; pass body as function |
| Chain of 5+ transformations is unreadable | Unnamed intermediate steps | Name each step |
| Race condition on shared state | Timeline sharing mutable resource | Queue or eliminate sharing |

---

## Key Principles Summary

- **Prefer data > calculations > actions.** Data is easiest to test, reason about, and serialize. Push actions to the edges.
- **Explicit is better than implicit.** Every hidden input or output is coupling that limits reuse and testability.
- **Functions are values.** Abstractions built from higher-order functions are more composable than code duplication.
- **Immutability simplifies time.** When data never changes in place, you can reason about a snapshot without worrying about concurrent mutation.
- **Layers clarify dependency.** A clear call-graph hierarchy tells you where to put new code, what to test first, and where changes are safe.
- **Timelines explain concurrency bugs.** Drawing the timeline diagram of an async system makes race conditions visible before they become production incidents.
