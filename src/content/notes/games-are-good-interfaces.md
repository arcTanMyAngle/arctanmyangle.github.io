---
title: Games are good interfaces
description: Building Galaga twice, once in C++ and once in Rust, taught me more about the two languages than either one's documentation did.
publishDate: 2026-05-02
---

Benchmarks tell you how fast a language runs a loop. They don't tell you what it's like to actually build something
in it — what fights you, what gets out of the way, where the borrow checker earns its keep versus where it's just
friction. The only honest way to compare two languages is to build the same non-trivial thing twice and pay
attention to the seams.

That's the whole premise behind building Galaga twice in the arcade repo — once in C++, once in Rust, both on
raylib, both aiming for a faithful 1:1 port rather than a reinterpretation. Same entity update loop, same collision
rules, same difficulty curve. The interesting part isn't which one "won" — it's noticing exactly where the two
implementations diverge even though they're solving the identical problem.

Games are a good interface for this kind of comparison because they refuse to let you fake it. A CRUD app can hide a
sloppy architecture behind a slow API call; a game running at a fixed 60Hz simulation step cannot. Uncanny Carnival's
house rule — deterministic physics, no rigged hitboxes, no RNG smoothing over a bad hit-detection decision — exists
for the same reason. If the timing is wrong, or the state management is wrong, the game visibly drops frames or
feels unfair immediately. There's nowhere to hide a shortcut. That's a much better forcing function for learning a
language, a physics kernel, or a rendering pipeline than any benchmark suite.
