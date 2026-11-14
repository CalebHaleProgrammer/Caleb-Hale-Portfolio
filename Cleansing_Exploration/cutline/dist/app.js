import {
  HEADER_HEIGHT,
  NODE_WIDTH,
  PORT_HEIGHT,
  addBlock,
  applyLayout,
  arrange,
  audioGain,
  blankProject,
  catalog,
  cloneDefinition,
  compile,
  connect,
  connectionBetween,
  copy,
  createBlock,
  currentDefinitions,
  describeNode,
  disconnectPin,
  drawLayer,
  duplicateBlock,
  duration,
  fastDetectors,
  freshEdit,
  importDraft,
  insertConnected,
  latest,
  linearSteps,
  makeClip,
  migrateProject,
  normalizeOverrides,
  placeholderBindings,
  portPoint,
  projectEnd,
  reference,
  referenceDiff,
  regionClip,
  remapDefinition,
  removeBlock,
  resolveReference,
  setPolicy,
  sourceAt,
  uid,
  validRegion,
  validateDraft,
  validateProject,
  valueAt,
  walkSteps,
  wirePath,
  withMode
} from "./chunks/chunk-PG5JINCA.js";
import {
  IndexedDBSignalCache,
  PipelineEngine,
  projectSelection
} from "./chunks/chunk-VDEFAL7U.js";
import {
  clone,
  compatible,
  example,
  media,
  node,
  port,
  serialize,
  validateGraph
} from "./chunks/chunk-T3E6QFBJ.js";

// src/engine.ts
var db = (v) => 20 * Math.log10(Math.max(1e-10, v));
function detectQuiet(e, c, p) {
  const lo = Math.floor(c.sourceIn / e.step), hi = Math.min(e.rms.length, Math.ceil(c.sourceOut / e.step));
  const runs = [];
  for (let i = lo; i < hi; i++) {
    const level = db(e.rms[i] * audioGain(c, c.start + (i * e.step - c.sourceIn) / c.rate)), quiet = level < Number(p.threshold);
    const last = runs.at(-1);
    if (last && last.quiet === quiet) {
      last.end = (i + 1) * e.step;
      last.peak = Math.max(last.peak, level);
    } else runs.push({ start: i * e.step, end: (i + 1) * e.step, quiet, peak: level });
  }
  for (let i = 1; i < runs.length - 1; i++) if (!runs[i].quiet && runs[i - 1].quiet && runs[i + 1].quiet && (runs[i].end - runs[i].start) / c.rate <= Number(p.burstDuration) + 1e-8 && runs[i].peak <= Number(p.burstCeiling)) runs[i].quiet = true;
  const merged = [];
  for (const r of runs.filter((r2) => r2.quiet)) {
    const last = merged.at(-1);
    if (last && r.start <= last.end + 1e-6) last.end = r.end;
    else merged.push({ start: Math.max(c.sourceIn, r.start), end: Math.min(c.sourceOut, r.end) });
  }
  return merged.filter((r) => (r.end - r.start) / c.rate >= Number(p.minQuiet));
}
function loudness(e, c) {
  const lo = Math.floor(c.sourceIn / e.step), hi = Math.min(e.rms.length, Math.ceil(c.sourceOut / e.step));
  let peak = 0;
  for (let i = lo; i < hi; i++) peak = Math.max(peak, e.peak[i] * audioGain(c, c.start + (i * e.step - c.sourceIn) / c.rate));
  const blocks = [];
  const n = Math.max(1, Math.round(0.4 / e.step)), hop = Math.max(1, Math.round(0.1 / e.step));
  for (let i = lo; i < hi; i += hop) {
    let sum = 0, count = 0;
    for (let j = i; j < Math.min(hi, i + n); j++) {
      const gain = audioGain(c, c.start + (j * e.step - c.sourceIn) / c.rate);
      sum += e.weighted[j] * gain * gain;
      count++;
    }
    const energy = sum / Math.max(1, count);
    if (-0.691 + 10 * Math.log10(Math.max(energy, 1e-15)) > -70) blocks.push(energy);
  }
  const mean = blocks.reduce((a, b) => a + b, 0) / Math.max(1, blocks.length), gate = mean / 10;
  const gated = blocks.filter((v) => v >= gate), integrated = gated.reduce((a, b) => a + b, 0) / Math.max(1, gated.length);
  return { lufs: integrated > 0 ? -0.691 + 10 * Math.log10(integrated) : -Infinity, peak: db(peak) };
}
function piece(c, sourceIn, sourceOut, start, quiet) {
  return { ...copy(c), id: uid(), sourceIn, sourceOut, start, quiet };
}
function shortenQuiet(c, ranges, retain) {
  if (!Number.isFinite(retain) || retain < 0) throw Error("Retained quiet duration must be zero or greater.");
  const clips = [], changes = [];
  let source = c.sourceIn, at = c.start;
  const add = (a, b, q) => {
    if (b - a > 1e-7) {
      const next = piece(c, a, b, at, q);
      clips.push(next);
      at += duration(next);
    }
  };
  for (const r of ranges) {
    add(source, r.start, false);
    const length = (r.end - r.start) / c.rate;
    if (length > retain + 1e-7) {
      const edge = retain * c.rate / 2;
      add(r.start, r.start + edge, true);
      add(r.end - edge, r.end, true);
      changes.push({ type: "cut", start: c.start + (r.start - c.sourceIn) / c.rate + retain / 2, end: c.start + (r.end - c.sourceIn) / c.rate - retain / 2, description: `Shorten ${length.toFixed(2)}s quiet to ${retain}s` });
    } else add(r.start, r.end, true);
    source = r.end;
  }
  add(source, c.sourceOut, false);
  return { clips: ranges.length ? clips : [copy(c)], changes };
}
function replaceClips(p, before, after) {
  if (!before.length) return p;
  const draft = copy(p), ids = new Set(before.map((c) => c.id)), oldStart = Math.min(...before.map((c) => c.start)), oldEnd = Math.max(...before.map((c) => c.start + duration(c)));
  const newEnd = after.length ? Math.max(...after.map((c) => c.start + duration(c))) : oldStart, delta = newEnd - oldEnd;
  const main = before.some((c) => c.trackId === "main");
  draft.clips = draft.clips.filter((c) => !ids.has(c.id)).map((c) => ({ ...c, start: c.start >= oldEnd - 1e-7 && (main || c.trackId === before[0].trackId) ? Math.max(0, c.start + delta) : c.start })).concat(copy(after));
  if (main) draft.markers = draft.markers.map((m) => {
    if (m.time >= oldEnd) return { ...m, time: m.time + delta };
    const original = before.find((c) => m.time >= c.start && m.time < c.start + duration(c));
    if (!original) return m;
    const source = sourceAt(original, m.time), kept = after.find((c) => c.assetId === original.assetId && source >= c.sourceIn && source <= c.sourceOut);
    if (kept) return { ...m, time: kept.start + (source - kept.sourceIn) / kept.rate };
    const next = after.filter((c) => c.sourceIn > source).sort((a, b) => a.sourceIn - b.sourceIn)[0];
    return { ...m, time: next?.start ?? newEnd };
  });
  draft.proposals = draft.proposals.map((s) => s.before.every((c) => c.start >= oldEnd - 1e-7) && (main || s.before[0].trackId === before[0].trackId) ? { ...s, before: s.before.map((c) => ({ ...c, start: c.start + delta })), after: s.after.map((c) => ({ ...c, start: c.start + delta })), changes: s.changes.map((c) => ({ ...c, start: c.start + delta, end: c.end + delta })) } : s);
  draft.revision++;
  return draft;
}
async function processClip(original, steps, analyze, signal) {
  async function evaluate(initial, sequence, depth = 0) {
    if (depth > 24) throw Error("Conditional logic is nested too deeply.");
    let clips = copy(initial), automatic = copy(initial), suggested = false;
    const changes = [];
    const anchor = initial[0]?.start ?? original.start;
    for (const step of sequence) {
      signal?.throwIfAborted();
      let next = [];
      const local = [];
      let conditionalPending = false;
      for (const c of clips) {
        signal?.throwIfAborted();
        if (step.operation === "if") {
          let matches = false;
          const target = step.params.target;
          if (step.condition === "matches") matches = c.quiet;
          else if (step.condition === "duration") matches = (target !== "quiet" || c.quiet) && compare(duration(c), Number(step.params.value), String(step.params.compare ?? "gt"));
          else {
            const env = await analyze(c.assetId), hasAudio = env.hasAudio !== false && env.rms.length > 0;
            if (step.condition === "audio") matches = hasAudio;
            else matches = hasAudio && compare(loudness(env, c).lufs, Number(step.params.value), String(step.params.compare ?? "lt"));
          }
          if (step.params.invert === true) matches = !matches;
          const branch = await evaluate([c], matches ? step.then ?? [] : step.otherwise ?? [], depth + 1);
          next.push(...branch.pending);
          local.push(...branch.changes);
          conditionalPending ||= branch.suggested;
        } else if (step.operation === "detectQuiet" || step.operation === "quiet") {
          const env = await analyze(c.assetId);
          if (env.hasAudio === false) {
            next.push({ ...c, quiet: false });
            continue;
          }
          const ranges = detectQuiet(env, c, step.params);
          const result = shortenQuiet(c, ranges, step.operation === "detectQuiet" ? duration(c) + 1 : Number(step.params.retain));
          next.push(...result.clips);
          if (step.operation === "quiet") local.push(...result.changes);
        } else if (step.operation === "shorten") {
          if (step.params.target === "quiet" && !c.quiet) {
            next.push(c);
            continue;
          }
          const result = shortenQuiet(c, [{ start: c.sourceIn, end: c.sourceOut }], Number(step.params.retain));
          next.push(...result.clips.map((piece2) => ({ ...piece2, quiet: c.quiet })));
          local.push(...result.changes);
        } else if (step.operation === "speed") {
          const rate = Number(step.params.rate);
          if (!Number.isFinite(rate) || rate < 0.1 || rate > 8 || c.rate * rate > 8 || c.rate * rate < 0.1) throw Error("Resulting playback rate must be between 0.1\xD7 and 8\xD7.");
          const apply = step.params.target !== "quiet" || c.quiet;
          next.push({ ...c, rate: apply ? c.rate * rate : c.rate });
          if (apply && rate !== 1) local.push({ type: "speed", start: c.start, end: c.start + duration(c), description: `${c.quiet ? "Matching section" : "Clip"} \u2192 ${(c.rate * rate).toFixed(2)}\xD7` });
        } else if (step.operation === "normalize") {
          if (step.params.affected === "quiet" && !c.quiet) {
            next.push(c);
            continue;
          }
          const env = await analyze(c.assetId);
          if (env.hasAudio === false) {
            next.push(c);
            continue;
          }
          const m = loudness(env, c), target = Number(step.params.target), boost = Number(step.params.maxBoost), peak = Number(step.params.peak), gain = Number.isFinite(m.lufs) ? Math.min(target - m.lufs, boost, peak - m.peak) : 0;
          const adjusted = { ...copy(c), gainDb: c.gainDb + gain };
          if (adjusted.keyframes.gainDb) adjusted.keyframes.gainDb = adjusted.keyframes.gainDb.map((k) => ({ ...k, value: k.value + gain }));
          next.push(adjusted);
          if (Math.abs(gain) > 0.01) local.push({ type: "gain", start: c.start, end: c.start + duration(c), description: `Loudness ${m.lufs.toFixed(1)} LUFS \xB7 gain ${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB` });
        } else {
          if (duration(c) < Number(step.params.minDuration) || c.rate > Number(step.params.maxRate)) throw Error("Final checks failed: a segment is too short or too fast. No edits from this run were applied.");
          next.push(c);
        }
      }
      let at = anchor;
      clips = next.map((c) => {
        const result = { ...c, start: at };
        at += duration(c);
        return result;
      });
      if (local.length) {
        suggested ||= step.operation === "if" ? conditionalPending : step.mode === "suggested";
        changes.push(...local);
        if (!suggested) automatic = copy(clips);
      }
    }
    return { automatic, pending: clips, changes, suggested };
  }
  return evaluate([original], steps);
}
function compare(actual, expected, operator) {
  return operator === "lt" ? actual < expected : operator === "lte" ? actual <= expected : operator === "gte" ? actual >= expected : actual > expected;
}
async function runWorkflow(p, ids, steps, analyze, name, signal) {
  let draft = copy(p);
  const selected2 = p.clips.filter((c) => ids.includes(c.id)).sort((a, b) => b.start - a.start);
  if (!selected2.length) throw Error("Select at least one clip.");
  for (const original of selected2) {
    signal?.throwIfAborted();
    if (draft.proposals.some((s) => s.before.some((b) => b.id === original.id))) throw Error("Resolve the existing suggestion for this content first.");
    const result = await processClip(original, steps, analyze, signal);
    if (!result.changes.length) continue;
    if (result.suggested) {
      const base = result.automatic;
      if (JSON.stringify(base) !== JSON.stringify([original])) draft = replaceClips(draft, [original], base);
      const suggestion = { id: uid(), name, rootId: original.rootId, before: base, after: result.pending, changes: result.changes, revision: draft.revision };
      draft.proposals.push(suggestion);
    } else draft = replaceClips(draft, [original], result.pending);
  }
  return draft;
}
function acceptProposal(p, id) {
  const proposal = p.proposals.find((s) => s.id === id);
  if (!proposal) throw Error("Suggestion no longer exists.");
  const existing = p.clips.filter((c) => proposal.before.some((b) => b.id === c.id));
  if (JSON.stringify([...existing].sort((a, b) => a.id.localeCompare(b.id))) !== JSON.stringify([...proposal.before].sort((a, b) => a.id.localeCompare(b.id)))) throw Error("The clip has changed since analysis. Reject this suggestion and run the action again.");
  let result = replaceClips(p, proposal.before, proposal.after);
  result.proposals = result.proposals.filter((s) => s.id !== id);
  return result;
}
function splitClip(p, id, time) {
  const c = p.clips.find((c2) => c2.id === id);
  if (!c || time <= c.start + 1e-3 || time >= c.start + duration(c) - 1e-3) throw Error("Put the playhead inside the selected clip.");
  const t = sourceAt(c, time), left = { ...copy(c), sourceOut: t }, right = { ...copy(c), id: uid(), sourceIn: t, start: time };
  const result = copy(p);
  result.clips = result.clips.filter((x) => x.id !== id).concat(left, right);
  result.revision++;
  return result;
}
function selectTimeRange(p, from, to, trackIds) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) throw Error("Enter a valid time range.");
  const next = copy(p), ids = [];
  next.clips = p.clips.flatMap((c) => {
    if (trackIds && !trackIds.includes(c.trackId) || c.start >= to || c.start + duration(c) <= from) return [copy(c)];
    if (p.proposals.some((s) => s.before.some((b) => b.id === c.id))) throw Error("Resolve the existing suggestion in this region first.");
    const start = Math.max(from, c.start), end = Math.min(to, c.start + duration(c)), pieces = [];
    const add = (a, b, selected2) => {
      const part = { ...copy(c), id: pieces.length ? uid() : c.id, start: a, sourceIn: sourceAt(c, a), sourceOut: sourceAt(c, b) };
      pieces.push(part);
      if (selected2) ids.push(part.id);
    };
    if (start > c.start) add(c.start, start, false);
    add(start, end, true);
    if (end < c.start + duration(c)) add(end, c.start + duration(c), false);
    return pieces;
  });
  return { project: next, ids };
}

// src/pipeline/adapter.ts
function assetRevision(asset, contentHash) {
  if (!contentHash) throw Error("Provide a content hash; filename metadata is not a cache identity.");
  return { ...media(asset.id, asset.duration, asset.kind === "video" ? asset.hasAudio ? "av" : "video" : asset.kind), assetId: asset.id, mediaHash: contentHash };
}
function clipRevision(asset, clip, contentHash) {
  const result = assetRevision(asset, contentHash), duration2 = (clip.sourceOut - clip.sourceIn) / clip.rate;
  return { ...result, id: clip.id, parentId: asset.id, durationSec: duration2, crop: { left: clip.cropLeft ?? 0, right: clip.cropRight ?? 0, top: clip.cropTop ?? 0, bottom: clip.cropBottom ?? 0 }, timeMap: { segments: [{ outStart: 0, outEnd: duration2, srcStart: clip.sourceIn, srcEnd: clip.sourceOut, rate: clip.rate }] } };
}

// src/storage.ts
var database = new Promise((resolve, reject2) => {
  const request = indexedDB.open("cutline-editor-v1", 1);
  request.onupgradeneeded = () => {
    for (const name of ["files", "projects", "analysis"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject2(request.error);
});
async function put(store, key, value) {
  const db2 = await database;
  return new Promise((resolve, reject2) => {
    const tx = db2.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject2(tx.error);
    tx.onabort = () => reject2(tx.error);
  });
}
async function get(store, key) {
  const db2 = await database;
  return new Promise((resolve, reject2) => {
    const request = db2.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject2(request.error);
  });
}
function download(value, name) {
  const url = URL.createObjectURL(value), a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3e4);
}
function asDataURL(blob) {
  return new Promise((resolve, reject2) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject2(r.error);
    r.readAsDataURL(blob);
  });
}

// src/media.ts
var Media = class {
  worker = new Worker(new URL("./media-worker.js", import.meta.url), { type: "module" });
  pending = /* @__PURE__ */ new Map();
  files = /* @__PURE__ */ new Map();
  urls = /* @__PURE__ */ new Map();
  envelopes = /* @__PURE__ */ new Map();
  spectra = /* @__PURE__ */ new Map();
  thumbs = /* @__PURE__ */ new Map();
  thumbQueue = Promise.resolve();
  constructor() {
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      if ("progress" in e.data) {
        p.progress?.(e.data.progress, e.data.message, e.data.signal);
        return;
      }
      this.pending.delete(e.data.id);
      e.data.error ? p.reject(Error(e.data.error)) : p.resolve(e.data.result);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(Error(e.message || "Media worker failed"));
      this.pending.clear();
    };
  }
  task(action2, args, progress2, signal) {
    const id = uid();
    return new Promise((resolve, reject2) => {
      const cancel = () => this.worker.postMessage({ action: "cancel", job: id });
      if (signal?.aborted) {
        reject2(Error("Cancelled"));
        return;
      }
      signal?.addEventListener("abort", cancel, { once: true });
      this.pending.set(id, { resolve: (v) => {
        signal?.removeEventListener("abort", cancel);
        resolve(v);
      }, reject: (e) => {
        signal?.removeEventListener("abort", cancel);
        reject2(e);
      }, progress: progress2 });
      this.worker.postMessage({ id, action: action2, ...args });
    });
  }
  async register(id, file) {
    this.files.set(id, file);
    if (this.urls.has(id)) URL.revokeObjectURL(this.urls.get(id));
    this.urls.set(id, URL.createObjectURL(file));
    await this.task("register", { assetId: id, file });
  }
  async import(file, progress2) {
    const id = uid();
    await this.register(id, file);
    const info = await this.task("probe", { assetId: id }, progress2);
    const a = { id, name: file.name, kind: info.kind, width: info.width, height: info.height, duration: info.duration, hasAudio: info.hasAudio, size: file.size, fingerprint: `${file.name}:${file.size}:${file.lastModified}`, thumbnail: info.thumb ? await asDataURL(info.thumb) : void 0 };
    return a;
  }
  async analyze(id, progress2, signal) {
    if (this.envelopes.has(id)) return this.envelopes.get(id);
    const cached = await get("analysis", id);
    if (cached) {
      this.envelopes.set(id, cached);
      return cached;
    }
    const e = await this.task("analyze", { assetId: id }, progress2, signal);
    this.envelopes.set(id, e);
    await put("analysis", id, e);
    return e;
  }
  async restore(assets) {
    for (const a of assets) {
      const f = await get("files", a.id);
      if (f) await this.register(a.id, f);
    }
  }
  async release(id) {
    this.files.delete(id);
    this.envelopes.delete(id);
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
    await this.task("release", { assetId: id });
  }
  async thumbnail(id, time, wanted = () => true) {
    const key = `${id}:${time.toFixed(2)}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key);
    let result = "";
    const task = this.thumbQueue.then(async () => {
      if (!wanted()) return;
      if (this.thumbs.has(key)) {
        result = this.thumbs.get(key);
        return;
      }
      const blob = await this.task("thumbnail", { assetId: id, time });
      if (blob) {
        result = await asDataURL(blob);
        this.thumbs.set(key, result);
        if (this.thumbs.size > 120) this.thumbs.delete(this.thumbs.keys().next().value);
      }
    });
    this.thumbQueue = task.catch(() => {
    });
    await task;
    return result;
  }
};
var Preview = class {
  constructor(canvas, media3, update) {
    this.canvas = canvas;
    this.media = media3;
    this.update = update;
  }
  elements = /* @__PURE__ */ new Map();
  images = /* @__PURE__ */ new Map();
  audio;
  gains = /* @__PURE__ */ new Map();
  sources = /* @__PURE__ */ new Map();
  playing = false;
  time = 0;
  origin = 0;
  originTime = 0;
  project;
  raf = 0;
  drawing = false;
  setProject(p) {
    this.project = p;
    this.pause();
    this.render();
  }
  async ensureElement(id, asset) {
    if (!this.media.urls.has(asset.id)) return;
    if (this.elements.has(id)) {
      const existing = this.elements.get(id);
      if (existing.src === this.media.urls.get(asset.id)) return existing;
      existing.pause();
      this.sources.get(id)?.disconnect();
      this.sources.delete(id);
      this.gains.get(id)?.disconnect();
      this.gains.delete(id);
      this.elements.delete(id);
    }
    const el = document.createElement(asset.kind === "video" ? "video" : "audio");
    el.src = this.media.urls.get(asset.id);
    el.preload = "auto";
    if (el instanceof HTMLVideoElement) {
      el.playsInline = true;
      el.preservesPitch = true;
    }
    el.crossOrigin = "anonymous";
    el.addEventListener("loadeddata", () => setTimeout(() => void this.render(), 0), { once: true });
    this.elements.set(id, el);
    return el;
  }
  async seek(t) {
    this.time = Math.max(0, t);
    this.originTime = this.time;
    this.origin = performance.now();
    for (const el of this.elements.values()) el.pause();
    await this.render(true);
    this.update(this.time);
  }
  async play() {
    if (!this.project) return;
    this.audio ??= new AudioContext();
    await this.audio.resume();
    this.playing = true;
    this.originTime = this.time;
    this.origin = performance.now();
    this.tick();
  }
  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const el of this.elements.values()) el.pause();
  }
  tick = () => {
    if (!this.playing) return;
    this.time = this.originTime + (performance.now() - this.origin) / 1e3;
    const end = Math.max(0, ...this.project.clips.filter((c) => c.enabled).map((c) => c.start + duration(c)));
    if (this.time >= end) {
      this.time = end;
      this.pause();
    }
    this.update(this.time);
    void this.render();
    if (this.playing) this.raf = requestAnimationFrame(this.tick);
  };
  async render(seek = false) {
    if (this.drawing || !this.project) return;
    this.drawing = true;
    try {
      const p = this.project, ctx = this.canvas.getContext("2d");
      if (this.canvas.width !== p.width || this.canvas.height !== p.height) {
        this.canvas.width = p.width;
        this.canvas.height = p.height;
      }
      ctx.fillStyle = "#090d10";
      ctx.fillRect(0, 0, p.width, p.height);
      const active = p.clips.filter((c) => c.enabled && this.time >= c.start && this.time < c.start + duration(c) && !p.tracks.find((t) => t.id === c.trackId)?.muted), keep = new Set(active.map((c) => c.id));
      for (const [id, el] of this.elements) if (!keep.has(id)) {
        el.pause();
        this.sources.get(id)?.disconnect();
        this.sources.delete(id);
        this.gains.get(id)?.disconnect();
        this.gains.delete(id);
        el.removeAttribute("src");
        el.load();
        this.elements.delete(id);
      }
      const order = [...p.tracks].sort((a, b) => a.kind === "main" ? -1 : b.kind === "main" ? 1 : 0);
      for (const track of order) for (const c of active.filter((c2) => c2.trackId === track.id)) {
        const a = p.assets.find((a2) => a2.id === c.assetId);
        if (a.kind === "image") {
          if (!this.media.urls.has(a.id)) continue;
          if (!this.images.has(a.id) || this.images.get(a.id).src !== this.media.urls.get(a.id)) {
            const im = new Image();
            im.src = this.media.urls.get(a.id);
            await im.decode();
            this.images.set(a.id, im);
          }
          drawLayer(ctx, this.images.get(a.id), p.width, p.height, c, this.time);
          continue;
        }
        const el = await this.ensureElement(c.id, a);
        if (!el) continue;
        const t = sourceAt(c, this.time);
        el.playbackRate = c.rate;
        if (seek || Math.abs(el.currentTime - t) > 0.2) {
          el.currentTime = t;
          if (el.readyState < 2 || el.seeking) await Promise.race([new Promise((r) => el.addEventListener("seeked", () => r(), { once: true })), new Promise((r) => setTimeout(r, 150))]);
        }
        if (this.audio && a.hasAudio) {
          if (!this.gains.has(c.id)) {
            const gain = this.audio.createGain(), source = this.audio.createMediaElementSource(el);
            source.connect(gain);
            gain.connect(this.audio.destination);
            this.sources.set(c.id, source);
            this.gains.set(c.id, gain);
          }
          this.gains.get(c.id).gain.value = audioGain(c, this.time);
          el.volume = 1;
        } else el.volume = Math.min(1, audioGain(c, this.time));
        if (this.playing && el.paused) void el.play().catch(() => {
        });
        if (a.kind === "video" && el.readyState >= 2) drawLayer(ctx, el, p.width, p.height, c, this.time);
      }
      for (const id of this.images.keys()) if (!active.some((c) => c.assetId === id)) this.images.delete(id);
    } finally {
      this.drawing = false;
    }
  }
};

// src/storyboard.ts
function linearScale(end, zoom2) {
  return { times: [0, end], positions: [0, end * zoom2], width: end * zoom2, toX: (t) => t * zoom2, toTime: (x) => x / zoom2 };
}
function structureScale(p, minimum = 32, compression = 18) {
  const times = [...new Set([0, ...p.clips.flatMap((c) => [c.start, c.start + duration(c)]), ...p.markers.map((m) => m.time)].filter((t) => Number.isFinite(t) && t >= 0).map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
  if (times.length === 1) times.push(Math.max(60, projectEnd(p)));
  const positions = [0];
  for (let i = 1; i < times.length; i++) positions.push(positions[i - 1] + Math.max(8, minimum) + Math.max(0, compression) * Math.log1p(times[i] - times[i - 1]));
  function map(value, from, to) {
    let lo = 0, hi = from.length - 1;
    if (value <= from[0]) return to[0] + (value - from[0]) * (to[1] - to[0]) / (from[1] - from[0]);
    if (value >= from[hi]) return to[hi] + (value - from[hi]) * (to[hi] - to[hi - 1]) / (from[hi] - from[hi - 1]);
    while (hi - lo > 1) {
      const mid = lo + hi >> 1;
      if (value < from[mid]) hi = mid;
      else lo = mid;
    }
    return to[lo] + (value - from[lo]) * (to[hi] - to[lo]) / (from[hi] - from[lo]);
  }
  return { times, positions, width: positions.at(-1), toX: (t) => map(t, times, positions), toTime: (x) => map(x, positions, times) };
}

// src/markers.ts
function regionBounds(p, region) {
  const endpoints = region.markerIds.map((id) => p.markers.find((m) => m.id === id));
  if (endpoints.some((m) => !m)) return;
  return [Math.min(endpoints[0].time, endpoints[1].time), Math.max(endpoints[0].time, endpoints[1].time)];
}
function regionForMarker(p, id) {
  return p.regions?.find((r) => r.markerIds.includes(id));
}
function moveMarker(p, id, time) {
  if (!Number.isFinite(time) || time < 0) throw Error("Choose a valid marker time.");
  const next = copy(p), marker = next.markers.find((m) => m.id === id);
  if (!marker) throw Error("Marker no longer exists.");
  marker.time = time;
  return next;
}
function createMarkedRegion(p, markerId, time) {
  if (!Number.isFinite(time) || time < 0) throw Error("Choose a valid region endpoint.");
  const next = copy(p), original = next.markers.find((m) => m.id === markerId);
  if (!original) throw Error("Marker no longer exists.");
  if (Math.abs(original.time - time) < 1e-3) throw Error("Drag away from the marker to mark a region.");
  const anchor = regionForMarker(next, markerId) ? { ...copy(original), id: uid() } : original;
  if (anchor !== original) next.markers.push(anchor);
  const end = { ...copy(anchor), id: uid(), time, name: `${anchor.name} \xB7 other end` };
  next.markers.push(end);
  const region = { id: uid(), name: anchor.name, color: anchor.color ?? "#efc17b", markerIds: [anchor.id, end.id] };
  (next.regions ??= []).push(region);
  return { project: next, regionId: region.id };
}
function deleteMarker(p, id) {
  const next = copy(p);
  next.markers = next.markers.filter((m) => m.id !== id);
  next.regions = next.regions?.filter((r) => !r.markerIds.includes(id));
  return next;
}

// src/timeline-view.ts
var esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var short = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
function renderTracks(host, scroller, o) {
  const { project: p, scale, media: media3, icon: icon2 } = o, visible = scroller.clientWidth || 1e3, left = Math.max(0, scroller.scrollLeft - 220), right = scroller.scrollLeft + visible + 220, width = Math.max(visible - 120, scale.width + 100), ticks = [];
  const rowEnds = [];
  const regions = (p.regions ?? []).flatMap((r) => {
    const bounds = regionBounds(p, r);
    return bounds ? [{ ...r, start: bounds[0], end: bounds[1] }] : [];
  }).sort((a, b) => a.start - b.start).map((r) => {
    let row = rowEnds.findIndex((end) => end < scale.toX(r.start) - 4);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = Math.max(scale.toX(r.end), scale.toX(r.start) + 8);
    return { ...r, row };
  });
  const times = o.structure ? scale.times : (() => {
    const interval = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800].find((i) => i * o.zoom >= 65) ?? 1800;
    const values = [];
    for (let t = Math.max(0, Math.floor(scale.toTime(left) / interval) * interval); t <= scale.toTime(right) + interval; t += interval) values.push(t);
    return values;
  })();
  let last = -1e6;
  for (const t of times) {
    const x = scale.toX(t);
    if (x < left || x > right) continue;
    const label = x - last >= 62;
    if (label) last = x;
    ticks.push(`<div class="ruler-tick${o.structure ? " structural" : ""}" style="left:${x}px" title="${t.toFixed(3)} seconds">${label ? `<span>${short(t)}</span>` : ""}</div>`);
  }
  host.style.width = `${width + 120}px`;
  host.classList.toggle("structure-view", o.structure);
  host.innerHTML = `<div class="ruler${regions.length ? " has-regions" : ""}" data-ruler style="height:${30 + rowEnds.length * 22}px">${ticks.join("")}${regions.map((r) => `<button class="marked-region" data-region="${esc(r.id)}" style="left:${scale.toX(r.start)}px;width:${Math.max(8, scale.toX(r.end) - scale.toX(r.start))}px;top:${30 + r.row * 22}px;--region-color:${/^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#efc17b"}" title="${esc(r.name)} \xB7 ${r.start.toFixed(2)}\u2013${r.end.toFixed(2)}s \xB7 click to edit or run a workflow" aria-label="Edit marked region ${esc(r.name)}"><span>${esc(r.name)}</span></button>`).join("")}${p.markers.map((m) => `<button class="marker-flag" data-marker="${esc(m.id)}" title="${esc(m.name)} \xB7 drag to move \xB7 Shift-drag to mark a region" aria-label="Edit marker ${esc(m.name)}" style="left:${scale.toX(m.time)}px;--marker-color:${/^#[0-9a-f]{6}$/i.test(m.color ?? "") ? m.color : "#efc17b"}">${icon2("marker")}<span>${esc(m.name)}</span></button>`).join("")}</div>${[...p.tracks].reverse().map((t) => `<div class="track-row"><div class="track-label">${icon2(t.kind === "audio" ? "audio" : "video")}<span>${esc(t.name)}</span><button class="icon ghost${t.muted ? " muted-track" : ""}" data-mute="${esc(t.id)}" title="Toggle track">${icon2(t.muted ? "mute" : "sound")}</button></div><div class="track-lane" data-lane="${esc(t.id)}">${o.structure ? scale.positions.filter((x) => x >= left && x <= right).map((x) => `<span class="structure-boundary" style="left:${x}px"></span>`).join("") : ""}${p.clips.filter((c) => c.trackId === t.id && scale.toX(c.start + duration(c)) >= left && scale.toX(c.start) <= right).map((c) => {
    const x = scale.toX(c.start), end = scale.toX(c.start + duration(c)), visualLeft = Math.max(0, left - x), visualWidth = Math.max(1, Math.min(end, right) - Math.max(x, left));
    return `<div class="clip ${t.kind}${c.id === o.selected ? " selected" : ""}${c.enabled ? "" : " disabled"}" data-clip="${esc(c.id)}" style="left:${x}px;width:${Math.max(3, end - x)}px" title="${esc(c.name)} \xB7 ${duration(c).toFixed(2)}s"><span class="clip-edge left" data-edge="left"></span><span class="clip-name" style="left:${visualLeft}px">${esc(c.name)}</span><span class="clip-sub" style="left:${visualLeft}px">${c.rate !== 1 ? `${c.rate.toFixed(2)}\xD7 \xB7 ` : ""}${short(duration(c))}${c.quiet ? " \xB7 matching" : ""}</span><canvas data-visual="${esc(c.id)}" data-x="${x + visualLeft}" style="left:${visualLeft}px;width:${visualWidth}px"></canvas>${Object.values(c.keyframes).flatMap((keys) => keys?.filter((k) => k.time >= c.sourceIn && k.time <= c.sourceOut).map((k) => `<span class="clip-key" style="left:${scale.toX(c.start + (k.time - c.sourceIn) / c.rate) - x}px"></span>`) ?? []).join("")}<span class="clip-edge right" data-edge="right"></span></div>`;
  }).join("")}${p.proposals.filter((s) => s.before[0]?.trackId === t.id).map((s) => {
    const start = Math.min(...s.before.map((c) => c.start)), end = Math.max(...s.before.map((c) => c.start + duration(c)));
    return `<div class="suggestion-band" data-proposal="${s.id}" style="left:${scale.toX(start)}px;width:${scale.toX(end) - scale.toX(start)}px"><span>${s.changes.length} suggested \xB7 click to review</span></div>`;
  }).join("")}</div></div>`).join("")}<div class="playhead" style="left:${120 + scale.toX(o.playhead)}px"></div>`;
  requestAnimationFrame(() => host.querySelectorAll("[data-visual]").forEach((canvas) => {
    const c = p.clips.find((c2) => c2.id === canvas.dataset.visual), asset = p.assets.find((a) => a.id === c.assetId), x0 = Number(canvas.dataset.x);
    canvas.width = Math.min(1800, Math.max(1, Math.ceil(parseFloat(canvas.style.width))));
    canvas.height = o.structure ? 56 : 30;
    const ctx = canvas.getContext("2d"), pixelScale = parseFloat(canvas.style.width) / canvas.width;
    const source = (x) => sourceAt(c, scale.toTime(x0 + x * pixelScale));
    function paintAudio() {
      const e = media3.envelopes.get(c.assetId), s = media3.spectra.get(c.assetId);
      if (o.audioView === "none") return;
      if (o.audioView === "frequency" && s) {
        const image = ctx.createImageData(canvas.width, canvas.height);
        for (let x = 0; x < canvas.width; x++) {
          const column = Math.max(0, Math.min(s.columns - 1, Math.floor(source(x) / s.step)));
          for (let y = 0; y < canvas.height; y++) {
            const bin = Math.min(s.bins - 1, Math.floor((1 - y / canvas.height) * s.bins)), v = s.data[column * s.bins + bin] / 255, at = (y * canvas.width + x) * 4;
            image.data[at] = 20 + 230 * v * v;
            image.data[at + 1] = 25 + 180 * v;
            image.data[at + 2] = 55 + 75 * v;
            image.data[at + 3] = 225;
          }
        }
        ctx.putImageData(image, 0, 0);
        return;
      }
      if (!e) return;
      ctx.strokeStyle = "#c4ecd6";
      ctx.fillStyle = "#a9d4bd";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < canvas.width; x += o.audioView === "levels" ? 4 : 1) {
        const t = source(x), index = Math.max(0, Math.min(e.rms.length - 1, Math.floor(t / e.step))), amp = e.rms[index] * audioGain(c, c.start + (t - c.sourceIn) / c.rate), height = canvas.height * (o.audioView === "levels" ? Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-6, amp)) + 60) / 60)) : Math.min(0.48, amp * 2));
        if (o.audioView === "levels") ctx.fillRect(x, canvas.height - height, 2, height);
        else {
          ctx.moveTo(x, canvas.height / 2 - height);
          ctx.lineTo(x, canvas.height / 2 + height);
        }
      }
      ctx.stroke();
    }
    paintAudio();
    if (o.videoView === "filmstrip" && asset.kind !== "audio" && asset.thumbnail) {
      const tiles = Math.min(8, Math.max(1, Math.ceil(canvas.width / 100))), tileWidth = canvas.width / tiles;
      for (let i = 0; i < tiles; i++) {
        const draw = (url) => {
          const image = new Image();
          image.onload = () => {
            if (!canvas.isConnected) return;
            ctx.globalAlpha = 0.55;
            ctx.drawImage(image, i * tileWidth, 0, tileWidth, canvas.height);
            ctx.globalAlpha = 1;
            paintAudio();
          };
          image.src = url;
        };
        draw(asset.thumbnail);
        if (asset.kind === "video" && media3.files.has(asset.id)) void media3.thumbnail(asset.id, Math.max(c.sourceIn, Math.min(c.sourceOut - 1e-3, source((i + 0.5) * tileWidth))), () => canvas.isConnected).then((url) => {
          if (url) draw(url);
        }).catch(() => {
        });
      }
    }
  }));
}

// src/player-view.ts
function playerSize(availableWidth, availableHeight, videoWidth, videoHeight, mode = "fit") {
  if (availableWidth <= 0 || availableHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) return { width: 0, height: 0 };
  const scale = mode === "actual" ? 1 : mode === "fill" ? Math.max(availableWidth / videoWidth, availableHeight / videoHeight) : Math.min(availableWidth / videoWidth, availableHeight / videoHeight);
  return { width: videoWidth * scale, height: videoHeight * scale };
}

// src/marker-drag.ts
function startMarkerDrag(event, h) {
  const flag = event.target.closest("[data-marker]");
  if (!flag || event.button !== 0) return false;
  const p = h.project(), marker = p.markers.find((m) => m.id === flag.dataset.marker);
  if (!marker) return false;
  const scale = h.scale(), scroller = h.scroller, ruler = flag.closest("[data-ruler]"), startX = event.clientX, startScroll = scroller.scrollLeft, copying = event.shiftKey, region = regionForMarker(p, marker.id);
  let moved = false, time = marker.time, pointerX = startX, frame = 0, previewFlag, previewBand;
  h.stop();
  const targets2 = [0, ...p.markers.filter((m) => m.id !== marker.id).map((m) => m.time), ...p.clips.flatMap((c) => [c.start, c.start + duration(c)])];
  function paint() {
    const x = scale.toX(marker.time) + pointerX - startX + scroller.scrollLeft - startScroll;
    const snap = targets2.find((t) => Math.abs(scale.toX(t) - x) < 7);
    time = Math.max(0, snap ?? scale.toTime(x));
    const host = ruler.parentElement;
    host.style.width = `${Math.max(parseFloat(host.style.width) || 0, scale.toX(time) + 240)}px`;
    const moving = copying ? previewFlag : flag;
    moving.style.left = `${scale.toX(time)}px`;
    if (copying) {
      const a = scale.toX(marker.time), b = scale.toX(time);
      previewBand.style.left = `${Math.min(a, b)}px`;
      previewBand.style.width = `${Math.max(2, Math.abs(a - b))}px`;
    } else if (region) {
      const band = Array.from(ruler.querySelectorAll("[data-region]")).find((b) => b.dataset.region === region.id), other = p.markers.find((m) => m.id === region.markerIds.find((id) => id !== marker.id));
      if (band && other) {
        const a = scale.toX(other.time), b = scale.toX(time);
        band.style.left = `${Math.min(a, b)}px`;
        band.style.width = `${Math.max(2, Math.abs(a - b))}px`;
      }
    }
    moving.title = `${time.toFixed(2)}s`;
  }
  function scroll() {
    if (!moved) return;
    const rect = scroller.getBoundingClientRect(), delta = pointerX > rect.right - 36 ? Math.min(18, (pointerX - rect.right + 36) / 2) : pointerX < rect.left + 150 ? -Math.min(18, (rect.left + 150 - pointerX) / 2) : 0;
    if (delta) {
      scroller.scrollLeft = Math.max(0, scroller.scrollLeft + delta);
      paint();
    }
    frame = requestAnimationFrame(scroll);
  }
  const move = (e) => {
    if (e.pointerId !== event.pointerId) return;
    pointerX = e.clientX;
    if (!moved && Math.abs(pointerX - startX) < 3) return;
    if (!moved) {
      moved = true;
      h.active(true);
      scroller.setPointerCapture(event.pointerId);
      flag.classList.add("dragging");
      if (copying) {
        previewFlag = flag.cloneNode(true);
        previewFlag.removeAttribute("data-marker");
        previewFlag.classList.add("marker-drag-preview");
        ruler.append(previewFlag);
        previewBand = document.createElement("span");
        previewBand.className = "marked-region region-drag-preview";
        previewBand.style.setProperty("--region-color", marker.color ?? "#efc17b");
        previewBand.style.top = `${ruler.clientHeight}px`;
        ruler.style.height = `${ruler.clientHeight + 22}px`;
        ruler.append(previewBand);
      }
      frame = requestAnimationFrame(scroll);
    }
    e.preventDefault();
    paint();
  };
  const finish = (e) => {
    if (e.pointerId !== event.pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel);
    cancelAnimationFrame(frame);
    if (scroller.hasPointerCapture(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
    if (!moved) return;
    h.active(false);
    h.suppressClick();
    if (e.type === "pointercancel") {
      h.render();
      return;
    }
    try {
      if (copying) {
        h.commit(createMarkedRegion(p, marker.id, time).project);
        h.toast("Marked region created. Click its band to run an edit.");
      } else h.commit(moveMarker(p, marker.id, time));
    } catch (error) {
      h.render();
      h.toast(error.message, true);
    }
  };
  const cancel = (e) => finish(e);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", cancel);
  return true;
}

// src/pipeline/workflows.ts
var operationLabels = { detectQuiet: "Quiet sections", quiet: "Shorten quiet sections", shorten: "Shorten sections", speed: "Playback speed", normalize: "Normalize audio", check: "Check result" };
function stepNode(step, name) {
  const kind = step.type === "condition" ? "condition" : step.type === "operation" && ["detectQuiet", "quiet"].includes(step.operation) ? "detection" : "action";
  return node(step.id, kind, { legacyStep: copy(step) }, [port("media", "media")], "media");
}
function stepName(step) {
  return step.type === "operation" ? operationLabels[step.operation] : step.type === "condition" ? "If / Then / Otherwise" : "Reusable Edit";
}
function definitionGraph(d, library = []) {
  const source = node(`source:${d.id}`, "media", {}, [], "av");
  source.name = "Media";
  const nodes = [source, ...d.steps.map((s) => {
    const n = stepNode(s);
    n.name = s.type === "reference" ? library.filter((d2) => d2.id === s.definitionId).sort((a, b) => b.version - a.version)[0]?.name ?? "Reusable Edit" : stepName(s);
    return n;
  })];
  return arrange({ schemaVersion: 1, id: d.id, name: d.name, version: Math.max(1, d.version), workflow: { kind: d.kind, mode: d.mode, description: d.description, initial: d.initial }, nodes, connections: nodes.slice(1).map((n, i) => ({ from: { node: nodes[i].id, port: "out" }, to: { node: n.id, port: "media" } })), slots: [{ id: source.id, name: "Media", type: "av", nodeId: source.id, required: true }], history: [] });
}
function graphDefinition(g, depth = 0) {
  if (depth > 24) throw Error("Conditional branches are nested too deeply.");
  for (const n of g.nodes) for (const draft of Object.values(n.params.branchDrafts ?? {})) graphDefinition(draft, depth + 1);
  if (!g.workflow) throw Error("This is a signal graph, not a reusable timeline Edit.");
  if (g.slots.length !== 1) throw Error("A timeline Edit needs one Media input. Use signal pipelines for multiple synchronized inputs.");
  validateGraph(g, placeholderBindings(g));
  const source = g.nodes.find((n) => g.slots.some((s) => s.nodeId === n.id));
  if (!source) throw Error("Add a Media input.");
  const steps = [], visited = /* @__PURE__ */ new Set([source.id]);
  let at = source.id;
  while (true) {
    const links = g.connections.filter((c) => c.from.node === at && c.from.port === "out" && c.to.port === "media");
    if (links.length > 1) throw Error("Chain timeline actions in one path. Put conditional choices inside Decide.");
    if (!links.length) break;
    const n = g.nodes.find((n2) => n2.id === links[0].to.node);
    if (visited.has(n.id)) throw Error("Remove the cycle from this Edit.");
    visited.add(n.id);
    if (!n.params.legacyStep) throw Error(`${n.name}: use a timeline Action, Decide or reusable Edit in this path.`);
    steps.push(copy(n.params.legacyStep));
    at = n.id;
  }
  if (g.nodes.some((n) => n.params.legacyStep && !visited.has(n.id))) throw Error("Connect every action to the Media path before running. Detached nodes are saved but never silently skipped.");
  return { id: g.id, version: g.version, name: g.name, ...copy(g.workflow), steps };
}
function workflowBlock(kind, id) {
  if (kind === "workflow-action") kind = "workflow-shorten";
  let step;
  if (kind.startsWith("reuse:")) step = { ...reference(kind.slice(6)), id };
  else if (kind === "workflow-decide") step = { id, type: "condition", test: "matches", params: {}, mode: "inherit", then: [], otherwise: [] };
  else {
    const op = kind.replace("workflow-", "");
    const defaults = { detectQuiet: { threshold: -40, minQuiet: 2, burstDuration: 1, burstCeiling: -25 }, quiet: { threshold: -40, minQuiet: 2, burstDuration: 1, burstCeiling: -25, retain: 20 }, shorten: { retain: 20, target: "quiet" }, speed: { rate: 1.3, target: "quiet" }, normalize: { target: -16, maxBoost: 12, peak: -1, affected: "all" }, check: { minDuration: 0.1, maxRate: 4 } };
    if (!defaults[op]) throw Error("Choose a supported timeline action.");
    step = { id, type: "operation", operation: op, params: copy(defaults[op]), mode: "inherit" };
  }
  const n = stepNode(step);
  n.name = stepName(step);
  return n;
}
function updateStep(g, id, step) {
  const next = clone(g), n = next.nodes.find((n2) => n2.id === id);
  n.params.legacyStep = copy(step);
  n.kind = stepNode(step).kind;
  return next;
}

// src/pipeline/variants.ts
function variants(n) {
  if (n.params.legacyStep) {
    const s = n.params.legacyStep;
    return s.type === "operation" ? s.operation === "detectQuiet" || s.operation === "quiet" ? [["legacy:detectQuiet", "Quiet signal"], ["legacy:quiet", "Find + shorten quiet"]] : [["legacy:shorten", "Shorten"], ["legacy:speed", "Speed"], ["legacy:normalize", "Normalize audio"], ["legacy:check", "Check"]] : [];
  }
  if (n.kind === "media" && !n.inputs.length) return [["av", "Video + audio"], ["video", "Video"], ["audio", "Audio"], ["image", "Image"], ["timeline", "Timeline"]];
  if (n.kind === "media") return [["static", "Image \u2192 video"], ["text-image", "Text \u2192 image / template"]];
  if (n.kind === "detection") return n.params.tracking ? [["smooth", "Smooth"], ["peak", "Peak"], ["duration", "Duration"], ["change", "Rate of change"]] : [["loudness", "Audio level"], ["silence", "Quiet duration"], ["speech", "Speech activity estimate"], ["variance", "Level variation"], ["consistency", "Level consistency"], ["motion", "Motion"], ["scene", "Scene changes"], ["time", "Time ranges"], ["markers", "Marked regions"]];
  if (n.kind === "condition") return [["threshold", "Threshold"], ["and", "All (AND)"], ["or", "Any (OR)"], ["not", "Not"], ["priority", "Priority"]];
  if (n.kind === "selection") return [["select", "Matching condition"], ["range", "Time ranges"], ["tags", "Tagged content"]];
  if (n.kind === "action") return [["remove", "Remove"], ["speed", "Speed"], ["tag", "Tag"], ["layout", "Layout"]];
  return [];
}
function variantValue(n) {
  if (n.params.legacyStep) return `legacy:${n.params.legacyStep.operation}`;
  if (n.kind === "media") return !n.inputs.length ? n.outputs[0].type : n.params.cast === "text-image" ? "text-image" : "static";
  if (n.kind === "detection") return String(n.params.tracking ?? n.params.detector);
  if (n.kind === "condition") return n.params.priorityOrder ? "priority" : String(n.params.expression?.op === "threshold" ? "threshold" : n.params.expression?.op);
  if (n.kind === "selection") return n.params.ranges ? "range" : n.params.source === "tags" ? "tags" : "select";
  return String(n.params.action ?? "");
}
function changeVariant(edit, id, value) {
  const next = clone(edit), n = next.nodes.find((n2) => n2.id === id);
  if (value.startsWith("legacy:")) {
    const old = n.params.legacyStep, step = workflowBlock("workflow-" + value.slice(7), old.id).params.legacyStep;
    step.mode = old.mode;
    n.params.legacyStep = step;
    n.kind = stepNode(step).kind;
  } else if (n.kind === "media" && !n.inputs.length) {
    n.outputs[0].type = value;
    const slot = next.slots.find((s) => s.nodeId === id);
    if (slot) slot.type = value;
  } else if (n.kind === "detection") {
    if (n.params.tracking) n.params.tracking = value;
    else {
      n.params.detector = value;
      n.inputs[0].type = ["motion", "scene"].includes(value) ? "video" : ["time", "markers"].includes(value) ? "media" : "audio";
    }
  } else {
    const made = createBlock(value, id, n.ui.x, n.ui.y);
    n.params = made.params;
    n.inputs = made.inputs;
    n.outputs = made.outputs;
  }
  return validateDraft(next);
}

// src/pipeline/ui/canvas.ts
var esc2 = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
var NodeCanvas = class {
  constructor(host, hooks) {
    this.host = host;
    this.hooks = hooks;
    host.classList.add("node-viewport");
    host.tabIndex = 0;
    host.setAttribute("aria-label", "Connected-node canvas. Tab to nodes and ports. Arrow keys move a selected node.");
    host.addEventListener("click", this.click);
    host.addEventListener("pointerdown", this.pointerdown);
    host.addEventListener("keydown", this.keydown);
    host.addEventListener("wheel", this.wheel, { passive: false });
    host.addEventListener("contextmenu", this.contextmenu);
    host.addEventListener("dragover", this.dragover);
    host.addEventListener("drop", this.drop);
    host.addEventListener("change", this.variantChange);
  }
  edit;
  selected = null;
  edge = null;
  pending = null;
  zoom = 1;
  cancelGesture;
  ignoreClick = false;
  variantChange = (e) => {
    const el = e.target;
    if (!el.dataset.nodeVariant) return;
    try {
      this.hooks.change(changeVariant(this.edit, el.dataset.nodeVariant, el.value));
    } catch (error) {
      this.hooks.message(error.message);
      this.render();
    }
  };
  variantMarkup(n) {
    const choices = variants(n);
    return choices.length ? `<select class="node-inline-variant" data-node-variant="${esc2(n.id)}" aria-label="${esc2(n.name)} type or channel">${choices.map(([v, l]) => `<option value="${v}"${v === variantValue(n) ? " selected" : ""}>${l}</option>`).join("")}</select>` : '<span class="node-inline-label">' + esc2(n.params.legacyStep ? "Timeline content" : "Continue") + "</span>";
  }
  insert(kind, id, x, y, pin) {
    return this.hooks.insert ? this.hooks.insert(kind, id, x, y, pin) : insertConnected(this.edit, kind, id, x, y, pin);
  }
  dispose() {
    this.cancelGesture?.();
    this.host.removeEventListener("click", this.click);
    this.host.removeEventListener("pointerdown", this.pointerdown);
    this.host.removeEventListener("keydown", this.keydown);
    this.host.removeEventListener("wheel", this.wheel);
    this.host.removeEventListener("contextmenu", this.contextmenu);
    this.host.removeEventListener("dragover", this.dragover);
    this.host.removeEventListener("drop", this.drop);
    this.host.removeEventListener("change", this.variantChange);
  }
  set(edit, selected2 = this.selected) {
    this.edit = edit;
    this.selected = edit.nodes.some((n) => n.id === selected2) ? selected2 : null;
    this.edge = null;
    this.pending = null;
    this.render();
  }
  select(id) {
    this.selected = id;
    this.edge = null;
    this.pending = null;
    this.showTargets();
    this.host.querySelectorAll(".node-card").forEach((n) => n.classList.toggle("is-selected", n.dataset.node === id));
    this.hooks.select(id);
  }
  dimensions() {
    return { width: Math.max(1e3, ...this.edit.nodes.map((n) => n.ui.x + NODE_WIDTH + 100)), height: Math.max(620, ...this.edit.nodes.map((n) => n.ui.y + HEADER_HEIGHT + Math.max(n.inputs.length, n.outputs.length) * PORT_HEIGHT + 130)) };
  }
  render() {
    const size = this.dimensions();
    this.host.innerHTML = `<div class="node-stage" style="width:${size.width * this.zoom}px;height:${size.height * this.zoom}px"><div class="node-world" style="width:${size.width}px;height:${size.height}px;transform:scale(${this.zoom})"><svg class="node-wires" width="${size.width}" height="${size.height}" aria-label="Connections"></svg>${this.edit.nodes.map((n) => {
      const rows = Math.max(n.inputs.length, n.outputs.length), portButton = (direction, index) => {
        const p = (direction === "in" ? n.inputs : n.outputs)[index];
        return p ? `<button class="node-port type-${p.type}" data-port="${esc2(p.id)}" data-direction="${direction}" data-owner="${esc2(n.id)}" title="${direction === "out" ? "Connect from" : "Connect to"} ${esc2(p.name)} \xB7 ${p.type}" aria-label="${direction === "out" ? "Output" : "Input"} ${esc2(p.name)}, ${p.type}, ${esc2(n.name)}"><i></i><span>${esc2(p.name)}</span><small>${p.type}</small></button>` : "<span></span>";
      };
      return `<article class="node-card kind-${n.kind}${n.id === this.selected ? " is-selected" : ""}" data-node="${esc2(n.id)}" style="left:${n.ui.x}px;top:${n.ui.y}px;width:${NODE_WIDTH}px" tabindex="0" aria-label="${esc2(n.name)}, ${n.kind}"><header class="node-header"><span class="node-kind">${n.kind === "detection" ? "SIGNAL" : n.kind === "condition" ? "DECIDE" : n.kind === "selection" ? "SELECT" : n.kind === "action" ? "ACTION" : n.kind === "breakpoint" ? "PAUSE" : "MEDIA"}</span><strong>${esc2(n.name)}</strong><button class="node-more" data-more="${esc2(n.id)}" aria-label="Node actions for ${esc2(n.name)}">\u22EF</button>${this.variantMarkup(n)}</header><div class="node-ports">${Array.from({ length: rows }, (_, i) => `<div class="node-port-row">${portButton("in", i)}${portButton("out", i)}</div>`).join("")}</div><p class="node-summary">${esc2(describeNode(n))}</p></article>`;
    }).join("")}</div></div>`;
    this.drawWires();
  }
  drawWires(edit = this.edit) {
    const svg = this.host.querySelector("svg");
    svg.innerHTML = edit.connections.map((c, i) => {
      const from = edit.nodes.find((n) => n.id === c.from.node), to = edit.nodes.find((n) => n.id === c.to.node);
      if (!from || !to) return "";
      const d = wirePath(portPoint(from, "out", c.from.port), portPoint(to, "in", c.to.port)), type = from.outputs.find((p) => p.id === c.from.port).type;
      return `<g class="wire-type-${type}"><path d="${d}" class="wire-hit" data-edge="${i}" role="button" tabindex="0" aria-label="Connection from ${esc2(from.name)} to ${esc2(to.name)}. Press Delete to disconnect."/><path d="${d}" class="wire-line${i === this.edge ? " selected" : ""}"/></g>`;
    }).join("");
    this.host.querySelectorAll("[data-port]").forEach((button2) => {
      const pin = this.pin(button2);
      button2.classList.toggle("pin-connected", edit.connections.some((c) => pin.direction === "out" ? c.from.node === pin.node && c.from.port === pin.port : c.to.node === pin.node && c.to.port === pin.port));
    });
  }
  findPort(target) {
    return target?.closest("[data-port]");
  }
  pin(button2) {
    return { node: button2.dataset.owner, port: button2.dataset.port, direction: button2.dataset.direction };
  }
  choosePort(button2) {
    const pin = this.pin(button2);
    if (!this.pending || this.pending.direction === pin.direction) {
      this.pending = pin;
      this.showTargets();
      this.hooks.message("Choose a pin on the opposite side, or drag into empty space to add a connected node.");
    } else {
      try {
        this.hooks.change(connect(this.edit, connectionBetween(this.pending, pin)));
        this.pending = null;
        this.hooks.message("Connected. Drag another pin to continue building the pipeline.");
      } catch (e) {
        this.hooks.message(e.message);
      }
    }
  }
  showTargets() {
    this.host.querySelectorAll("[data-port]").forEach((b) => {
      let valid = false;
      if (this.pending && b.dataset.direction !== this.pending.direction) try {
        connect(this.edit, connectionBetween(this.pending, this.pin(b)));
        valid = true;
      } catch {
      }
      b.classList.toggle("can-connect", valid);
      b.classList.toggle("pin-pending", !!this.pending && b.dataset.owner === this.pending.node && b.dataset.port === this.pending.port && b.dataset.direction === this.pending.direction);
    });
  }
  click = (event) => {
    if (this.ignoreClick) return;
    this.host.querySelector(".node-context")?.remove();
    const port2 = this.findPort(event.target);
    if (port2) {
      if (event.altKey) {
        this.hooks.change(disconnectPin(this.edit, this.pin(port2)));
        this.hooks.message("Pin disconnected.");
      } else this.choosePort(port2);
      return;
    }
    const more = event.target.closest("[data-more]");
    if (more) {
      this.openMenu(more.dataset.more, more);
      return;
    }
    const edge = event.target.closest("[data-edge]");
    if (edge) {
      this.edge = Number(edge.dataset.edge);
      this.selected = null;
      this.hooks.select(null);
      this.drawWires();
      this.host.focus();
      this.hooks.message("Connection selected. Press Delete to disconnect.");
      return;
    }
    const node2 = event.target.closest("[data-node]");
    this.select(node2?.dataset.node ?? null);
  };
  pointerdown = (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (this.cancelGesture) return;
    const target = event.target, port2 = event.button === 0 ? this.findPort(target) : null, header = event.button === 0 ? target.closest(".node-header") : null, card = header?.closest("[data-node]");
    if (event.altKey && port2) return;
    if (target.closest("button,select,input") && !port2 && event.button === 0) return;
    if (event.button === 0 && !port2 && !card && target.closest("[data-node],[data-edge]")) return;
    if (event.button === 1) event.preventDefault();
    this.host.querySelector(".node-context")?.remove();
    const x = event.clientX, y = event.clientY, startScroll = { x: this.host.scrollLeft, y: this.host.scrollTop }, draft = clone(this.edit);
    let moved = false, lastPoint = { x: 0, y: 0 };
    const n = card ? draft.nodes.find((n2) => n2.id === card.dataset.node) : void 0, origin = n ? { ...n.ui } : void 0;
    if (n) this.select(n.id);
    let preview2;
    const move = (e) => {
      if (e.pointerId !== event.pointerId) return;
      if (!moved && Math.hypot(e.clientX - x, e.clientY - y) < 4) return;
      if (!moved && port2) {
        this.pending = this.pin(port2);
        this.showTargets();
      }
      moved = true;
      e.preventDefault();
      if (port2) {
        const rect = this.host.querySelector(".node-world").getBoundingClientRect(), from = this.edit.nodes.find((n2) => n2.id === port2.dataset.owner);
        lastPoint = { x: (e.clientX - rect.left) / this.zoom, y: (e.clientY - rect.top) / this.zoom };
        preview2 ??= document.createElementNS("http://www.w3.org/2000/svg", "path");
        preview2.classList.add("wire-preview");
        const anchor = portPoint(from, port2.dataset.direction, port2.dataset.port);
        preview2.setAttribute("d", port2.dataset.direction === "out" ? wirePath(anchor, lastPoint) : wirePath(lastPoint, anchor));
        this.host.querySelector("svg").append(preview2);
        this.host.querySelectorAll(".pin-hover").forEach((p) => p.classList.remove("pin-hover"));
        const over = this.findPort(document.elementFromPoint(e.clientX, e.clientY));
        if (over) {
          over.classList.add("pin-hover");
          this.hooks.message(over.classList.contains("can-connect") ? "Release to connect these pins." : "These pins cannot connect. Use an unoccupied pin of the right type.");
        } else this.hooks.message("Release on empty space to add a compatible node.");
      } else if (n && origin) {
        const snap = (v) => Math.max(0, e.shiftKey ? v : Math.round(v / 16) * 16);
        n.ui = { x: snap(origin.x + (e.clientX - x + this.host.scrollLeft - startScroll.x) / this.zoom), y: snap(origin.y + (e.clientY - y + this.host.scrollTop - startScroll.y) / this.zoom) };
        card.style.left = `${n.ui.x}px`;
        card.style.top = `${n.ui.y}px`;
        this.drawWires(draft);
      } else {
        this.host.scrollLeft = startScroll.x - (e.clientX - x);
        this.host.scrollTop = startScroll.y - (e.clientY - y);
      }
    };
    const clean = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      preview2?.remove();
      this.host.querySelectorAll(".pin-hover").forEach((p) => p.classList.remove("pin-hover"));
      this.cancelGesture = void 0;
    };
    const up = (e) => {
      if (e.pointerId !== event.pointerId) return;
      clean();
      if (!moved) return;
      this.ignoreClick = true;
      setTimeout(() => this.ignoreClick = false, 0);
      if (port2) {
        const end = this.findPort(document.elementFromPoint(e.clientX, e.clientY));
        this.pending = this.pin(port2);
        if (end) {
          try {
            this.hooks.change(connect(this.edit, connectionBetween(this.pending, this.pin(end))));
            this.hooks.message("Pins connected.");
          } catch (error) {
            this.hooks.message(error.message);
          }
          this.pending = null;
          this.showTargets();
        } else if (this.host.contains(document.elementFromPoint(e.clientX, e.clientY))) {
          this.openAddMenu(e.clientX, e.clientY, this.pending);
        } else {
          this.pending = null;
          this.showTargets();
        }
      } else if (n) this.hooks.change(draft);
    };
    const cancel = () => {
      clean();
      this.pending = null;
      this.render();
    };
    this.cancelGesture = cancel;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };
  keydown = (event) => {
    if (event.target.closest("input,textarea,select")) return;
    if (event.key === " " && event.target === this.host) {
      event.preventDefault();
      this.openSearch();
      return;
    }
    if (event.key === "Escape") {
      if (this.pending || this.host.querySelector(".node-context") || this.cancelGesture) {
        event.preventDefault();
        event.stopPropagation();
        this.cancelGesture?.();
        this.pending = null;
        this.host.querySelector(".node-context")?.remove();
        this.showTargets();
        this.hooks.message("Connection cancelled.");
      }
      return;
    }
    const edge = event.target.closest("[data-edge]");
    if (edge && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.edge = Number(edge.dataset.edge);
      this.selected = null;
      this.hooks.select(null);
      this.drawWires();
      this.host.focus();
      this.hooks.message("Connection selected. Press Delete to disconnect.");
      return;
    }
    if (edge && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      const next = clone(this.edit);
      next.connections.splice(Number(edge.dataset.edge), 1);
      this.hooks.change(next);
      return;
    }
    const card = event.target.closest("[data-node]"), id = card?.dataset.node ?? this.selected;
    if (card && event.key === "Enter" && !event.target.closest("button")) {
      event.preventDefault();
      this.select(id);
      return;
    }
    if (event.key === "F10" && event.shiftKey && card) {
      event.preventDefault();
      this.openMenu(id, card);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && !this.findPort(event.target)) {
      event.preventDefault();
      if (this.edge !== null) {
        const next = clone(this.edit);
        next.connections.splice(this.edge, 1);
        this.hooks.change(next);
      } else if (id) this.hooks.change(removeBlock(this.edit, id));
      return;
    }
    if (id && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && !event.target.closest("button")) {
      event.preventDefault();
      const next = clone(this.edit), n = next.nodes.find((n2) => n2.id === id), step = event.shiftKey ? 40 : 10;
      n.ui.x = Math.max(0, n.ui.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0));
      n.ui.y = Math.max(0, n.ui.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0));
      this.hooks.change(next);
      this.host.querySelectorAll("[data-node]").forEach((el) => {
        if (el.dataset.node === id) el.focus();
      });
    }
  };
  contextmenu = (event) => {
    if (event.shiftKey || event.target.closest("input,textarea,select")) return;
    event.preventDefault();
    const card = event.target.closest("[data-node]");
    if (card) this.openMenu(card.dataset.node, card);
    else this.openAddMenu(event.clientX, event.clientY);
  };
  worldPoint(clientX, clientY) {
    const rect = this.host.querySelector(".node-world").getBoundingClientRect();
    return { x: (clientX - rect.left) / this.zoom, y: (clientY - rect.top) / this.zoom };
  }
  addAtCenter(kind) {
    const r = this.host.getBoundingClientRect(), point = this.worldPoint(r.left + r.width / 2, r.top + r.height / 2);
    this.hooks.change(this.insert(kind, crypto.randomUUID(), point.x - NODE_WIDTH / 2, point.y));
  }
  openSearch() {
    const r = this.host.getBoundingClientRect();
    this.openAddMenu(r.left + r.width / 2, r.top + r.height / 2);
  }
  openAddMenu(clientX, clientY, pin) {
    this.host.querySelector(".node-context")?.remove();
    const point = this.worldPoint(clientX, clientY), rect = this.host.getBoundingClientRect(), menu = document.createElement("div");
    menu.className = "node-context node-search";
    menu.style.left = `${this.host.scrollLeft + Math.max(8, Math.min(rect.width - 292, clientX - rect.left))}px`;
    menu.style.top = `${this.host.scrollTop + Math.max(8, Math.min(rect.height - 350, clientY - rect.top))}px`;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", pin ? "Add a compatible connected node" : "Add a node");
    menu.innerHTML = `<div class="node-search-title">${pin ? "ADD CONNECTED NODE" : "ADD NODE"}</div><input type="search" aria-label="Search nodes" placeholder="Search actions, conditions, media\u2026"><div class="node-search-results"></div>`;
    menu.addEventListener("pointerdown", (e) => e.stopPropagation());
    menu.addEventListener("click", (e) => e.stopPropagation());
    const input = menu.querySelector("input"), results = menu.querySelector(".node-search-results");
    const compatibleKinds = (this.hooks.items?.() ?? catalog).filter(([kind]) => {
      if (!pin) return true;
      try {
        this.insert(kind, "__candidate__", 0, 0, pin);
        return true;
      } catch {
        return false;
      }
    });
    const render2 = () => {
      results.replaceChildren();
      for (const [kind, group, label] of compatibleKinds.filter((c) => `${c[1]} ${c[2]}`.toLowerCase().includes(input.value.toLowerCase()))) {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = `<small>${group}</small><span>${esc2(label)}</span>`;
        b.onclick = () => {
          try {
            const next = this.insert(kind, crypto.randomUUID(), point.x - (pin?.direction === "in" ? NODE_WIDTH : 0), point.y - HEADER_HEIGHT, pin);
            menu.remove();
            this.pending = null;
            this.hooks.change(next);
            this.hooks.message(pin ? "Added and connected the new node." : "Node added. Drag its header to position it.");
          } catch (e) {
            this.hooks.message(e.message);
          }
        };
        results.append(b);
      }
      if (!results.childElementCount) results.textContent = "No matching nodes.";
    };
    input.oninput = render2;
    menu.onkeydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        menu.remove();
        this.pending = null;
        this.showTargets();
        this.host.focus();
      }
      if (e.key === "Enter" && e.target === input) {
        e.preventDefault();
        results.querySelector("button")?.click();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = [...results.querySelectorAll("button")], i = buttons.indexOf(document.activeElement);
        buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    };
    this.host.append(menu);
    render2();
    input.focus();
  }
  dragover = (event) => {
    if (event.dataTransfer?.types.includes("application/x-cutline-node")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      this.host.classList.add("palette-drop-target");
    }
  };
  drop = (event) => {
    const kind = event.dataTransfer?.getData("application/x-cutline-node");
    this.host.classList.remove("palette-drop-target");
    if (!kind) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const point = this.worldPoint(event.clientX, event.clientY);
      this.hooks.change(this.insert(kind, crypto.randomUUID(), point.x - NODE_WIDTH / 2, point.y));
      this.hooks.message("Node placed. Drag between pins to connect it.");
    } catch (e) {
      this.hooks.message(e.message);
    }
  };
  openMenu(id, anchor) {
    this.host.querySelector(".node-context")?.remove();
    this.select(id);
    const menu = document.createElement("div");
    menu.className = "node-context";
    menu.addEventListener("click", (e) => e.stopPropagation());
    menu.setAttribute("role", "menu");
    menu.style.left = `${this.host.scrollLeft + Math.min(this.host.clientWidth - 190, Math.max(4, anchor.getBoundingClientRect().left - this.host.getBoundingClientRect().left))}px`;
    menu.style.top = `${this.host.scrollTop + Math.min(this.host.clientHeight - 120, anchor.getBoundingClientRect().bottom - this.host.getBoundingClientRect().top)}px`;
    for (const [label, fn] of [["Edit settings", () => this.hooks.select(id)], ["Duplicate node", () => this.hooks.change(duplicateBlock(this.edit, id, crypto.randomUUID()))], ["Delete node", () => this.hooks.change(removeBlock(this.edit, id))]]) {
      const b = document.createElement("button");
      b.setAttribute("role", "menuitem");
      b.textContent = label;
      b.onclick = () => {
        menu.remove();
        fn();
      };
      menu.append(b);
    }
    menu.onkeydown = (e) => {
      if (e.key === "Escape") {
        menu.remove();
        anchor.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...menu.querySelectorAll("button")], i = items.indexOf(document.activeElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
      }
    };
    this.host.append(menu);
    menu.querySelector("button").focus();
  }
  setZoom(value) {
    const old = this.zoom;
    this.zoom = Math.max(0.35, Math.min(1.6, value));
    const center = { x: (this.host.scrollLeft + this.host.clientWidth / 2) / old, y: (this.host.scrollTop + this.host.clientHeight / 2) / old };
    this.render();
    this.host.scrollLeft = center.x * this.zoom - this.host.clientWidth / 2;
    this.host.scrollTop = center.y * this.zoom - this.host.clientHeight / 2;
    return this.zoom;
  }
  get scale() {
    return this.zoom;
  }
  fit() {
    const size = this.dimensions();
    this.zoom = Math.max(0.35, Math.min(1, (this.host.clientWidth - 40) / size.width, (this.host.clientHeight - 40) / size.height));
    this.render();
    this.host.scrollTo(0, 0);
    return this.zoom;
  }
  wheel = (event) => {
    if (event.target.closest(".node-context") || this.cancelGesture) return;
    if (!event.shiftKey) {
      event.preventDefault();
      const point = this.worldPoint(event.clientX, event.clientY), rect = this.host.getBoundingClientRect();
      this.setZoom(this.zoom * (event.deltaY < 0 ? 1.1 : 0.9));
      this.host.scrollLeft = point.x * this.zoom - (event.clientX - rect.left);
      this.host.scrollTop = point.y * this.zoom - (event.clientY - rect.top);
    }
  };
};

// src/pipeline/ui/settings.ts
function renderSettings(host, edit, id, change, message) {
  const n = edit.nodes.find((n2) => n2.id === id);
  if (!n) {
    host.innerHTML = '<div class="node-inspector-empty"><span>NODE SETTINGS</span><h3>Select a node</h3><p>Choose a card to name it and adjust its settings. Connect an output to an input with the same type.</p><p>Use Tab and Enter to connect ports. Arrow keys move a focused card; Shift moves it further.</p></div>';
    return;
  }
  const p = n.params, slot = edit.slots.find((s) => s.nodeId === n.id), field = (key, label, value, type = "text", min) => `<label class="node-field"><span>${esc2(label)}</span><input data-setting="${key}" type="${type}" value="${esc2(value)}"${min !== void 0 ? ` min="${min}"` : ""}${type === "number" ? ' step="any" required' : ""}></label>`, select = (key, label, value, options) => `<label class="node-field"><span>${label}</span><select data-setting="${key}">${options.map(([v, l]) => `<option value="${v}"${v === value ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
  let fields = field("$name", "Node name", n.name);
  if (slot) fields += field("$slot", "Input slot name", slot.name) + `<label class="node-check"><input data-setting="$required" type="checkbox"${slot.required ? " checked" : ""}> Required input</label>`;
  if (n.kind === "detection") {
    if (p.tracking) fields += field("windowSec", "Tracking window (seconds)", p.windowSec ?? 1, "number", 0.02) + (p.tracking === "duration" ? field("threshold", "Match threshold (signal units)", p.threshold ?? -40, "number") + select("direction", "Match when", p.direction ?? "below", [["below", "Below threshold"], ["above", "Above threshold"]]) : "");
    else fields += field("sampleRateHz", "Samples per second", p.sampleRateHz ?? 4, "number", 0.1) + (["silence", "speech", "scene"].includes(String(p.detector)) ? field("threshold", p.detector === "scene" ? "Scene change sensitivity (0\u20131)" : "Audio cutoff (dBFS)", p.threshold ?? (p.detector === "scene" ? 0.35 : p.detector === "speech" ? -35 : -40), "number") : "") + '<p class="node-setting-note">Measured locally from media when Run is selected. Audio level uses dBFS; quiet duration uses seconds; motion uses 0\u20131. Speech activity is an energy-based estimate.</p>';
  }
  if (n.kind === "condition") {
    const expression = p.expression;
    if (expression?.op === "threshold") fields += select("expression:direction", "Match values", expression.direction ?? "above", [["above", "Above threshold"], ["below", "Below threshold"]]) + field("expression:on", "Turn on threshold (signal units)", expression.on, "number") + field("expression:off", "Turn off threshold (hysteresis)", expression.off ?? expression.on, "number");
    fields += field("debounce", "Must match for (seconds)", p.debounce ?? 0, "number", 0) + field("hold", "Stay on at least (seconds)", p.hold ?? 0, "number", 0);
    if (p.priorityOrder) fields += select("chooseState", "Select this priority winner", p.chooseState, [["a", "First source"], ["b", "Second source"], ["none", "Nobody"]]) + field("defaultState", "Default state", p.defaultState ?? "none");
  }
  if (n.kind === "selection") {
    fields += select("anchor", "Keep selection attached to", p.anchor ?? "content", [["content", "Content, through timing changes"], ["timestamp", "Exact timestamps (may become stale)"]]);
    if (p.source === "tags") fields += field("tag", "Tag to select", p.tag ?? "intro");
    if (Array.isArray(p.ranges)) fields += `<label class="node-field"><span>Time ranges, one per line (start, end in seconds)</span><textarea data-setting="$ranges" rows="4">${esc2(p.ranges.map((r) => `${r.start}, ${r.end}`).join("\n"))}</textarea></label>`;
  }
  if (n.kind === "action") {
    fields += select("mode", "How to apply changes", p.mode ?? "auto", [["auto", "Apply automatically"], ["review", "Pause for review"], ["propose", "Suggest changes"]]);
    if (p.action === "speed") fields += field("rate", "Playback speed multiplier", p.rate ?? 1.3, "number", 0.01);
    if (p.action === "tag") fields += field("label", "Tag label", p.label ?? "Chapter");
    if (p.action === "layout") fields += field("layout", "Matching layout", p.layout ?? "speakerA") + field("defaultLayout", "Default layout", p.defaultLayout ?? "grid") + field("z", "Layer order", p.z ?? 0, "number");
  }
  if (p.cast === "static-video") fields += field("durationSec", "Hold image for (seconds)", p.durationSec, "number", 0.01);
  if (p.cast === "text-image") fields += field("template", "Image template name", p.template) + `<label class="node-field"><span>Text</span><textarea data-setting="text" rows="3">${esc2(p.text ?? "")}</textarea></label>` + field("width", "Image width", p.width ?? 1280, "number", 16) + field("height", "Image height", p.height ?? 320, "number", 16) + field("fontSize", "Text size", p.fontSize ?? 100, "number", 1) + field("color", "Text color", p.color ?? "#f4f9f6", "color") + field("background", "Background (color or transparent)", p.background ?? "transparent");
  if (n.kind === "breakpoint") fields += field("note", "Note when paused", p.note ?? "");
  host.innerHTML = `<div class="node-inspector-title"><span>${esc2(n.kind.toUpperCase())}</span><h3>${esc2(n.name)}</h3></div>${fields}<details class="node-advanced"><summary>Advanced settings</summary><p>Expressions, source types, confidence tiers and other parameters are preserved here. Weights are reserved.</p><label class="node-field"><span>Node parameters (JSON)</span><textarea data-setting="$params" rows="12" spellcheck="false">${esc2(JSON.stringify(p, null, 2))}</textarea></label>${n.inputs.some((v) => ["av", "video", "audio", "timeline"].includes(v.type)) ? select("$mediaType", "Media input type", n.inputs.find((v) => ["av", "video", "audio", "timeline"].includes(v.type)).type, [["av", "Video + audio"], ["video", "Video"], ["audio", "Audio"], ["timeline", "Timeline"]]) : ""}</details>`;
  host.onchange = (e) => {
    const el = e.target, key = el.dataset.setting;
    if (!key) return;
    if (el instanceof HTMLInputElement && !el.reportValidity()) return;
    try {
      const next = clone(edit), node2 = next.nodes.find((node3) => node3.id === id);
      if (key === "$name") {
        node2.name = el.value.trim();
        if (!node2.name) throw Error("Give this node a name.");
      } else if (key === "$slot") next.slots.find((s) => s.nodeId === id).name = el.value.trim() || node2.name;
      else if (key === "$required") next.slots.find((s) => s.nodeId === id).required = el.checked;
      else if (key === "$ranges") {
        node2.params.ranges = el.value.split("\n").filter((line) => line.trim()).map((line) => {
          const [start, end, ...extra] = line.split(",").map(Number);
          if (extra.length || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw Error("Enter each range as start, end with end after start.");
          return { start, end };
        });
      } else if (key === "$params") {
        const value = JSON.parse(el.value);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Parameters must be a JSON object.");
        node2.params = value;
      } else if (key === "$mediaType") {
        node2.inputs.filter((v) => ["av", "video", "audio", "timeline"].includes(v.type)).forEach((v) => v.type = el.value);
        node2.outputs.filter((v) => ["av", "video", "audio", "timeline"].includes(v.type)).forEach((v) => v.type = el.value);
      } else if (key.startsWith("expression:")) node2.params.expression[key.split(":")[1]] = el instanceof HTMLSelectElement ? el.value : Number(el.value);
      else {
        node2.params[key] = el instanceof HTMLInputElement && el.type === "number" ? Number(el.value) : el.value;
        if (key === "detector" && el.value === "speaker" && !node2.params.label) node2.params.label = "speakerA";
      }
      change(next);
    } catch (error) {
      message(error.message);
    }
  };
}

// src/pipeline/history.ts
var PipelineHistory = class {
  constructor(current, limit = 40) {
    this.current = current;
    this.limit = limit;
    this.current = clone(current);
  }
  past = [];
  future = [];
  commit(next) {
    this.past.push(clone(this.current));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = clone(next);
    return clone(this.current);
  }
  undo() {
    if (this.past.length) {
      this.future.push(clone(this.current));
      this.current = this.past.pop();
    }
    return clone(this.current);
  }
  redo() {
    if (this.future.length) {
      this.past.push(clone(this.current));
      this.current = this.future.pop();
    }
    return clone(this.current);
  }
};

// src/builder.ts
var detectionFields = [{ key: "threshold", label: "Audio quieter than (dBFS)", default: -40, min: -90, max: 0, hint: "Lower values mean only very quiet audio will match." }, { key: "minQuiet", label: "Lasting at least (seconds)", default: 2, min: 0.02, max: 600, step: 0.1 }, { key: "burstDuration", label: "Ignore sound bursts up to (seconds)", default: 1, min: 0, max: 10, step: 0.1 }, { key: "burstCeiling", label: "Only if those bursts stay below (dBFS)", default: -25, min: -90, max: 0 }];
var targets = [["quiet", "Sections found by the last detector"], ["all", "All content reaching this step"]];
var operationFields = { detectQuiet: detectionFields, shorten: [{ key: "retain", label: "Keep up to (seconds per section)", default: 20, min: 0, max: 600, step: 0.1, hint: "Keep the beginning and end; remove the middle. Time is measured at this step." }, { key: "target", label: "Apply to", default: "quiet", options: targets }], quiet: [...detectionFields, { key: "retain", label: "Keep up to (seconds)", default: 20, min: 0, max: 600, step: 0.1 }], speed: [{ key: "rate", label: "Multiply speed by", default: 1.3, min: 0.1, max: 8, step: 0.05 }, { key: "target", label: "Apply to", default: "quiet", options: targets }], normalize: [{ key: "target", label: "Target loudness (LUFS)", default: -16, min: -40, max: -8 }, { key: "maxBoost", label: "Maximum boost (dB)", default: 12, min: 0, max: 24 }, { key: "peak", label: "Sample peak guard (dBFS)", default: -1, min: -12, max: 0, step: 0.1, hint: "Loudness estimate; oversampled true-peak limiting is planned." }, { key: "affected", label: "Apply to", default: "all", options: targets }], check: [{ key: "minDuration", label: "No section shorter than (seconds)", default: 0.1, min: 0, max: 10, step: 0.01 }, { key: "maxRate", label: "No playback faster than", default: 4, min: 0.1, max: 8, step: 0.1 }] };

// src/pipeline/ui/workflow-settings.ts
function workflowSettings(host, inputStep, change, h, message) {
  const step = inputStep.type === "reference" ? normalizeOverrides(inputStep, h.library()) : inputStep;
  const fields = (op, ref) => operationFields[op.operation].map((f) => {
    const key = `${op.id}:${f.key}`, kept = ref && key in ref.overrides, value = op.params[f.key] ?? f.default;
    return `<label class="node-field"><span>${esc2(f.label)}</span>${f.options ? `<select data-value="${ref ? key : f.key}">${f.options.map(([v, label]) => `<option value="${v}"${v === value ? " selected" : ""}>${esc2(label)}</option>`).join("")}</select>` : `<input data-value="${ref ? key : f.key}" type="number" step="any" min="${f.min ?? -1e6}" max="${f.max ?? 1e6}" value="${esc2(value)}" required>`}${f.hint ? `<small>${esc2(f.hint)}</small>` : ""}</label>${kept ? `<button data-follow="${esc2(key)}" class="small">Locked locally \xB7 Follow value</button>` : ""}`;
  }).join("");
  let content = "";
  let resolved;
  if (step.type === "operation") content = `<label class="node-field"><span>${["detectQuiet", "quiet"].includes(step.operation) ? "Signal channel" : "Action type"}</span><select data-operation>${(["detectQuiet", "quiet"].includes(step.operation) ? ["detectQuiet", "quiet"] : ["shorten", "speed", "normalize", "check"]).map((op) => `<option value="${op}"${op === step.operation ? " selected" : ""}>${operationLabels[op]}</option>`).join("")}</select></label>${fields(step)}`;
  if (step.type === "condition") content = `<h3>Decide</h3><label class="node-field"><span>When</span><select data-test>${[["matches", "Content matches the preceding detector"], ["duration", "Duration"], ["loudness", "Loudness"], ["audio", "Audio is present"]].map(([v, l]) => `<option value="${v}"${v === step.test ? " selected" : ""}>${l}</option>`).join("")}</select></label>${["duration", "loudness"].includes(step.test) ? `<label class="node-field"><span>Comparison</span><select data-param="compare">${[["gt", "Greater than"], ["gte", "At least"], ["lt", "Less than"], ["lte", "At most"]].map(([v, l]) => `<option value="${v}"${v === (step.params.compare ?? "gt") ? " selected" : ""}>${l}</option>`).join("")}</select></label><label class="node-field"><span>${step.test === "duration" ? "Seconds" : "Loudness (LUFS)"}</span><input type="number" step="any" data-param="value" value="${step.params.value ?? 20}"></label>` : ""}<label class="node-check"><input type="checkbox" data-invert${step.params.invert ? " checked" : ""}> Reverse condition</label><button class="branch-open" data-branch="then">Then \xB7 ${step.then.length} nodes \u2192</button><button class="branch-open" data-branch="otherwise">Otherwise \xB7 ${step.otherwise.length} nodes \u2192</button>`;
  if (step.type === "reference") {
    try {
      resolved = resolveReference(step, h.library());
      content = `<h3>${esc2(resolved.name)}</h3><button data-source>Open source pipeline \u2192</button><button data-clone>Clone this setup</button><label class="node-field"><span>Updates</span><select data-policy>${[["follow", "Linked \xB7 follow updates"], ["definition", "Frozen definition \xB7 one layer"], ["bake", "Baked \xB7 entire subtree"]].map(([v, l]) => `<option value="${v}"${step.policy === v ? " selected" : ""}>${l}</option>`).join("")}</select></label><details><summary>Parameters for this use</summary>${walkSteps(resolved.steps).filter((s) => s.type === "operation").map((op) => `<h4>${operationLabels[op.operation]}</h4>${fields(op, step)}`).join("")}</details>`;
    } catch (e) {
      content = `<p>${esc2(e.message)}</p>`;
    }
  }
  host.innerHTML = content + `<label class="node-field"><span>Implementation</span><select data-mode>${[["inherit", "Use surrounding setting"], ["automatic", "Automatic"], ["suggested", "Suggest on timeline"]].map(([v, l]) => `<option value="${v}"${v === step.mode ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
  function cloneSetup() {
    if (!resolved) return;
    const d = cloneDefinition(resolved, h.library(), `${resolved.name} copy`);
    h.saveDefinition(d);
    change({ ...copy(step), definitionId: d.id, policy: "follow", frozen: void 0, unbaked: void 0, overrides: {} });
  }
  async function release(next) {
    const diff = referenceDiff(step, next, h.library());
    if (diff.length) {
      const answer = await h.confirm(`<p>Following current settings changes this setup:</p><table class="diff-table">${diff.map((d) => `<tr><td>${esc2(d.path)}</td><td>${esc2(d.before)}</td><td>\u2192 ${esc2(d.after)}</td></tr>`).join("")}</table>`);
      if (answer === "clone") {
        cloneSetup();
        return;
      }
      if (answer !== "unlock") {
        const field = host.querySelector("[data-policy]");
        if (field) field.value = step.policy;
        return;
      }
    }
    change(next);
  }
  host.onchange = (e) => {
    void (async () => {
      const el = e.target;
      if (el.hasAttribute("data-node-alias")) return;
      if (el instanceof HTMLInputElement && !el.reportValidity()) return;
      const next = copy(step);
      if (el.dataset.value) {
        if (next.type === "operation") next.params[el.dataset.value] = el instanceof HTMLSelectElement ? el.value : Number(el.value);
        if (next.type === "reference") next.overrides[el.dataset.value] = el instanceof HTMLSelectElement ? el.value : Number(el.value);
      }
      if (el.hasAttribute("data-operation")) {
        const s = workflowBlock("workflow-" + el.value, next.id).params.legacyStep;
        s.mode = next.mode;
        change(s);
        return;
      }
      if (el.hasAttribute("data-mode")) next.mode = el.value;
      if (next.type === "condition") {
        if (el.hasAttribute("data-test")) next.test = el.value;
        if (el.dataset.param) next.params[el.dataset.param] = el instanceof HTMLSelectElement ? el.value : Number(el.value);
        if (el.hasAttribute("data-invert")) next.params.invert = el.checked;
      }
      if (el.hasAttribute("data-policy") && next.type === "reference") {
        const changed = setPolicy(next, el.value, h.library());
        if (next.policy === "bake" && changed.policy !== "bake" || next.policy === "definition" && changed.policy === "follow") await release(changed);
        else change(changed);
        return;
      }
      change(next);
    })().catch((e2) => message(e2.message));
  };
  host.onclick = (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    e.stopPropagation();
    if (el.dataset.branch) h.branch(el.dataset.branch);
    if (el.hasAttribute("data-source") && resolved) h.source(resolved.id);
    if (el.hasAttribute("data-clone")) cloneSetup();
    if (el.dataset.follow && step.type === "reference") {
      const next = copy(step);
      delete next.overrides[el.dataset.follow];
      void release(next).catch((e2) => message(e2.message));
    }
  };
}

// src/pipeline/ui/editor.ts
function openEditMenu(h) {
  const d = h.dialog("Edit workspace", "", true);
  d.classList.add("node-editor-dialog");
  d.querySelector(".dialog-actions").remove();
  const body = d.querySelector(".dialog-body");
  const library = h.definitions?.() ?? [], first = currentDefinitions(library)[0], initial = h.initial ?? h.edits()[0] ?? (first ? definitionGraph(first, library) : definitionGraph({ id: crypto.randomUUID(), version: 1, kind: "quick", name: "My first Edit", description: "", mode: "suggested", initial: false, steps: [] }));
  let current = clone(initial), history2 = new PipelineHistory(current), selected2 = null, listMode = false, libraryTab = current.workflow?.kind === "preset" ? "presets" : "edits", dirty = false;
  body.innerHTML = `<div class="node-edit-shell"><aside class="node-library"><div class="node-library-heading">AUTOMATION</div><nav class="node-library-tabs" aria-label="Edit library"><button data-library="edits" class="active">Edits</button><button data-library="recipes">Recipes</button><button data-library="presets">Presets</button></nav><div id="node-library-items"></div><div class="node-library-bottom"><button data-command="new">+ New Edit</button><button data-command="new-preset">+ New preset</button><button data-command="new-signals">+ Signal pipeline</button><button data-command="import">Import JSON</button><input type="file" id="node-import" accept=".json,application/json" hidden></div></aside><section class="node-workspace"><div class="node-editor-toolbar"><label class="node-edit-name"><span class="sr-only">Edit name</span><input id="node-edit-name" value="${esc2(current.name)}" maxlength="100"></label><button data-command="undo" title="Undo (Ctrl+Z)">\u21B6</button><button data-command="redo" title="Redo (Ctrl+Shift+Z)">\u21B7</button><div class="node-view-toggle"><button data-command="graph" aria-pressed="true">Nodes</button><button data-command="list" aria-pressed="false">List</button></div><button data-command="run" class="primary">Run</button><button data-command="clone">Clone</button><button data-command="validate">Check</button><button data-command="export">Export JSON</button></div><div id="node-workflow-controls" class="node-workflow-controls"></div><div id="node-shelf" class="node-shelf"></div><div class="node-addbar"><button data-command="search" title="Right-click the canvas or press Space">Add node\u2026</button><span class="node-addbar-spacer"></span><button data-command="arrange">Arrange</button><button data-command="zoom-out" aria-label="Zoom out">\u2212</button><button data-command="fit">Fit</button><button data-command="zoom-in" aria-label="Zoom in">+</button></div><div class="node-canvas" id="node-canvas"></div><div class="node-list hidden" id="node-list" aria-label="Read-only workflow list"></div><div class="node-editor-status" role="status" aria-live="polite" id="node-editor-status">Add nodes, then drag or click an output and an input to connect them.</div><div class="node-phase-note">Drag a grouped node above onto the canvas. Select a node to adjust its channel and settings.</div></section><aside class="node-settings" id="node-settings"></aside></div>`;
  const $2 = (s) => body.querySelector(s);
  const message = (text) => {
    $2("#node-editor-status").textContent = text;
  };
  function items() {
    if (!current.workflow) return catalog;
    const reuse = (h.definitions ? currentDefinitions(h.definitions()) : []).filter((d2) => d2.id !== current.id).map((d2) => [`reuse:${d2.id}`, d2.kind === "preset" ? "Presets" : "Edits", d2.name]);
    return current.workflow.kind === "preset" ? [["source", "Media", "Media"], ...reuse, ["workflow-decide", "Decide", "Decide"]] : [["source", "Media", "Media"], ["workflow-detectQuiet", "Signal", "Quiet signal"], ["workflow-decide", "Decide", "Decide"], ["workflow-action", "Action", "Action"], ...reuse];
  }
  function insert(kind, id, x, y, pin) {
    if (!current.workflow) return insertConnected(current, kind, id, x, y, pin);
    const n = kind === "source" ? createBlock(kind, id) : workflowBlock(kind, id);
    n.ui = { x: Math.max(0, Math.round(x / 16) * 16), y: Math.max(0, Math.round(y / 16) * 16) };
    if (kind.startsWith("reuse:")) n.name = h.legacy().find((d2) => d2.id === kind.slice(6))?.name ?? "Edit";
    let next = addBlock(current, n);
    if (pin) {
      let error = "No compatible input.";
      for (const p of pin.direction === "out" ? n.inputs : n.outputs) try {
        return connect(next, connectionBetween(pin, { node: id, port: p.id, direction: pin.direction === "out" ? "in" : "out" }));
      } catch (e) {
        error = e.message;
      }
      throw Error(error);
    }
    return next;
  }
  const canvas = new NodeCanvas($2("#node-canvas"), { change: (next) => change(next), select: (id) => {
    selected2 = id;
    showSettings();
  }, message, items, insert });
  function showSettings() {
    const host = $2("#node-settings");
    host.onchange = null;
    host.onclick = null;
    const n = current.nodes.find((n2) => n2.id === selected2);
    if (!n && current.workflow) {
      rootSettings();
      return;
    }
    if (n?.params.legacyStep) {
      workflowSettings($2("#node-settings"), n.params.legacyStep, (step) => change(updateStep(current, n.id, step)), { library: () => h.definitions?.() ?? [], saveDefinition: (d2) => h.saveDefinition?.(d2), source: (id) => loadDefinition(id), confirm: (body2) => h.confirm?.(body2) ?? Promise.resolve("keep"), branch: (which) => {
        const step = copy(n.params.legacyStep);
        if (step.type !== "condition") return;
        const branchDef = { id: `${current.id}/${n.id}/${which}`, version: 1, kind: "quick", name: `${current.name} \xB7 ${which === "then" ? "Then" : "Otherwise"}`, description: "Conditional branch", initial: false, mode: "inherit", steps: step[which] };
        const initial2 = n.params.branchDrafts?.[which] ?? definitionGraph(branchDef, h.definitions?.());
        openEditMenu({ ...h, initial: initial2, sharing: void 0, save: (g) => {
          const next = clone(current), node2 = next.nodes.find((node3) => node3.id === n.id);
          node2.params.branchDrafts = { ...node2.params.branchDrafts ?? {}, [which]: g };
          try {
            node2.params.legacyStep[which] = graphDefinition(g).steps;
          } catch {
          }
          change(next);
        } });
      } }, message);
      nodeAlias(n.id, n.name);
    } else renderSettings($2("#node-settings"), current, selected2, change, message);
  }
  let sharingChecked = false, sharingPending = false;
  function nodeAlias(id, name) {
    const field = document.createElement("label"), input = document.createElement("input");
    field.className = "node-field";
    field.append(document.createTextNode("Node name"));
    input.value = name;
    input.dataset.nodeAlias = "true";
    input.onchange = () => {
      const next = clone(current);
      next.nodes.find((n) => n.id === id).name = input.value.trim() || name;
      change(next);
    };
    field.append(input);
    $2("#node-settings").prepend(field);
  }
  function uses() {
    return currentDefinitions(h.definitions?.() ?? []).reduce((count, d2) => count + walkSteps(d2.steps).filter((s) => s.type === "reference" && s.definitionId === current.id).length, 0);
  }
  function requiresSharing() {
    if (!current.workflow || !uses()) return false;
    try {
      const d2 = graphDefinition(current), old = currentDefinitions(h.definitions?.() ?? []).find((v) => v.id === current.id);
      return !!old && JSON.stringify({ ...old, version: 0 }) !== JSON.stringify({ ...d2, version: 0 });
    } catch {
      return false;
    }
  }
  function rootSettings() {
    const host = $2("#node-settings"), versions = (h.definitions?.() ?? []).filter((d2) => d2.id === current.id).sort((a, b) => b.version - a.version);
    host.innerHTML = `<h3>${current.workflow.kind === "preset" ? "Preset" : "Edit"} settings</h3><p class="node-setting-note">Used in ${uses()} places. Linked uses follow updates; frozen uses retain their settings.</p><label class="node-field"><span>Description</span><textarea id="edit-description">${esc2(current.workflow.description)}</textarea></label><label class="node-field"><span>Saved versions</span><select id="edit-history">${versions.map((d2) => `<option value="${d2.version}">Version ${d2.version}</option>`).join("")}</select></label><button id="restore-version">Restore as current settings</button>`;
    $2("#edit-description").onchange = (e) => {
      const next = clone(current);
      next.workflow.description = e.target.value;
      change(next);
    };
    $2("#restore-version").onclick = () => {
      const version = versions.find((v) => v.version === Number($2("#edit-history").value));
      if (version) change(definitionGraph(version, h.definitions?.()));
    };
  }
  function persist() {
    if (requiresSharing() && h.sharing && !sharingChecked) {
      if (!sharingPending) {
        sharingPending = true;
        void h.sharing(uses()).then((answer) => {
          sharingPending = false;
          if (answer === "cancel") {
            current = history2.undo();
            dirty = false;
            render2();
            return;
          }
          if (answer === "copy") {
            const d2 = cloneDefinition(graphDefinition(current), h.definitions?.() ?? [], `${current.name} copy`);
            current = definitionGraph(d2, h.definitions?.());
            history2 = new PipelineHistory(current);
          }
          sharingChecked = true;
          persist();
          render2();
        }).catch((e) => {
          sharingPending = false;
          message(e.message);
        });
      }
      return false;
    }
    h.save(clone(current));
    dirty = false;
    return true;
  }
  function change(next) {
    try {
      validateDraft(next);
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      if (next.nodes.length > current.nodes.length) selected2 = next.nodes.at(-1).id;
      current = history2.commit(next);
      dirty = true;
      const saved = persist();
      render2();
      message(saved ? "Saved draft. Drag another pin to connect the next step." : "Choose how to update this shared Edit.");
    } catch (e) {
      message(e.message);
    }
  }
  function load(edit) {
    current = clone(edit);
    history2 = new PipelineHistory(current);
    selected2 = null;
    dirty = false;
    sharingChecked = false;
    render2();
    canvas.fit();
  }
  function loadDefinition(id) {
    const definition = currentDefinitions(h.definitions?.() ?? []).find((d2) => d2.id === id);
    if (definition) load(h.edits().find((edit) => edit.id === id) ?? definitionGraph(definition, h.definitions?.()));
    else h.openLegacy(id);
  }
  function renderDock() {
    const dock = $2("#node-shelf");
    dock.innerHTML = [...new Set(items().map((c) => c[1]))].map((group) => `<section><span>${esc2(group.toUpperCase())}</span><div>${items().filter((c) => c[1] === group).map(([kind, , label]) => `<button draggable="true" data-shelf="${esc2(kind)}" title="Drag to the canvas">${esc2(label)}</button>`).join("")}</div></section>`).join("");
    dock.querySelectorAll("[data-shelf]").forEach((button2) => {
      button2.ondragstart = (e) => {
        e.dataTransfer.setData("application/x-cutline-node", button2.dataset.shelf);
        e.dataTransfer.effectAllowed = "copy";
      };
      button2.onclick = (e) => {
        e.stopPropagation();
        if (listMode) command("graph");
        canvas.addAtCenter(button2.dataset.shelf);
      };
    });
    const controls = $2("#node-workflow-controls");
    controls.innerHTML = current.workflow ? `<span>${current.workflow.kind === "preset" ? "PRESET \xB7 CHAIN EDITS" : "EDIT \xB7 DEFINE ACTIONS"}</span><select id="workflow-mode" aria-label="Default implementation">${[["inherit", "Use node settings"], ["automatic", "Automatic"], ["suggested", "Suggest on timeline"]].map(([v, l]) => `<option value="${v}"${current.workflow.mode === v ? " selected" : ""}>${l}</option>`).join("")}</select><label><input type="checkbox" id="workflow-initial"${current.workflow.initial ? " checked" : ""}> Offer when adding media</label>` : "<span>SIGNAL PIPELINE \xB7 MEASURE \u2192 TRACK \u2192 DECIDE \u2192 SELECT</span>";
    const mode = $2("#workflow-mode"), initial2 = $2("#workflow-initial");
    if (mode) mode.onchange = () => {
      const next = clone(current);
      next.workflow.mode = mode.value;
      change(next);
    };
    if (initial2) initial2.onchange = () => {
      const next = clone(current);
      next.workflow.initial = initial2.checked;
      change(next);
    };
  }
  function renderPalette(node2) {
    node2.innerHTML = '<input class="blueprint-palette-search" type="search" placeholder="Search nodes\u2026" aria-label="Search node palette"><p class="node-library-note">Drag a node onto the grid, or click to add it at the center.</p><div class="blueprint-palette-items"></div>';
    const input = node2.querySelector("input"), paletteList = node2.querySelector(".blueprint-palette-items");
    const update = () => {
      paletteList.replaceChildren();
      let prior = "";
      for (const [kind, group, label] of items().filter((c) => `${c[1]} ${c[2]}`.toLowerCase().includes(input.value.toLowerCase()))) {
        if (group !== prior) {
          const heading = document.createElement("div");
          heading.className = "node-library-subtitle";
          heading.textContent = group;
          paletteList.append(heading);
          prior = group;
        }
        const button2 = document.createElement("button");
        button2.className = "blueprint-palette-card";
        button2.draggable = true;
        button2.innerHTML = `<span class="palette-grip">\u283F</span><span>${esc2(label)}</span>`;
        button2.ondragstart = (e) => {
          e.dataTransfer.setData("application/x-cutline-node", kind);
          e.dataTransfer.effectAllowed = "copy";
        };
        button2.ondragend = () => $2("#node-canvas").classList.remove("palette-drop-target");
        button2.onclick = () => {
          if (listMode) command("graph");
          canvas.addAtCenter(kind);
        };
        paletteList.append(button2);
      }
    };
    input.oninput = update;
    update();
  }
  function renderLibrary() {
    body.querySelectorAll("[data-library]").forEach((b) => b.classList.toggle("active", b.dataset.library === libraryTab));
    const node2 = $2("#node-library-items");
    if (libraryTab === "recipes") {
      node2.innerHTML = `<p class="node-library-note">Start with a signal graph. Analyze media, then mark selected regions to run timeline Edits.</p>${[["remove", "Remove long silences", "Find quiet \u2192 select \u2192 remove"], ["cross", "Cross-revision tagging", "Remove \u2192 tag surviving content"]].map(([id, name, description]) => `<button class="node-recipe" data-recipe="${id}"><strong>${name}</strong><span>${description}</span><small>SIGNAL ANALYSIS</small></button>`).join("")}`;
    } else {
      node2.innerHTML = `${h.edits().filter((edit) => !h.legacy().some((d2) => d2.id === edit.id)).filter((edit) => libraryTab === "presets" ? edit.workflow?.kind === "preset" : edit.workflow?.kind !== "preset").map((edit) => `<button class="node-library-item${edit.id === current.id ? " active" : ""}" data-load-edit="${esc2(edit.id)}"><strong>${esc2(edit.name)}</strong><small>${edit.nodes.length} nodes \xB7 v${edit.version}</small></button>`).join("") || '<p class="node-library-note">Create an Edit or choose a recipe to start.</p>'}<div class="node-library-subtitle">REUSABLE PIPELINES</div>${h.legacy().filter((edit) => libraryTab === "presets" ? edit.kind === "preset" : edit.kind === "quick").map((edit) => `<button class="node-library-item node-legacy" data-legacy-edit="${esc2(edit.id)}"><strong>${esc2(edit.name)}</strong><small>${edit.kind === "quick" ? "Edit" : "Preset"} \xB7 open pipeline</small></button>`).join("")}`;
    }
  }
  function renderList() {
    try {
      $2("#node-list").innerHTML = `<p class="node-list-note">Read-only view \xB7 connections determine execution order.</p><ol>${linearSteps(current).map((step) => `<li><strong>${esc2(step.name)}</strong><p>${esc2(step.description)}</p><small>${step.inputs.length ? `Receives: ${esc2(step.inputs.join(", "))}` : "Starts here"}</small></li>`).join("")}</ol>`;
    } catch (e) {
      $2("#node-list").textContent = e.message;
    }
  }
  function render2() {
    canvas.set(current, selected2);
    showSettings();
    renderDock();
    $2("#node-edit-name").value = current.name;
    renderLibrary();
    renderList();
    const run = body.querySelector("[data-command=run]");
    run.textContent = current.workflow ? "Run" : "Analyze";
  }
  function download2() {
    const blob = new Blob([serialize(current)], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url;
    a.download = `${current.name.replace(/[<>:"/\\|?*]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  let zoom2 = 1;
  function command(name) {
    if (name === "new" || name === "new-preset") {
      const d2 = { id: crypto.randomUUID(), version: 1, name: name === "new" ? "New Edit" : "New preset", kind: name === "new" ? "quick" : "preset", description: "", mode: "suggested", initial: false, steps: [] };
      const edit = definitionGraph(d2, h.definitions?.());
      h.save(edit);
      load(edit);
    }
    if (name === "new-signals") {
      const edit = freshEdit(crypto.randomUUID(), "Signal pipeline");
      h.save(edit);
      load(edit);
    }
    if (name === "clone") {
      const definition = current.workflow ? cloneDefinition(graphDefinition(current), h.definitions?.() ?? [], `${current.name} copy`) : void 0;
      const edit = definition ? definitionGraph(definition, h.definitions?.()) : { ...clone(current), id: crypto.randomUUID(), name: `${current.name} copy`, version: 1, derivedFrom: { editId: current.id, version: current.version } };
      if (definition) h.saveDefinition?.(definition);
      h.save(edit);
      load(edit);
    }
    if (name === "run") {
      const button2 = body.querySelector("[data-command=run]");
      button2.disabled = true;
      button2.textContent = "Working\u2026";
      void h.run?.(clone(current)).catch((e) => message(e.message)).finally(() => {
        button2.disabled = false;
        button2.textContent = current.workflow ? "Run" : "Analyze";
      });
    }
    if (name === "search") {
      if (listMode) command("graph");
      canvas.openSearch();
    }
    if (name === "undo" || name === "redo") {
      const next = name === "undo" ? history2.undo() : history2.redo();
      current = clone(next);
      persist();
      render2();
      message(name === "undo" ? "Undid the last graph change." : "Redid the graph change.");
    }
    if (name === "arrange") {
      change(arrange(current));
      zoom2 = canvas.fit();
    }
    if (name === "fit") zoom2 = canvas.fit();
    if (name === "zoom-in") zoom2 = canvas.setZoom(canvas.scale + 0.1);
    if (name === "zoom-out") zoom2 = canvas.setZoom(canvas.scale - 0.1);
    if (name === "graph" || name === "list") {
      listMode = name === "list";
      $2("#node-canvas").classList.toggle("hidden", listMode);
      $2("#node-list").classList.toggle("hidden", !listMode);
      body.querySelector('[data-command="graph"]').setAttribute("aria-pressed", String(!listMode));
      body.querySelector('[data-command="list"]').setAttribute("aria-pressed", String(listMode));
      renderList();
    }
    if (name === "validate") {
      try {
        if (current.workflow) graphDefinition(current);
        else validateGraph(current, placeholderBindings(current));
        message(current.nodes.length ? "Connections are valid. Run uses the current connected settings." : "Add a Media input and connect some steps.");
      } catch (e) {
        message(e.message);
      }
    }
    if (name === "export") download2();
    if (name === "import") $2("#node-import").click();
  }
  body.addEventListener("click", (e) => {
    const target = e.target.closest("button");
    if (!target) return;
    try {
      if (target.dataset.command) command(target.dataset.command);
      if (target.dataset.library) {
        libraryTab = target.dataset.library;
        body.querySelectorAll("[data-library]").forEach((b) => b.classList.toggle("active", b.dataset.library === libraryTab));
        renderLibrary();
      }
      if (target.dataset.loadEdit) {
        const edit = h.edits().find((edit2) => edit2.id === target.dataset.loadEdit);
        if (edit) load(edit);
      }
      if (target.dataset.recipe) {
        const edit = arrange(example(target.dataset.recipe));
        edit.id = crypto.randomUUID();
        edit.name += " copy";
        h.save(edit);
        load(edit);
        message("Recipe copied. Analyze your media to see signals and selected regions.");
      }
      if (target.dataset.legacyEdit) loadDefinition(target.dataset.legacyEdit);
    } catch (error) {
      message(error.message);
    }
  });
  $2("#node-edit-name").onchange = (e) => {
    const name = e.target.value.trim();
    if (name) change({ ...clone(current), name });
    else message("Give this Edit a name.");
  };
  $2("#node-import").onchange = (e) => {
    void (async () => {
      const input = e.target, file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > 5 * 1024 * 1024) throw Error("Choose a graph JSON file smaller than 5 MB.");
        const edit = importDraft(await file.text());
        edit.id = crypto.randomUUID();
        edit.name += " (imported)";
        h.save(edit);
        load(edit);
        message("Imported as an independent Edit. The original saved Edit is unchanged.");
      } catch (error) {
        message(error.message);
      } finally {
        input.value = "";
      }
    })();
  };
  d.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.closest("input,textarea,select")) {
      e.preventDefault();
      command(e.shiftKey ? "redo" : "undo");
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      persist();
      message("Saved in this project. Use File \u2192 Save project for a project JSON backup.");
    }
  });
  d.addEventListener("close", () => {
    canvas.dispose();
    if (dirty) persist();
  }, { once: true });
  render2();
  requestAnimationFrame(() => {
    zoom2 = canvas.fit();
  });
  return d;
}

// src/region-ui.ts
var esc3 = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function regionEditor(h) {
  const assets = h.project().assets.filter((a) => a.kind !== "audio" && h.urls.has(a.id));
  if (!assets.length) {
    h.message("Import or relink video or an image first.");
    return;
  }
  const d = h.dialog("Visual source regions", "", true), body = d.querySelector(".dialog-body");
  let asset = assets[0], current = { id: uid(), name: "Region", assetId: asset.id, left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 }, cancelDrag;
  function render2() {
    cancelDrag?.();
    const width = Math.min(650, innerWidth * 0.65, innerHeight * 0.45 * asset.width / asset.height);
    body.innerHTML = `<div class="field"><label>Source</label><select id="region-source">${assets.map((a) => `<option value="${esc3(a.id)}"${a.id === asset.id ? " selected" : ""}>${esc3(a.name)}</option>`).join("")}</select></div><p>Drag a rectangle over the frame. Video controls below let you choose the frame. Regions share the original file.</p><div class="visual-region-stage" style="position:relative;width:${width}px;aspect-ratio:${asset.width}/${asset.height};max-width:100%">${asset.kind === "video" ? `<video id="region-source-video" src="${esc3(h.urls.get(asset.id))}" muted playsinline style="position:absolute;width:100%;height:100%"></video>` : `<img src="${esc3(h.urls.get(asset.id))}" style="position:absolute;width:100%;height:100%" alt="Source">`}<canvas id="region-drawing" width="1000" height="${Math.round(1e3 * asset.height / asset.width)}" style="position:absolute;width:100%;height:100%;touch-action:none"></canvas></div>${asset.kind === "video" ? '<input id="region-frame" type="range" min="0" max="1000" value="0" aria-label="Choose source frame" style="width:100%">' : ""}<div class="field"><label>Region name</label><input id="visual-region-name" value="${esc3(current.name)}"></div><div class="row" id="region-saved-list">${(h.project().visualRegions ?? []).filter((r) => r.assetId === asset.id).map((r) => `<button data-region-load="${esc3(r.id)}">${esc3(r.name)}</button>`).join("")}</div>`;
    const canvas = body.querySelector("#region-drawing"), ctx = canvas.getContext("2d");
    const paint = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#0006";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.clearRect(current.left * canvas.width, current.top * canvas.height, (current.right - current.left) * canvas.width, (current.bottom - current.top) * canvas.height);
      ctx.strokeStyle = "#bcf3cb";
      ctx.lineWidth = 4;
      ctx.strokeRect(current.left * canvas.width, current.top * canvas.height, (current.right - current.left) * canvas.width, (current.bottom - current.top) * canvas.height);
    };
    paint();
    canvas.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect(), point = (ev) => ({ x: Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height)) }), start = point(e), old = copy(current);
      const move = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        const end = point(ev);
        current = { ...current, left: Math.min(start.x, end.x), right: Math.max(start.x, end.x), top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) };
        paint();
      };
      const clean = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        cancelDrag = void 0;
      };
      const up = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        clean();
        if (!validRegion(current)) current = old;
        paint();
      };
      const cancel = () => {
        clean();
        current = old;
        paint();
      };
      cancelDrag = cancel;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    };
    body.querySelector("#region-source").onchange = (e) => {
      asset = assets.find((a) => a.id === e.target.value);
      current = { id: uid(), name: "Region", assetId: asset.id, left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 };
      render2();
    };
    const slider = body.querySelector("#region-frame");
    if (slider) slider.oninput = () => {
      const video = body.querySelector("#region-source-video");
      if (video.readyState > 0) video.currentTime = Math.max(0, Number(slider.value) / 1e3 * (asset.duration - 0.01));
    };
    body.querySelectorAll("[data-region-load]").forEach((b) => b.onclick = () => {
      current = copy(h.project().visualRegions.find((r) => r.id === b.dataset.regionLoad));
      render2();
    });
  }
  const actions = d.querySelector(".dialog-actions"), save2 = () => {
    if (!validRegion(current)) {
      h.message("Draw a region at least 1% of the source size.");
      return false;
    }
    current.name = body.querySelector("#visual-region-name").value.trim() || "Region";
    const p = copy(h.project());
    p.visualRegions = [...(p.visualRegions ?? []).filter((r) => r.id !== current.id), copy(current)];
    h.save(p);
    return true;
  };
  for (const [label, fn] of [["Save region", () => {
    if (save2()) render2();
  }], ["Add region to timeline", () => {
    if (save2()) h.add(copy(current));
  }], ["Delete region", () => {
    const p = copy(h.project());
    p.visualRegions = p.visualRegions?.filter((r) => r.id !== current.id);
    h.save(p);
    current.id = uid();
    render2();
  }], ["Done", () => d.close()]]) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    actions.append(b);
  }
  render2();
  d.addEventListener("close", () => {
    cancelDrag?.();
    body.querySelector("video")?.remove();
  }, { once: true });
}

// src/app.ts
var app = document.querySelector("#app");
var esc4 = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var paths = { cut: "M8 8l12 12M8 16L20 4M6 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", plus: "M12 5v14M5 12h14", import: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5", video: "M3 5h13v14H3zM16 9l5-3v12l-5-3", image: "M3 3h18v18H3zM3 17l5-6 4 4 3-3 6 7M15 7h.01", audio: "M9 18V5l11-2v13M9 7l11-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm11-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", play: "m8 4 12 8-12 8Z", pause: "M7 5h3v14H7zM14 5h3v14h-3z", back: "M5 5v14M19 5 7 12l12 7Z", next: "M19 5v14M5 5l12 7-12 7Z", undo: "M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12", redo: "m15 4 5 5-5 5M20 9H10a6 6 0 0 0 0 12", trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7", copy: "M8 8h13v13H8zM16 8V3H3v13h5", settings: "M4 7h16M4 17h16M8 3v8M16 13v8", check: "m5 12 4 4L20 5", close: "m6 6 12 12M18 6 6 18", chevron: "m9 5 7 7-7 7", grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z", timeline: "M3 5h18v4H3zM3 12h9v7H3zM15 12h6v7h-6z", bolt: "m13 2-9 12h7l-1 8 10-13h-7Z", lock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4", unlock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 7-3", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z", save: "M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-7h8v7", folder: "M3 6V3h7l3 3h8v14H3z", spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z", mute: "M11 5 6 9H2v6h4l5 4zM16 9l6 6M22 9l-6 6", sound: "M11 5 6 9H2v6h4l5 4zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14", marker: "M5 22V3h13l-3 5 3 5H5" };
var icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.settings}"/></svg>`;
var fmt = (t) => `${String(Math.floor(Math.max(0, t) / 60)).padStart(2, "0")}:${Math.max(0, t % 60).toFixed(2).padStart(5, "0")}`;
var short2 = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
var project = blankProject();
var selected = null;
var selectedAsset = null;
var tab = "quick";
var view = "timeline";
var zoom = 12;
var playhead = 0;
var clipboard = null;
var storyPage = 0;
var playerFit = "fit";
var audioView = "waveform";
var videoView = "filmstrip";
var storyMinimum = 32;
var storyCompression = 18;
var displayScale = linearScale(60, zoom);
var markerDragging = false;
var suppressMarkerClickUntil = 0;
var busy = false;
var abort;
var draftPreview = false;
var history = [];
var redo = [];
var saveTimer;
var toastTimer;
var media2 = new Media();
app.innerHTML = `<header class="topbar"><div class="brand"><span class="brand-mark">${icon("cut")}</span>CUTLINE<span class="pill">DRAFT 02</span></div><span class="project-title" id="project-name">Untitled project</span><div class="local"><span class="status-dot"></span>Local workspace</div><button class="icon ghost" data-action="undo" title="Undo (Ctrl+Z)">${icon("undo")}</button><button class="icon ghost" data-action="redo" title="Redo (Ctrl+Shift+Z)">${icon("redo")}</button><span class="divider"></span><button class="primary" data-action="export">${icon("import")} Export video</button></header>
<div class="workspace"><aside class="panel assets-panel"><div class="panel-head"><h2>Media library</h2><span class="muted tiny" id="asset-count">0 assets</span></div><div class="asset-toolbar"><button class="import-button" data-action="import">${icon("plus")} Import media</button><input id="asset-search" placeholder="Search media\u2026" aria-label="Search media" style="width:100%;margin-top:10px"></div><div class="asset-list" id="assets"></div><div class="asset-bottom"><button data-action="demo" class="ghost">${icon("spark")} Load sample project</button><div class="onboarding-foot">Files stay on this device.<br>Drop files here, or paste an image.</div></div></aside>
<div class="resizer resize-left" data-resizer="left" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize media panel"></div>
<section class="preview-panel"><div class="preview-head"><span id="monitor-label">PROJECT MONITOR</span><span id="output-info">1920 \xD7 1080 <span class="muted"> / </span>30 FPS</span></div><div class="preview-stage" id="stage"><canvas id="preview" width="1920" height="1080" aria-label="Project video preview"></canvas><div class="empty-preview" id="empty-preview"><span class="empty-symbol">${icon("video")}</span><h2>Make room for the good parts.</h2><p>Import your footage or explore the sample.<br>Your edit stays right here, in your browser.</p><button class="primary" data-action="demo">${icon("play")} Try the sample</button></div></div><div class="transport"><span class="timecode mono" id="timecode">00:00.00 <span class="muted">/ 00:00.00</span></span><button class="icon ghost" data-action="frame-back" title="Previous frame (\u2190)">${icon("back")}</button><button class="play-button" data-action="play" title="Play / pause (Space)" id="play-button">${icon("play")}</button><button class="icon ghost" data-action="frame-next" title="Next frame (\u2192)">${icon("next")}</button></div></section>
<div class="resizer resize-right" data-resizer="right" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize editing panel"></div>
<aside class="panel inspector-panel"><nav class="tabs"><button data-tab="quick" class="active">Edits</button><button data-tab="presets">Presets</button><button data-tab="suggestions" title="Pending edit suggestions">Review <span id="suggest-count">0</span></button></nav><div class="panel-body" id="inspector"></div></aside>
<div class="resizer resize-bottom" data-resizer="bottom" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Resize timeline"></div>
<section class="timeline-panel"><div class="timeline-toolbar"><div class="view-switch"><button data-view="timeline" class="active">${icon("timeline")} Timeline</button><button data-view="storyboard">${icon("grid")} Storyboard</button></div><button class="icon ghost" data-action="split" title="Split at playhead (S)">${icon("cut")}</button><button class="icon ghost" data-action="duplicate" title="Duplicate clip (Ctrl+D)">${icon("copy")}</button><button class="icon ghost danger" data-action="delete" title="Delete clip (Delete); Shift+Delete to ripple">${icon("trash")}</button><span class="divider"></span><button class="ghost small" data-action="add-track">${icon("plus")}<span class="label-long">Layer</span></button><button class="ghost small" data-action="marker" title="Add marker (M)">${icon("marker")}<span class="label-long">Marker</span></button><button class="ghost small" data-action="preview-draft" id="draft-toggle" title="Preview all pending edits">${icon("eye")}<span class="label-long">Suggestions</span></button><div class="zoom"><span>ZOOM</span><input id="zoom" aria-label="Timeline zoom" type="range" min="0" max="100" value="55"><button class="ghost small" data-action="fit">Fit</button></div></div><div class="timeline-scroll" id="timeline-scroll"><div class="timeline-content" id="timeline"></div></div><div class="storyboard hidden" id="storyboard"></div></section></div>
<footer class="footer"><span class="status-dot"></span><span id="status">Ready. Import footage or try the sample.</span><progress id="progress" class="hidden" max="1"></progress><button id="cancel-job" class="ghost small hidden" data-action="cancel">Cancel</button><span class="right" id="footer-info">NON-DESTRUCTIVE \xB7 BROWSER LOCAL</span></footer><input type="file" id="file-input" accept="video/*,audio/*,image/*,.mp4,.mov,.mkv,.webm,.wav,.mp3,.m4a" multiple hidden><input type="file" id="project-input" accept=".json,application/json" hidden><input type="file" id="relink-input" accept="video/*,audio/*,image/*" hidden>`;
var $ = (s, root = document) => root.querySelector(s);
document.querySelector('[data-action="export"]').insertAdjacentHTML("beforebegin", `<button class="ghost" data-action="node-edits" title="Open the drag-and-drop pipeline editor">${icon("bolt")} Pipelines</button>`);
$(".topbar").insertAdjacentHTML("afterbegin", '<nav class="workspace-menus" aria-label="Workspace"><button data-action="file-menu" aria-haspopup="menu">File \u25BE</button><button data-action="view-menu" aria-haspopup="menu">View \u25BE</button></nav>');
$(".timeline-toolbar").insertAdjacentHTML("beforeend", `<button class="icon ghost" data-action="clip-settings" title="Selected clip settings">${icon("settings")}</button>`);
var preview = new Preview($("#preview"), media2, (t) => {
  playhead = t;
  updateTime();
});
function status(message, progress2) {
  $("#status").textContent = message;
  $("#progress").classList.toggle("hidden", progress2 === void 0);
  if (progress2 !== void 0) $("#progress").value = progress2;
}
function toast(message, error = false) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const div = document.createElement("div");
  div.className = `toast${error ? " error" : ""}`;
  div.textContent = message;
  document.body.append(div);
  toastTimer = setTimeout(() => div.remove(), 6500);
}
function checkpoint() {
  history.push(copy(project));
  if (history.length > 40) history.shift();
  redo = [];
}
function commit(next) {
  checkpoint();
  project = next;
  project.revision++;
  draftPreview = false;
  render();
  save();
}
function save() {
  clearTimeout(saveTimer);
  status("Saving locally\u2026");
  saveTimer = setTimeout(() => {
    void put("projects", "autosave", project).then(() => status("Saved on this device")).catch(() => status("Autosave unavailable. Use Save to download your project."));
  }, 500);
}
function getClip() {
  return project.clips.find((c) => c.id === selected);
}
function stop() {
  preview.pause();
  $("#play-button").innerHTML = icon("play");
  if (tab === "properties" && selected) renderInspector();
}
function updateTime() {
  $("#timecode").innerHTML = `${fmt(playhead)} <span class="muted">/ ${fmt(projectEnd(preview.project ?? project))}</span>`;
  document.querySelectorAll(".playhead").forEach((el) => el.style.left = `${120 + displayScale.toX(playhead)}px`);
  $("#play-button").innerHTML = icon(preview.playing ? "pause" : "play");
  if (!preview.playing && tab === "properties" && selected && !$("#inspector").contains(document.activeElement)) renderInspector();
}
function showProject() {
  let displayed = project;
  if (draftPreview) {
    displayed = copy(project);
    try {
      for (const s of [...displayed.proposals].sort((a, b) => b.before[0].start - a.before[0].start)) displayed = acceptProposal(displayed, s.id);
    } catch (e) {
      draftPreview = false;
      toast(e.message, true);
    }
  }
  preview.setProject(displayed);
  preview.time = playhead;
  void preview.render(true);
  $("#monitor-label").textContent = draftPreview ? "SUGGESTED RESULT \xB7 PREVIEW" : "PROJECT MONITOR";
  $("#monitor-label").classList.toggle("previewing", draftPreview);
  $("#draft-toggle").classList.toggle("previewing", draftPreview);
}
function render() {
  $("#project-name").textContent = project.name;
  $("#output-info").textContent = `${project.width} \xD7 ${project.height} / ${project.fps} FPS`;
  $("#asset-count").textContent = `${project.assets.length} asset${project.assets.length === 1 ? "" : "s"}`;
  $("#suggest-count").textContent = String(project.proposals.length);
  $("#empty-preview").classList.toggle("hidden", project.clips.length > 0);
  $("#footer-info").textContent = `${project.clips.length} CLIPS \xB7 ${short2(projectEnd(project))} \xB7 BROWSER LOCAL`;
  renderAssets();
  renderInspector();
  renderTimeline();
  renderStoryboard();
  showProject();
  resizePlayer();
  updateTime();
  document.querySelectorAll('[data-action="undo"]').forEach((b) => b.disabled = !history.length);
  document.querySelectorAll('[data-action="redo"]').forEach((b) => b.disabled = !redo.length);
}
function renderAssets() {
  const q = $("#asset-search").value.toLowerCase();
  $("#assets").innerHTML = project.assets.filter((a) => a.name.toLowerCase().includes(q)).map((a) => `<div class="asset${a.id === selectedAsset ? " selected" : ""}" draggable="true" data-asset="${a.id}" title="${esc4(a.name)}"><span>${a.thumbnail ? `<img src="${esc4(a.thumbnail)}" alt="">` : `<span class="asset-placeholder">${icon(a.kind)}</span>`}</span><div style="min-width:0;flex:1"><div class="asset-name">${esc4(a.name)}</div><div class="asset-meta">${a.kind === "image" ? `${a.width} \xD7 ${a.height}` : short2(a.duration)} \xB7 ${media2.files.has(a.id) ? `${(a.size / 1e6).toFixed(1)} MB` : "RELINK NEEDED"}</div></div><button class="icon ghost" data-add-asset="${a.id}" title="Add to project">${icon("plus")}</button></div>`).join("") || '<div class="empty-assets">Your source media lives here.<br><br>Import video, audio, or images. Add them to the timeline when you\u2019re ready.</div>';
}
var propertyLabels = { x: "Position X", y: "Position Y", scale: "Scale", rotation: "Rotation", opacity: "Opacity", gainDb: "Volume (dB)" };
function propertyField(c, prop, min, max, step) {
  const at = sourceAt(c, playhead), value = valueAt(c, prop, Math.max(c.sourceIn, Math.min(c.sourceOut, at))), keys = c.keyframes[prop], has = keys?.some((k) => Math.abs(k.time - at) < 1 / (project.fps * 2));
  return `<div class="field"><label>${propertyLabels[prop]}<button class="key-button${has ? " active" : ""}" data-key="${prop}" title="Add / remove keyframe at playhead">\u25C6</button></label><input data-property="${prop}" type="number" min="${min}" max="${max}" step="${step}" value="${Number(value.toFixed(3))}"></div>`;
}
function renderInspector(target, mode = tab) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const node2 = target ?? $("#inspector");
  queueMicrotask(() => {
    if (mode === "properties" && getClip() && !node2.querySelector("[data-extra-properties]")) extraProperties(getClip(), node2);
  });
  if (mode === "properties") {
    const c = getClip();
    if (!c) {
      node2.innerHTML = `<div class="section-label">Clip inspector</div><div class="status-empty">${icon("settings")}<br><br>Select a clip to adjust its timing,<br>transform, audio, and keyframes.</div><div class="callout">Edits combine processes and checks. Presets let you reuse and chain them.</div>`;
      return;
    }
    const a = project.assets.find((a2) => a2.id === c.assetId);
    node2.innerHTML = `<div class="selected-heading">${esc4(c.name)}</div><div class="tiny muted">${esc4(a.kind.toUpperCase())} \xB7 ${short2(duration(c))} \xB7 ${c.quiet ? "QUIET REGION" : `${c.rate.toFixed(2)}\xD7 SPEED`}</div><div class="section-label">Timing</div><div class="field-pair"><div class="field"><label>Start (project s)</label><input data-timing="start" type="number" min="0" step=".01" value="${c.start.toFixed(3)}"></div><div class="field"><label>Speed multiplier</label><input data-timing="rate" type="number" min=".1" max="8" step=".05" value="${c.rate}"></div><div class="field"><label>Source in (s)</label><input data-timing="sourceIn" type="number" min="0" step=".01" value="${c.sourceIn.toFixed(3)}"></div><div class="field"><label>Source out (s)</label><input data-timing="sourceOut" type="number" min=".01" step=".01" value="${c.sourceOut.toFixed(3)}"></div></div><div class="field"><label>Layer</label><select data-timing="trackId">${project.tracks.map((t) => `<option value="${t.id}"${t.id === c.trackId ? " selected" : ""}>${esc4(t.name)}</option>`).join("")}</select></div>${a.kind !== "audio" ? `<div class="section-label">Transform <span class="muted">\xB7 \u25C6 keyframe</span></div><div class="field-pair">${propertyField(c, "x", -2, 3, 0.01)}${propertyField(c, "y", -2, 3, 0.01)}${propertyField(c, "scale", 0.01, 5, 0.01)}${propertyField(c, "rotation", -360, 360, 1)}</div>${propertyField(c, "opacity", 0, 1, 0.05)}` : ""}${a.hasAudio ? `<div class="section-label">Audio</div>${propertyField(c, "gainDb", -60, 24, 0.5)}<div class="tiny muted">Pitch is preserved when changing speed.</div>` : ""}<div class="section-label">Clip controls</div><div class="row"><button class="small" data-action="toggle-clip">${icon(c.enabled ? "eye" : "close")}${c.enabled ? "Enabled" : "Disabled"}</button><button class="small" data-action="analyze">Analyze audio</button></div>${Object.entries(c.keyframes).some(([, v]) => v?.length) ? `<div class="section-label">Keyframes</div><div class="key-list">${Object.entries(c.keyframes).flatMap(([prop, keys]) => keys.map((k, i) => `<div class="key-row"><button class="ghost small" data-seek="${c.start + (k.time - c.sourceIn) / c.rate}">${esc4(propertyLabels[prop])} \xB7 ${k.time.toFixed(2)}s</button><select data-key-interpolation="${prop}:${i}" title="Interpolation after this keyframe"><option value="linear"${k.interpolation === "linear" ? " selected" : ""}>Linear</option><option value="hold"${k.interpolation === "hold" ? " selected" : ""}>Hold</option></select><button class="ghost small" data-remove-key="${prop}:${i}" title="Remove keyframe">\xD7</button></div>`)).join("")}</div>` : ""}`;
  } else if (mode === "quick" || mode === "presets") {
    const kind = mode === "quick" ? "quick" : "preset", defs = currentDefinitions(project.library).filter((d) => d.kind === kind);
    node2.innerHTML = `<div class="row between" style="margin-bottom:14px"><span class="tiny muted">${kind === "quick" ? "REUSABLE ACTIONS" : "YOUR WORKFLOWS"}</span><button class="small" data-new-definition="${kind}">${icon("plus")} New</button></div>${defs.map((d) => `<article class="definition-card"><div class="definition-top"><h3>${esc4(d.name)}</h3><span class="pill${d.mode === "automatic" ? "" : " amber"}">${d.mode === "inherit" ? "STEP MODES" : d.mode === "automatic" ? "AUTO" : "SUGGEST"}</span></div><p>${esc4(d.description || `${d.steps.length} ordered steps`)}</p><div class="definition-actions"><button class="small" data-run="${d.id}">${icon("bolt")} Run</button><button class="small" data-edit="${d.id}" title="Edit definition">${icon("settings")}</button><button class="small" data-clone="${d.id}" title="Clone current setup">${icon("copy")}</button></div>${d.kind === "preset" ? `<label class="initial"><input type="checkbox" data-initial="${d.id}"${d.initial ? " checked" : ""}> Offer as an initial preset</label>` : ""}<div class="tiny muted" style="margin-top:9px">v${d.version} \xB7 ${d.steps.length} steps</div></article>`).join("")}`;
  } else {
    node2.innerHTML = `<div class="section-label">Suggested edits</div>${project.proposals.map((s) => `<article class="suggestion-card"><h3>${esc4(s.name)}</h3><p>${s.changes.length} related changes \xB7 ${short2(s.before.reduce((n, c) => n + duration(c), 0))} \u2192 ${short2(s.after.reduce((n, c) => n + duration(c), 0))}<br>${esc4(s.changes.slice(0, 3).map((c) => c.description).join(" \xB7 "))}</p><div class="row"><button class="small primary" data-accept="${s.id}">${icon("check")} Accept</button><button class="small" data-reject="${s.id}">Reject</button><button class="small" data-proposal="${s.id}" title="Inspect suggestion">${icon("eye")}</button></div></article>`).join("") || '<div class="status-empty">No pending edits.<br>Run a Edit in Suggested mode<br>to see its proposals here.</div>'}${project.proposals.length ? '<div class="callout">A card groups dependent steps for one clip. Approving commits the complete chain; rejecting keeps the original content.</div>' : ""}`;
  }
}
function renderTimeline() {
  if (markerDragging) return;
  displayScale = view === "storyboard" ? structureScale(project, storyMinimum, storyCompression) : linearScale(Math.max(projectEnd(project), ...project.markers.map((m) => m.time), 60), zoom);
  renderTracks($("#timeline"), $("#timeline-scroll"), { project, selected, playhead, structure: view === "storyboard", scale: displayScale, zoom, audioView, videoView, media: media2, icon });
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
}
function renderStoryboard() {
  $("#storyboard").classList.add("hidden");
  $("#timeline-scroll").classList.remove("hidden");
}
function selectClip(id) {
  stop();
  selected = id;
  draftPreview = false;
  renderInspector();
  renderTimeline();
  renderStoryboard();
}
function extraProperties(c, node2) {
  const a = project.assets.find((a2) => a2.id === c.assetId);
  const div = document.createElement("div");
  div.dataset.extraProperties = "true";
  div.innerHTML = `${a.kind !== "audio" ? `<div class="section-label">Crop \xB7 fraction of source</div><div class="field-pair">${["Left", "Right", "Top", "Bottom"].map((side) => `<div class="field"><label>${side}</label><input data-timing="crop${side}" type="number" min="0" max=".99" step=".01" value="${c[`crop${side}`] ?? 0}"></div>`).join("")}</div>` : ""}${a.hasAudio ? `<div class="section-label">Audio fades</div><div class="field-pair"><div class="field"><label>Fade in (s)</label><input data-timing="fadeIn" type="number" min="0" step=".1" value="${c.fadeIn ?? 0}"></div><div class="field"><label>Fade out (s)</label><input data-timing="fadeOut" type="number" min="0" step=".1" value="${c.fadeOut ?? 0}"></div></div>` : ""}`;
  node2.append(div);
  if (a.hasAudio) {
    const label = document.createElement("label"), input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!c.audioMuted;
    input.onchange = () => mutateClip((clip) => clip.audioMuted = input.checked);
    label.className = "node-check";
    label.append(input, document.createTextNode("Mute this clip audio"));
    div.prepend(label);
  }
}
function setBusy(on, message = "Ready") {
  busy = on;
  $("#cancel-job").classList.toggle("hidden", !on);
  if (on) abort = new AbortController();
  else abort = void 0;
  status(message, on ? 0 : void 0);
}
async function job(message, fn) {
  if (busy) {
    toast("Finish or cancel the current media task first.");
    return;
  }
  setBusy(true, message);
  stop();
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
    status(e.message);
    return;
  } finally {
    setBusy(false);
  }
}
var progress = (v, message) => status(message, v);
function openDialog(title, body, wide = false) {
  const d = document.createElement("dialog");
  if (wide) d.classList.add("wide");
  d.innerHTML = `<div class="dialog-head"><h2>${esc4(title)}</h2><button class="icon ghost" data-dialog-close title="Close">${icon("close")}</button></div><div class="dialog-body">${body}</div><div class="dialog-actions"></div>`;
  document.body.append(d);
  $("[data-dialog-close]", d).onclick = () => d.close();
  d.addEventListener("close", () => d.remove(), { once: true });
  d.showModal();
  return d;
}
function button(label, fn, kind = "") {
  const b = document.createElement("button");
  b.className = kind;
  b.textContent = label;
  b.onclick = fn;
  return b;
}
function choose(title, body, options, wide = false) {
  return new Promise((resolve) => {
    const d = openDialog(title, body, wide);
    let done = false;
    d.addEventListener("close", () => {
      if (!done) resolve({ id: "cancel", values: {} });
    });
    for (const option of options) $(".dialog-actions", d).append(button(option.label, () => {
      const values = {};
      d.querySelectorAll("input[name],select[name],textarea[name]").forEach((el) => {
        if (el instanceof HTMLInputElement && ["radio", "checkbox"].includes(el.type) && !el.checked) return;
        values[el.name] = el.value;
      });
      done = true;
      resolve({ id: option.id, values });
      d.close();
    }, option.kind));
  });
}
async function askName(title, value) {
  const r = await choose(title, `<div class="field"><label>Name</label><input name="name" value="${esc4(value)}" maxlength="100" autofocus></div>`, [{ id: "cancel", label: "Cancel" }, { id: "save", label: "Save", kind: "primary" }]);
  return r.id === "save" ? r.values.name?.trim() : void 0;
}
async function importFiles(files) {
  await job("Importing media\u2026", async () => {
    for (const f of files) {
      abort?.signal.throwIfAborted();
      const a = await media2.import(f, progress);
      const next = copy(project);
      next.assets.push(a);
      commit(next);
      try {
        await put("files", a.id, f);
      } catch {
        toast("Media works for this session. Browser storage is full; relink it when reopening.");
      }
    }
    status("Imported. Add an asset to the project with + or drag it onto a track.");
  });
}
async function addAsset(id, target, start) {
  if (busy) return;
  const a = project.assets.find((a2) => a2.id === id);
  if (!a) return;
  if (!media2.files.has(id)) {
    selectedAsset = id;
    relinkId = id;
    $("#relink-input").click();
    return;
  }
  const trackId = target ?? project.tracks.find((t) => t.kind === (a.kind === "audio" ? "audio" : "main"))?.id, track = project.tracks.find((t) => t.id === trackId);
  if (!track) {
    toast("Add a compatible track before adding this asset.", true);
    return;
  }
  if (track.kind !== "audio" && a.kind === "audio") {
    toast("Drop audio-only media onto an Audio track.");
    return;
  }
  const last = Math.max(0, ...project.clips.filter((c2) => c2.trackId === track.id).map((c2) => c2.start + duration(c2))), at = start ?? (track.kind === "main" ? last : playhead), c = makeClip(a, track.id, at);
  const next = copy(project);
  next.clips.push(c);
  if (project.clips.length === 0 && a.kind === "video") {
    const scale = Math.min(1, 1920 / a.width, 1080 / a.height);
    next.width = Math.max(16, Math.round(a.width * scale / 2) * 2);
    next.height = Math.max(16, Math.round(a.height * scale / 2) * 2);
  }
  selected = c.id;
  commit(next);
  playhead = at;
  await preview.seek(at);
  await offerInitialPreset(c, a);
}
async function offerInitialPreset(c, a) {
  const initial = currentDefinitions(project.library).filter((d) => d.initial);
  if (initial.length) {
    const r = await choose("Choose an initial preset", `<p>Added <strong>${esc4(a.name)}</strong>. Choose a preset to run on this clip.</p>${initial.map((d, i) => `<label class="choice-card"><input name="preset" type="radio" value="${d.id}"${i === 0 ? " checked" : ""}><span><strong>${esc4(d.name)}</strong><small>${esc4(d.description)}</small></span></label>`).join("")}<p>The preset\u2019s automatic/suggested settings will be respected.</p>`, [{ id: "none", label: "Run no initial presets" }, { id: "run", label: "Run selected preset", kind: "primary" }]);
    if (r.id === "run") await runDefinition(latest(project.library, r.values.preset), [c.id]);
  }
}
async function runDefinition(d, ids, override, range, rangeTracks) {
  await job(`Running ${d.name}\u2026`, async () => {
    let draft = copy(project), selectedIds = ids ?? (selected ? [selected] : []);
    let steps = compile(d, draft.library);
    if (override && override !== "inherit") steps = withMode(steps, override);
    if (range) {
      const scoped = selectTimeRange(draft, range[0], range[1], rangeTracks);
      draft = scoped.project;
      selectedIds = scoped.ids;
    }
    if (!selectedIds.length) throw Error(range ? "No timeline content overlaps this range on the chosen tracks." : "Select a clip or choose a valid time range.");
    const baseRevision = project.revision, baseline = JSON.stringify(draft), result = await runWorkflow(draft, selectedIds, steps, (id) => {
      const a = draft.assets.find((a2) => a2.id === id);
      return a?.hasAudio ? media2.analyze(id, progress, abort?.signal) : Promise.resolve({ step: 0.02, duration: a?.duration ?? 0, hasAudio: false, rms: new Float32Array(), peak: new Float32Array(), weighted: new Float32Array() });
    }, d.name, abort?.signal);
    if (project.revision !== baseRevision) throw Error("The project changed during analysis. Run the action again.");
    const count = result.proposals.length - project.proposals.length;
    if (JSON.stringify(result) === baseline) {
      toast("No changes met the workflow\u2019s criteria.");
      return;
    }
    commit(result);
    if (count) {
      tab = "suggestions";
      renderInspector();
      toast(`${count} suggestion group${count === 1 ? "" : "s"} ready in the timeline.`);
    } else toast("Edits applied. Undo restores the previous project.");
  });
}
async function runOptions(id, regionId, definition) {
  const saved = project.nodeEdits?.find((g) => g.id === id && g.workflow), d = definition ?? (saved ? graphDefinition(saved) : latest(project.library, id)), regions = (project.regions ?? []).filter((region) => regionBounds(project, region));
  const body = `<div class="field"><label>Apply to</label><select name="scope"><option value="selected">Selected clip</option><option value="main">All main video clips</option><option value="all">All clips</option><option value="range">Exact time range</option>${regions.length ? `<optgroup label="Marked regions">${regions.map((region) => {
    const bounds = regionBounds(project, region);
    return `<option value="region:${esc4(region.id)}"${region.id === regionId ? " selected" : ""}>${esc4(region.name)} \xB7 ${fmt(bounds[0])}\u2013${fmt(bounds[1])}</option>`;
  }).join("")}</optgroup>` : ""}</select></div><div data-range-fields class="field-pair hidden"><div class="field"><label>Range start (s)</label><input name="from" type="number" min="0" step="any" value="${playhead.toFixed(2)}"></div><div class="field"><label>Range end (s)</label><input name="to" type="number" min="0" step="any" value="${(playhead + 20).toFixed(2)}"></div></div><div data-range-tracks class="field${regionId ? "" : " hidden"}"><label>Tracks inside the range</label><select name="tracks"><option value="all">All tracks</option><option value="main">Main video track</option>${getClip() ? '<option value="selected">Selected clip\u2019s track</option>' : ""}</select></div><div class="field"><label>Application mode</label><select name="mode"><option value="inherit">Respect each Edit\u2019s settings</option><option value="suggested">Suggest all edits</option><option value="automatic">Apply all edits automatically</option></select></div><div class="callout">Only content inside the chosen range is processed. Duration changes use the timeline\u2019s existing ripple behavior. Suggested changes stay pending until approved.</div>`;
  const pending = choose(`Run ${d.name}`, body, [{ id: "cancel", label: "Cancel" }, { id: "run", label: "Run workflow", kind: "primary" }]);
  const dialog = document.querySelector("dialog[open]:last-of-type"), scope = $("[name=scope]", dialog);
  const updateRangeFields = () => {
    $("[data-range-fields]", dialog).classList.toggle("hidden", scope.value !== "range");
    $("[data-range-tracks]", dialog).classList.toggle("hidden", scope.value !== "range" && !scope.value.startsWith("region:"));
  };
  scope.onchange = updateRangeFields;
  updateRangeFields();
  const r = await pending;
  if (r.id !== "run") return;
  let range;
  if (r.values.scope === "range") range = [Number(r.values.from), Number(r.values.to)];
  else if (r.values.scope.startsWith("region:")) {
    const region = project.regions?.find((region2) => region2.id === r.values.scope.slice(7));
    range = region && regionBounds(project, region);
    if (!range) {
      toast("This marked region no longer exists.", true);
      return;
    }
  }
  const tracks = r.values.tracks === "main" ? ["main"] : r.values.tracks === "selected" ? [getClip()?.trackId ?? ""] : void 0;
  const ids = r.values.scope === "main" ? project.clips.filter((c) => c.trackId === "main").map((c) => c.id) : r.values.scope === "all" ? project.clips.map((c) => c.id) : selected ? [selected] : [];
  await runDefinition(d, ids, r.values.mode, range, tracks);
}
function savePipeline(edit) {
  const next = copy(project), g = copy(edit);
  if (g.workflow) {
    try {
      const d = graphDefinition(g), old = currentDefinitions(next.library).find((v) => v.id === d.id);
      const same = old && JSON.stringify({ ...old, version: 0 }) === JSON.stringify({ ...d, version: 0 });
      if (!same) {
        d.version = (old?.version ?? 0) + 1;
        compile(d, [...next.library, d]);
        next.library.push(d);
        g.version = d.version;
      }
    } catch {
    }
  }
  next.nodeEdits = [...(next.nodeEdits ?? []).filter((e) => e.id !== g.id), g];
  commit(next);
}
function openPipelines(initial) {
  stop();
  return openEditMenu({ initial, edits: () => project.nodeEdits ?? [], save: savePipeline, definitions: () => project.library, saveDefinition: (d) => {
    const next = copy(project);
    next.library.push(d);
    commit(next);
  }, legacy: () => currentDefinitions(project.library).map((d) => ({ id: d.id, name: d.name, kind: d.kind })), openLegacy: (id) => editDefinition(latest(project.library, id)), dialog: openDialog, message: toast, sharing: async (count) => {
    const result = await choose("Used in " + count + " places", "<p>Update linked uses everywhere, or preserve them by saving this setup as a separate Edit?</p>", [{ id: "cancel", label: "Cancel change" }, { id: "copy", label: "Save as separate Edit" }, { id: "everywhere", label: "Edit everywhere", kind: "primary" }]);
    return ["copy", "everywhere"].includes(result.id) ? result.id : "cancel";
  }, confirm: async (body) => {
    const answer = await choose("Follow current settings?", body, [{ id: "keep", label: "Keep locked" }, { id: "clone", label: "Make a separate clone" }, { id: "unlock", label: "Unlock and use current settings", kind: "primary" }], true);
    return ["unlock", "clone"].includes(answer.id) ? answer.id : "keep";
  }, run: async (edit) => {
    if (edit.workflow) {
      const d = graphDefinition(edit);
      compile(d, project.library);
      await runOptions(d.id, void 0, d);
    } else await analyzePipeline(edit);
  } });
}
function editDefinition(original, kind = "preset") {
  const d = original ?? { id: uid(), version: 1, name: kind === "quick" ? "New Edit" : "New preset", description: "", kind, mode: "suggested", initial: false, steps: [] };
  const saved = project.nodeEdits?.find((g) => g.id === d.id);
  return openPipelines(saved ?? definitionGraph(d, project.library));
}
async function analyzePipeline(edit) {
  const selectedClip = getClip(), candidates = [...selectedClip ? [{ id: `clip:${selectedClip.id}`, label: `Selected clip \xB7 ${selectedClip.name}`, asset: project.assets.find((a) => a.id === selectedClip.assetId) }] : [], ...project.assets.map((asset) => ({ id: `asset:${asset.id}`, label: asset.name, asset }))];
  for (const link of project.sourceLinks ?? []) {
    const asset = project.assets.find((a) => a.id === link.videoAssetId);
    if (asset) candidates.push({ id: "link:" + link.id, label: link.name + " \xB7 linked video/audio", asset, link });
  }
  const mapping = await choose("Choose pipeline media", edit.slots.map((slot) => `<div class="field"><label>${esc4(slot.name)}${slot.required ? " \xB7 required" : ""}</label><select name="${esc4(slot.id)}"><option value="">Choose media\u2026</option>${candidates.filter((c) => compatible(c.link ? "av" : c.asset.kind === "video" ? c.asset.hasAudio ? "av" : "video" : c.asset.kind, slot.type)).map((c, i) => `<option value="${esc4(c.id)}"${i === 0 ? " selected" : ""}>${esc4(c.label)}</option>`).join("")}</select></div>`).join(""), [{ id: "cancel", label: "Cancel" }, { id: "run", label: "Analyze real media", kind: "primary" }]);
  if (mapping.id !== "run") return;
  const constructed = [];
  let result, boundClip;
  await job("Analyzing pipeline signals\u2026", async () => {
    const bindings = {};
    for (const slot of edit.slots) {
      const value = mapping.values[slot.id];
      if (!value) {
        if (slot.required) throw Error(`Choose media for ${slot.name}.`);
        continue;
      }
      const candidate = candidates.find((c) => c.id === value);
      if (!media2.files.has(candidate.asset.id)) throw Error("Relink the selected source before analysis.");
      const hash = await media2.task("hash", { assetId: candidate.asset.id }, progress, abort?.signal);
      if (candidate.link) {
        const link = candidate.link;
        if (!media2.files.has(link.audioAssetId)) throw Error("Relink the linked audio source.");
        const audioHash = await media2.task("hash", { assetId: link.audioAssetId }, progress, abort?.signal);
        bindings[slot.id] = { ...assetRevision(candidate.asset, hash + ":" + audioHash + ":" + link.audioOffsetSec), id: link.id, originId: link.id, type: "av", audioAssetId: link.audioAssetId, audioOffsetSec: link.audioOffsetSec };
      } else bindings[slot.id] = value.startsWith("clip:") ? clipRevision(candidate.asset, selectedClip, hash) : assetRevision(candidate.asset, hash);
      if (value.startsWith("clip:")) boundClip = bindings[slot.id];
    }
    for (const node2 of edit.nodes.filter((n) => n.kind === "media" && n.params.cast === "text-image" && !edit.connections.some((c) => c.to.node === n.id && c.to.port === "media"))) {
      const asset = await templateAsset(node2.params, node2.name);
      constructed.push(asset);
      const hash = await media2.task("hash", { assetId: asset.id }, progress, abort?.signal);
      bindings[node2.id] = assetRevision(asset, hash);
    }
    const engine = new PipelineEngine(fastDetectors(async (revision, params, onPartial, signal) => {
      if (params.detector === "markers" && !params.ranges) params = { ...params, ranges: (project.regions ?? []).flatMap((r) => {
        const b = regionBounds(project, r);
        if (!b || !selectedClip || revision.id !== selectedClip.id) return [];
        return [{ start: Math.max(0, b[0] - selectedClip.start), end: Math.min(duration(selectedClip), b[1] - selectedClip.start) }].filter((r2) => r2.end > r2.start);
      }) };
      return media2.task("pipeline-signal", { assetId: ["loudness", "silence", "variance", "consistency", "speech"].includes(String(params.detector)) ? revision.audioAssetId ?? revision.assetId ?? revision.originId : revision.assetId ?? revision.originId, revision, params }, (v, m, partial) => {
        progress(v, m);
        if (partial) onPartial({ progress: v, signal: partial });
      }, signal);
    }), new IndexedDBSignalCache({ get: (key) => get("analysis", `pipeline:${key}`), put: (key, value) => put("analysis", `pipeline:${key}`, value) }));
    result = await engine.advance(engine.create(edit, bindings, { proposeOnly: true }), abort?.signal);
    if (result.status === "failed") throw Error(result.error?.message ?? "Pipeline analysis failed.");
  });
  if (!result || result.status === "failed") return;
  const run = result;
  const signalHTML = Object.entries(run.outputs).flatMap(([id, outputs]) => Object.values(outputs).map((value) => {
    const name = edit.nodes.find((n) => n.id === id)?.name ?? id;
    if ("values" in value) {
      const values = value.values, lo = Math.min(0, ...values), hi = Math.max(1, ...values), step = Math.max(1, Math.ceil(values.length / 400)), points = Array.from(values).flatMap((v, i) => i % step ? [] : [`${i / Math.max(1, values.length - 1) * 600},${90 - (v - lo) / Math.max(1e-3, hi - lo) * 80}`]).join(" ");
      return `<section><h3>${esc4(name)}</h3><small>${esc4(value.kind)} \xB7 ${value.sampleRateHz} samples/sec \xB7 ${lo.toFixed(1)} to ${hi.toFixed(1)}</small><svg viewBox="0 0 600 100" style="width:100%;background:#152327"><polyline fill="none" stroke="#b4e7c3" stroke-width="2" points="${points}"></polyline></svg></section>`;
    }
    if ("originRanges" in value) return `<section><h3>${esc4(name)}</h3><p>${value.ranges.length} selected regions</p><pre>${esc4(value.ranges.map((r) => `${fmt(r.start)} \u2013 ${fmt(r.end)}`).join("\n"))}</pre></section>`;
    return "";
  })).join("");
  const d = openDialog(constructed.length ? "Pipeline results" : "Signal analysis", `<p>Measured from your media. Speech activity is an energy-based estimate, not speaker recognition. ${run.status === "awaiting-approval" ? "Action proposals are previews and have not changed the timeline." : ""}</p>${signalHTML || "<p>No signal outputs. Connect Media \u2192 Signal \u2192 Track \u2192 Decide \u2192 Select.</p>"}`, true);
  if (constructed.length) {
    const note = document.createElement("p");
    note.textContent = "Template images are in the media library: " + constructed.map((a) => a.name).join(", ");
    d.querySelector(".dialog-body").prepend(note);
  }
  if (boundClip && selectedClip) {
    const selections = Object.values(run.outputs).flatMap((outputs) => Object.values(outputs).filter((v) => "originRanges" in v));
    if (selections.length) $(".dialog-actions", d).append(button("Create marked regions", () => {
      try {
        let next = copy(project);
        let count = 0;
        for (const selection of selections) {
          const projected = projectSelection(selection, boundClip);
          if (projected.stale.length) throw Error("Recompute the stale timestamp selection first.");
          for (const r of projected.ranges) {
            if (++count > 1e3) throw Error("More than 1,000 selections. Refine the condition before marking.");
            const marker = { id: uid(), name: `${edit.name} ${count}`, time: selectedClip.start + r.start, color: "#9cc9e5" };
            next.markers.push(marker);
            next = createMarkedRegion(next, marker.id, selectedClip.start + r.end).project;
          }
        }
        if (count) {
          commit(next);
          toast(`${count} regions marked. Edits can run within them.`);
          d.close();
        } else toast("Nothing matched the selection.");
      } catch (e) {
        toast(e.message, true);
      }
    }));
  }
  $(".dialog-actions", d).append(button("Close", () => d.close(), "primary"));
}
async function templateAsset(params, name) {
  const text = String(params.text ?? ""), width = Number(params.width ?? 1280), height = Number(params.height ?? 320);
  if (text.length > 1e4 || ![width, height].every((v) => Number.isInteger(v) && v >= 16 && v <= 4096)) throw Error("Use up to 10,000 text characters and image dimensions between 16 and 4,096 pixels.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(params))), fingerprint = "constructed:" + Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
  const existing = project.assets.find((a) => a.fingerprint === fingerprint && media2.files.has(a.id));
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (params.background && params.background !== "transparent") {
    ctx.fillStyle = String(params.background);
    ctx.fillRect(0, 0, width, height);
  }
  ctx.fillStyle = String(params.color ?? "#f4f9f6");
  const font = Number(params.fontSize ?? Math.min(100, height * 0.35));
  if (!Number.isFinite(font) || font <= 0 || font > 4096) throw Error("Choose a positive text size up to 4,096 pixels.");
  ctx.font = `600 ${font}px Segoe UI`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = text.split("\n"), lineHeight = font * 1.2;
  lines.forEach((line, i) => ctx.fillText(line, width / 2, height / 2 + (i - (lines.length - 1) / 2) * lineHeight, width * 0.92));
  const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png")), asset = await media2.import(new File([blob], `${name}.png`, { type: "image/png" }));
  asset.fingerprint = fingerprint;
  const next = copy(project);
  next.assets.push(asset);
  commit(next);
  try {
    await put("files", asset.id, media2.files.get(asset.id));
  } catch {
    toast("Template image is available this session; browser storage is full.");
  }
  return asset;
}
async function cloneLibrary(id) {
  const current = latest(project.library, id), name = await askName("Clone current setup", `${current.name} copy`);
  if (!name) return;
  const next = copy(project);
  next.library.push(cloneDefinition(current, project.library, name));
  commit(next);
  toast("Clone saved with its descendants pinned.");
}
async function inspectProposal(id) {
  const s = project.proposals.find((s2) => s2.id === id);
  if (!s) return;
  stop();
  selected = s.before[0].id;
  playhead = Math.max(0, s.before[0].start);
  await preview.seek(playhead);
  tab = "suggestions";
  renderInspector();
  const r = await choose("Suggested edits", `<p><strong>${esc4(s.name)}</strong> \xB7 ${s.changes.length} dependent changes</p><p>${fmt(s.before.reduce((n, c) => n + duration(c), 0))} \u2192 ${fmt(s.after.reduce((n, c) => n + duration(c), 0))}</p>${s.changes.map((c) => `<div class="callout">${esc4(c.description)}<br><span class="mono">${fmt(c.start)} \u2014 ${fmt(c.end)}</span></div>`).join("")}<p>Use Suggestions in the monitor toolbar to audition the proposed result. Context-aware popup playback is a later milestone.</p>`, [{ id: "cancel", label: "Keep pending" }, { id: "reject", label: "Reject" }, { id: "preview", label: "Preview result" }, { id: "accept", label: "Accept chain", kind: "primary" }]);
  if (r.id === "accept") accept(id);
  if (r.id === "reject") reject(id);
  if (r.id === "preview") {
    draftPreview = true;
    render();
    await preview.seek(playhead);
    await preview.play();
  }
}
function accept(id) {
  try {
    commit(acceptProposal(project, id));
    toast("Suggestion accepted.");
  } catch (e) {
    toast(e.message, true);
  }
}
function reject(id) {
  const next = copy(project);
  next.proposals = next.proposals.filter((s) => s.id !== id);
  commit(next);
  toast("Suggestion rejected; original content kept.");
}
function mutateClip(fn) {
  if (busy) return;
  const next = copy(project), c = next.clips.find((c2) => c2.id === selected);
  if (!c) return;
  fn(c);
  if (c.sourceIn < 0 || c.sourceOut <= c.sourceIn || c.start < 0 || c.rate < 0.1 || c.rate > 8 || c.scale <= 0 || c.opacity < 0 || c.opacity > 1 || (c.fadeIn ?? 0) < 0 || (c.fadeOut ?? 0) < 0 || [c.cropLeft, c.cropRight, c.cropTop, c.cropBottom].some((v) => v !== void 0 && (v < 0 || v > 0.99)) || (c.cropLeft ?? 0) + (c.cropRight ?? 0) >= 0.9999 || (c.cropTop ?? 0) + (c.cropBottom ?? 0) >= 0.9999 || !Object.values(c).filter((v) => typeof v === "number").every(Number.isFinite)) {
    toast("Clip timing or value is out of range.", true);
    renderInspector();
    return;
  }
  const a = next.assets.find((a2) => a2.id === c.assetId);
  if (a.kind !== "image" && c.sourceOut > a.duration + 1e-3) {
    toast("The trim extends beyond the source.", true);
    renderInspector();
    return;
  }
  commit(next);
}
var relinkId = null;
async function exportVideo() {
  if (!project.clips.length) {
    toast("Add media to the timeline first.");
    return;
  }
  if (project.proposals.length) {
    const r = await choose("Export the committed edit?", `<p>${project.proposals.length} suggestion groups are still pending. Export uses accepted edits only.</p>`, [{ id: "cancel", label: "Keep editing" }, { id: "export", label: "Export accepted edits", kind: "primary" }]);
    if (r.id !== "export") return;
  }
  let handle;
  try {
    if ("showSaveFilePicker" in window) handle = await window.showSaveFilePicker({ suggestedName: `${project.name}.mp4`, types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] });
  } catch (e) {
    if (e.name === "AbortError") return;
    toast(e.message, true);
    return;
  }
  if (!handle && projectEnd(project) > 120) {
    toast("Large exports require a Chromium browser with direct file saving. Open this editor in Chrome or Edge.", true);
    return;
  }
  await job("Preparing MP4 export\u2026", async () => {
    const result = await media2.task("export", { project: copy(project), handle }, progress, abort?.signal);
    if (result.blob) download(result.blob, `${project.name}.mp4`);
    toast("MP4 export complete.");
  });
}
async function loadDemo() {
  if (project.clips.length) {
    const r = await choose("Add sample media?", "<p>The sample will be added to your media library. Your existing clips will remain.</p>", [{ id: "cancel", label: "Cancel" }, { id: "add", label: "Add sample", kind: "primary" }]);
    if (r.id !== "add") return;
  }
  let asset;
  await job("Creating a real sample MP4\u2026", async () => {
    const result = await media2.task("demo", {}, progress, abort?.signal), file = new File([result.blob], "Field notes \u2014 sample.mp4", { type: "video/mp4" });
    asset = await media2.import(file);
    await put("files", asset.id, file);
    const next = copy(project);
    next.assets.push(asset);
    next.name = project.clips.length ? project.name : "Field notes";
    commit(next);
  });
  if (asset) {
    await addAsset(asset.id, "main");
    fitTimeline();
  }
}
function fitTimeline() {
  const available = $("#timeline-scroll").clientWidth - 160;
  if (view === "storyboard") {
    const scale = structureScale(project, storyMinimum, 1), count = scale.times.length - 1, logs = scale.times.slice(1).reduce((sum, t, i) => sum + Math.log1p(t - scale.times[i]), 0);
    storyCompression = Math.max(0, Math.min(60, (available - count * storyMinimum) / Math.max(1e-3, logs)));
    $("#zoom").value = String(storyCompression / 0.6);
  } else {
    zoom = Math.max(0.04, Math.min(100, available / Math.max(projectEnd(project), 10)));
    $("#zoom").value = String(100 * Math.log(zoom / 0.04) / Math.log(100 / 0.04));
  }
  renderTimeline();
}
async function addTitle() {
  const title = await askName("Create text overlay", "Chapter one");
  if (!title) return;
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 320;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f3f8f5";
  ctx.font = "600 100px Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#000b";
  ctx.shadowBlur = 12;
  ctx.fillText(title, 960, 160, 1800);
  const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  const before = new Set(project.assets.map((a) => a.id));
  await importFiles([new File([blob], `${title}.png`, { type: "image/png" })]);
  const asset = project.assets.find((a) => !before.has(a.id));
  if (asset) await addAsset(asset.id, "overlay");
}
$(".asset-toolbar").append(button("Add text overlay", () => void addTitle(), "ghost small"));
document.addEventListener("dblclick", (e) => {
  const asset = e.target.closest("[data-asset]");
  if (!asset) return;
  const a = project.assets.find((a2) => a2.id === asset.dataset.asset), url = media2.urls.get(a.id);
  if (!url) return;
  const d = openDialog(`Source \xB7 ${a.name}`, a.kind === "image" ? `<img src="${esc4(url)}" alt="${esc4(a.name)}" style="width:100%;max-height:50vh;object-fit:contain">` : `<${a.kind === "audio" ? "audio" : "video"} src="${esc4(url)}" controls style="width:100%;max-height:50vh"></${a.kind === "audio" ? "audio" : "video"}>`, true);
  $(".dialog-actions", d).append(button("Add to project", () => {
    d.close();
    void addAsset(a.id);
  }, "primary"));
  d.addEventListener("close", () => d.querySelector("video,audio")?.remove());
});
async function action(name) {
  if (busy && !["cancel", "play"].includes(name)) {
    toast("Finish or cancel the current task first.");
    return;
  }
  if (name === "file-menu") openFileMenu();
  if (name === "source-links") openSourceLinks();
  if (name === "source-regions") regionEditor({ project: () => project, save: commit, urls: media2.urls, dialog: openDialog, message: toast, add: async (r) => {
    const next = copy(project), asset = next.assets.find((a) => a.id === r.assetId);
    let track = next.tracks.find((t) => t.kind === "overlay");
    if (!track) {
      track = { id: uid(), kind: "overlay", name: "Regions", muted: false };
      next.tracks.push(track);
    }
    const c = regionClip(asset, r, track.id, playhead);
    next.clips.push(c);
    selected = c.id;
    commit(next);
    await offerInitialPreset(c, asset);
  } });
  if (name === "layouts") {
    const clips = project.clips.filter((c) => c.enabled && c.start <= playhead && c.start + duration(c) > playhead && project.assets.find((a) => a.id === c.assetId)?.kind === "video");
    const result = await choose("Layouts", `<p>Apply from the playhead using hold keyframes. Earlier positions and the existing layer order are retained; image overlays stay above video.</p><div class="field"><label>Named layout</label><select name="layout"><option value="grid">Grid</option>${clips.map((c) => `<option value="focus:${c.id}">Focus \xB7 ${esc4(c.name)}</option>`).join("")}</select></div>`, [{ id: "cancel", label: "Cancel" }, { id: "apply", label: "Apply layout", kind: "primary" }]);
    if (result.id === "apply") try {
      commit(applyLayout(project, playhead, result.values.layout === "grid" ? "grid" : "focus", result.values.layout.slice(6)));
    } catch (e) {
      toast(e.message, true);
    }
  }
  if (name === "clip-settings") {
    document.querySelector(".view-dropdown")?.remove();
    openClipSettings();
  }
  if (name === "new-project") {
    const result = await choose("New workspace", "<p>The current project stays available through Undo. Use File \u2192 Save project for a separate backup.</p>", [{ id: "cancel", label: "Cancel" }, { id: "new", label: "New project", kind: "primary" }]);
    if (result.id === "new") {
      stop();
      selected = null;
      playhead = 0;
      commit(blankProject());
    }
  }
  if (name === "workspace-settings") {
    const result = await choose("Workspace settings", `<div class="field"><label>Name</label><input name="name" value="${esc4(project.name)}"></div><div class="field-pair"><div class="field"><label>Width</label><input name="width" type="number" min="16" max="4096" value="${project.width}"></div><div class="field"><label>Height</label><input name="height" type="number" min="16" max="4096" value="${project.height}"></div></div><div class="field"><label>Frames per second</label><input name="fps" type="number" min="1" max="60" value="${project.fps}"></div>`, [{ id: "cancel", label: "Cancel" }, { id: "save", label: "Save", kind: "primary" }]);
    if (result.id === "save") {
      const next = copy(project);
      next.name = result.values.name.trim() || "Untitled";
      next.width = Number(result.values.width);
      next.height = Number(result.values.height);
      next.fps = Number(result.values.fps);
      try {
        validateProject(next);
        commit(next);
      } catch (e) {
        toast(e.message, true);
      }
    }
  }
  if (name === "node-edits") openPipelines();
  if (name === "cancel") {
    abort?.abort();
    status("Cancelling after the current media block\u2026");
    return;
  }
  if (name === "view-menu") openViewMenu();
  if (name === "edit-menu-styles") await compareMenuStyles();
  if (name === "import") $("#file-input").click();
  if (name === "demo") await loadDemo();
  if (name === "play") {
    if (preview.playing) stop();
    else if (project.clips.length) {
      if (playhead >= projectEnd(preview.project)) await preview.seek(0);
      await preview.play();
    }
  }
  if (name === "frame-back" || name === "frame-next") {
    stop();
    await preview.seek(Math.max(0, Math.min(projectEnd(project), playhead + (name === "frame-back" ? -1 : 1) / project.fps)));
  }
  if (name === "undo" && history.length) {
    stop();
    redo.push(copy(project));
    project = history.pop();
    render();
    save();
  }
  if (name === "redo" && redo.length) {
    stop();
    history.push(copy(project));
    project = redo.pop();
    render();
    save();
  }
  if (name === "split" && selected) {
    try {
      commit(splitClip(project, selected, playhead));
    } catch (e) {
      toast(e.message, true);
    }
  }
  if (name === "delete" && selected) {
    const next = copy(project);
    next.clips = next.clips.filter((c) => c.id !== selected);
    selected = null;
    commit(next);
  }
  if (name === "ripple-delete" && selected) {
    const c = getClip();
    selected = null;
    commit(replaceClips(project, [c], []));
  }
  if (name === "duplicate" && selected) {
    const c = copy(getClip());
    c.id = uid();
    c.rootId = c.id;
    c.start = Math.max(c.start + duration(c), ...project.clips.filter((x) => x.trackId === c.trackId).map((x) => x.start + duration(x)));
    const next = copy(project);
    next.clips.push(c);
    selected = c.id;
    commit(next);
  }
  if (name === "toggle-clip") mutateClip((c) => c.enabled = !c.enabled);
  if (name === "fit") fitTimeline();
  if (name === "preview-draft") {
    draftPreview = !draftPreview;
    render();
  }
  if (name === "add-track") {
    const next = copy(project);
    next.tracks.push({ id: uid(), name: `Overlay ${next.tracks.filter((t) => t.kind === "overlay").length + 1}`, kind: "overlay", muted: false });
    commit(next);
  }
  if (name === "marker") {
    const next = copy(project), marker = { id: uid(), time: playhead, name: `Marker ${next.markers.length + 1}`, color: "#efc17b" };
    next.markers.push(marker);
    commit(next);
    await editMarker(marker.id);
  }
  if (name === "analyze" && getClip()) {
    const c = getClip();
    await job("Analyzing audio\u2026", async () => {
      await media2.analyze(c.assetId, progress, abort?.signal);
      renderTimeline();
      toast("Audio envelope cached.");
    });
  }
  if (name === "save-project") {
    const title = await askName("Save project", project.name);
    if (title) {
      project.name = title;
      render();
      save();
      download(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), `${title}.cutline.json`);
    }
  }
  if (name === "open-project") $("#project-input").click();
  if (name === "export") await exportVideo();
  if (name === "export-presets") download(new Blob([JSON.stringify({ format: "cutline-presets-v1", library: project.library }, null, 2)], { type: "application/json" }), "Cutline presets.json");
  if (name === "import-presets") {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        if (data.format !== "cutline-presets-v1" || !Array.isArray(data.library)) throw Error("Not a Cutline preset library.");
        const next = copy(project);
        const remap = /* @__PURE__ */ new Map();
        for (const d of data.library) if (!remap.has(d.id)) remap.set(d.id, uid());
        const visit = (d) => remapDefinition(d, remap);
        next.library.push(...data.library.map(visit));
        validateProject(next);
        commit(migrateProject(next));
      } catch (e) {
        toast(e.message, true);
      }
    };
    input.click();
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("button,[data-asset],[data-clip],[data-story],[data-proposal]");
  if (!el) return;
  if (el.closest("dialog") && !el.closest(".clip-properties-dialog")) return;
  if (el.dataset.action) void action(el.dataset.action).catch((e2) => toast(e2.message, true));
  if (el.dataset.tab) {
    tab = el.dataset.tab;
    renderInspector();
  }
  if (el.dataset.view) setView(el.dataset.view);
  if (el.dataset.addAsset) void addAsset(el.dataset.addAsset).catch((e2) => toast(e2.message, true));
  else if (el.dataset.asset) {
    selectedAsset = el.dataset.asset;
    renderAssets();
    if (!media2.files.has(selectedAsset)) {
      relinkId = selectedAsset;
      $("#relink-input").click();
    }
  }
  if (el.dataset.clip) selectClip(el.dataset.clip);
  if (el.dataset.story) {
    selectClip(el.dataset.story);
    void preview.seek(getClip().start);
  }
  if (el.dataset.storyPage) {
    storyPage = Math.max(0, storyPage + Number(el.dataset.storyPage));
    renderStoryboard();
    $("#storyboard").scrollTop = 0;
  }
  if (el.dataset.run) void runOptions(el.dataset.run).catch((e2) => toast(e2.message, true));
  if (el.dataset.edit) editDefinition(latest(project.library, el.dataset.edit));
  if (el.dataset.clone) void cloneLibrary(el.dataset.clone);
  if (el.dataset.newDefinition) editDefinition(void 0, el.dataset.newDefinition);
  if (el.dataset.accept) accept(el.dataset.accept);
  if (el.dataset.reject) reject(el.dataset.reject);
  if (el.dataset.proposal) void inspectProposal(el.dataset.proposal);
  if (el.dataset.seek) {
    stop();
    void preview.seek(Number(el.dataset.seek));
  }
  if (el.dataset.marker && Date.now() > suppressMarkerClickUntil) void editMarker(el.dataset.marker);
  if (el.dataset.region && Date.now() > suppressMarkerClickUntil) void editRegion(el.dataset.region);
  if (el.dataset.mute) {
    const next = copy(project);
    const t = next.tracks.find((t2) => t2.id === el.dataset.mute);
    t.muted = !t.muted;
    commit(next);
  }
  if (el.dataset.key) {
    const prop = el.dataset.key;
    mutateClip((c) => {
      if (playhead < c.start || playhead > c.start + duration(c)) {
        toast("Put the playhead inside this clip.");
        return;
      }
      const at = sourceAt(c, playhead), keys = c.keyframes[prop] ?? [], index = keys.findIndex((k) => Math.abs(k.time - at) < 1 / (project.fps * 2));
      if (index >= 0) keys.splice(index, 1);
      else keys.push({ time: at, value: valueAt(c, prop, at), interpolation: "linear" });
      c.keyframes[prop] = keys.sort((a, b) => a.time - b.time);
    });
  }
  if (el.dataset.removeKey) {
    const [prop, i] = el.dataset.removeKey.split(":");
    mutateClip((c) => c.keyframes[prop]?.splice(Number(i), 1));
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.closest("dialog") && !el.closest(".clip-properties-dialog")) return;
  if (el.dataset.property) {
    const prop = el.dataset.property, value = Number(el.value);
    if (!Number.isFinite(value)) return;
    mutateClip((c) => {
      const keys = c.keyframes[prop];
      if (keys?.length) {
        const at = Math.max(c.sourceIn, Math.min(c.sourceOut, sourceAt(c, playhead))), key = keys.find((k) => Math.abs(k.time - at) < 1 / (project.fps * 2));
        if (key) key.value = value;
        else keys.push({ time: at, value, interpolation: "linear" });
        keys.sort((a, b) => a.time - b.time);
      } else c[prop] = value;
    });
  }
  if (el.dataset.timing) {
    const prop = el.dataset.timing;
    mutateClip((c) => {
      c[prop] = prop === "trackId" ? el.value : Number(el.value);
    });
  }
  if (el.dataset.initial) {
    const next = copy(project), d = copy(latest(next.library, el.dataset.initial));
    d.version++;
    d.initial = el.checked;
    next.library.push(d);
    commit(next);
  }
  if (el.dataset.keyInterpolation) {
    const [prop, i] = el.dataset.keyInterpolation.split(":");
    mutateClip((c) => c.keyframes[prop][Number(i)].interpolation = el.value);
  }
});
$("#file-input").onchange = (e) => {
  void importFiles(Array.from(e.target.files ?? []));
  e.target.value = "";
};
$("#asset-search").oninput = renderAssets;
$("#zoom").oninput = (e) => {
  if (view === "storyboard") storyCompression = Number(e.target.value) * 0.6;
  else zoom = 0.04 * Math.pow(100 / 0.04, Number(e.target.value) / 100);
  renderTimeline();
};
$("#timeline-scroll").addEventListener("scroll", () => renderTimeline(), { passive: true });
$("#project-input").onchange = async (e) => {
  try {
    const file = e.target.files?.[0];
    if (!file) return;
    const loaded = JSON.parse(await file.text());
    validateProject(loaded);
    await media2.restore(loaded.assets);
    selected = null;
    playhead = 0;
    commit(migrateProject(loaded));
    fitTimeline();
    const missing = project.assets.filter((a) => !media2.files.has(a.id)).length;
    if (missing) toast(`${missing} source files need relinking. Click them in the media library.`);
  } catch (e2) {
    toast(e2.message, true);
  }
  e.target.value = "";
};
$("#relink-input").onchange = async (e) => {
  const f = e.target.files?.[0], id = relinkId;
  if (!f || !id) return;
  let probeId;
  try {
    const expected = project.assets.find((a) => a.id === id);
    if (expected.size !== f.size || expected.name !== f.name) {
      const r = await choose("Relink to a different file?", `<p>The selected file differs in name or size. Existing trims and keyframes will use this replacement.</p>`, [{ id: "cancel", label: "Cancel" }, { id: "use", label: "Use replacement", kind: "primary" }]);
      if (r.id !== "use") return;
    }
    const info = await media2.import(f);
    probeId = info.id;
    if (info.kind !== expected.kind || info.kind !== "image" && info.duration < Math.max(0, ...project.clips.filter((c) => c.assetId === id).map((c) => c.sourceOut)) - 0.02) throw Error("Replacement format or duration does not match the clips.");
    await media2.register(id, f);
    await put("files", id, f);
    media2.envelopes.delete(id);
    media2.spectra.delete(id);
    await put("analysis", id, void 0);
    await put("analysis", `${id}:spectrum`, void 0);
    render();
    toast("Media relinked.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (probeId) await media2.release(probeId);
    e.target.value = "";
  }
};
document.addEventListener("keydown", (e) => {
  if (markerDragging || document.querySelector("dialog[open]") || e.target.closest("input,textarea,select,[contenteditable]")) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.code === "Space") {
    e.preventDefault();
    void action("play");
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    void action(e.key === "ArrowLeft" ? "frame-back" : "frame-next");
  }
  if (e.key.toLowerCase() === "s" && !mod) void action("split");
  if (e.key.toLowerCase() === "m" && !mod) void action("marker");
  if (e.key === "Delete" || e.key === "Backspace") void action(e.shiftKey ? "ripple-delete" : "delete");
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    void action(e.shiftKey ? "redo" : "undo");
  }
  if (mod && e.key.toLowerCase() === "d") {
    e.preventDefault();
    void action("duplicate");
  }
  if (mod && e.key.toLowerCase() === "c" && getClip()) {
    clipboard = copy(getClip());
    e.preventDefault();
  }
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void action("save-project");
  }
});
document.addEventListener("paste", (e) => {
  if (e.target.closest("input,textarea,select,[contenteditable]") || document.querySelector("dialog[open]") || busy || markerDragging) return;
  const items = Array.from(e.clipboardData?.items ?? []), image = items.find((i) => i.type.startsWith("image/"))?.getAsFile();
  if (image) {
    e.preventDefault();
    void (async () => {
      const file = new File([image], `Pasted image ${project.assets.length + 1}.png`, { type: image.type });
      await importFiles([file]);
      const a = project.assets.at(-1);
      if (a) await addAsset(a.id, "overlay");
    })();
  } else if (clipboard) {
    e.preventDefault();
    const c = copy(clipboard);
    c.id = uid();
    c.rootId = c.id;
    c.start = playhead;
    const next = copy(project);
    next.clips.push(c);
    selected = c.id;
    commit(next);
  }
});
document.addEventListener("dragstart", (e) => {
  const asset = e.target.closest("[data-asset]"), story = e.target.closest("[data-story]");
  if (asset) e.dataTransfer?.setData("application/x-cutline-asset", asset.dataset.asset);
  if (story) e.dataTransfer?.setData("application/x-cutline-story", story.dataset.story);
});
document.addEventListener("dragover", (e) => {
  if (e.target.closest(".workspace")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  const el = e.target;
  if (!el.closest(".workspace")) return;
  e.preventDefault();
  if (busy) return;
  const asset = e.dataTransfer?.getData("application/x-cutline-asset"), story = e.dataTransfer?.getData("application/x-cutline-story"), lane = el.closest("[data-lane]");
  if (asset) {
    const at = lane ? Math.max(0, displayScale.toTime(e.clientX - lane.getBoundingClientRect().left)) : void 0;
    void addAsset(asset, lane?.dataset.lane, at);
  } else if (story) {
    const target = el.closest("[data-story]");
    if (target && target.dataset.story !== story) {
      const next = copy(project), main = next.clips.filter((c) => c.trackId === "main").sort((a, b) => a.start - b.start), from = main.findIndex((c) => c.id === story), to = main.findIndex((c) => c.id === target.dataset.story);
      main.splice(to, 0, ...main.splice(from, 1));
      let at = 0;
      main.forEach((c) => {
        c.start = at;
        at += duration(c);
      });
      commit(next);
    }
  } else if (e.dataTransfer?.files.length) void importFiles(Array.from(e.dataTransfer.files));
});
document.addEventListener("pointerdown", (e) => {
  if (markerDragging) return;
  if (!busy && startMarkerDrag(e, { project: () => project, scale: () => displayScale, scroller: $("#timeline-scroll"), stop, commit, render: renderTimeline, active: (value) => {
    markerDragging = value;
  }, suppressClick: () => {
    suppressMarkerClickUntil = Date.now() + 350;
  }, toast })) return;
  const resizer = e.target.closest("[data-resizer]");
  if (resizer) {
    e.preventDefault();
    const key = resizer.dataset.resizer, root = document.documentElement, startX2 = e.clientX, startY = e.clientY, start = parseFloat(getComputedStyle(root).getPropertyValue(`--${key}`));
    resizer.classList.add("dragging");
    const move2 = (ev) => {
      const size = key === "bottom" ? Math.max(180, Math.min(innerHeight - 300, start - (ev.clientY - startY))) : Math.max(170, Math.min(innerWidth * 0.4, start + (key === "left" ? 1 : -1) * (ev.clientX - startX2)));
      root.style.setProperty(`--${key}`, `${size}px`);
    };
    const up2 = () => {
      resizer.classList.remove("dragging");
      window.removeEventListener("pointermove", move2);
      window.removeEventListener("pointerup", up2);
      localStorage.setItem("cutline-layout", JSON.stringify(["left", "right", "bottom"].map((k) => getComputedStyle(root).getPropertyValue(`--${k}`))));
      renderTimeline();
    };
    window.addEventListener("pointermove", move2);
    window.addEventListener("pointerup", up2);
    return;
  }
  const ruler = e.target.closest("[data-ruler]");
  if (ruler && !e.target.closest("button")) {
    stop();
    void preview.seek(Math.max(0, displayScale.toTime(e.clientX - ruler.getBoundingClientRect().left)));
    return;
  }
  const div = e.target.closest("[data-clip]");
  if (!div || busy || e.button !== 0) return;
  const c = project.clips.find((c2) => c2.id === div.dataset.clip);
  selected = c.id;
  stop();
  renderInspector();
  const edge = e.target.closest("[data-edge]")?.dataset.edge, startX = e.clientX, original = copy(c), dragScale = displayScale;
  let moved = false, last = copy(c);
  div.classList.add("selected");
  const move = (ev) => {
    const anchor = edge === "right" ? original.start + duration(original) : original.start, delta = dragScale.toTime(dragScale.toX(anchor) + (ev.clientX - startX)) - anchor;
    if (Math.abs(ev.clientX - startX) > 3) moved = true;
    last = copy(original);
    if (edge === "left") {
      const d = Math.max(-original.start, -original.sourceIn / original.rate, Math.min(duration(original) - 0.02, delta));
      last.start += d;
      last.sourceIn += d * last.rate;
    } else if (edge === "right") {
      const a = project.assets.find((a2) => a2.id === c.assetId);
      last.sourceOut = Math.max(last.sourceIn + 0.02 * last.rate, Math.min(a.kind === "image" ? 1e8 : a.duration, original.sourceOut + delta * last.rate));
    } else {
      last.start = Math.max(0, original.start + delta);
      const targets2 = [0, playhead, ...project.clips.filter((x) => x.id !== c.id).flatMap((x) => [x.start, x.start + duration(x)])];
      const snap = targets2.find((t) => Math.abs(dragScale.toX(t) - dragScale.toX(last.start)) < 7);
      if (snap !== void 0) last.start = snap;
    }
    div.style.left = `${dragScale.toX(last.start)}px`;
    div.style.width = `${dragScale.toX(last.start + duration(last)) - dragScale.toX(last.start)}px`;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (moved) {
      const next = copy(project);
      next.clips = next.clips.map((x) => x.id === c.id ? last : x);
      commit(next);
    } else renderTimeline();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});
$("#preview").addEventListener("pointerdown", (e) => {
  const c = getClip();
  if (!c || busy || playhead < c.start || playhead >= c.start + duration(c)) return;
  stop();
  const rect = $("#preview").getBoundingClientRect(), startX = e.clientX, startY = e.clientY, next = copy(project), clip = next.clips.find((x) => x.id === c.id), sx = valueAt(c, "x", sourceAt(c, playhead)), sy = valueAt(c, "y", sourceAt(c, playhead));
  let moved = false;
  const move = (ev) => {
    moved = true;
    const values = { x: sx + (ev.clientX - startX) / rect.width, y: sy + (ev.clientY - startY) / rect.height };
    for (const prop of ["x", "y"]) {
      const keys = clip.keyframes[prop];
      if (keys?.length) {
        const t = sourceAt(clip, playhead), key = keys.find((k) => Math.abs(k.time - t) < 1e-3);
        if (key) key.value = values[prop];
        else {
          keys.push({ time: t, value: values[prop], interpolation: "linear" });
          keys.sort((a, b) => a.time - b.time);
        }
      } else clip[prop] = values[prop];
    }
    preview.project = next;
    void preview.render();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (moved) commit(next);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});
window.addEventListener("resize", () => {
  resizePlayer();
  renderTimeline();
});
async function init() {
  try {
    const layout = JSON.parse(localStorage.getItem("cutline-layout") ?? "null");
    if (layout) ["left", "right", "bottom"].forEach((k, i) => document.documentElement.style.setProperty(`--${k}`, layout[i]));
    const saved = await get("projects", "autosave");
    if (saved) {
      validateProject(saved);
      project = migrateProject(saved);
      await media2.restore(project.assets);
    }
    render();
    if (project.clips.length) fitTimeline();
  } catch (e) {
    render();
    toast(`Recovery: ${e.message}`, true);
  }
}
void init();
function resizePlayer() {
  const stage = $("#stage"), style = getComputedStyle(stage), width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom), size = playerSize(width, height, project.width, project.height, playerFit), canvas = $("#preview");
  canvas.style.width = `${Math.max(1, size.width)}px`;
  canvas.style.height = `${Math.max(1, size.height)}px`;
  const button2 = $('[data-action="view-menu"]');
  button2.textContent = "View \u25BE";
}
new ResizeObserver(resizePlayer).observe($("#stage"));
function saveViews() {
  try {
    localStorage.setItem("cutline-views", JSON.stringify({ playerFit, audioView, videoView, storyMinimum, storyCompression, view }));
  } catch {
  }
}
function loadViews() {
  try {
    const v = JSON.parse(localStorage.getItem("cutline-views") ?? "null");
    if (!v) return;
    if (["fit", "fill", "actual"].includes(v.playerFit)) playerFit = v.playerFit;
    if (["waveform", "levels", "frequency", "none"].includes(v.audioView)) audioView = v.audioView;
    if (["filmstrip", "plain"].includes(v.videoView)) videoView = v.videoView;
    if (["timeline", "storyboard"].includes(v.view)) view = v.view;
    storyMinimum = Math.max(12, Math.min(120, Number(v.storyMinimum) || 32));
    storyCompression = Math.max(0, Math.min(60, Number(v.storyCompression) || 18));
  } catch {
  }
}
loadViews();
function setView(value) {
  view = value === "storyboard" ? "storyboard" : "timeline";
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  renderStoryboard();
  renderTimeline();
  $("#zoom").value = String(view === "storyboard" ? storyCompression / 0.6 : 100 * Math.log(zoom / 0.04) / Math.log(100 / 0.04));
  saveViews();
}
function openClipSettings() {
  const clip = getClip();
  if (!clip) {
    toast("Select a clip first.");
    return;
  }
  const d = openDialog(`Clip \xB7 ${clip.name}`, "", true);
  d.classList.add("clip-properties-dialog");
  const body = $(".dialog-body", d);
  renderInspector(body, "properties");
  const refresh = () => requestAnimationFrame(() => {
    if (d.open) renderInspector(body, "properties");
  });
  d.addEventListener("change", refresh);
  d.addEventListener("click", (e) => {
    if (e.target.closest("button")) refresh();
  });
  $(".dialog-actions", d).append(button("Done", () => d.close(), "primary"));
}
function openSourceLinks() {
  const d = openDialog("Linked sources", "", true), body = $(".dialog-body", d);
  function renderLinks() {
    const videos = project.assets.filter((a) => a.kind === "video"), audios = project.assets.filter((a) => a.hasAudio);
    body.innerHTML = `<p>Link a video with a separate audio recording. Links provide synchronized signals; they do not replace timeline audio. Participants/Cast remain optional.</p>${(project.sourceLinks ?? []).map((l) => `<div class="definition-card"><strong>${esc4(l.name)}</strong><p>${esc4(project.assets.find((a) => a.id === l.videoAssetId)?.name)} + ${esc4(project.assets.find((a) => a.id === l.audioAssetId)?.name)} \xB7 audio offset ${l.audioOffsetSec}s</p><button data-unlink="${esc4(l.id)}">Remove link</button></div>`).join("")}<div class="field"><label>Name</label><input id="link-name" value="Linked source"></div><div class="field"><label>Video</label><select id="link-video">${videos.map((a) => `<option value="${esc4(a.id)}">${esc4(a.name)}</option>`).join("")}</select></div><div class="field"><label>Audio source</label><select id="link-audio">${audios.map((a) => `<option value="${esc4(a.id)}">${esc4(a.name)}</option>`).join("")}</select></div><div class="field"><label>Audio source time at video start (seconds)</label><input id="link-offset" type="number" step="any" value="0"><small>Positive skips the audio lead-in; negative means audio starts later.</small></div>`;
    body.querySelectorAll("[data-unlink]").forEach((b) => b.onclick = () => {
      const next = copy(project);
      next.sourceLinks = next.sourceLinks?.filter((l) => l.id !== b.dataset.unlink);
      commit(next);
      renderLinks();
    });
  }
  renderLinks();
  $(".dialog-actions", d).append(button("Add link", () => {
    const next = copy(project), link = { id: uid(), name: $("#link-name", d).value.trim() || "Linked source", videoAssetId: $("#link-video", d).value, audioAssetId: $("#link-audio", d).value, audioOffsetSec: Number($("#link-offset", d).value) };
    (next.sourceLinks ??= []).push(link);
    try {
      validateProject(next);
      commit(next);
      renderLinks();
    } catch (e) {
      toast(e.message, true);
    }
  }, "primary"), button("Done", () => d.close()));
}
function openFileMenu() {
  const existing = document.querySelector(".view-dropdown"), same = existing?.classList.contains("file-dropdown");
  existing?.remove();
  if (same) return;
  const menu = document.createElement("div");
  menu.className = "view-dropdown file-dropdown";
  menu.setAttribute("role", "menu");
  menu.innerHTML = [["new-project", "New project"], ["open-project", "Open project\u2026"], ["save-project", "Save project\u2026"], ["import", "Import media\u2026"], ["workspace-settings", "Workspace settings\u2026"], ["source-links", "Linked sources\u2026"], ["source-regions", "Visual source regions\u2026"], ["layouts", "Layouts: Grid / Focus\u2026"], ["export-presets", "Export Edit library\u2026"], ["import-presets", "Import Edit library\u2026"], ["export", "Export video\u2026"]].map(([action2, label]) => `<button role="menuitem" data-action="${action2}">${label}</button>`).join("");
  const r = $('[data-action="file-menu"]').getBoundingClientRect();
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 5}px`;
  menu.onclick = () => menu.remove();
  menu.onkeydown = (e) => {
    if (e.key === "Escape") {
      menu.remove();
      $('[data-action="file-menu"]').focus();
    }
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const buttons = [...menu.querySelectorAll("button")], i = buttons.indexOf(document.activeElement);
      buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
  };
  document.body.append(menu);
  menu.querySelector("button").focus();
}
function openViewMenu() {
  const existing = document.querySelector(".view-dropdown"), same = existing && !existing.classList.contains("file-dropdown");
  existing?.remove();
  if (same) return;
  const menu = document.createElement("div");
  menu.className = "view-dropdown";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "View settings");
  const option = (group, value, label, selected2) => `<button role="menuitemradio" aria-checked="${selected2}" data-view-option="${group}:${value}"><span>${selected2 ? "\u2713" : "\u3000"}</span>${label}</button>`;
  menu.innerHTML = `<div class="view-group"><button class="submenu-trigger" role="menuitem" aria-haspopup="menu">Video view <span>\u25B8</span></button><div class="view-submenu" role="menu" aria-label="Video view"><div class="menu-heading">Player scale</div>${option("fit", "fit", "Fit available player area", playerFit === "fit")}${option("fit", "fill", "Fill player area", playerFit === "fill")}${option("fit", "actual", "Actual size \xB7 100%", playerFit === "actual")}<hr><div class="menu-heading">Project view</div>${option("view", "timeline", "Timeline \xB7 proportional time", view === "timeline")}${option("view", "storyboard", "Storyboard \xB7 compressed structure", view === "storyboard")}<hr>${option("video", "filmstrip", "Video thumbnails", videoView === "filmstrip")}${option("video", "plain", "Plain clips", videoView === "plain")}<label class="menu-input">Minimum structural spacing <input id="structure-minimum" type="number" min="12" max="120" step="4" value="${storyMinimum}" aria-label="Minimum structural spacing in pixels"> px</label></div></div><div class="view-group"><button class="submenu-trigger" role="menuitem" aria-haspopup="menu">Audio view <span>\u25B8</span></button><div class="view-submenu" role="menu" aria-label="Audio view">${option("audio", "waveform", "Waveform", audioView === "waveform")}${option("audio", "levels", "Volume bars", audioView === "levels")}${option("audio", "frequency", "Frequency \xB7 spectrogram", audioView === "frequency")}${option("audio", "none", "Hide audio visualization", audioView === "none")}<div class="menu-note">Audio is analyzed locally when a visualization is selected.</div></div></div>`;
  const rect = $('[data-action="view-menu"]').getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 460))}px`;
  menu.style.top = `${Math.max(12, Math.min(rect.bottom + 5, Math.max(12, innerHeight - 560)))}px`;
  document.body.append(menu);
  menu.addEventListener("click", (e) => {
    const button2 = e.target.closest("[data-view-option],.submenu-trigger");
    if (!button2) return;
    if (button2.classList.contains("submenu-trigger")) {
      button2.parentElement.classList.toggle("open");
      return;
    }
    const [group, value] = button2.dataset.viewOption.split(":");
    if (group === "fit") {
      playerFit = value;
      resizePlayer();
    }
    if (group === "view") setView(value);
    if (group === "video") {
      videoView = value;
      renderTimeline();
    }
    if (group === "audio") {
      audioView = value;
      renderTimeline();
      void prepareAudioView();
    }
    saveViews();
    menu.remove();
  });
  $("#structure-minimum", menu).onchange = (e) => {
    storyMinimum = Math.max(12, Math.min(120, Number(e.target.value) || 32));
    e.target.value = String(storyMinimum);
    renderTimeline();
    saveViews();
  };
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      menu.remove();
      $('[data-action="view-menu"]').focus();
    }
    if (e.key === "ArrowRight") {
      const group = e.target.closest(".view-group");
      group?.classList.add("open");
      group?.querySelector(".view-submenu button")?.focus();
    }
  });
  menu.querySelector("button")?.focus();
}
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest('.view-dropdown,[data-action="view-menu"],[data-action="file-menu"]')) document.querySelector(".view-dropdown")?.remove();
});
async function prepareAudioView() {
  if (audioView === "none") return;
  const ids = [...new Set(project.clips.filter((c) => project.assets.find((a) => a.id === c.assetId)?.hasAudio).map((c) => c.assetId))];
  if (!ids.length) return;
  await job("Preparing audio view\u2026", async () => {
    for (const id of ids) {
      abort?.signal.throwIfAborted();
      if (audioView === "frequency") {
        if (!media2.spectra.has(id)) {
          const key = `${id}:spectrum`, cached = await get("analysis", key), s = cached ?? await media2.task("spectrum", { assetId: id }, progress, abort?.signal);
          media2.spectra.set(id, s);
          if (!cached) await put("analysis", key, s);
        }
      } else await media2.analyze(id, progress, abort?.signal);
      renderTimeline();
    }
  });
}
async function editMarker(id) {
  if (busy) {
    toast("Finish or cancel the current task before editing markers.");
    return;
  }
  const marker = project.markers.find((m) => m.id === id);
  if (!marker) return;
  const color = /^#[0-9a-f]{6}$/i.test(marker.color ?? "") ? marker.color : "#efc17b";
  const d = openDialog("Edit marker", `<div class="field"><label for="marker-name">Name</label><input id="marker-name" value="${esc4(marker.name)}" maxlength="100" autofocus></div><div class="field-pair"><div class="field"><label for="marker-time">Project time (seconds)</label><input id="marker-time" type="number" min="0" step=".01" value="${marker.time.toFixed(3)}"></div><div class="field"><label for="marker-color">Color</label><input id="marker-color" type="color" value="${color}"></div></div><div class="marker-palette">${["#efc17b", "#e8918b", "#b0e7c5", "#7ebbe6", "#ba9ae6", "#e69fc5", "#d9e1df"].map((c) => `<button class="color-swatch" data-swatch="${c}" style="--swatch:${c}" title="Use marker color ${c}" aria-label="Use marker color ${c}"></button>`).join("")}</div>`);
  const linked = regionForMarker(project, id);
  d.classList.add("marker-dialog");
  d.querySelectorAll("[data-swatch]").forEach((b) => b.onclick = () => {
    $("#marker-color", d).value = b.dataset.swatch;
  });
  $(".dialog-actions", d).append(button(linked ? "Delete marker & unlink" : "Delete marker", () => {
    commit(deleteMarker(project, id));
    d.close();
  }, "danger"), button("Go to marker", () => {
    stop();
    void preview.seek(marker.time);
    d.close();
  }), button("Save", () => {
    const name = $("#marker-name", d).value.trim(), time = Number($("#marker-time", d).value), color2 = $("#marker-color", d).value;
    if (!Number.isFinite(time) || time < 0 || !/^#[0-9a-f]{6}$/i.test(color2)) {
      toast("Choose a valid marker time and color.", true);
      return;
    }
    const next = copy(project), m = next.markers.find((m2) => m2.id === id);
    m.name = name || "Marker";
    m.time = time;
    m.color = color2;
    const region = regionForMarker(next, id);
    if (region) {
      region.color = color2;
      next.markers.filter((m2) => region.markerIds.includes(m2.id)).forEach((m2) => m2.color = color2);
    }
    commit(next);
    d.close();
  }, "primary"));
  if (linked) $(".dialog-actions", d).prepend(button("Edit marked region\u2026", () => {
    d.close();
    void editRegion(linked.id);
  }));
  await new Promise((resolve) => d.addEventListener("close", () => resolve(), { once: true }));
}
async function editRegion(id) {
  if (busy || markerDragging) return;
  const region = project.regions?.find((r) => r.id === id), bounds = region && regionBounds(project, region);
  if (!region || !bounds) return;
  const endpointIds = [...region.markerIds].sort((a, b) => project.markers.find((m) => m.id === a).time - project.markers.find((m) => m.id === b).time);
  const workflows = currentDefinitions(project.library), color = /^#[0-9a-f]{6}$/i.test(region.color) ? region.color : "#efc17b";
  const d = openDialog("Marked region", `<div class="field"><label for="region-name">Name</label><input id="region-name" value="${esc4(region.name)}" maxlength="100"></div><div class="field-pair"><div class="field"><label for="region-start">Start (seconds)</label><input id="region-start" type="number" min="0" step="any" value="${bounds[0]}"></div><div class="field"><label for="region-end">End (seconds)</label><input id="region-end" type="number" min="0" step="any" value="${bounds[1]}"></div></div><div class="field"><label for="region-color">Color</label><input id="region-color" type="color" value="${color}"></div><div class="field"><label for="region-workflow">Edit or preset</label><select id="region-workflow">${["quick", "preset"].map((kind) => `<optgroup label="${kind === "quick" ? "Edits" : "Presets"}">${workflows.filter((w) => w.kind === kind).map((w) => `<option value="${esc4(w.id)}">${esc4(w.name)}</option>`).join("")}</optgroup>`).join("")}</select></div>`);
  const saveRegion = () => {
    const from = Number($("#region-start", d).value), to = Number($("#region-end", d).value);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) {
      toast("Set the region end after its start.", true);
      return false;
    }
    const next = copy(project), r = next.regions.find((r2) => r2.id === id);
    r.name = $("#region-name", d).value.trim() || "Marked region";
    r.color = $("#region-color", d).value;
    endpointIds.forEach((id2, i) => {
      const m = next.markers.find((m2) => m2.id === id2);
      m.time = i === 0 ? from : to;
      m.color = r.color;
    });
    if (JSON.stringify(next) !== JSON.stringify(project)) commit(next);
    return true;
  };
  $(".dialog-actions", d).append(button("Unlink markers", () => {
    const next = copy(project);
    next.regions = next.regions?.filter((r) => r.id !== id);
    commit(next);
    d.close();
  }), button("Save", () => {
    if (saveRegion()) d.close();
  }), button("Run edit\u2026", () => {
    const workflow = $("#region-workflow", d).value;
    if (workflow && saveRegion()) {
      d.close();
      void runOptions(workflow, id);
    }
  }, "primary"));
}
async function compareMenuStyles() {
  await choose("Three workflow menu styles", `<div class="style-comparison"><article><h3>1. Guided cards</h3><span class="pill">CURRENT DRAFT \xB7 RECOMMENDED</span><div class="style-mini"><div class="mini-find">FIND \xB7 Quiet sections</div><div class="mini-if">IF \xB7 A section matches<div class="mini-do">THEN \xB7 Keep up to 20 seconds</div><div class="mini-do">AND \xB7 Play at 1.3\xD7</div></div></div><p>Ordered cards with explicit Then / Otherwise branches. Easy to scan, rearrange, and grow.</p></article><article><h3>2. Sentence recipe</h3><div class="style-mini recipe-mini">When audio is <em>quieter than \u221240 dBFS</em> for <em>at least 2 seconds</em>, keep <em>up to 20 seconds</em> and play it at <em>1.3\xD7</em>. Otherwise, <em>keep it unchanged</em>.</div><p>Reads like a short instruction with inline controls. Best for simple workflows; nested logic becomes wordy.</p></article><article><h3>3. Branching flowchart</h3><div class="style-mini flow-mini"><div>Find quiet sections</div><span>\u2193</span><div>Does this section match?</div><span>\u2199 YES\u3000\u3000NO \u2198</span><div class="mini-do">Shorten \u2192 Speed up</div><div>Keep unchanged</div></div><p>Shows routes and dependencies clearly. Best for larger branching workflows; needs more space and navigation.</p></article></div>`, [{ id: "close", label: "Close comparison", kind: "primary" }], true);
}
//# sourceMappingURL=app.js.map
