---
title: Why I like real-time visual systems
description: A radar scope has to lie a little to look honest — on dead reckoning, ADS-B jitter, and why look-above renders between updates instead of waiting for them.
publishDate: 2026-03-10
---

A flight radar that only redraws when new ADS-B data arrives looks broken. Real transponder updates land every
5–15 seconds, so a naive renderer either freezes between packets or snaps aircraft forward in visible jumps. Neither
reads as "live" — both read as a graph of a live system, not the thing itself.

That's the actual problem real-time visualization solves: not "how do I draw the data," but "how do I keep the
screen honest during the gaps where I don't have any." look-above's answer is dead reckoning — hold each aircraft's
last known heading and speed, and extrapolate its position every frame at 60fps, correcting smoothly whenever a real
update arrives. The CPU side (tokio for I/O, rayon for the compute) does the thinking; the GPU side (wgpu) only
draws. That split matters more than it sounds like it should — it's the difference between a renderer that stutters
under network jitter and one that doesn't.

The same instinct shows up in global_unrest, just aimed at a different kind of gap. There, the honesty problem isn't
about interpolating between network packets — it's about not implying certainty a signal doesn't have. Media
attention and verified events get scored and rendered separately, on purpose, so a region lighting up on the map
means "getting covered," not "confirmed." A real-time system that fills in gaps convincingly is only good if it's
also willing to show you where the gaps actually are.
