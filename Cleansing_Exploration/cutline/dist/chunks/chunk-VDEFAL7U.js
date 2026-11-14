import {
  clone,
  compose,
  media,
  mergeRanges,
  project,
  rangeProjection,
  sourceTime,
  toOrigin,
  validateGraph
} from "./chunk-T3E6QFBJ.js";

// src/pipeline/selection.ts
function select(media2, ranges, anchor = "content") {
  const bounded = mergeRanges(ranges).map((r) => ({ ...r, start: Math.min(media2.durationSec, r.start), end: Math.min(media2.durationSec, r.end) })).filter((r) => r.end > r.start);
  return { ranges: bounded, originRanges: toOrigin(media2.timeMap, bounded), originId: media2.originId, anchor, computedAgainst: media2.id, timeMap: clone(media2.timeMap), stale: [], lost: [] };
}
function projectSelection(selection, target) {
  if (selection.originId !== target.originId) throw Error("Selection and target have no shared origin. Connect media derived from the same recording.");
  const result = clone(selection);
  if (selection.anchor === "timestamp" && JSON.stringify(selection.timeMap) !== JSON.stringify(target.timeMap)) {
    result.stale = selection.ranges.map((range) => ({ range, reason: "Timing changed. Recompute this timestamp selection before applying it." }));
    return result;
  }
  const projected = rangeProjection(target.timeMap, selection.originRanges);
  result.ranges = projected.ranges;
  result.lost = projected.lost;
  result.computedAgainst = target.id;
  result.timeMap = clone(target.timeMap);
  return result;
}

// src/pipeline/synthetic.ts
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223 >>> 0;
    return state / 4294967296;
  };
}
function synthetic(seed = 42, duration = 90, rate = 4) {
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(duration) || duration < 0) throw Error("Synthetic signals need a positive sample rate and a finite duration.");
  const rng = random(seed), revision = media(`synthetic-${seed}`, duration), n = Math.ceil(duration * rate), signals = {};
  const make = (kind, fn) => {
    const values = Float32Array.from({ length: n }, (_, i) => fn(i / rate)), confidence = new Float32Array(n).fill(0.95);
    signals[kind] = { id: kind, kind, revisionId: revision.id, sampleRateHz: rate, values, confidence, remappable: !["silence", "variance"].includes(kind) };
  };
  make("speakerA", (t) => t % 30 >= 3 && t % 30 < 16 ? 0.65 + rng() * 0.3 : rng() < 0.015 ? 0.8 : rng() * 0.04);
  make("speakerB", (t) => t % 30 >= 12 && t % 30 < 25 ? 0.6 + rng() * 0.35 : rng() < 0.015 ? 0.8 : rng() * 0.04);
  make("loudness", (t) => Math.max(signals.speakerA.values[Math.min(n - 1, Math.floor(t * rate))], signals.speakerB.values[Math.min(n - 1, Math.floor(t * rate))]));
  make("motion", (t) => 0.2 + 0.2 * Math.sin(t) + rng() * 0.1);
  make("scene", (t) => t > 0 && t % 15 < 1 / rate ? 1 : 0);
  make("layout", (t) => t % 30 >= 12 && t % 30 < 16 ? 1 : 0);
  make("speech", (t) => signals.loudness.values[Math.floor(t * rate)] > 0.2 ? 1 : 0);
  let quiet = 0;
  make("silence", (t) => {
    quiet = signals.loudness.values[Math.floor(t * rate)] < 0.1 ? quiet + 1 / rate : 0;
    return quiet;
  });
  make("variance", (t) => {
    const at = Math.floor(t * rate), lo = Math.max(0, at - Math.round(rate)), v = signals.loudness.values;
    let sum = 0, squares = 0;
    for (let i = lo; i <= at; i++) {
      sum += v[i];
      squares += v[i] * v[i];
    }
    const count = at - lo + 1;
    return squares / count - (sum / count) ** 2;
  });
  return { media: revision, signals, tags: [{ start: 0, end: Math.min(3, duration), tags: ["intro"] }, { start: Math.max(0, duration - 3), end: duration, tags: ["outro"] }], markers: [{ start: Math.min(10, duration), end: Math.min(15, duration), tags: ["manual"] }] };
}

// src/pipeline/signals.ts
var MemorySignalCache = class {
  values = /* @__PURE__ */ new Map();
  async get(key) {
    const s = this.values.get(key);
    return s && clone(s);
  }
  async put(key, value) {
    this.values.set(key, clone(value));
  }
};
var IndexedDBSignalCache = class {
  constructor(store) {
    this.store = store;
  }
  async get(key) {
    if (!this.store) throw Error("Supply a persistent signal store or use MemorySignalCache.");
    return this.store.get(key);
  }
  async put(key, value) {
    if (!this.store) throw Error("Supply a persistent signal store or use MemorySignalCache.");
    await this.store.put(key, value);
  }
};
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function signalKey(media2, detector, params) {
  return stable({ hash: media2.mediaHash, revision: media2.id, map: media2.timeMap, crop: media2.crop, audioOffset: media2.audioOffsetSec, detector, params });
}
function remapSignal(signal, from, to) {
  if (signal.revisionId !== from.id) throw Error("Signal does not belong to the supplied source revision. Recompute or supply its original revision.");
  if (from.originId !== to.originId) throw Error("Cannot remap signals between recordings without a shared origin.");
  if (!signal.remappable && stable(from.timeMap) !== stable(to.timeMap)) throw Error(`${signal.kind} depends on neighboring content. Recompute detection on the new revision.`);
  const values = new Float32Array(Math.ceil(to.durationSec * signal.sampleRateHz)), confidence = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const origin = sourceTime(to.timeMap, i / signal.sampleRateHz), time = origin === void 0 ? void 0 : project(from.timeMap, origin)[0];
    if (time === void 0) continue;
    const index = Math.floor(time * signal.sampleRateHz);
    values[i] = signal.values[index] ?? 0;
    confidence[i] = signal.confidence[index] ?? 0;
  }
  return { ...signal, id: `${signal.id}@${to.id}`, revisionId: to.id, values, confidence };
}

// src/pipeline/conditions.ts
function condition(expression, signals, debounce = 0, hold = 0) {
  const inputs = Object.values(signals), first = inputs[0];
  if (!first) throw Error("Connect at least one signal to this condition.");
  if (inputs.some((s) => s.sampleRateHz !== first.sampleRateHz || s.values.length !== first.values.length || s.revisionId !== first.revisionId)) throw Error("Condition signals must use the same revision, length, and sample rate.");
  if (debounce < 0 || hold < 0) throw Error("Debounce and hold cannot be negative.");
  const latches = /* @__PURE__ */ new Map();
  const evalAt = (e, i) => {
    if (e.op === "not") return !evalAt(e.child, i);
    if (e.op === "and" || e.op === "or") {
      const results = e.children.map((c) => evalAt(c, i));
      return e.op === "and" ? results.every(Boolean) : results.some(Boolean);
    }
    const leaf = e, s = signals[leaf.signal];
    if (!s) throw Error(`Connect signal \u201C${leaf.signal}\u201D before running this condition.`);
    const previous = latches.get(e) ?? false, threshold = previous ? leaf.off ?? leaf.on : leaf.on, value = s.values[i], active = leaf.direction === "below" ? value < threshold : value > threshold;
    latches.set(e, active);
    return active;
  };
  const values = new Float32Array(first.values.length), confidence = new Float32Array(values.length);
  let streak = 0, on = false, until = 0;
  const required = Math.max(1, Math.ceil(debounce * first.sampleRateHz)), minimum = Math.ceil(hold * first.sampleRateHz);
  for (let i = 0; i < values.length; i++) {
    const yes = evalAt(expression, i);
    streak = yes ? streak + 1 : 0;
    if (!on && streak >= required) {
      on = true;
      until = i + minimum;
    }
    if (on && !yes && i >= until) on = false;
    values[i] = on ? 1 : 0;
    confidence[i] = Math.min(...inputs.map((s) => s.confidence[i]));
  }
  return { id: "condition", kind: "condition", revisionId: first.revisionId, sampleRateHz: first.sampleRateHz, values, confidence, remappable: false };
}
function signalRanges(signal) {
  const out = [];
  let start = -1, confidence = 1;
  for (let i = 0; i <= signal.values.length; i++) {
    if (i < signal.values.length && signal.values[i] > 0.5) {
      if (start < 0) start = i;
      confidence = Math.min(confidence, signal.confidence[i]);
    } else if (start >= 0) {
      out.push({ start: start / signal.sampleRateHz, end: i / signal.sampleRateHz, confidence });
      start = -1;
      confidence = 1;
    }
  }
  return out;
}
function priority(signals, order, defaultState, hold = 0) {
  const inputs = Object.values(signals), first = inputs[0];
  if (!first) return [];
  if (inputs.some((s) => s.revisionId !== first.revisionId || s.sampleRateHz !== first.sampleRateHz || s.values.length !== first.values.length)) throw Error("Priority inputs must use the same media revision and sampling grid.");
  if (hold < 0) throw Error("Priority hold cannot be negative.");
  const output = [], min = Math.ceil(hold * first.sampleRateHz);
  let current = defaultState, until = 0;
  for (let i = 0; i < first.values.length; i++) {
    const chosen = order.find((id) => signals[id]?.values[i] > 0.5) ?? defaultState;
    if (chosen !== current && i >= until) {
      current = chosen;
      until = i + min;
    }
    output.push(current);
  }
  return output;
}

// src/pipeline/actions.ts
function route(confidence, mode, tiers, proposeOnly = false) {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw Error("Confidence must be between 0 and 1.");
  const resolved = tiers ? [...tiers].sort((a, b) => b.minimum - a.minimum).find((t) => confidence >= t.minimum)?.mode ?? "ignore" : mode;
  return resolved === "ignore" ? "ignore" : proposeOnly ? "propose" : resolved;
}
function decisions(node, target, selection, proposeOnly = false) {
  const projected = projectSelection(selection, target);
  if (projected.stale.length) throw Error(projected.stale[0].reason);
  const action = String(node.params.action);
  if (!["remove", "speed", "tag", "layout"].includes(action)) throw Error("Choose remove, speed, tag, or layout.");
  if (action === "layout" && !node.params.defaultLayout) throw Error("Choose a default layout for times when nothing matches.");
  if (action === "speed" && (!Number.isFinite(Number(node.params.rate)) || Number(node.params.rate) <= 0)) throw Error("Choose a positive playback speed.");
  return mergeRanges(projected.ranges).map((range, i) => {
    const confidence = range.confidence ?? 1, mode = route(confidence, node.params.mode ?? "auto", node.params.confidenceTiers, proposeOnly);
    return { id: `${node.id}:${target.id}:${i}`, actionNodeId: node.id, action, range, params: clone(node.params), confidence, mode: mode === "ignore" ? "propose" : mode, status: mode === "ignore" ? "ignored" : mode === "auto" ? "accepted" : "pending", summary: `${action === "remove" ? "Remove" : action === "speed" ? `Play at ${node.params.rate}\xD7` : action === "tag" ? `Tag as ${node.params.label ?? "label"}` : `Show ${node.params.layout ?? "layout"}`} from ${range.start.toFixed(2)} to ${range.end.toFixed(2)} seconds.` };
  });
}
function applyDecisions(target, list, id, defaultLayout) {
  const accepted = list.filter((o) => o.status === "accepted" || o.status === "applied"), structural = accepted.filter((o) => o.action === "remove" || o.action === "speed");
  const boundaries = [.../* @__PURE__ */ new Set([0, target.durationSec, ...structural.flatMap((o) => [Math.max(0, o.range.start), Math.min(target.durationSec, o.range.end)])])].sort((a, b) => a - b), local = { segments: [] };
  let at = 0;
  for (let i = 1; i < boundaries.length; i++) {
    const a = boundaries[i - 1], b = boundaries[i], ops = structural.filter((o) => o.range.start <= a && o.range.end >= b);
    if (ops.length > 1) throw Error("Structural operations overlap. Merge selections or put actions in a linear chain.");
    const op = ops[0];
    if (op?.action === "remove") continue;
    const rate = op?.action === "speed" ? Number(op.params.rate) : 1;
    if (!Number.isFinite(rate) || rate <= 0) throw Error("Playback speed must be positive.");
    local.segments.push({ outStart: at, outEnd: at + (b - a) / rate, srcStart: a, srcEnd: b, rate });
    at += (b - a) / rate;
  }
  const result = { ...clone(target), id, parentId: target.id, durationSec: at, timeMap: compose(local, target.timeMap), tags: rangeProjection(local, target.tags).ranges, layouts: target.layouts.flatMap((l) => rangeProjection(local, [l.range]).ranges.map((range) => ({ ...l, range }))) };
  if (defaultLayout) result.layouts.push({ range: { start: 0, end: at }, layout: defaultLayout, z: -1 });
  for (const op of accepted) {
    if (op.action === "tag") result.tags.push(...rangeProjection(local, [{ ...op.range, tags: [String(op.params.label ?? "label")] }]).ranges);
    if (op.action === "layout") result.layouts.push(...rangeProjection(local, [op.range]).ranges.map((range) => ({ range, layout: String(op.params.layout ?? defaultLayout), z: Number(op.params.z ?? 0) })));
  }
  return result;
}

// src/pipeline/detectors.ts
var MockDetector = class {
  constructor(id) {
    this.id = id;
  }
  version = 1;
  async *detect(media2, params, abort) {
    abort?.throwIfAborted();
    const fixture = synthetic(Number(params.seed ?? 42), Math.max(media2.durationSec, ...media2.timeMap.segments.map((s) => s.srcEnd), 0), Number(params.sampleRateHz ?? 4));
    const aliases = { consistency: "variance", speaker: String(params.label ?? "speakerA"), time: "speech", markers: "speech" };
    const key = aliases[this.id] ?? this.id;
    let base = fixture.signals[key];
    if (!base) throw Error(`Unknown detector \u201C${this.id}\u201D. Choose a supported Fast-tier mock.`);
    base = clone(base);
    base.revisionId = fixture.media.id;
    base.kind = this.id;
    if (this.id === "time" || this.id === "markers") {
      const ranges = this.id === "markers" ? params.ranges ?? fixture.markers : params.ranges ?? [];
      base.values = Float32Array.from(base.values, (_, i) => ranges.some((r) => i / base.sampleRateHz >= r.start && i / base.sampleRateHz < r.end) ? 1 : 0);
      base.remappable = true;
    }
    const original = { ...fixture.media, originId: media2.originId };
    let result = remapSignal({ ...base, remappable: true }, original, media2);
    result.remappable = base.remappable;
    if (this.id === "silence") {
      const loud = remapSignal(fixture.signals.loudness, original, media2);
      let elapsed = 0;
      result.values = Float32Array.from(loud.values, (v) => elapsed = v < Number(params.threshold ?? 0.1) ? elapsed + 1 / loud.sampleRateHz : 0);
    }
    if (this.id === "variance" || this.id === "consistency") {
      const loud = remapSignal(fixture.signals.loudness, original, media2), radius = Math.max(1, Math.round(Number(params.windowSec ?? 1) * loud.sampleRateHz));
      result.values = Float32Array.from(loud.values, (_, at) => {
        const lo = Math.max(0, at - radius);
        let sum = 0, square = 0;
        for (let j = lo; j <= at; j++) {
          sum += loud.values[j];
          square += loud.values[j] ** 2;
        }
        const n = at - lo + 1, variance = square / n - (sum / n) ** 2;
        return this.id === "variance" ? variance : 1 / (1 + variance);
      });
      result.remappable = false;
    }
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      abort?.throwIfAborted();
      const count = Math.ceil(result.values.length * fraction);
      yield { progress: fraction, signal: { ...result, values: result.values.slice(0, count), confidence: result.confidence.slice(0, count) } };
      await Promise.resolve();
    }
  }
};
var mockDetectors = () => new Map(["loudness", "variance", "consistency", "silence", "speech", "speaker", "motion", "scene", "time", "markers", "layout"].map((id) => [id, new MockDetector(id)]));

// src/pipeline/tracking.ts
function trackSignal(input, p) {
  const rate = input.sampleRateHz, window = Math.max(1, Math.round(Number(p.windowSec ?? 1) * rate));
  if (!Number.isFinite(window) || window > 1e6 || rate <= 0) throw Error("Choose a finite tracking window and a positive signal sample rate.");
  const values = new Float32Array(input.values.length), confidence = new Float32Array(input.confidence), mode = String(p.tracking ?? "smooth");
  let sum = 0, elapsed = 0;
  const queue = [];
  let head = 0;
  for (let i = 0; i < values.length; i++) {
    const v = input.values[i];
    if (mode === "smooth") {
      sum += v;
      if (i >= window) sum -= input.values[i - window];
      values[i] = sum / Math.min(window, i + 1);
    } else if (mode === "peak") {
      while (queue.length > head && input.values[queue.at(-1)] <= v) queue.pop();
      queue.push(i);
      while (queue[head] <= i - window) head++;
      values[i] = input.values[queue[head]];
      if (head > 1024) {
        queue.splice(0, head);
        head = 0;
      }
    } else if (mode === "duration") {
      const match = p.direction === "above" ? v >= Number(p.threshold ?? 0) : v <= Number(p.threshold ?? 0);
      elapsed = match ? elapsed + 1 / rate : 0;
      values[i] = elapsed;
    } else if (mode === "change") values[i] = i ? Math.abs(v - input.values[i - 1]) * rate : 0;
    else throw Error("Choose smooth, peak, duration or change tracking.");
  }
  return { ...input, id: `${input.id}/track`, kind: `track:${mode}`, values, confidence, remappable: false };
}

// src/pipeline/engine.ts
function executionGraph(edit) {
  return { nodes: edit.nodes.map(({ ui, lockedCache, ...node }) => node), connections: edit.connections, slots: edit.slots };
}
var PipelineEngine = class {
  constructor(detectors = mockDetectors(), cache = new MemorySignalCache()) {
    this.detectors = detectors;
    this.cache = cache;
  }
  create(edit, bindings, options = {}) {
    const order = validateGraph(edit, bindings).map((n) => n.id), cursor = options.from ? order.indexOf(options.from) : 0;
    if (cursor < 0) throw Error("Choose an existing node for Run from here.");
    if (options.cached && (options.from || options.solo) && (stable(options.cached.bindings) !== stable(bindings) || stable(executionGraph(options.cached.edit)) !== stable(executionGraph(edit)))) throw Error("The graph or media changed. Run the full Edit to refresh upstream results.");
    if (cursor && !options.cached) throw Error("Run upstream nodes before using Run from here.");
    const state = { schemaVersion: 1, edit: clone(edit), bindings: clone(bindings), order: options.solo ? order.filter((id) => id === options.solo) : order, cursor: options.solo ? 0 : cursor, outputs: options.cached ? clone(options.cached.outputs) : {}, cacheKeys: options.cached ? clone(options.cached.cacheKeys) : {}, decisions: [], queue: [], status: "running", proposeOnly: !!options.proposeOnly, solo: !!options.solo, events: [] };
    if (options.solo && !order.includes(options.solo)) throw Error("Choose an existing node for Solo.");
    return state;
  }
  async advance(state, abort, onProgress) {
    if (state.status !== "running") throw Error("Resolve pending operations, then explicitly Continue.");
    const next = clone(state);
    while (next.cursor < next.order.length) {
      const node = next.edit.nodes.find((n) => n.id === next.order[next.cursor]);
      try {
        abort?.throwIfAborted();
        const incoming = {};
        for (const c of next.edit.connections.filter((c2) => c2.to.node === node.id)) {
          const value = next.outputs[c.from.node]?.[c.from.port];
          if (!value) throw Error(`Run upstream node \u201C${c.from.node}\u201D before this node.`);
          incoming[c.to.port] = value;
        }
        const key = stable({ kind: node.kind, params: node.params, inputs: incoming, bindings: next.bindings, proposeOnly: next.proposeOnly });
        if (node.lockedCache && next.outputs[node.id] && next.cacheKeys[node.id] === key) {
          next.cursor++;
          continue;
        }
        const output = {}, media2 = Object.values(incoming).find((v) => "timeMap" in v && "durationSec" in v);
        const port = node.outputs[0]?.id ?? "out";
        if (node.kind === "media") {
          const slot = next.edit.slots.find((s) => s.nodeId === node.id), bound = slot ? next.bindings[slot.id] : next.bindings[node.id];
          if (bound) output[port] = clone(bound);
          else if (media2) {
            const cast = node.params.cast;
            if (cast === "static-video") {
              if (media2.type !== "image" || Number(node.params.durationSec) <= 0) throw Error("Static video needs an image and a positive duration.");
              const duration = Number(node.params.durationSec);
              if (!Number.isFinite(duration)) throw Error("Set a finite static-video duration.");
              output[port] = { ...clone(media2), id: `${media2.id}:static`, type: "video", durationSec: duration, timeMap: { segments: [{ outStart: 0, outEnd: duration, srcStart: 0, srcEnd: duration, rate: 1 }] } };
            } else if (cast === "text-image") {
              if (media2.type !== "text" || !node.params.template) throw Error("Text-to-image needs text and a named template.");
              output[port] = { ...clone(media2), id: `${media2.id}:image`, type: "image", template: String(node.params.template) };
            } else output[port] = clone(media2);
          } else if (node.params.cast === "text-image") {
            if (!node.params.template || typeof node.params.text !== "string") throw Error("Enter text and choose an image template.");
            output[port] = { ...media(node.id, 0, "image"), text: node.params.text, template: String(node.params.template) };
          } else if (slot?.required) throw Error(`Choose media for slot \u201C${slot.name}\u201D.`);
        } else if (node.kind === "detection") {
          if (node.params.legacyStep) throw Error("Use the timeline Edit runner for this reusable action.");
          if (node.params.tracking) {
            const input = Object.values(incoming).find((v) => "values" in v);
            if (!input) throw Error("Connect a measured signal to track.");
            output[port] = trackSignal(input, node.params);
          } else {
            if (!media2) throw Error("Connect media to analyze.");
            const detector = this.detectors.get(String(node.params.detector));
            if (!detector) throw Error("Choose an installed detector.");
            const cacheKey = signalKey(media2, `${detector.id}@${detector.version}`, node.params);
            let signal = await this.cache.get(cacheKey);
            if (!signal) {
              for await (const partial of detector.detect(media2, node.params, abort)) {
                onProgress?.(node.id, partial.progress, partial.signal);
                if (partial.progress === 1) signal = partial.signal;
              }
              if (!signal) throw Error("Detector returned no complete signal.");
              await this.cache.put(cacheKey, signal);
            }
            output[port] = signal;
          }
        } else if (node.kind === "condition") {
          const signals = Object.fromEntries(Object.entries(incoming).filter(([, v]) => "values" in v));
          if (node.params.priorityOrder) {
            if (!node.params.defaultState || !node.params.chooseState) throw Error("Priority conditions need a default state and the state to select.");
            const first = Object.values(signals)[0];
            if (!first) throw Error("Connect signals before ranking sources.");
            const states = priority(signals, node.params.priorityOrder, String(node.params.defaultState), Number(node.params.hold ?? 0));
            output[port] = { ...clone(first), id: node.id, kind: "condition", values: Float32Array.from(states, (state2) => state2 === node.params.chooseState ? 1 : 0), remappable: false };
          } else output[port] = condition(node.params.expression, signals, Number(node.params.debounce ?? 0), Number(node.params.hold ?? 0));
        } else if (node.kind === "selection") {
          if (!media2) throw Error("Connect the media whose content this selection describes.");
          const signal = Object.values(incoming).find((v) => "values" in v);
          if (signal && signal.revisionId !== media2.id) throw Error("Recompute conditions against this media revision before selecting.");
          const ranges = signal ? signalRanges(signal) : node.params.source === "tags" ? media2.tags.filter((r) => !node.params.tag || r.tags?.includes(String(node.params.tag))) : node.params.ranges ?? [];
          output[port] = select(media2, ranges, node.params.anchor ?? "content");
        } else if (node.kind === "action") {
          if (!media2) throw Error("Connect target media to this action.");
          const selection = Object.values(incoming).find((v) => "originRanges" in v);
          if (!selection) throw Error("Connect a selection to this action.");
          const list = decisions(node, media2, selection, next.proposeOnly);
          next.decisions.push(...list);
          next.pending = { nodeId: node.id, target: clone(media2), outputPort: port };
          next.queue = list.filter((o) => o.status === "pending").map((o) => o.id);
          if (next.queue.length) {
            next.status = "awaiting-approval";
            next.cacheKeys[node.id] = key;
            return next;
          }
          output[port] = applyDecisions(media2, list, `${media2.id}/${node.id}`, node.params.defaultLayout);
          list.forEach((o) => {
            if (o.status === "accepted") o.status = "applied";
          });
          next.pending = void 0;
        } else if (node.kind === "breakpoint") {
          next.cursor++;
          next.status = "paused-at-breakpoint";
          next.events.push({ nodeId: node.id, summary: String(node.params.note ?? "Paused at Break-Point. Continue when ready.") });
          next.outputs[node.id] = media2 ? { [port]: clone(media2) } : {};
          return next;
        }
        next.outputs[node.id] = output;
        next.cacheKeys[node.id] = key;
        next.events.push({ nodeId: node.id, summary: `${node.name} completed${Object.keys(output).length ? "" : ": nothing matched"}.` });
        next.cursor++;
      } catch (error) {
        next.status = "failed";
        next.error = { nodeId: node.id, message: `${node.name}: ${error.message}` };
        return next;
      }
    }
    next.status = "complete";
    return next;
  }
  resolve(state, id, resolution, params) {
    const next = clone(state), op = next.decisions.find((o) => o.id === id);
    if (next.status !== "awaiting-approval" || !op || !next.queue.includes(id)) throw Error("Choose an unresolved operation in the active review queue.");
    next.queue = next.queue.filter((key) => key !== id);
    if (resolution === "skip") {
      op.status = "skipped";
      next.queue.push(id);
    } else if (resolution === "adjust") {
      op.params = { ...op.params, ...params };
      if (op.action === "speed" && (!Number.isFinite(Number(op.params.rate)) || Number(op.params.rate) <= 0)) throw Error("Set a positive speed before accepting.");
      op.status = "pending";
      op.summary = `Adjusted ${op.action} at ${op.range.start.toFixed(2)} seconds; awaiting approval.`;
      next.queue.push(id);
    } else op.status = resolution === "accept" ? "accepted" : "rejected";
    next.events.push({ nodeId: op.actionNodeId, summary: `${resolution}: ${op.summary}` });
    if (!next.queue.length) next.status = "awaiting-continue";
    return next;
  }
  continue(state) {
    if (!["awaiting-continue", "paused-at-breakpoint"].includes(state.status)) throw Error("Resolve every queued operation before continuing.");
    const next = clone(state);
    if (next.pending) {
      const p = next.pending, node = next.edit.nodes.find((n) => n.id === p.nodeId), list = next.decisions.filter((o) => o.actionNodeId === p.nodeId);
      next.outputs[p.nodeId] = { [p.outputPort]: applyDecisions(p.target, list, `${p.target.id}/${p.nodeId}`, node.params.defaultLayout) };
      list.forEach((o) => {
        if (o.status === "accepted") o.status = "applied";
      });
      next.cursor++;
      next.pending = void 0;
    }
    next.status = "running";
    return next;
  }
};

export {
  projectSelection,
  synthetic,
  IndexedDBSignalCache,
  PipelineEngine
};
//# sourceMappingURL=chunk-VDEFAL7U.js.map
