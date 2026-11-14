import {
  clone,
  media,
  migrate,
  node,
  port,
  validateGraph
} from "./chunk-PON2G5UI.js";

// src/pipeline/authoring.ts
var NODE_WIDTH = 246;
var HEADER_HEIGHT = 96;
var PORT_HEIGHT = 30;
var catalog = [
  ["source", "Media", "Media"],
  ["constructor", "Media Constructor", "Media Constructor"],
  ["detect", "Signal", "Measure signal"],
  ["track", "Signal", "Track signal"],
  ["threshold", "Decide", "Decide"],
  ["select", "Select", "Select"],
  ["action", "Action", "Action"],
  ["breakpoint", "Control", "Break-Point"]
];
function placeholderBindings(edit) {
  return Object.fromEntries(edit.slots.map((s) => [s.id, media(`slot:${s.id}`, 90, s.type)]));
}
function validateDraft(edit) {
  if (!edit || !Array.isArray(edit.nodes) || !Array.isArray(edit.connections) || !Array.isArray(edit.slots) || !Array.isArray(edit.history) || typeof edit.name !== "string" || !edit.id || !Number.isInteger(edit.version) || edit.version < 1) throw Error("Choose an Edit JSON file with a name, nodes, connections, slots and version.");
  if (edit.nodes.length > 1e3 || edit.connections.length > 5e3) throw Error("This draft exceeds the 1,000-node authoring limit. Split it into smaller Edits.");
  const types = ["video", "audio", "av", "image", "text", "timeline", "media", "signal", "condition", "selection"];
  if (edit.workflow && (!["quick", "preset"].includes(edit.workflow.kind) || !["automatic", "suggested", "inherit"].includes(edit.workflow.mode) || typeof edit.workflow.description !== "string" || typeof edit.workflow.initial !== "boolean")) throw Error("An Edit needs its kind, implementation setting, description and initial flag.");
  const validateStep = (s, depth = 0) => {
    const step = s;
    if (!step || depth > 24 || !step.id || !["operation", "condition", "reference"].includes(step.type) || !["automatic", "suggested", "inherit"].includes(step.mode)) throw Error("A reusable action has invalid settings or nesting.");
    if (step.type === "reference") {
      if (!step.definitionId || !["follow", "definition", "bake"].includes(step.policy) || !step.overrides || typeof step.overrides !== "object") throw Error("A reusable Edit needs its source and update policy.");
    } else {
      if (!step.params || typeof step.params !== "object") throw Error("Action parameters must be an object.");
      if (step.type === "operation" && !["quiet", "detectQuiet", "shorten", "speed", "normalize", "check"].includes(step.operation)) throw Error("Choose a supported timeline action.");
      if (step.type === "condition") {
        if (!Array.isArray(step.then) || !Array.isArray(step.otherwise)) throw Error("Decide needs Then and Otherwise branches.");
        step.then.forEach((s2) => validateStep(s2, depth + 1));
        step.otherwise.forEach((s2) => validateStep(s2, depth + 1));
      }
    }
  };
  for (const n of edit.nodes) if (n.params?.legacyStep) validateStep(n.params.legacyStep);
  for (const n of edit.nodes) {
    if (!n.id || typeof n.name !== "string" || !n.params || typeof n.params !== "object" || !n.ui || ![n.ui.x, n.ui.y].every((v) => Number.isFinite(v) && v >= 0) || !Array.isArray(n.inputs) || !Array.isArray(n.outputs)) throw Error("A node is missing its name, settings, position or ports.");
    for (const p of [...n.inputs, ...n.outputs]) if (!p.id || !types.includes(p.type) || typeof p.name !== "string") throw Error(`${n.name}: choose a supported port type and a name.`);
  }
  if (new Set(edit.slots.map((s) => s.id)).size !== edit.slots.length) throw Error("Input slot IDs must be unique.");
  validateGraph(edit, placeholderBindings(edit), { allowIncomplete: true });
  return edit;
}
function importDraft(text) {
  return validateDraft(migrate(JSON.parse(text)));
}
function freshEdit(id, name = "Untitled Edit") {
  return { schemaVersion: 1, id, name, version: 1, nodes: [], connections: [], slots: [], history: [] };
}
function createBlock(kind, id, x = 50, y = 50) {
  if (kind === "constructor") kind = "static";
  if (kind === "action") kind = "remove";
  let n;
  if (["source", "audio", "video", "timeline", "image", "text"].includes(kind)) n = node(id, "media", {}, [], kind === "source" ? "av" : kind);
  else if (kind === "static") n = node(id, "media", { cast: "static-video", durationSec: 5 }, [port("media", "image")], "video");
  else if (kind === "text-image") n = node(id, "media", { cast: "text-image", template: "Chapter card", text: "Title" }, [port("media", "text", false)], "image");
  else if (kind === "detect") n = node(id, "detection", { detector: "loudness", sampleRateHz: 4, seed: 42 }, [port("media", "audio")], "signal");
  else if (kind === "track") n = node(id, "detection", { tracking: "smooth", windowSec: 1, threshold: -40 }, [port("value", "signal")], "signal");
  else if (kind === "threshold") n = node(id, "condition", { expression: { op: "threshold", signal: "value", on: 0.5, off: 0.2 }, debounce: 1.5, hold: 3 }, [port("value", "signal")], "condition");
  else if (kind === "and" || kind === "or") n = node(id, "condition", { expression: { op: kind, children: [{ op: "threshold", signal: "a", on: 0.5 }, { op: "threshold", signal: "b", on: 0.5 }] } }, [port("a", "condition"), port("b", "condition")], "condition");
  else if (kind === "not") n = node(id, "condition", { expression: { op: "not", child: { op: "threshold", signal: "value", on: 0.5 } } }, [port("value", "condition")], "condition");
  else if (kind === "priority") n = node(id, "condition", { priorityOrder: ["a", "b"], chooseState: "a", defaultState: "none", hold: 3 }, [port("a", "condition"), port("b", "condition")], "condition");
  else if (["select", "range", "tags"].includes(kind)) n = node(id, "selection", kind === "range" ? { ranges: [{ start: 0, end: 10 }] } : kind === "tags" ? { source: "tags", tag: "intro" } : {}, [port("media", "media"), ...kind === "select" ? [port("condition", "condition")] : []], "selection");
  else if (kind === "breakpoint") n = node(id, "breakpoint", { note: "Review the result before continuing." }, [port("media", "av")], "av");
  else if (["remove", "speed", "tag", "layout"].includes(kind)) n = node(id, "action", { action: kind, mode: "propose", ...kind === "speed" ? { rate: 1.3 } : kind === "tag" ? { label: "Chapter" } : kind === "layout" ? { layout: "speakerA", defaultLayout: "grid", z: 0 } : {} }, [port("media", "media"), port("selection", "selection")], "media");
  else throw Error("Choose a supported building block.");
  n.name = catalog.find((c) => c[0] === kind)?.[2] ?? { static: "Media Constructor", "text-image": "Media Constructor", remove: "Action", speed: "Action", tag: "Action", layout: "Action", range: "Select", tags: "Select", and: "Decide", or: "Decide", not: "Decide", priority: "Decide" }[kind] ?? "Media";
  n.ui = { x, y };
  return n;
}
function addBlock(edit, n) {
  const next = clone(edit);
  next.nodes.push(clone(n));
  if (n.kind === "media" && !n.inputs.length) next.slots.push({ id: n.id, name: n.name, type: n.outputs[0].type, nodeId: n.id, required: true });
  return validateDraft(next);
}
function connect(edit, connection) {
  const next = clone(edit);
  next.connections.push(clone(connection));
  return validateDraft(next);
}
function connectionBetween(a, b) {
  if (a.direction === b.direction) throw Error("Connect an output pin to an input pin.");
  return a.direction === "out" ? { from: { node: a.node, port: a.port }, to: { node: b.node, port: b.port } } : { from: { node: b.node, port: b.port }, to: { node: a.node, port: a.port } };
}
function disconnectPin(edit, pin) {
  const next = clone(edit);
  next.connections = next.connections.filter((c) => pin.direction === "out" ? c.from.node !== pin.node || c.from.port !== pin.port : c.to.node !== pin.node || c.to.port !== pin.port);
  return next;
}
function insertConnected(edit, kind, id, x, y, pin) {
  let next = addBlock(edit, createBlock(kind, id, Math.max(0, Math.round(x / 16) * 16), Math.max(0, Math.round(y / 16) * 16)));
  if (pin) {
    const n = next.nodes.find((n2) => n2.id === id);
    let error = "No compatible pin is available on this node.";
    for (const p of pin.direction === "out" ? n.inputs : n.outputs) {
      try {
        return connect(next, connectionBetween(pin, { node: id, port: p.id, direction: pin.direction === "out" ? "in" : "out" }));
      } catch (e) {
        error = e.message;
      }
    }
    throw Error(error);
  }
  return next;
}
function removeBlock(edit, id) {
  const next = clone(edit);
  next.nodes = next.nodes.filter((n) => n.id !== id);
  next.connections = next.connections.filter((c) => c.from.node !== id && c.to.node !== id);
  next.slots = next.slots.filter((s) => s.nodeId !== id);
  return next;
}
function duplicateBlock(edit, id, newId) {
  const original = edit.nodes.find((n2) => n2.id === id);
  if (!original) throw Error("Select a node to duplicate.");
  const n = clone(original);
  n.id = newId;
  n.name += " copy";
  n.ui.x += 40;
  n.ui.y += 40;
  const mapped = (id2) => `${newId}:${id2}`;
  const step = (s, root = false) => s.type === "condition" ? { ...clone(s), id: root ? newId : mapped(s.id), then: s.then.map((s2) => step(s2)), otherwise: s.otherwise.map((s2) => step(s2)) } : { ...clone(s), id: root ? newId : mapped(s.id) };
  const graph = (g) => {
    const copy2 = clone(g);
    copy2.id = mapped(copy2.id);
    copy2.nodes.forEach((n2) => {
      n2.id = mapped(n2.id);
      if (n2.params.legacyStep) n2.params.legacyStep = step(n2.params.legacyStep);
      if (n2.params.branchDrafts) n2.params.branchDrafts = Object.fromEntries(Object.entries(n2.params.branchDrafts).map(([k, g2]) => [k, graph(g2)]));
    });
    copy2.connections.forEach((c) => {
      c.from.node = mapped(c.from.node);
      c.to.node = mapped(c.to.node);
    });
    copy2.slots.forEach((s) => {
      s.id = mapped(s.id);
      s.nodeId = mapped(s.nodeId);
    });
    return copy2;
  };
  if (n.params.legacyStep) n.params.legacyStep = step(n.params.legacyStep, true);
  if (n.params.branchDrafts) n.params.branchDrafts = Object.fromEntries(Object.entries(n.params.branchDrafts).map(([k, g]) => [k, graph(g)]));
  return addBlock(edit, n);
}
function arrange(edit) {
  const next = clone(edit), order = validateGraph(next, placeholderBindings(next), { allowIncomplete: true }), depth = /* @__PURE__ */ new Map(), rows = /* @__PURE__ */ new Map();
  for (const n of order) {
    const incoming = next.connections.filter((c) => c.to.node === n.id), column = Math.max(0, ...incoming.map((c) => (depth.get(c.from.node) ?? 0) + 1)), row = rows.get(column) ?? 0;
    depth.set(n.id, column);
    n.ui = { x: 40 + column * 340, y: 40 + row * 270 };
    rows.set(column, row + 1);
  }
  return next;
}
function portPoint(n, direction, id) {
  const index = (direction === "in" ? n.inputs : n.outputs).findIndex((p) => p.id === id);
  return { x: n.ui.x + (direction === "out" ? NODE_WIDTH : 0), y: n.ui.y + HEADER_HEIGHT + index * PORT_HEIGHT + PORT_HEIGHT / 2 };
}
function wirePath(a, b) {
  const bend = Math.max(60, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`;
}
function describeNode(n) {
  if (n.params.legacyStep) {
    const s = n.params.legacyStep;
    return s.type === "reference" ? `Reusable Edit \xB7 ${s.policy === "follow" ? "Linked" : s.policy === "bake" ? "Baked" : "Frozen definition"}` : s.type === "condition" ? `If ${s.test} \u2192 Then / Otherwise` : `${n.name} \xB7 selected content`;
  }
  if (n.params.tracking) return `Track ${n.params.tracking} over ${n.params.windowSec ?? 1}s`;
  const p = n.params;
  if (n.kind === "media") return p.cast === "static-video" ? `Hold image for ${p.durationSec} seconds` : p.cast === "text-image" ? `Fill the ${p.template} template` : "Named media input";
  if (n.kind === "detection") return `Find ${p.detector} over time \xB7 mock detector`;
  if (n.kind === "condition") {
    if (p.priorityOrder) return `Prefer ${p.priorityOrder.join(", then ")}; otherwise ${p.defaultState}`;
    const e = p.expression;
    return e?.op === "threshold" ? `When value exceeds ${e.on}; wait ${p.debounce ?? 0}s, hold ${p.hold ?? 0}s` : e?.op === "and" ? "When all connected conditions match" : e?.op === "or" ? "When any connected condition matches" : e?.op === "not" ? "When the connected condition is false" : "Combine conditions";
  }
  if (n.kind === "selection") return p.ranges ? `Select ${p.ranges.map((r) => `${r.start}\u2013${r.end}s`).join(", ")}` : p.source === "tags" ? `Select content tagged ${p.tag ?? "any"}` : "Select matching content";
  if (n.kind === "action") return `${p.action === "speed" ? `Play selected content at ${p.rate}\xD7` : p.action === "tag" ? `Label selected content \u201C${p.label}\u201D` : p.action === "layout" ? `Show ${p.layout}; default ${p.defaultLayout}` : "Remove selected content"} \xB7 ${p.mode ?? "auto"}`;
  return String(p.note ?? "Pause until you continue");
}
function linearSteps(edit) {
  return validateGraph(edit, placeholderBindings(edit), { allowIncomplete: true }).map((n) => ({ id: n.id, name: n.name, description: describeNode(n), inputs: edit.connections.filter((c) => c.to.node === n.id).map((c) => edit.nodes.find((n2) => n2.id === c.from.node).name) }));
}

// src/model.ts
var uid = () => crypto.randomUUID();
var copy = (value) => structuredClone(value);
var duration = (clip) => (clip.sourceOut - clip.sourceIn) / clip.rate;
var projectEnd = (p) => Math.max(0, ...p.clips.filter((c) => c.enabled).map((c) => c.start + duration(c)));
var sourceAt = (c, time) => c.sourceIn + (time - c.start) * c.rate;
function valueAt(c, prop, sourceTime) {
  const keys = c.keyframes[prop];
  if (!keys?.length) return c[prop];
  if (sourceTime <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i], a = keys[i - 1];
    if (sourceTime <= b.time) return a.interpolation === "hold" ? a.value : a.value + (b.value - a.value) * ((sourceTime - a.time) / (b.time - a.time));
  }
  return keys[keys.length - 1].value;
}
function makeClip(a, trackId, start) {
  const id = uid();
  return { id, rootId: id, assetId: a.id, trackId, name: a.name, start, sourceIn: 0, sourceOut: a.kind === "image" ? 5 : a.duration, rate: 1, gainDb: 0, enabled: true, quiet: false, x: 0.5, y: 0.5, scale: trackId === "main" ? 1 : 0.5, rotation: 0, opacity: 1, keyframes: {} };
}
function blankProject() {
  const quiet = quietDefinition();
  const normalize = { id: "normalize-action", version: 1, kind: "quick", name: "Level spoken audio", description: "Measure loudness and adjust gain with a peak guard.", mode: "suggested", initial: false, steps: [{ id: "level", type: "operation", operation: "normalize", mode: "inherit", params: { target: -16, maxBoost: 12, peak: -1 } }] };
  return { schema: 1, name: "Untitled project", revision: 0, assets: [], tracks: [{ id: "main", name: "Main video", kind: "main", muted: false }, { id: "overlay", name: "Overlay 1", kind: "overlay", muted: false }, { id: "audio", name: "Audio", kind: "audio", muted: false }], clips: [], library: [quiet, normalize, { id: "lecture-preset", version: 1, kind: "preset", name: "Lecture cleanup", description: "Shorten pauses, level audio, and check the result.", mode: "inherit", initial: true, steps: [reference(quiet.id), reference(normalize.id), { id: "verify", type: "operation", operation: "check", mode: "inherit", params: { minDuration: 0.1, maxRate: 4 } }] }], proposals: [], markers: [], width: 1920, height: 1080, fps: 30 };
}
function reference(id) {
  return { id: uid(), type: "reference", definitionId: id, policy: "follow", overrides: {}, mode: "inherit" };
}
function quietDefinition() {
  return { id: "quiet-action", version: 2, kind: "quick", name: "Shorten quiet moments", description: "Find quiet regions, then shorten and speed them up when found.", mode: "suggested", initial: false, steps: [{ id: "detect", type: "operation", operation: "detectQuiet", mode: "inherit", params: { threshold: -40, minQuiet: 2, burstDuration: 1, burstCeiling: -25 } }, { id: "when-quiet", type: "condition", test: "matches", params: {}, mode: "inherit", then: [{ id: "detect-shorten", type: "operation", operation: "shorten", mode: "inherit", params: { retain: 20, target: "quiet" } }, { id: "speed", type: "operation", operation: "speed", mode: "inherit", params: { rate: 1.3, target: "quiet" } }], otherwise: [] }] };
}
function walkSteps(steps) {
  return steps.flatMap((s) => s.type === "condition" ? [s, ...walkSteps(s.then), ...walkSteps(s.otherwise)] : [s]);
}
function operationSteps(steps) {
  return walkSteps(steps).filter((s) => s.type === "operation");
}
function latest(library, id) {
  const versions = library.filter((d) => d.id === id).sort((a, b) => b.version - a.version);
  if (!versions.length) throw Error("Referenced definition is missing.");
  return versions[0];
}
function currentDefinitions(library) {
  return [...new Set(library.map((d) => d.id))].map((id) => latest(library, id));
}
function resolveReference(ref, library) {
  const d = copy(ref.policy === "follow" ? latest(library, ref.definitionId) : ref.frozen ?? latest(library, ref.definitionId));
  for (const [path, value] of Object.entries(ref.overrides)) {
    const [id, param] = path.split(":");
    let step = walkSteps(d.steps).find((s) => s.id === id);
    if (param === "retain" && step?.type === "operation" && step.operation === "detectQuiet") step = walkSteps(d.steps).find((s) => s.id === `${id}-shorten`);
    if (!step || step.type === "reference" || !(param in step.params)) throw Error(`A kept parameter (${path}) no longer exists. Keep the definition locked or resolve this override.`);
    step.params[param] = value;
  }
  return d;
}
function bakeDefinition(d, library, stack = []) {
  if (stack.includes(d.id)) throw Error("Circular preset reference detected.");
  const baked = copy(d);
  const visit = (steps) => steps.map((s) => s.type === "condition" ? { ...copy(s), then: visit(s.then), otherwise: visit(s.otherwise) } : s.type === "operation" ? copy(s) : { ...copy(s), policy: "bake", overrides: {}, unbaked: resolveReference(s, library), frozen: bakeDefinition(resolveReference(s, library), library, [...stack, d.id]) });
  baked.steps = visit(d.steps);
  return baked;
}
function setPolicy(ref, policy, library) {
  if (policy === "follow") {
    const result = { ...copy(ref), policy };
    delete result.frozen;
    delete result.unbaked;
    return normalizeOverrides(result, library);
  }
  const raw = copy(ref.policy === "follow" ? latest(library, ref.definitionId) : ref.policy === "bake" ? ref.unbaked ?? ref.frozen ?? latest(library, ref.definitionId) : ref.frozen ?? latest(library, ref.definitionId));
  return { ...copy(ref), policy, unbaked: policy === "bake" ? raw : void 0, frozen: policy === "bake" ? bakeDefinition(raw, library) : raw };
}
function normalizeOverrides(ref, library) {
  const result = copy(ref), d = ref.policy === "follow" ? latest(library, ref.definitionId) : ref.frozen ?? latest(library, ref.definitionId);
  for (const [path, value] of Object.entries(result.overrides)) {
    const [id, param] = path.split(":");
    if (param === "retain" && operationSteps(d.steps).some((s) => s.id === id && s.operation === "detectQuiet") && operationSteps(d.steps).some((s) => s.id === `${id}-shorten`)) {
      delete result.overrides[path];
      result.overrides[`${id}-shorten:${param}`] = value;
    }
  }
  return result;
}
function withMode(steps, mode) {
  return steps.map((s) => ({ ...s, mode, then: s.then ? withMode(s.then, mode) : void 0, otherwise: s.otherwise ? withMode(s.otherwise, mode) : void 0 }));
}
function compile(d, library, inherited = "suggested", stack = []) {
  if (stack.includes(d.id) || stack.length > 24) throw Error("Preset contains a circular reference or is nested too deeply.");
  const mode = d.mode === "inherit" ? inherited : d.mode;
  const visit = (steps, parent, depth = 0) => {
    if (depth > 24) throw Error("Conditional logic is nested too deeply.");
    return steps.flatMap((s) => {
      const local = s.mode === "inherit" ? parent : s.mode;
      if (s.type === "operation") return [{ operation: s.operation, params: copy(s.params), mode: local, label: d.name }];
      if (s.type === "condition") return [{ operation: "if", condition: s.test, params: copy(s.params), mode: local, label: d.name, then: visit(s.then, local, depth + 1), otherwise: visit(s.otherwise, local, depth + 1) }];
      const ops = compile(resolveReference(s, library), library, parent, [...stack, d.id]);
      return s.mode === "inherit" ? ops : withMode(ops, s.mode);
    });
  };
  return visit(d.steps, mode);
}
function migrateProject(p) {
  const result = copy(p);
  for (const d of currentDefinitions(result.library)) {
    if (!operationSteps(d.steps).some((s) => s.operation === "quiet")) continue;
    const visit = (steps) => steps.flatMap((s) => s.type === "condition" ? [{ ...copy(s), then: visit(s.then), otherwise: visit(s.otherwise) }] : s.type === "operation" && s.operation === "quiet" ? [{ ...copy(s), operation: "detectQuiet", params: Object.fromEntries(Object.entries(s.params).filter(([key]) => key !== "retain")) }, { id: `${s.id}-when`, type: "condition", test: "matches", params: {}, mode: s.mode, then: [{ id: `${s.id}-shorten`, type: "operation", operation: "shorten", mode: s.mode, params: { retain: s.params.retain, target: "quiet" } }], otherwise: [] }] : [copy(s)]);
    result.library.push({ ...copy(d), version: d.version + 1, steps: visit(d.steps) });
  }
  return result;
}
function remapDefinition(d, ids) {
  const visit = (steps) => steps.map((s) => s.type === "condition" ? { ...s, then: visit(s.then), otherwise: visit(s.otherwise) } : s.type === "reference" ? { ...s, definitionId: ids.get(s.definitionId) ?? s.definitionId, frozen: s.frozen ? remapDefinition(s.frozen, ids) : void 0, unbaked: s.unbaked ? remapDefinition(s.unbaked, ids) : void 0 } : s);
  return { ...d, id: ids.get(d.id) ?? d.id, steps: visit(d.steps) };
}
function flatten(value, path = "") {
  if (Array.isArray(value)) return Object.assign({}, ...value.map((v, i) => flatten(v, `${path}[${i}]`)));
  if (value && typeof value === "object") return Object.assign({}, ...Object.entries(value).filter(([k]) => !["id", "version", "name", "description", "initial"].includes(k)).map(([k, v]) => flatten(v, path ? `${path}.${k}` : k)));
  return { [path]: value };
}
function referenceDiff(a, b, library) {
  const left = flatten(compile(resolveReference(a, library), library)), right = flatten(compile(resolveReference(b, library), library));
  return [.../* @__PURE__ */ new Set([...Object.keys(left), ...Object.keys(right)])].filter((k) => JSON.stringify(left[k]) !== JSON.stringify(right[k])).map((path) => ({ path, before: left[path], after: right[path] }));
}
function cloneDefinition(d, library, name) {
  return { ...bakeDefinition(d, library), id: uid(), version: 1, name, initial: false };
}
function validateProject(p) {
  if (p?.schema !== 1 || !Array.isArray(p.clips) || !Array.isArray(p.library) || !Array.isArray(p.assets) || !Array.isArray(p.tracks) || !Array.isArray(p.proposals) || !Array.isArray(p.markers)) throw Error("This is not a supported Cutline project.");
  if (p.assets.length > 1e4 || p.clips.length > 1e5) throw Error("Project is too large to load.");
  if (!Number.isFinite(p.width) || !Number.isFinite(p.height) || p.width < 16 || p.width > 4096 || p.height < 16 || p.height > 4096 || !Number.isFinite(p.fps) || p.fps < 1 || p.fps > 60) throw Error("Invalid output dimensions or frame rate.");
  for (const c of p.clips) if (![c.start, c.sourceIn, c.sourceOut, c.rate, c.gainDb, c.x, c.y, c.scale, c.rotation, c.opacity].every(Number.isFinite) || c.start < 0 || c.sourceIn < 0 || c.sourceOut <= c.sourceIn || c.rate < 0.1 || c.rate > 8 || !p.tracks.some((t) => t.id === c.trackId) || !p.assets.some((a) => a.id === c.assetId)) throw Error("Project contains an invalid clip.");
  if (new Set(p.markers.map((m) => m.id)).size !== p.markers.length || p.markers.some((m) => !m.id || !Number.isFinite(m.time) || m.time < 0)) throw Error("Project contains an invalid marker.");
  if (p.regions !== void 0 && !Array.isArray(p.regions)) throw Error("Project contains invalid marked regions.");
  const linked = /* @__PURE__ */ new Set();
  for (const r of p.regions ?? []) {
    if (!r.id || !Array.isArray(r.markerIds) || r.markerIds.length !== 2 || r.markerIds[0] === r.markerIds[1] || r.markerIds.some((id) => !p.markers.some((m) => m.id === id) || linked.has(id))) throw Error("A marked region needs two distinct, unshared markers.");
    r.markerIds.forEach((id) => linked.add(id));
  }
  if (new Set((p.regions ?? []).map((r) => r.id)).size !== (p.regions ?? []).length) throw Error("Marked regions have duplicate identities.");
  if (p.nodeEdits !== void 0) {
    if (!Array.isArray(p.nodeEdits) || new Set(p.nodeEdits.map((e) => e.id)).size !== p.nodeEdits.length) throw Error("Project contains an invalid node Edit library.");
    p.nodeEdits.forEach(validateDraft);
  }
  if (p.sourceLinks !== void 0) {
    if (!Array.isArray(p.sourceLinks) || new Set(p.sourceLinks.map((l) => l.id)).size !== p.sourceLinks.length) throw Error("Project contains invalid source links.");
    for (const l of p.sourceLinks) if (!l.id || !l.name || !Number.isFinite(l.audioOffsetSec) || !p.assets.some((a) => a.id === l.videoAssetId && a.kind === "video") || !p.assets.some((a) => a.id === l.audioAssetId && a.hasAudio)) throw Error("A source link needs video, an audio source and a finite offset.");
  }
  if (p.visualRegions !== void 0) {
    if (!Array.isArray(p.visualRegions) || p.visualRegions.some((r) => !validRegion(r) || !p.assets.some((a) => a.id === r.assetId && a.kind !== "audio"))) throw Error("A visual region must stay inside its video or image.");
  }
  for (const d of currentDefinitions(p.library)) compile(d, p.library);
}

// src/composition.ts
function validRegion(r) {
  return [r.left, r.top, r.right, r.bottom].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) && r.right - r.left >= 0.01 && r.bottom - r.top >= 0.01;
}
function regionClip(asset, region, trackId, start) {
  if (!validRegion(region) || region.assetId !== asset.id) throw Error("Choose a region inside its source frame.");
  const c = makeClip(asset, trackId, start);
  return { ...c, name: region.name, audioMuted: true, cropLeft: region.left, cropTop: region.top, cropRight: 1 - region.right, cropBottom: 1 - region.bottom };
}
function applyLayout(p, time, kind, focusId) {
  const next = copy(p), all = next.clips.filter((c) => c.enabled && c.start <= time && c.start + duration(c) > time && next.assets.find((a) => a.id === c.assetId)?.kind === "video" && !next.tracks.find((t) => t.id === c.trackId)?.muted);
  if (!all.length) throw Error("Put the playhead on a video clip first.");
  if (kind === "focus" && !all.some((c) => c.id === focusId)) throw Error("Select a visible video clip to focus.");
  const overlays = all.filter((c) => next.tracks.find((t) => t.id === c.trackId)?.kind === "overlay"), clips = kind === "grid" && overlays.length ? overlays : all, cols = Math.ceil(Math.sqrt(clips.length)), rows = Math.ceil(clips.length / cols);
  const set = (c, prop, value) => {
    const at = sourceAt(c, time), keys = c.keyframes[prop] ?? [], old = valueAt(c, prop, at);
    if (!keys.length && at > c.sourceIn + 1e-6) keys.push({ time: c.sourceIn, value: old, interpolation: "hold" });
    const existing = keys.find((k) => Math.abs(k.time - at) < 1e-6);
    if (existing) {
      existing.value = value;
      existing.interpolation = "hold";
    } else keys.push({ time: at, value, interpolation: "hold" });
    c.keyframes[prop] = keys.sort((a, b) => a.time - b.time);
  };
  if (kind === "grid" && overlays.length) all.filter((c) => !clips.includes(c)).forEach((c) => set(c, "opacity", 0));
  clips.forEach((c, i) => {
    const focused = kind === "focus" && c.id === focusId;
    set(c, "x", kind === "grid" ? (i % cols + 0.5) / cols : 0.5);
    set(c, "y", kind === "grid" ? (Math.floor(i / cols) + 0.5) / rows : 0.5);
    set(c, "scale", kind === "grid" ? Math.min(1 / cols, 1 / rows) : 1);
    set(c, "opacity", kind === "grid" || focused ? 1 : 0);
  });
  return next;
}

// src/render.ts
function drawLayer(ctx, image, w, h, c, time) {
  const source = sourceAt(c, time), iw = "videoWidth" in image ? image.videoWidth : "width" in image ? image.width : w, ih = "videoHeight" in image ? image.videoHeight : "height" in image ? image.height : h;
  if (!iw || !ih) return;
  const left = c.cropLeft ?? 0, top = c.cropTop ?? 0, cw = iw * (1 - left - (c.cropRight ?? 0)), ch = ih * (1 - top - (c.cropBottom ?? 0));
  const fit = Math.min(w / cw, h / ch) * valueAt(c, "scale", source);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, valueAt(c, "opacity", source)));
  ctx.translate(valueAt(c, "x", source) * w, valueAt(c, "y", source) * h);
  ctx.rotate(valueAt(c, "rotation", source) * Math.PI / 180);
  ctx.drawImage(image, left * iw, top * ih, cw, ch, -cw * fit / 2, -ch * fit / 2, cw * fit, ch * fit);
  ctx.restore();
}
function audioGain(c, time) {
  return c.audioMuted ? 0 : 10 ** (valueAt(c, "gainDb", sourceAt(c, time)) / 20) * Math.max(0, Math.min(1, (time - c.start) / Math.max(5e-3, c.fadeIn ?? 0), (c.start + (c.sourceOut - c.sourceIn) / c.rate - time) / Math.max(5e-3, c.fadeOut ?? 0)));
}
function drawDemo(ctx, w, h, t) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#173b40");
  g.addColorStop(1, "#081d23");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#8ddbb5";
  ctx.font = `${h * 0.026}px sans-serif`;
  ctx.fillText("FIELD NOTES  /  01", w * 0.075, h * 0.15);
  ctx.fillStyle = "#eef6ed";
  ctx.font = `600 ${h * 0.085}px sans-serif`;
  ctx.fillText("A little room", w * 0.075, h * 0.36);
  ctx.fillText("to think.", w * 0.075, h * 0.46);
  ctx.fillStyle = "#90aaa6";
  ctx.font = `${h * 0.026}px sans-serif`;
  ctx.fillText(t >= 12 && t < 48 ? "A quiet moment. Keep what matters." : "Ideas take shape, one moment at a time.", w * 0.075, h * 0.57);
  for (let i = 0; i < 7; i++) {
    ctx.strokeStyle = `rgba(149,224,187,${0.12 + i * 0.035})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let j = 0; j < 100; j++) {
      const x = w * (0.63 + j * 3e-3), y = h * (0.5 + Math.sin(j * 0.06 + t * 0.12 + i * 0.35) * (0.07 + i * 0.025));
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = "#90aaa6";
  ctx.font = `${h * 0.022}px monospace`;
  ctx.fillText(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")} / 01:00`, w * 0.075, h * 0.87);
}
function demoAudio(t) {
  const quiet = t >= 12 && t < 48, burst = t >= 28 && t < 28.6;
  const amp = burst ? 0.025 : quiet ? 8e-4 : 0.17 * (0.7 + 0.3 * Math.sin(t * 9));
  return amp * (Math.sin(t * 2 * Math.PI * 220) + 0.3 * Math.sin(t * 2 * Math.PI * 443)) * 0.7;
}

// src/pipeline/fast.ts
function audioSignal(revision, e, p) {
  const rate = Number(p.sampleRateHz ?? 4), kind = String(p.detector ?? "loudness");
  if (!Number.isFinite(rate) || rate <= 0 || rate > 50) throw Error("Choose a signal rate between 0 and 50 samples per second.");
  const values = new Float32Array(Math.ceil(revision.durationSec * rate)), confidence = new Float32Array(values.length), levels = new Float32Array(values.length), window = Math.max(1, Math.round(Number(p.windowSec ?? 1) * rate));
  let quiet = 0, sum = 0, squares = 0, valid = 0;
  if (!Number.isFinite(window) || window > 1e5) throw Error("Choose a finite measurement window.");
  let segmentIndex = 0;
  const segments = revision.timeMap.segments, prefix = new Float64Array(e.rms.length + 1);
  for (let i = 0; i < e.rms.length; i++) prefix[i + 1] = prefix[i] + e.rms[i] ** 2;
  for (let i = 0; i < values.length; i++) {
    const start = i / rate, end = Math.min(revision.durationSec, (i + 1) / rate), offset = Number(revision.audioOffsetSec ?? 0);
    let energy = 0, coverage = 0;
    while (segmentIndex < segments.length && segments[segmentIndex].outEnd <= start) segmentIndex++;
    if (e.hasAudio !== false) for (let s = segmentIndex; s < segments.length && segments[s].outStart < end; s++) {
      const seg = segments[s], a = Math.max(start, seg.outStart), b = Math.min(end, seg.outEnd);
      if (b <= a) continue;
      const loSource = seg.srcStart + (a - seg.outStart) * seg.rate + offset, hiSource = seg.srcStart + (b - seg.outStart) * seg.rate + offset;
      const lo = Math.max(0, Math.floor(loSource / e.step)), hi = Math.min(e.rms.length, Math.ceil(hiSource / e.step));
      if (hi <= lo) continue;
      const available = Math.max(0, Math.min(e.duration, hiSource) - Math.max(0, loSource)) / seg.rate;
      energy += (prefix[hi] - prefix[lo]) / (hi - lo) * available;
      coverage += available;
    }
    if (!coverage) {
      values[i] = kind === "loudness" ? -100 : 0;
      quiet = 0;
      sum = 0;
      squares = 0;
      valid = 0;
      continue;
    }
    const rms = Math.sqrt(energy / coverage), db = Math.max(-100, 20 * Math.log10(Math.max(1e-5, rms)));
    levels[i] = db;
    valid++;
    sum += db;
    squares += db * db;
    if (valid > window) {
      sum -= levels[i - window];
      squares -= levels[i - window] ** 2;
    }
    const n = Math.min(window, valid), variance = Math.max(0, squares / n - (sum / n) ** 2);
    if (coverage < end - start - 1e-6) quiet = 0;
    quiet = db <= Number(p.threshold ?? -40) ? quiet + coverage : 0;
    values[i] = kind === "loudness" ? db : kind === "silence" ? quiet : kind === "variance" ? variance : kind === "consistency" ? 1 / (1 + variance) : db > Number(p.threshold ?? -35) ? 1 : 0;
    confidence[i] = (kind === "speech" ? 0.55 : 0.98) * Math.min(1, coverage / (end - start));
  }
  return { id: `${revision.id}/${kind}`, revisionId: revision.id, kind, sampleRateHz: rate, values, confidence, remappable: kind === "loudness" };
}
function frameDifference(before, after) {
  if (!before) return { motion: 0, scene: 0 };
  let change = 0;
  const a = new Float32Array(16), b = new Float32Array(16), count = after.length / 4;
  for (let i = 0; i < after.length; i += 4) {
    const x = (before[i] + before[i + 1] + before[i + 2]) / 3, y = (after[i] + after[i + 1] + after[i + 2]) / 3;
    change += Math.abs(x - y) / 255;
    a[Math.min(15, Math.floor(x / 16))]++;
    b[Math.min(15, Math.floor(y / 16))]++;
  }
  let hist = 0;
  for (let i = 0; i < 16; i++) hist += Math.abs(a[i] - b[i]);
  return { motion: change / Math.max(1, count), scene: hist / Math.max(1, 2 * count) };
}
var FastDetector = class {
  constructor(id, service) {
    this.id = id;
    this.service = service;
  }
  version = 1;
  async *detect(revision, params, abort) {
    abort?.throwIfAborted();
    let done = false, error, wake;
    const queue = [];
    void this.service(revision, { ...params, detector: this.id }, (part) => {
      queue.splice(0, queue.length, part);
      wake?.();
    }, abort).then((signal) => {
      queue.splice(0, queue.length, { progress: 1, signal });
      done = true;
      wake?.();
    }, (e) => {
      error = e;
      done = true;
      wake?.();
    });
    while (!done || queue.length) {
      abort?.throwIfAborted();
      if (!queue.length) {
        await new Promise((resolve) => {
          wake = resolve;
        });
        wake = void 0;
      }
      if (error) throw error;
      if (queue.length) yield queue.shift();
    }
    if (error) throw error;
  }
};
function fastDetectors(service) {
  return new Map(["loudness", "silence", "speech", "variance", "consistency", "motion", "scene", "time", "markers"].map((id) => [id, new FastDetector(id, service)]));
}

export {
  NODE_WIDTH,
  HEADER_HEIGHT,
  PORT_HEIGHT,
  catalog,
  placeholderBindings,
  validateDraft,
  importDraft,
  freshEdit,
  createBlock,
  addBlock,
  connect,
  connectionBetween,
  disconnectPin,
  insertConnected,
  removeBlock,
  duplicateBlock,
  arrange,
  portPoint,
  wirePath,
  describeNode,
  linearSteps,
  validRegion,
  regionClip,
  applyLayout,
  uid,
  copy,
  duration,
  projectEnd,
  sourceAt,
  valueAt,
  makeClip,
  blankProject,
  reference,
  walkSteps,
  latest,
  currentDefinitions,
  resolveReference,
  setPolicy,
  normalizeOverrides,
  withMode,
  compile,
  migrateProject,
  remapDefinition,
  referenceDiff,
  cloneDefinition,
  validateProject,
  drawLayer,
  audioGain,
  drawDemo,
  demoAudio,
  audioSignal,
  frameDifference,
  fastDetectors
};
//# sourceMappingURL=chunk-F2DUKIHG.js.map
