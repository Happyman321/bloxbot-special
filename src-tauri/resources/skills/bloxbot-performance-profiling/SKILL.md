---
name: bloxbot-performance-profiling
description: Investigate Roblox FPS loss, frame spikes, memory growth, and expensive code with measurements, MicroProfiler captures, and LibMP analysis. Use for lag, stutter, high frame time, memory leaks, or performance optimization requests.
---

# Roblox performance profiling

Measure before optimizing. Establish a repeatable scenario and compare the same workload before and after changes.

## Investigation

1. Define the symptom, device context, expected budget, and reproducible player action.
2. Collect baseline FPS, frame-time distribution, memory categories, and relevant console warnings.
3. Separate client, server, rendering, physics, networking, and allocation hypotheses.
4. Use MicroProfiler captures for intermittent spikes or unclear frame cost. Prefer a stable capture window containing both normal and slow frames.
5. In Studio scripts, load LibMP with `require("@rbx/LibMP")` when programmatic MicroProfiler analysis is appropriate.
6. Identify expensive labels, call relationships, frequency, and whether cost is regular or bursty. Report both regular frame indices and absolute frame IDs when referring to capture frames.
7. Make the smallest high-confidence optimization and repeat the same measurements.

## Memory

Compare memory after warm-up and across repeated cycles. Look for retained instances, connections, threads, tables, textures, and caches. A single rising sample is not proof of a leak; seek sustained growth after equivalent cleanup points.

## Reporting

Distinguish measured facts from hypotheses. Include the scenario, capture duration, baseline, bottleneck evidence, change, and post-change result. Do not present an optimization as successful without a comparable measurement.
