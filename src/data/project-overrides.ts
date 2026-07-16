import type { ProjectOverride } from "../lib/projects";

// Keyed by slug (repo name, lowercased — see slugify() in src/lib/projects.ts).
// This is the only place richer copy, categories, featured status, and demo
// wiring get authored. Everything not listed here falls back to whatever the
// raw GitHub metadata says, via the derivation rules in src/lib/projects.ts.
export const projectOverrides: Record<string, ProjectOverride> = {
  // ---------------------------------------------------------------------
  // Flagship "main machines" — full 6-section detail treatment.
  // ---------------------------------------------------------------------

  "look-above": {
    category: "real-time-visualization",
    status: "featured",
    featuredOrder: 1,
    demoType: "radar",
    techStack: ["Rust", "tokio", "rayon", "wgpu", "SQLite", "crossbeam"],
    descriptionOverride: "A local-first flight radar built around public ADS-B feeds — no antenna, no scraping.",
    detailSections: {
      whatItIs:
        "A native Rust desktop app that shows the aircraft flying over a chosen patch of sky right now, built from public ADS-B feeds instead of scraped flight-tracker sites. No antenna, no hardware — it polls HTTPS/JSON endpoints and turns the responses into a live radar scope.",
      whyItMatters:
        "Most “flight tracker” side projects are a map library with some dots on it. look-above treats it as a real-time systems problem: bounded network jitter, dead reckoning between updates, and a hard privacy line around which aircraft get shown at all.",
      howItWorks:
        "Five crates keep concerns separate: core (geo math, no external dependencies), ingest (feed adapters and polling), store (an embedded SQLite layer), render (wgpu pipelines and shaders), and app (the binary and config). tokio drives the network I/O, rayon parallelizes the compute-heavy parts, and crossbeam channels hand normalized data from the CPU side to the GPU side — the stated design rule is “the CPU does the thinking, the GPU only draws.” Because ADS-B updates only arrive every 5–15 seconds, the renderer dead-reckons aircraft along their last known heading and speed to hold a steady 60fps between real updates.",
      technicalDecisions:
        "Feed sources are an explicit allowlist — OpenSky Network, airplanes.live, adsb.lol, aviationweather.gov, and OurAirports — with FlightRadar24, FlightAware, and ADS-B Exchange deliberately excluded rather than scraped. ICAO24 addresses are strictly validated as hex, and synthetic TIS-B/ADS-R records (marked with a ‘~’ prefix) are rejected outright rather than rendered as if they were real transponder data. Privacy is enforced at the data layer, not the UI: once a target has been anonymous for a session, a later record claiming an identity doesn't reopen it, and aircraft under FAA LADD/PIA protections stay anonymous — there's no tail-number search, no alerting, and no data export.",
      currentStatus:
        "Foundation phase. Milestone M0 is complete — the five-crate workspace, 51 passing unit tests, and the core geographic math (haversine distance, Web Mercator projection) are done. Live ingestion (M1) and the wgpu render loop (M2) haven't started yet, so there's no visible radar screen in the app itself today — this is correct infrastructure, not a finished tool.",
      nextUpgrade:
        "Wiring up live ingestion (M1) against the allowlisted feeds, then the wgpu render loop (M2) so aircraft actually appear on screen instead of just in unit tests.",
    },
  },

  global_unrest: {
    category: "geospatial",
    status: "featured",
    featuredOrder: 2,
    demoType: "signal-map",
    techStack: ["Rust", "DuckDB", "Parquet", "H3"],
    descriptionOverride:
      "A desktop signal map that separates media attention from verified events — transparent, non-ML scoring.",
    detailSections: {
      whatItIs:
        "A Rust desktop dashboard that maps global news attention and unrest-adjacent signals — not a claim of “verified events happening now,” but a transparent view of what's getting covered, where, and how confidently.",
      whyItMatters:
        "Civic-data tools are easy to get wrong in a way that looks authoritative and isn't. global_unrest bakes in a hard separation between media attention (how much coverage a place is getting) and verified events (things that actually happened), plus non-ML, inspectable scoring — you can see why a region lit up, not just that it did.",
      howItWorks:
        "The whole thing runs 100% offline by default from committed synthetic fixtures — no network calls, no API keys required to explore it. An H3-cell heatmap shades regions by attention, event count, or source diversity; colored diamonds mark discrete protest/conflict/disruption events; a time slider replays 35 days of data in 6-hour steps; and a region inspector breaks down counts, attention metrics, score components, and outlet diversity for whatever you click on. Sessions can export to date-partitioned Parquet, and storage is bundled DuckDB, so there's nothing external to install.",
      technicalDecisions:
        "Live mode (milestone M3) pulls from GDELT — the DOC 2.0 API for media-attention signals and the 15-minute Events dumps for discrete CAMEO-coded events — on a 15-minute fetch cadence with rate-limiting and graceful degradation back to offline mode if the network drops. A planned ACLED adapter (M5) is intentionally not built yet, since it requires registered authorization the project doesn't have. The basemap is Natural Earth's public-domain 1:110m country dataset, and ingest logging surfaces malformed records instead of silently dropping them.",
      currentStatus:
        "Milestones 1 through 3 are complete: the offline fixture pipeline, scoring depth (baselines and spike detection), and live GDELT ingestion with rate-limiting and retention all work today. Dual MIT/Apache-2.0 licensed.",
      nextUpgrade:
        "The ACLED adapter (M5) for verified-event data, once registered access is in place — that's the piece that would let the map show confirmed events alongside media attention instead of attention signals alone.",
    },
  },

  bird_acoustics: {
    category: "edge-ml",
    status: "featured",
    featuredOrder: 3,
    demoType: "spectrogram",
    techStack: ["C", "ESP-IDF", "TensorFlow Lite Micro", "PyTorch", "ESP32-S3"],
    descriptionOverride: "A tiny bird classifier meant to run where Wi-Fi and cloud GPUs are not guaranteed.",
    detailSections: {
      whatItIs:
        "A bird species classifier that runs entirely on a low-cost microcontroller. A Seeed XIAO ESP32-S3 listens through its onboard PDM microphone, turns audio into a log-mel spectrogram, and runs int8 inference on-device — no Wi-Fi, no cloud round-trip, no dependency on connectivity a field deployment might not have.",
      whyItMatters:
        "Most “edge ML” demos are a laptop pretending to be an edge device. This one actually ships to hardware: an ESP-IDF native firmware build (not Arduino), a ~65K-parameter CNN quantized to int8, and a real measured accuracy number instead of a training-run screenshot.",
      howItWorks:
        "Audio flows: PDM mic → 16kHz / 3-second clips → log-mel spectrogram (512-point FFT, 256-sample hop, 40 mel bands, per-sample z-score normalized) → a compact 4-block CNN (16→32→64→64 channels, batchnorm + maxpool) running as int8 TFLite Micro with ESP-NN hardware acceleration → confidence thresholding with temporal smoothing → a CSV log written to a microSD card. Training happens in PyTorch/torchaudio on a 70/15/15 grouped, stratified split of Xeno-canto recordings plus ESC-50 for a background/noise class — “grouped” matters here because it stops the same recording from leaking across train and test.",
      technicalDecisions:
        "Static per-channel symmetric int8 quantization via PyTorch 2.0 Export (PT2E) gets the deployed model down to 75KB. Moving off Arduino to native ESP-IDF with ESP-NN dropped inference latency from roughly 12–15 seconds to sub-second — the difference between “technically works” and “actually usable in the field.” The project also runs parity tests between the C and Python versions of the audio frontend and compares device output against host simulation, specifically to catch the class of bug where quantized on-device math quietly drifts from what was validated in training.",
      currentStatus:
        "Actively maintained, on training/export pipeline v5–6. Reported held-out test accuracy is 90.2% across 9 classes (8 species — American Crow, California Quail, California Scrub-Jay, Great Horned Owl, Killdeer, Mourning Dove, Red-tailed Hawk, Western Meadowlark — plus a background class), with a 2.2% background false-positive rate at 84.7% bird recall.",
      nextUpgrade:
        "Broader species coverage beyond the current 8, and longer unattended field-deployment runs to see how the false-positive rate holds up outside the curated test split.",
    },
  },

  arcade: {
    category: "games",
    status: "featured",
    featuredOrder: 4,
    demoType: "cabinet",
    techStack: ["Rust", "macroquad", "raylib", "Three.js", "JavaScript", "C++"],
    descriptionOverride: "One cabinet, four from-scratch games — deterministic, asset-light, no game engine.",
    detailSections: {
      whatItIs:
        "A single cabinet housing four completely different from-scratch games: Wii Kart (a 3D procedural kart racer), Uncanny Carnival (a browser-based carnival of six skill games across five difficulty tiers), a Galaga clone built twice — once in C++ and once in Rust — as a direct language comparison, and an HTML Cabinet of five zero-dependency single-file browser games (Mario, Tetris, DK64, Kaboom, Stacker).",
      whyItMatters:
        "The project's own “house rules” are the interesting part: deterministic fixed-timestep simulation, no rigged hitboxes, asset-light procedural art and audio, and nothing built on top of an existing game engine. Building the same shooter twice in two languages is a genuinely useful way to compare what Rust and C++ actually cost you in a real, non-trivial program rather than a synthetic benchmark.",
      howItWorks:
        "Wii Kart runs on Rust + macroquad with drift-charge and mini-turbo mechanics at a fixed 60Hz simulation rate. Uncanny Carnival is Three.js + Vite with a custom deterministic physics kernel and procedural Web Audio sound effects — explicitly “zero RNG rigging.” Galaga is raylib in both languages, built to be a faithful 1:1 port rather than a reinterpretation. The HTML Cabinet games are plain single-file JavaScript — no build step, no dependencies, just double-click and play.",
      technicalDecisions:
        "Hand-rolling a physics kernel for Uncanny Carnival instead of pulling in a physics library, and reimplementing Galaga a second time in a different language instead of just porting the assets, are both deliberate “do it the hard way, on purpose” choices — the value here is in the from-scratch implementation, not in shipping fastest.",
      currentStatus:
        "All four cabinets are playable today. Language split across the repo is roughly Rust 50%, JavaScript 28%, HTML 16%, C++ 6%. MIT licensed.",
      nextUpgrade:
        "A fifth cabinet, or a shared high-score/save layer across cabinets that currently each keep their own state independently.",
    },
  },

  "real-timereaction": {
    displayName: "Real-TimeReaction",
    category: "games",
    status: "featured",
    featuredOrder: 5,
    demoType: "reaction",
    techStack: ["C++17", "SDL2", "OpenGL", "Dear ImGui", "OpenCV", "SQLite"],
    descriptionOverride: "A reaction-time game that treats latency as both gameplay and data.",
    detailSections: {
      whatItIs:
        "A C++17 reaction-time trainer and local two-player arcade game (its own README calls it “reActivation”). A stimulus — a circle, square, or cross in one of four colors — appears over a live webcam panel, and the app measures the exact time between stimulus onset and keypress.",
      whyItMatters:
        "It treats latency as the actual gameplay mechanic instead of an afterthought: false-start detection, a 2-second timeout, and four distinct modes (Classic, Race, Blitz, Survival) all built around the same core measurement, with every trial persisted so trends are visible across sessions instead of vanishing when the window closes.",
      howItWorks:
        "SDL2 and OpenGL handle the window and rendering, Dear ImGui plus ImPlot drive the UI and the in-app analytics charts (histograms, trend lines, leaderboards), OpenCV pulls the webcam feed, SDL_mixer generates all audio procedurally (no shipped asset files at all), and SQLiteCpp persists every trial to a local database with CSV export. The whole thing is CMake-built and covered by 51 Catch2 test cases.",
      technicalDecisions:
        "Race mode runs two players simultaneously and resolves who-pressed-first at the input level rather than the frame level, since frame-level resolution isn't precise enough to be fair when reaction time is the entire point. The camera panel falls back to a black panel if no webcam is present, so the trainer still runs headless instead of failing to start.",
      currentStatus:
        "Playable today across all four modes, built out across six documented development phases, with a companion project page live at real-time-reaction.vercel.app.",
      nextUpgrade:
        "Cross-session player profiles and longer-horizon trend analysis — analytics are strong within a session today; the natural next step is making them meaningful across weeks of practice.",
    },
  },

  foliage_disease_classification: {
    category: "applied-ml",
    status: "featured",
    featuredOrder: 6,
    demoType: "scanner",
    techStack: ["PyTorch", "timm", "MobileViT v2", "Gradio", "GradCAM"],
    descriptionOverride: "A plant-foliage disease classifier, with the model-selection tradeoffs shown, not hidden.",
    detailSections: {
      whatItIs:
        "A plant-foliage disease classifier (early blight and similar conditions) built around MobileViT v2, chosen after directly comparing it against alternatives instead of defaulting to the biggest model available.",
      whyItMatters:
        "The model-selection writeup is the actual substance here: EfficientNetV2-S hit 91.54% accuracy but at 20.3M parameters and roughly 2818 seconds of training time, while MobileViT v1 landed at 89.61% with only 2.0M parameters in a similar training window. MobileViT v2 (~3M parameters) was picked as the better tradeoff — lightweight, quick to train, and architecturally closer to a traditional CNN than v1, leaving room to add segmentation later without a full rebuild.",
      howItWorks:
        "PyTorch and timm handle the model itself; GradCAM and ScoreCAM produce visual explanations of what the model is actually looking at when it makes a call, rather than treating it as a black box; and a Gradio interface wired into Google Colab lets anyone run inference on a sample image without installing anything locally.",
      technicalDecisions:
        "Publishing the losing candidates (EfficientNetV2-S, MobileViT v1) alongside the chosen model, with their actual accuracy / parameter-count / training-time numbers, instead of only showing the final pick — that comparison is what makes the MobileViT v2 choice a documented decision rather than an assumption.",
      currentStatus:
        "Active development, with inference available today through the Colab-hosted Gradio demo and GradCAM interpretability wired in and working. MIT licensed.",
      nextUpgrade: "Expanding beyond the current disease/plant coverage — the architecture choice was made explicitly to leave headroom for that.",
    },
  },

  // ---------------------------------------------------------------------
  // Applied ML / data science
  // ---------------------------------------------------------------------

  check_your_heart: {
    category: "applied-ml",
    descriptionOverride:
      "A first pass at predicting heart-disease risk from lifestyle, societal, and demographic factors — later revisited in Predictive-Heart-Disease-Model.",
    techStack: ["Python", "Jupyter Notebook"],
  },

  "predictive-heart-disease-model": {
    category: "applied-ml",
    descriptionOverride:
      "A cleaned-up, MIT-licensed follow-up to Check_Your_Heart — same question, same feature set, revisited.",
    techStack: ["Python", "Jupyter Notebook"],
  },

  project: {
    displayName: "Project",
    category: "applied-ml",
    descriptionOverride: "An earlier, unlabeled data-science notebook — kept for the record, not polished for display.",
    techStack: ["Python", "Jupyter Notebook"],
  },

  // ---------------------------------------------------------------------
  // Web
  // ---------------------------------------------------------------------

  roomies4sac: {
    category: "web",
    descriptionOverride: "A roommate-finding web app for Sacramento State students, deployed live.",
  },

  // ---------------------------------------------------------------------
  // Archive / practice (categories left to the default archive/fork-experiment
  // derivation in src/lib/projects.ts — only description copy is added here)
  // ---------------------------------------------------------------------

  "leetcode-solutions": {
    descriptionOverride: "A running log of LeetCode practice — not a project, a training log.",
  },

  roomies_webpage: {
    descriptionOverride: "An earlier fork/attempt at the same roommate-finder concept, later rebuilt as roomies4sac.",
  },

  aiagenttradingsystem: {
    descriptionOverride: "A fork of an AI-agent trading system experiment — exploratory, not an original build.",
  },

  "drive-tutorial": {
    descriptionOverride: "A TypeScript learning exercise built while getting comfortable with the language.",
  },

  my_port: {
    descriptionOverride: "An earlier personal-portfolio attempt, superseded by this site.",
  },

  // ---------------------------------------------------------------------
  // Excluded: empty or near-empty repos with nothing to show.
  // ---------------------------------------------------------------------

  virtual_background: {
    exclude: true, // 0 KB, no committed content
  },

  mysqueeze: {
    exclude: true, // ~1 KB, effectively empty
  },

  oropeza: {
    exclude: true, // 3 KB intro-CS coursework repo, no portfolio value
  },
};
