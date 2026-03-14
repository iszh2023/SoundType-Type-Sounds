/* global chrome */

(() => {
  // Singleton + hot-reload safety:
  // - Content scripts may be injected multiple times (startup, update, tab rehydrate).
  // - During development, you can also reload the extension while tabs remain open.
  // We keep exactly one running instance per frame per extension version.
  try {
    const THIS_VERSION = (() => {
      try {
        return chrome?.runtime?.getManifest?.().version || "dev";
      } catch {
        return "dev";
      }
    })();

    const existing = window.__soundtypeInstance;
    if (existing && existing.version === THIS_VERSION) return;
    if (existing && typeof existing.cleanup === "function") existing.cleanup();

    const cleanupFns = [];
    window.__soundtypeInstance = {
      version: THIS_VERSION,
      cleanup: () => {
        for (const fn of cleanupFns.splice(0).reverse()) {
          try {
            fn();
          } catch {
            // ignore
          }
        }
      },
      _registerCleanup: (fn) => cleanupFns.push(fn),
    };
  } catch {
    // ignore
  }

  const registerCleanup = (fn) => {
    try {
      window.__soundtypeInstance?._registerCleanup?.(fn);
    } catch {
      // ignore
    }
  };

  const IS_TOP = window.top === window;

  // Cross-reload guard:
  // When the extension reloads, old content-script isolated worlds can stay alive on already-open tabs.
  // Store an "active token" on the DOM so older instances self-disable (prevents multiple series playing).
  const ACTIVE_TOKEN = (() => `${Date.now()}_${Math.random().toString(16).slice(2)}`)();
  const TOKEN_KEY = "soundtypeActiveToken";
  const isActiveInstance = () => {
    try {
      return document.documentElement?.dataset?.[TOKEN_KEY] === ACTIVE_TOKEN;
    } catch {
      return true;
    }
  };
  try {
    if (document.documentElement?.dataset) document.documentElement.dataset[TOKEN_KEY] = ACTIVE_TOKEN;
  } catch {
    // ignore
  }
  const tokenInterval = window.setInterval(() => {
    try {
      if (!isActiveInstance()) window.__soundtypeInstance?.cleanup?.();
    } catch {
      // ignore
    }
  }, 350);
  registerCleanup(() => window.clearInterval(tokenInterval));

  const STORAGE = (() => {
    try {
      return chrome?.storage?.local || chrome?.storage?.sync || null;
    } catch {
      return null;
    }
  })();
  const STORAGE_AREA = (() => {
    try {
      return STORAGE === chrome.storage.local ? "local" : "sync";
    } catch {
      return "sync";
    }
  })();

  const DEFAULTS = {
    enabled: true,
    uiOpen: false,
    autoOpen: true,
    activeSeries: "none",
    volume: 0.75,
    theme: "light", // "dark" | "light"
    pos: { top: 14, left: 14 },
    size: { w: 320, h: 420 },
  };

  const SERIES = [
    { id: "none", name: "NONE", icon: "" },
    { id: "keys", name: "Keys", icon: "⌨️" },
    { id: "roblox", name: "Roblox", icon: "🧱" },
    { id: "amongus", name: "Among Us (‼️ LOUD ‼️)", icon: "🧑‍🚀" },
    { id: "mario", name: "Mario (‼️ LOUD ‼️)", icon: "🍄" },
    { id: "animal", name: "Animal Crossing", icon: "🍃" },
    { id: "geometry", name: "Geometry Dash", icon: "🟩" },
    { id: "minecraft", name: "Minecraft", icon: "⛏️" },
    { id: "pokemon", name: "Pokémon", icon: "⚡" },
    { id: "zelda", name: "Zelda", icon: "🗡️" },
    { id: "sonic", name: "Sonic", icon: "💨" },
    { id: "undertale", name: "Undertale", icon: "💙" },
    { id: "asmr", name: "ASMR", icon: "🎧" },
    { id: "meme", name: "Meme (‼️ LOUD ‼️)", icon: "😂" }
  ];

  // Optional "real sound" packs (user-provided / properly licensed audio files).
  // Put files under: `Google Extension/SoundType/sounds/<seriesId>/...`
  // Example: `Google Extension/SoundType/sounds/roblox/oof.mp3` (or .wav / .ogg)
  // Notes:
  // - We do NOT ship copyrighted game audio in this repo.
  // - If these files are missing, we fall back to the built-in synth sounds.
  const SOUND_PACKS = {
    // You can use any subset. Each entry can be either:
    // - a full filename (e.g. "oof.mp3"), or
    // - a base name without extension (e.g. "oof") which will try .mp3/.wav/.ogg.
    none: [],
    keys: ["keys"],
    roblox: ["oof", "oof2", "vine_boom"],
    amongus: ["sus", "emergency", "kill"],
    mario: ["mammamia", "coin", "1up", "jump"],
    animal: ["chatter1", "chatter2", "chatter3"],
    geometry: ["gd_click1", "gd_click2", "gd_jump"],
    minecraft: ["xp", "hit", "place"],
    pokemon: ["pikachu", "battle_start", "catch"],
    zelda: ["hey_listen", "item_get", "secret"],
    sonic: ["ring", "spin", "level_up"],
    undertale: ["sans", "hit", "save"],
    asmr: [
      "asmr_tap_1",
      "asmr_tap_2",
      "asmr_brush_1",
      "asmr_scratch_1",
      "asmr_crinkle_1",
      "asmr_whisper_1",
      "asmr_whisper_2",
      "asmr_rain_1",
      "asmr_water_1",
      "asmr_chime_1",
    ],
    meme: ["metal_pipe", "bruh", "gasp", "boing", "error", "ping", "bass"],
  };

  // UI-only override: show these series as "REAL" even if we are using synth fallback.
  // (Requested for the default Keys series.)
  const UI_FORCE_REAL = new Set(["keys"]);

  const state = {
    settings: { ...DEFAULTS },
    mounted: false,
    ui: {},
    audio: {
      ctx: null,
      master: null,
      lastAt: 0,
      playSeq: 0,
      active: [], // [{ src: AudioScheduledSourceNode, nodes: AudioNode[], startAt: number }]
      lastPick: new Map(), // seriesId -> { bufIdx: number, patIdx: number }
      packs: new Map(), // seriesId -> { ok, buffers: AudioBuffer[], missing: string[] }
      lastKeySig: "",
      lastKeySigAt: 0,
    },
    drag: {
      on: false,
      dx: 0,
      dy: 0,
    },
  };

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickRandomIndex(len, lastIdx) {
    const n = Math.max(0, Number(len) || 0);
    if (n <= 0) return -1;
    if (n === 1) return 0;
    const last = Number.isFinite(Number(lastIdx)) ? Number(lastIdx) : -1;

    let idx = Math.floor(Math.random() * n);
    if (idx !== last) return idx;
    for (let k = 0; k < 4; k += 1) {
      idx = Math.floor(Math.random() * n);
      if (idx !== last) return idx;
    }
    return (last + 1) % n;
  }

  function pickRandomNoRepeat(arr, lastIdx) {
    const a = Array.isArray(arr) ? arr : [];
    const idx = pickRandomIndex(a.length, lastIdx);
    return { idx, value: idx >= 0 ? a[idx] : undefined };
  }

  async function loadSettings() {
    let got = await (STORAGE || chrome.storage.sync).get(DEFAULTS);

    // Migration: older versions used `storage.sync`. If local appears empty/default, prefer sync once and copy it over.
    try {
      if (STORAGE === chrome.storage.local && chrome?.storage?.sync) {
        const isDefaultish =
          (got?.activeSeries == null || got.activeSeries === DEFAULTS.activeSeries) &&
          (got?.volume == null || Number(got.volume) === Number(DEFAULTS.volume)) &&
          (got?.enabled == null || got.enabled === DEFAULTS.enabled) &&
          (got?.autoOpen == null || got.autoOpen === DEFAULTS.autoOpen);
        if (isDefaultish) {
          const fromSync = await chrome.storage.sync.get(DEFAULTS);
          const syncDiff =
            (fromSync?.activeSeries != null && fromSync.activeSeries !== DEFAULTS.activeSeries) ||
            (fromSync?.volume != null && Number(fromSync.volume) !== Number(DEFAULTS.volume)) ||
            (fromSync?.enabled != null && fromSync.enabled !== DEFAULTS.enabled) ||
            (fromSync?.autoOpen != null && fromSync.autoOpen !== DEFAULTS.autoOpen);
          if (syncDiff) {
            got = fromSync;
            await chrome.storage.local.set(fromSync);
          }
        }
      }
    } catch {
      // ignore
    }
    const merged = { ...DEFAULTS, ...got };
    merged.volume = clamp(Number(merged.volume) || DEFAULTS.volume, 0, 1);
    merged.theme = merged.theme === "light" ? "light" : "dark";
    merged.size = merged.size || DEFAULTS.size;
    merged.pos = merged.pos || DEFAULTS.pos;
    merged.autoOpen = merged.autoOpen !== false;
    if (!merged.activeSeries) merged.activeSeries = DEFAULTS.activeSeries;
    state.settings = merged;
  }

  function applySettingsUpdate(partial) {
    if (!partial) return;
    const prevSeries = state.settings.activeSeries;
    state.settings = { ...state.settings, ...partial };
    if (partial.theme != null) {
      state.settings.theme = state.settings.theme === "light" ? "light" : "dark";
    }
    if (partial.volume != null && state.audio.master) {
      try {
        const v = clamp(Number(state.settings.volume) || 0, 0, 1);
        state.audio.master.gain.value = v;
        if (v <= 0.0001) stopActiveSounds();
      } catch {
        // ignore
      }
    }
    if (partial.activeSeries != null && state.settings.activeSeries !== prevSeries) {
      try {
        stopActiveSounds();
      } catch {
        // ignore
      }
      // Warm the new series pack so badges/status update quickly across tabs.
      try {
        if (IS_TOP && state.mounted && state.ui.folder) state.ui.folder.textContent = `sounds/${state.settings.activeSeries}/`;
        tryLoadSoundPack(state.settings.activeSeries, { force: false })
          .finally(() => {
            if (IS_TOP && state.mounted) applyUiState();
          });
      } catch {
        // ignore
      }
    }
  }

  async function save(partial) {
    state.settings = { ...state.settings, ...(partial || {}) };
    await (STORAGE || chrome.storage.sync).set(partial || {});
  }

  function broadcastSettings(_partial) {}

  function ensureAudio() {
    if (state.audio.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = state.settings.volume;
    master.connect(ctx.destination);
    state.audio.ctx = ctx;
    state.audio.master = master;
    try {
      window.__soundtypeAudioReady = ctx.state === "running";
    } catch {
      // ignore
    }
  }

  function stopActiveSounds() {
    const ctx = state.audio.ctx;
    const active = Array.isArray(state.audio.active) ? state.audio.active : [];
    if (!active.length) return;

    // Stop and disconnect any currently playing/scheduled nodes so each keypress is monophonic.
    for (const entry of active) {
      const src = entry?.src;
      const nodes = Array.isArray(entry?.nodes) ? entry.nodes : [];
      const startAt = typeof entry?.startAt === "number" ? entry.startAt : null;

      if (src && typeof src.stop === "function") {
        try {
          const now = ctx ? ctx.currentTime : 0;
          const tStop = startAt == null ? now : Math.max(now, startAt) + 0.001;
          src.stop(tStop);
        } catch {
          // ignore
        }
      }

      // Disconnect (even if stop threw). Disconnecting prevents any future scheduled playback from reaching output.
      for (const n of [src, ...nodes]) {
        if (n && typeof n.disconnect === "function") {
          try {
            n.disconnect();
          } catch {
            // ignore
          }
        }
      }
    }

    state.audio.active = [];
  }

  function trackActive(src, nodes, startAt) {
    if (!src) return;
    if (!Array.isArray(state.audio.active)) state.audio.active = [];
    state.audio.active.push({ src, nodes: Array.isArray(nodes) ? nodes : [], startAt: typeof startAt === "number" ? startAt : 0 });
  }

  async function fetchArrayBuffer(url, opts = {}) {
    try {
      const force = !!opts.force;
      const res = await fetch(url, { cache: force ? "reload" : "force-cache" });
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  }

  async function tryLoadSoundPack(seriesId, opts = {}) {
    ensureAudio();
    const ctx = state.audio.ctx;
    if (!ctx) return { ok: false, buffers: [], missing: [] };
    const force = !!opts.force;
    if (!force && state.audio.packs.has(seriesId)) return state.audio.packs.get(seriesId);

    const entries = SOUND_PACKS[seriesId] || [];
    if (!entries.length) {
      const pack = { ok: false, buffers: [], missing: [] };
      state.audio.packs.set(seriesId, pack);
      return pack;
    }

    const buffers = [];
    const missing = [];
    // Add common download formats; decode support varies by platform.
    const exts = [".mp3", ".wav", ".ogg", ".m4a", ".webm"];
    for (const entry of entries) {
      const e = String(entry || "").trim();
      if (!e) continue;
      const candidates = e.includes(".") ? [e] : exts.map((x) => `${e}${x}`);

      let loaded = false;
      for (const f of candidates) {
        const url = chrome.runtime.getURL(`sounds/${seriesId}/${f}`);
        const ab = await fetchArrayBuffer(url, { force });
        if (!ab) continue;
        try {
          // decodeAudioData copies the buffer internally; do not reuse 'ab'.
          const buf = await ctx.decodeAudioData(ab.slice(0));
          buffers.push(buf);
          loaded = true;
          break;
        } catch {
          // try next extension
        }
      }
      if (!loaded) missing.push(e);
    }

    const pack = { ok: buffers.length > 0, buffers, missing };
    state.audio.packs.set(seriesId, pack);
    return pack;
  }

  function playBuffer(buf, whenSec = 0) {
    const ctx = state.audio.ctx;
    const master = state.audio.master;
    if (!ctx || !master || !buf) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.98;
    src.connect(g);
    g.connect(master);
    const t0 = Math.max(ctx.currentTime, whenSec);
    trackActive(src, [g], t0);
    src.start(t0);
  }

  function setVolume(vol) {
    const v = clamp(Number(vol) || 0, 0, 1);
    state.settings.volume = v;
    if (state.audio.master) state.audio.master.gain.value = v;
    if (v <= 0.0001) {
      try {
        stopActiveSounds();
      } catch {
        // ignore
      }
    }
    void save({ volume: v });
  }

  function resumeAudioIfNeeded() {
    ensureAudio();
    const ctx = state.audio.ctx;
    if (!ctx) return;
    if (ctx.state === "running") {
      try {
        window.__soundtypeAudioReady = true;
      } catch {
        // ignore
      }
      return;
    }
    if (ctx.state === "suspended") {
      ctx
        .resume()
        .then(() => {
          try {
            window.__soundtypeAudioReady = true;
          } catch {
            // ignore
          }
        })
        .catch(() => {});
    }
  }

  function scheduleTone({ type = "sine", f0 = 440, f1 = null, ms = 120, gain = 0.25, at = 0 } = {}) {
    const ctx = state.audio.ctx;
    const master = state.audio.master;
    if (!ctx || !master) return;

    const t0 = Math.max(ctx.currentTime, at);
    const t1 = t0 + ms / 1000;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (typeof f1 === "number") {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t1);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.connect(g);
    g.connect(master);
    trackActive(osc, [g], t0);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }

  function scheduleNoise({ ms = 120, gain = 0.15, at = 0 } = {}) {
    const ctx = state.audio.ctx;
    const master = state.audio.master;
    if (!ctx || !master) return;

    const t0 = Math.max(ctx.currentTime, at);
    const t1 = t0 + ms / 1000;

    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (ms / 1000)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.9;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);

    src.connect(g);
    g.connect(master);
    trackActive(src, [g], t0);
    src.start(t0);
    src.stop(t1 + 0.02);
  }

  async function playSeriesSound(seriesId) {
    try {
      if (!isActiveInstance()) return;
      resumeAudioIfNeeded();
      ensureAudio();
      const ctx = state.audio.ctx;
      if (!ctx) return;

      if (seriesId === "none") {
        stopActiveSounds();
        return;
      }

      state.audio.playSeq = (Number(state.audio.playSeq) || 0) + 1;
      stopActiveSounds();

      // If muted, never play (but still stop any currently playing/scheduled sound).
      if ((Number(state.settings.volume) || 0) <= 0.0001) return;

      const t = ctx.currentTime + 0.003;

      // Prefer real sound pack if already cached and loaded; otherwise kick off loading in background
      // and play synth immediately (prevents a "late" sound after decoding finishes).
      const cached = state.audio.packs.get(seriesId);
      if (cached?.ok && cached.buffers?.length) {
        const prev = state.audio.lastPick.get(seriesId) || { bufIdx: -1, patIdx: -1 };
        const { idx, value } = pickRandomNoRepeat(cached.buffers, prev.bufIdx);
        state.audio.lastPick.set(seriesId, { ...prev, bufIdx: idx });
        playBuffer(value, t);
        return;
      }
      if (!cached) {
        void tryLoadSoundPack(seriesId).catch(() => {});
      }

      const patterns = {
      none: [() => {}],
      keys: [
        () => {
          // One consistent key-click style sound (default).
          scheduleNoise({ ms: 18, gain: 0.14, at: t });
          scheduleTone({ type: "triangle", f0: 1700, f1: 1200, ms: 22, gain: 0.07, at: t });
        },
      ],
      roblox: [
        () => {
          scheduleNoise({ ms: 110, gain: 0.06, at: t });
          scheduleTone({ type: "square", f0: 220, f1: 90, ms: 220, gain: 0.22, at: t });
        },
        () => scheduleTone({ type: "square", f0: 180, f1: 120, ms: 170, gain: 0.20, at: t }),
        () => scheduleTone({ type: "sawtooth", f0: 260, f1: 70, ms: 210, gain: 0.16, at: t }),
      ],
      amongus: [
        () => {
          scheduleTone({ type: "triangle", f0: 740, ms: 80, gain: 0.12, at: t });
          scheduleTone({ type: "triangle", f0: 520, ms: 120, gain: 0.12, at: t + 0.09 });
          scheduleTone({ type: "triangle", f0: 660, ms: 90, gain: 0.12, at: t + 0.22 });
        },
        () => scheduleTone({ type: "triangle", f0: 880, f1: 440, ms: 260, gain: 0.14, at: t }),
        () => {
          scheduleTone({ type: "triangle", f0: 620, ms: 70, gain: 0.1, at: t });
          scheduleTone({ type: "triangle", f0: 620, ms: 70, gain: 0.1, at: t + 0.08 });
          scheduleTone({ type: "triangle", f0: 490, ms: 150, gain: 0.11, at: t + 0.16 });
        },
      ],
      mario: [
        () => {
          scheduleTone({ type: "square", f0: 988, ms: 70, gain: 0.12, at: t });
          scheduleTone({ type: "square", f0: 1319, ms: 90, gain: 0.11, at: t + 0.07 });
        },
        () => {
          scheduleTone({ type: "square", f0: 659, ms: 65, gain: 0.12, at: t });
          scheduleTone({ type: "square", f0: 784, ms: 65, gain: 0.12, at: t + 0.06 });
          scheduleTone({ type: "square", f0: 988, ms: 110, gain: 0.10, at: t + 0.12 });
        },
        () => scheduleTone({ type: "square", f0: 1568, f1: 784, ms: 220, gain: 0.10, at: t }),
      ],
      animal: [
        () => {
          scheduleTone({ type: "sine", f0: 523.25, ms: 90, gain: 0.10, at: t });
          scheduleTone({ type: "sine", f0: 659.25, ms: 140, gain: 0.09, at: t + 0.07 });
        },
        () => {
          scheduleTone({ type: "sine", f0: 392, ms: 90, gain: 0.09, at: t });
          scheduleTone({ type: "sine", f0: 523.25, ms: 120, gain: 0.09, at: t + 0.09 });
          scheduleTone({ type: "sine", f0: 659.25, ms: 160, gain: 0.08, at: t + 0.17 });
        },
        () => scheduleTone({ type: "sine", f0: 784, f1: 392, ms: 250, gain: 0.07, at: t }),
      ],
      geometry: [
        () => scheduleTone({ type: "sawtooth", f0: 420, f1: 980, ms: 120, gain: 0.13, at: t }),
        () => scheduleTone({ type: "sawtooth", f0: 880, f1: 330, ms: 160, gain: 0.12, at: t }),
        () => {
          scheduleTone({ type: "sawtooth", f0: 660, ms: 70, gain: 0.11, at: t });
          scheduleTone({ type: "sawtooth", f0: 990, ms: 90, gain: 0.10, at: t + 0.06 });
        },
      ],
      minecraft: [
        () => {
          scheduleTone({ type: "triangle", f0: 196, ms: 110, gain: 0.14, at: t });
          scheduleTone({ type: "triangle", f0: 392, ms: 90, gain: 0.10, at: t + 0.08 });
        },
        () => scheduleTone({ type: "triangle", f0: 246.94, f1: 123.47, ms: 210, gain: 0.12, at: t }),
        () => {
          scheduleNoise({ ms: 45, gain: 0.03, at: t });
          scheduleTone({ type: "triangle", f0: 174.61, ms: 160, gain: 0.13, at: t });
        },
      ],
      pokemon: [
        () => {
          scheduleTone({ type: "sine", f0: 880, ms: 70, gain: 0.12, at: t });
          scheduleTone({ type: "sine", f0: 1175, ms: 90, gain: 0.11, at: t + 0.07 });
          scheduleTone({ type: "sine", f0: 1568, ms: 120, gain: 0.10, at: t + 0.16 });
        },
        () => scheduleTone({ type: "sine", f0: 659, f1: 1319, ms: 180, gain: 0.12, at: t }),
        () => scheduleTone({ type: "sine", f0: 1480, f1: 740, ms: 240, gain: 0.10, at: t }),
      ],
      zelda: [
        () => {
          scheduleTone({ type: "triangle", f0: 659, ms: 80, gain: 0.12, at: t });
          scheduleTone({ type: "triangle", f0: 784, ms: 90, gain: 0.12, at: t + 0.08 });
          scheduleTone({ type: "triangle", f0: 988, ms: 110, gain: 0.11, at: t + 0.17 });
        },
        () => scheduleTone({ type: "triangle", f0: 523, f1: 1046, ms: 260, gain: 0.10, at: t }),
        () => {
          scheduleTone({ type: "triangle", f0: 740, ms: 70, gain: 0.11, at: t });
          scheduleTone({ type: "triangle", f0: 587, ms: 120, gain: 0.11, at: t + 0.07 });
        },
      ],
      sonic: [
        () => {
          scheduleTone({ type: "square", f0: 880, ms: 60, gain: 0.12, at: t });
          scheduleTone({ type: "square", f0: 988, ms: 60, gain: 0.12, at: t + 0.05 });
          scheduleTone({ type: "square", f0: 1175, ms: 80, gain: 0.10, at: t + 0.10 });
        },
        () => scheduleTone({ type: "square", f0: 1319, f1: 659, ms: 210, gain: 0.10, at: t }),
        () => scheduleTone({ type: "square", f0: 1046, f1: 1568, ms: 160, gain: 0.10, at: t }),
      ],
      undertale: [
        () => {
          scheduleTone({ type: "sine", f0: 440, ms: 90, gain: 0.12, at: t });
          scheduleTone({ type: "sine", f0: 554.37, ms: 90, gain: 0.11, at: t + 0.09 });
          scheduleTone({ type: "sine", f0: 659.25, ms: 120, gain: 0.10, at: t + 0.18 });
        },
        () => scheduleTone({ type: "sine", f0: 330, f1: 220, ms: 240, gain: 0.12, at: t }),
        () => {
          scheduleTone({ type: "sine", f0: 523.25, ms: 70, gain: 0.10, at: t });
          scheduleTone({ type: "sine", f0: 392.0, ms: 150, gain: 0.11, at: t + 0.06 });
        },
      ],
      meme: [
        () => scheduleTone({ type: "square", f0: 220, f1: 110, ms: 180, gain: 0.18, at: t }),
        () => {
          scheduleTone({ type: "triangle", f0: 880, ms: 60, gain: 0.10, at: t });
          scheduleTone({ type: "triangle", f0: 660, ms: 100, gain: 0.10, at: t + 0.06 });
        },
        () => scheduleNoise({ ms: 90, gain: 0.06, at: t }),
      ],
    };

      const list = patterns[seriesId] || patterns.roblox;
      const prev = state.audio.lastPick.get(seriesId) || { bufIdx: -1, patIdx: -1 };
      const { idx, value } = pickRandomNoRepeat(list, prev.patIdx);
      state.audio.lastPick.set(seriesId, { ...prev, patIdx: idx });
      if (typeof value === "function") value();
    } catch {
      // Never throw from a keypress handler.
    }
  }

  function toast(text) {
    const el = state.ui.toast;
    if (!el) return;
    el.textContent = text;
    el.style.opacity = "1";
    el.style.transform = "translateY(0px)";
    window.setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(-6px)";
    }, 850);
  }

  function applyUiState() {
    if (!state.ui.host) return;
    state.ui.host.style.display = state.settings.uiOpen ? "block" : "none";
    if (state.ui.wrap) state.ui.wrap.dataset.theme = state.settings.theme === "light" ? "light" : "dark";
    if (state.ui.vol) state.ui.vol.value = String(state.settings.volume);
    if (state.ui.volVal) state.ui.volVal.textContent = `${Math.round(state.settings.volume * 100)}%`;
    if (state.ui.folder) state.ui.folder.textContent = `sounds/${state.settings.activeSeries}/`;
    if (state.ui.themeDark) state.ui.themeDark.setAttribute("aria-pressed", state.settings.theme === "light" ? "false" : "true");
    if (state.ui.themeLight) state.ui.themeLight.setAttribute("aria-pressed", state.settings.theme === "light" ? "true" : "false");
    if (state.ui.active) {
      const s = SERIES.find((x) => x.id === state.settings.activeSeries) || SERIES[0];
      state.ui.active.textContent = `Active: ${s?.name || "None"}`;
    }
    if (state.ui.soundStatus) {
      if (state.settings.activeSeries === "none") {
        state.ui.soundStatus.textContent = "Sounds: NONE";
        if (state.ui.missing) state.ui.missing.textContent = "";
      } else if (UI_FORCE_REAL.has(state.settings.activeSeries)) {
        state.ui.soundStatus.textContent = "Sounds: real";
        if (state.ui.missing) state.ui.missing.textContent = "";
      } else {
      const pack = state.audio.packs.get(state.settings.activeSeries);
      if (!pack) {
        state.ui.soundStatus.textContent = "Sounds: checking…";
        if (state.ui.missing) state.ui.missing.textContent = "";
      } else if (pack.ok && pack.buffers && pack.buffers.length) {
        state.ui.soundStatus.textContent = `Sounds: real (${pack.buffers.length})`;
        if (state.ui.missing) state.ui.missing.textContent = "";
      } else {
        const miss = Array.isArray(pack.missing) ? pack.missing.length : 0;
        state.ui.soundStatus.textContent = miss ? `Sounds: synth (missing ${miss})` : "Sounds: synth (add files)";
        if (state.ui.missing) {
          const names = Array.isArray(pack.missing) ? pack.missing.slice(0, 6) : [];
          state.ui.missing.textContent = names.length ? `Missing: ${names.join(", ")} (try .mp3/.wav/.ogg)` : "";
        }
      }
      }
    }
    if (state.ui.grid) {
      for (const btn of state.ui.grid.querySelectorAll("[data-series]")) {
        const id = btn.getAttribute("data-series");
        const on = id === state.settings.activeSeries;
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        const badge = btn.querySelector("[data-badge]");
        const pack = state.audio.packs.get(id);
        if (badge) {
          badge.textContent = id === "none" ? "NONE" : UI_FORCE_REAL.has(id) ? "REAL" : pack?.ok ? "REAL" : "SYNTH";
          badge.style.opacity = "0.85";
        }
      }
    }
  }

  function mountUi() {
    if (!IS_TOP) return; // UI only in top frame
    if (state.mounted) return;
    state.mounted = true;

    // Extension reloads can leave old content-script instances alive in other isolated worlds.
    // Remove any existing SoundType panel(s) in the DOM so we never stack multiple windows.
    try {
      const old = document.querySelectorAll('#soundtype-host,[data-soundtype-host="1"]');
      for (const el of old) el.remove();
    } catch {
      // ignore
    }

    const host = document.createElement("div");
    host.id = "soundtype-host";
    host.dataset.soundtypeHost = "1";
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.top = `${state.settings.pos?.top ?? 14}px`;
    if (state.settings.pos && Number.isFinite(Number(state.settings.pos.left))) {
      host.style.left = `${Math.round(Number(state.settings.pos.left))}px`;
      host.style.right = "auto";
    } else {
      host.style.right = `${state.settings.pos?.right ?? 14}px`;
    }
    host.style.zIndex = "2147483647";
    host.style.display = "none";
    host.style.pointerEvents = "auto";

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    const lightBgUrl = (() => {
      try {
        return chrome.runtime.getURL("assets/light-bg.jpg");
      } catch {
        return "";
      }
    })();
    const indieFontUrl = (() => {
      try {
        return chrome.runtime.getURL("assets/IndieFlower-Regular.woff2");
      } catch {
        return "";
      }
    })();
    style.textContent = `
      ${indieFontUrl ? `@font-face {
        font-family: "Indie Flower";
        font-style: normal;
        font-weight: 400;
        src: url("${indieFontUrl}") format("woff2");
        font-display: swap;
      }
      @font-face {
        font-family: "Indie Flower";
        font-style: normal;
        font-weight: 700;
        src: url("${indieFontUrl}") format("woff2");
        font-display: swap;
      }` : ""}

      * { box-sizing: border-box; }
      .panel {
        width: ${Math.round(state.settings.size?.w ?? 320)}px;
        height: ${Math.round(state.settings.size?.h ?? 420)}px;
        display: flex;
        flex-direction: column;
        background: rgba(12, 16, 28, 0.94);
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 14px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        color: rgba(255,255,255,0.92);
        overflow: hidden;
        resize: both;
        /* Default (Dark theme): keep a clean system font. */
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        font-synthesis: weight style;
      }
      .panel[data-theme="light"]{
        background-image:
          linear-gradient(0deg, rgba(255,255,255,0.78), rgba(255,255,255,0.78)),
          url("${lightBgUrl}");
        background-size: cover, cover;
        background-position: center, center;
        border-color: rgba(16, 24, 40, 0.18);
        box-shadow: 0 14px 34px rgba(0,0,0,0.22);
        color: rgba(16, 24, 40, 0.88);
        font-weight: 700;
      }
      .panel[data-theme="light"],
      .panel[data-theme="light"] * {
        font-family: "Indie Flower", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Trebuchet MS", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
      }
      .hdr {
        user-select: none;
        cursor: move;
        padding: 10px 10px 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.04);
      }
      .panel[data-theme="light"] .hdr {
        border-bottom-color: rgba(16,24,40,0.10);
        background: rgba(255,255,255,0.18);
      }
      .panel[data-theme="light"] .hdr strong {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0.35px;
      }
      .panel[data-theme="light"] .hdr .pill {
        font-size: 13px;
        font-weight: 700;
        opacity: 0.85;
      }
      .hdr strong { font-size: 13px; letter-spacing: 0.2px; }
      .hdr .pill { font-size: 11px; opacity: 0.8; }
      .body { padding: 10px; display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        overflow: auto;
        padding-right: 4px;
        flex: 1;
        min-height: 160px;
        scrollbar-gutter: stable;
      }
      .sectionTitle { font-size: 11px; opacity: 0.78; letter-spacing: 0.2px; }
      .scrollHint {
        font-size: 10px;
        opacity: 0.65;
        display: flex;
        align-items: center;
        justify-content: space-between;
        user-select: none;
      }
      /* Make scrollbars visible even on macOS (where they often auto-hide). */
      .grid::-webkit-scrollbar { width: 10px; }
      .grid::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); border-radius: 999px; }
      .grid::-webkit-scrollbar-thumb { background: rgba(93,214,192,0.35); border-radius: 999px; border: 2px solid rgba(0,0,0,0.18); }
      .grid::-webkit-scrollbar-thumb:hover { background: rgba(93,214,192,0.55); }
      .card {
        appearance: none;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        border-radius: 12px;
        padding: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        cursor: pointer;
        color: rgba(255,255,255,0.92);
        transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
      }
      .card:hover { transform: translateY(-1px); border-color: rgba(93,214,192,0.55); }
      .card[aria-pressed="true"] { border-color: rgba(93,214,192,0.9); background: rgba(93,214,192,0.14); }
      .panel[data-theme="light"] .card {
        border-color: rgba(16,24,40,0.14);
        background: rgba(255,255,255,0.44);
        color: rgba(16,24,40,0.88);
      }
      .panel[data-theme="light"] .card:hover { border-color: rgba(255, 145, 180, 0.75); }
      .panel[data-theme="light"] .card[aria-pressed="true"] { border-color: rgba(255, 145, 180, 0.92); background: rgba(255, 145, 180, 0.16); }
      .left { display:flex; align-items:center; gap: 10px; }
      .icon {
        width: 34px;
        height: 34px;
        border-radius: 10px;
        display:flex;
        align-items:center;
        justify-content:center;
        background: rgba(0,0,0,0.22);
        border: 1px solid rgba(255,255,255,0.12);
        font-size: 18px;
      }
      .panel[data-theme="light"] .icon { background: rgba(255,255,255,0.70); border-color: rgba(16,24,40,0.10); }
      .name { font-size: 12px; text-align: left; }
      .mini { font-size: 10px; opacity: 0.65; margin-top: 2px; }
      .toast {
        position: absolute;
        top: 54px;
        right: 12px;
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(93,214,192,0.92);
        color: #071016;
        font-weight: 800;
        font-size: 12px;
        opacity: 0;
        transform: translateY(-6px);
        transition: opacity 280ms ease, transform 280ms ease;
        pointer-events: none;
      }
      .panel[data-theme="light"] .toast { background: rgba(255, 145, 180, 0.95); color: rgba(16,24,40,0.92); }
      .footer {
        border-top: 1px solid rgba(255,255,255,0.10);
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .panel[data-theme="light"] .footer { border-top-color: rgba(16,24,40,0.10); }
      .row { display:flex; align-items:center; justify-content: space-between; gap: 10px; }
      .row label { font-size: 11px; opacity: 0.8; }
      .panel[data-theme="light"] .row label { font-size: 13px; font-weight: 700; opacity: 0.9; }
      input[type="range"] { width: 100%; }
      .muted { font-size: 10px; opacity: 0.65; line-height: 1.3; }
      .panel[data-theme="light"] .muted { opacity: 0.72; }
      .theme {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .seg {
        appearance: none;
        border: 1px solid rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.92);
        border-radius: 999px;
        padding: 6px 10px;
        cursor: pointer;
        font-size: 12px;
        text-align: center;
      }
      .seg[aria-pressed="true"] { border-color: rgba(93,214,192,0.95); background: rgba(93,214,192,0.18); }
      .panel[data-theme="light"] .seg { border-color: rgba(16,24,40,0.14); background: rgba(255,255,255,0.50); color: rgba(16,24,40,0.88); }
      .panel[data-theme="light"] .seg[aria-pressed="true"] { border-color: rgba(255, 145, 180, 0.92); background: rgba(255, 145, 180, 0.16); }
      .panel[data-theme="light"] .seg { font-size: 13px; font-weight: 700; }
      .panel[data-theme="light"] #st-volval { font-size: 13px; font-weight: 700; opacity: 0.9; }
      button.small {
        appearance: none;
        border: 1px solid rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.92);
        border-radius: 10px;
        padding: 6px 8px;
        cursor: pointer;
        font-size: 12px;
      }
      .panel[data-theme="light"] button.small,
      .panel[data-theme="light"] button.close {
        border-color: rgba(16,24,40,0.14);
        background: rgba(255,255,255,0.50);
        color: rgba(16,24,40,0.88);
      }
      button.close {
        appearance: none;
        border: 1px solid rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.92);
        border-radius: 10px;
        padding: 6px 8px;
        cursor: pointer;
        font-size: 12px;
      }
    `;

    const wrap = document.createElement("div");
    wrap.className = "panel";
    wrap.innerHTML = `
      <div class="hdr" id="st-hdr">
        <div>
          <strong>SoundType</strong>
          <div class="pill" id="st-active"></div>
        </div>
        <button class="close" id="st-close" title="Hide">✕</button>
      </div>
      <div class="body">
        <div class="scrollHint">
          <div class="sectionTitle">Series</div>
          <div id="st-scrollhint">Scroll for more ↓</div>
        </div>
        <div class="grid" id="st-grid"></div>
        <div class="footer">
          <div class="row">
            <label>Theme</label>
            <div class="theme" role="group" aria-label="Theme">
              <button class="seg" id="st-theme-dark" type="button" aria-pressed="true">Dark</button>
              <button class="seg" id="st-theme-light" type="button" aria-pressed="false">Light</button>
            </div>
          </div>
          <div class="row">
            <label>Volume</label>
            <div style="font-size:11px; opacity:0.8" id="st-volval">75%</div>
          </div>
          <input id="st-vol" type="range" min="0" max="1" step="0.01" />
          <div class="muted">Tip: Press any key anywhere to play a random sound from the active series.</div>
          <div class="muted" id="st-audiohint" style="display:none;">
            If you hear nothing: click once anywhere on the page, then press a key again.
          </div>
        </div>
      </div>
      <div class="toast" id="st-toast">Activated!</div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(wrap);
    document.documentElement.appendChild(host);
    registerCleanup(() => {
      try {
        host.remove();
      } catch {
        // ignore
      }
    });

    state.ui.host = host;
    state.ui.shadow = shadow;
    state.ui.wrap = wrap;
    state.ui.grid = shadow.getElementById("st-grid");
    state.ui.hdr = shadow.getElementById("st-hdr");
    state.ui.active = shadow.getElementById("st-active");
    state.ui.toast = shadow.getElementById("st-toast");
    state.ui.scrollHint = shadow.getElementById("st-scrollhint");
    state.ui.vol = shadow.getElementById("st-vol");
    state.ui.volVal = shadow.getElementById("st-volval");
    state.ui.audioHint = shadow.getElementById("st-audiohint");
    state.ui.close = shadow.getElementById("st-close");
    state.ui.themeDark = shadow.getElementById("st-theme-dark");
    state.ui.themeLight = shadow.getElementById("st-theme-light");

    // Programmatic font load to improve reliability on pages with strict CSP.
    try {
      if (indieFontUrl && "FontFace" in window && document?.fonts?.add) {
        const face = new FontFace("Indie Flower", `url(${indieFontUrl})`, { style: "normal", weight: "400" });
        face.load().then((f) => document.fonts.add(f)).catch(() => {});
      }
    } catch {
      // ignore
    }

    state.ui.themeDark?.addEventListener("click", () => {
      state.settings.theme = "dark";
      void save({ theme: "dark" });
      applyUiState();
    });
    state.ui.themeLight?.addEventListener("click", () => {
      state.settings.theme = "light";
      void save({ theme: "light" });
      applyUiState();
    });

    for (const s of SERIES) {
      const btn = document.createElement("button");
      btn.className = "card";
      btn.type = "button";
      btn.setAttribute("data-series", s.id);
      btn.setAttribute("aria-pressed", "false");
      if (s.id === "none") {
        btn.style.justifyContent = "center";
        btn.style.textAlign = "center";
        btn.innerHTML = `<div class="name" style="font-size:13px; letter-spacing:0.4px;">NONE</div>`;
      } else {
        btn.innerHTML = `
          <div class="left">
            <div class="icon">${s.icon}</div>
            <div>
              <div class="name">${s.name}</div>
              <div class="mini">random on keypress</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span data-badge style="font-size:10px; padding: 3px 6px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.18);">SYNTH</span>
            <div style="opacity:0.6; font-size:12px;">›</div>
          </div>
        `;
      }
      btn.addEventListener("click", async () => {
        state.settings.activeSeries = s.id;
        try {
          await save({ activeSeries: s.id, enabled: true });
        } catch {
          // ignore
        }
        if (state.ui.folder) state.ui.folder.textContent = `sounds/${s.id}/`;
        applyUiState();
        toast(`Activated: ${s.name}`);
        // Play a tiny preview sound immediately (usually synth first; real pack kicks in once loaded).
        if (s.id !== "none" && (Number(state.settings.volume) || 0) > 0.0001) void playSeriesSound(s.id);

        // Warm the pack in the background; update UI/toast when it resolves.
        tryLoadSoundPack(s.id, { force: true })
          .then((pack) => {
            if (state.settings.activeSeries !== s.id) return;
            if (UI_FORCE_REAL.has(s.id) || pack?.ok) toast(`Activated: ${s.name} (real)`);
            applyUiState();
          })
          .catch(() => {});
      });
      state.ui.grid.appendChild(btn);
    }

    const updateScrollHint = () => {
      const g = state.ui.grid;
      const hint = state.ui.scrollHint;
      if (!g || !hint) return;
      const canScroll = g.scrollHeight > g.clientHeight + 6;
      const atBottom = g.scrollTop + g.clientHeight >= g.scrollHeight - 8;
      hint.style.visibility = canScroll && !atBottom ? "visible" : "hidden";
    };
    state.ui.grid.addEventListener("scroll", updateScrollHint, { passive: true });
    window.setTimeout(updateScrollHint, 80);

    // Prime the active series pack so the status is accurate immediately.
    tryLoadSoundPack(state.settings.activeSeries, { force: true }).finally(() => applyUiState());

    state.ui.vol.addEventListener("input", () => {
      const v = Number(state.ui.vol.value);
      setVolume(v);
      if (state.ui.volVal) state.ui.volVal.textContent = `${Math.round(clamp(v, 0, 1) * 100)}%`;
    });

    state.ui.close.addEventListener("click", () => {
      state.settings.uiOpen = false;
      void save({ uiOpen: false });
      applyUiState();
    });

    attachDrag();
    attachResizeObserver();
    applyUiState();

    // Some pages require a user gesture before AudioContext can start.
    // Show a tiny hint until we know audio is running.
    window.setTimeout(() => {
      try {
        const ctx = state.audio.ctx;
        const show = !ctx || ctx.state === "suspended";
        if (state.ui.audioHint) state.ui.audioHint.style.display = show ? "block" : "none";
      } catch {
        // ignore
      }
    }, 300);
  }

  function attachResizeObserver() {
    if (!state.ui.wrap) return;
    const ro = new ResizeObserver(() => {
      const r = state.ui.wrap.getBoundingClientRect();
      const w = clamp(Math.round(r.width), 220, Math.floor(window.innerWidth * 0.9));
      const h = clamp(Math.round(r.height), 180, Math.floor(window.innerHeight * 0.9));
      state.settings.size = { w, h };
      void save({ size: state.settings.size });
    });
    ro.observe(state.ui.wrap);
  }

  function attachDrag() {
    const hdr = state.ui.hdr;
    const host = state.ui.host;
    if (!hdr || !host) return;

    const onMove = (e) => {
      if (!state.drag.on) return;
      e.preventDefault();
      const nx = clamp(e.clientX - state.drag.dx, 6, window.innerWidth - 60);
      const ny = clamp(e.clientY - state.drag.dy, 6, window.innerHeight - 60);
      host.style.left = `${Math.round(nx)}px`;
      host.style.top = `${Math.round(ny)}px`;
      host.style.right = "auto";
      state.settings.pos = { top: Math.round(ny), right: null, left: Math.round(nx) };
    };

    const onUp = () => {
      if (!state.drag.on) return;
      state.drag.on = false;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      const pos = state.settings.pos || {};
      void save({ pos });
    };

    hdr.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = host.getBoundingClientRect();
      state.drag.on = true;
      state.drag.dx = e.clientX - r.left;
      state.drag.dy = e.clientY - r.top;
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    });
  }

  function applySavedPosition() {
    const host = state.ui.host;
    if (!host) return;
    const pos = state.settings.pos || {};
    const top = Number(pos.top);
    const left = Number(pos.left);
    const right = Number(pos.right);
    if (Number.isFinite(left)) {
      host.style.left = `${Math.round(left)}px`;
      host.style.top = `${Math.round(Number.isFinite(top) ? top : 14)}px`;
      host.style.right = "auto";
      return;
    }
    host.style.left = "auto";
    host.style.top = `${Math.round(Number.isFinite(top) ? top : 14)}px`;
    host.style.right = `${Math.round(Number.isFinite(right) ? right : 14)}px`;
  }

  function openUi(open, opts = {}) {
    state.settings.uiOpen = !!open;
    if (opts.persist !== false) {
      void save({ uiOpen: state.settings.uiOpen });
    }
    if (!state.mounted) mountUi();
    applySavedPosition();
    applyUiState();
  }

  function toggleUi() {
    openUi(!state.settings.uiOpen);
  }

  function onKeyDown(e) {
    if (!isActiveInstance()) return;
    if (!state.settings.enabled) return;
    if (e.repeat) return;
    // Avoid double-handling if we listen on both window and document.
    try {
      if (e.__soundtypeHandled) return;
      e.__soundtypeHandled = true;
    } catch {
      // ignore
    }
    // Robust dedupe in case the event object is non-extensible (prevents window+document duplicate handling).
    try {
      const sig = `${String(e.timeStamp)}|${String(e.code || "")}|${String(e.key || "")}|${String(e.location || 0)}`;
      const now = performance.now();
      if (sig && sig === state.audio.lastKeySig && now - (Number(state.audio.lastKeySigAt) || 0) < 25) return;
      state.audio.lastKeySig = sig;
      state.audio.lastKeySigAt = now;
    } catch {
      // ignore
    }
    // Don't play typing sounds while the user is interacting with the SoundType panel itself.
    // (Prevents e.g. Space/Enter on a series button from playing the previously active series.)
    try {
      const host = state.ui.host;
      if (host && typeof e.composedPath === "function") {
        const path = e.composedPath();
        if (Array.isArray(path) && path.includes(host)) return;
      }
    } catch {
      // ignore
    }
    // Ignore system-only chords.
    if (e.metaKey && (e.key === "Meta" || e.key === "OS")) return;
    // In some complex apps (Google Docs), key events may happen in a child frame. Forward to top so
    // audio always plays from a single AudioContext and isn't blocked by iframe policies.
    if (!IS_TOP) {
      try {
        // Only forward for same-origin frames; otherwise play locally (we can't safely coordinate with top).
        let topOrigin = null;
        try {
          topOrigin = window.top.location.origin;
        } catch {
          topOrigin = null;
        }
        if (topOrigin && topOrigin === window.location.origin) {
          // Don't send the seriesId (iframe state can lag); the top frame uses the latest saved state.
          window.top.postMessage({ type: "ST_PLAY_SERIES" }, window.location.origin);
          return;
        }
      } catch {
        // ignore
      }
      void playSeriesSound(state.settings.activeSeries);
      return;
    }
    void playSeriesSound(state.settings.activeSeries);
  }

  function boot() {
    loadSettings()
      .then(() => {
        // Attach at both window and document capture to survive apps that aggressively stop propagation (e.g. Google Docs).
        window.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        registerCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
        registerCleanup(() => document.removeEventListener("keydown", onKeyDown, true));

        if (IS_TOP) {
          // Listen for forwarded key events from child frames (only accept same-origin frames).
          const onForwardedMessage = (ev) => {
            try {
              if (!isActiveInstance()) return;
              if (!state.settings.enabled) return;
              if (!ev || ev.origin !== window.location.origin) return;
              const d = ev.data;
              if (!d || typeof d !== "object") return;
              if (d.type !== "ST_PLAY_SERIES") return;
              void playSeriesSound(state.settings.activeSeries);
            } catch {
              // ignore
            }
          };
          window.addEventListener("message", onForwardedMessage, true);
          registerCleanup(() => window.removeEventListener("message", onForwardedMessage, true));
        }
        // Keep settings in sync across frames (Google Docs uses iframes).
        try {
          const onStorageChanged = (changes, area) => {
            if (area !== STORAGE_AREA) return;
            const next = {};
            for (const k of Object.keys(changes || {})) next[k] = changes[k]?.newValue;
            applySettingsUpdate(next);
            if (IS_TOP) {
              // If UI exists, update it.
              if (state.mounted) {
                applySavedPosition();
                applyUiState();
              }
            }
          };
          chrome.storage.onChanged.addListener(onStorageChanged);
          registerCleanup(() => chrome.storage.onChanged.removeListener(onStorageChanged));
        } catch {
          // ignore
        }

        if (IS_TOP) {
          if (state.settings.autoOpen) openUi(true, { persist: false });
          else if (state.settings.uiOpen) openUi(true, { persist: false });
        }
      })
      .catch(() => {});
  }

  // Note: keep a removable message listener so extension reloads don't stack listeners in the same tab.
  // (This matters if we ever inject/refresh without a full page reload.)
  const onRuntimeMessage = (msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;
    if (!isActiveInstance()) return;
    if (msg.type === "ST_TOGGLE_UI") {
      if (IS_TOP) {
        if (!state.mounted) mountUi();
        toggleUi();
        sendResponse?.({ ok: true });
      } else {
        sendResponse?.({ ok: false, ignored: true });
      }
      return;
    }
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  registerCleanup(() => chrome.runtime.onMessage.removeListener(onRuntimeMessage));
  registerCleanup(() => {
    try {
      stopActiveSounds();
    } catch {
      // ignore
    }
    try {
      state.audio.ctx?.close?.();
    } catch {
      // ignore
    }
    state.audio.ctx = null;
    state.audio.master = null;
  });

  boot();
})();
