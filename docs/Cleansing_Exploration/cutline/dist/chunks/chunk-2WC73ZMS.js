// src/pipeline/examples.ts
var port = (id, type, required = true) => ({ id, name: id, type, required });
function node(id, kind, params, inputs, output) {
  return { id, name: id, kind, params, inputs, outputs: [port("out", output)], ui: { x: 0, y: 0 } };
}
function example(kind = "remove") {
  const source = node("source", "media", {}, [], "av"), detect = node("quiet", "detection", { detector: "silence" }, [port("media", "av")], "signal"), when = node("long-pause", "condition", { expression: { op: "threshold", signal: "value", on: 2 }, debounce: 0.5 }, [port("value", "signal")], "condition"), selection = node("selection", "selection", {}, [port("media", "av"), port("condition", "condition")], "selection"), action = node("remove", "action", { action: "remove", mode: "propose" }, [port("media", "av"), port("selection", "selection")], "av");
  const edit = { schemaVersion: 1, id: kind, name: kind === "speaker" ? "Speaker focus" : kind === "cross" ? "Cross-revision tagging" : "Remove long silences", version: 1, nodes: [source, detect, when, selection, action], connections: [], slots: [{ id: "source", name: "Recording", nodeId: "source", type: "av", required: true }], history: [] };
  const wire = (from, to, input) => edit.connections.push({ from: { node: from, port: "out" }, to: { node: to, port: input } });
  wire("source", "quiet", "media");
  wire("quiet", "long-pause", "value");
  wire("source", "selection", "media");
  wire("long-pause", "selection", "condition");
  wire("source", "remove", "media");
  wire("selection", "remove", "selection");
  if (kind === "cross") {
    const tag = node("tag-remaining", "action", { action: "tag", label: "pause remainder", mode: "auto" }, [port("media", "av"), port("selection", "selection")], "av");
    edit.nodes.push(tag);
    wire("remove", "tag-remaining", "media");
    wire("selection", "tag-remaining", "selection");
  }
  if (kind === "speaker") {
    detect.params = { detector: "speaker", label: "speakerA" };
    when.params = { expression: { op: "threshold", signal: "value", on: 0.5, off: 0.2 }, debounce: 1.5, hold: 3 };
    action.params = { action: "layout", layout: "speakerA", defaultLayout: "grid", mode: "review" };
    const b = node("speaker-b", "detection", { detector: "speaker", label: "speakerB" }, [port("media", "av")], "signal"), both = node("both-speaking", "condition", { expression: { op: "and", children: [{ op: "threshold", signal: "a", on: 0.5, off: 0.2 }, { op: "threshold", signal: "b", on: 0.5, off: 0.2 }] }, debounce: 1.5, hold: 3 }, [port("a", "signal"), port("b", "signal")], "condition"), s = node("both-selection", "selection", {}, [port("media", "av"), port("condition", "condition")], "selection"), layout = node("show-both", "action", { action: "layout", layout: "both", defaultLayout: "grid", z: 1, mode: "review" }, [port("media", "av"), port("selection", "selection")], "av");
    edit.nodes.push(b, both, s, layout);
    wire("source", "speaker-b", "media");
    wire("quiet", "both-speaking", "a");
    wire("speaker-b", "both-speaking", "b");
    wire("source", "both-selection", "media");
    wire("both-speaking", "both-selection", "condition");
    wire("remove", "show-both", "media");
    wire("both-selection", "show-both", "selection");
    const onlyB = node("b-active", "condition", { expression: { op: "threshold", signal: "b", on: 0.5, off: 0.2 }, debounce: 1.5, hold: 3 }, [port("b", "signal")], "condition"), selectB = node("b-selection", "selection", {}, [port("media", "av"), port("condition", "condition")], "selection"), showB = node("show-b", "action", { action: "layout", layout: "speakerB", defaultLayout: "grid", z: 0, mode: "review" }, [port("media", "av"), port("selection", "selection")], "av");
    edit.nodes.push(onlyB, selectB, showB);
    wire("speaker-b", "b-active", "b");
    wire("source", "b-selection", "media");
    wire("b-active", "b-selection", "condition");
    wire("remove", "show-b", "media");
    wire("b-selection", "show-b", "selection");
    edit.connections = edit.connections.filter((c) => !(c.from.node === "remove" && c.to.node === "show-both"));
    wire("show-b", "show-both", "media");
  }
  edit.nodes.forEach((n, i) => n.ui = { x: 40 + i * 200, y: 40 });
  return edit;
}

// src/pipeline/model.ts
var clone = (value) => structuredClone(value);
function media(id, durationSec, type = "av") {
  if (!Number.isFinite(durationSec) || durationSec < 0) throw Error("Media duration must be finite and non-negative.");
  return { id, originId: id, mediaHash: id, type, durationSec, timeMap: { segments: durationSec ? [{ outStart: 0, outEnd: durationSec, srcStart: 0, srcEnd: durationSec, rate: 1 }] : [] }, tags: [], layouts: [] };
}
function compatible(from, to) {
  return from === to || from === "av" && (to === "video" || to === "audio");
}
function validateGraph(edit, bindings = {}, options = {}) {
  if (edit.schemaVersion !== 1 || !Array.isArray(edit.nodes) || !Array.isArray(edit.connections) || !Array.isArray(edit.slots)) throw Error("Unsupported pipeline schema. Import a version 1 Edit.");
  const nodes = new Map(edit.nodes.map((n) => [n.id, n]));
  if (nodes.size !== edit.nodes.length) throw Error("Node names may repeat, but node IDs must be unique.");
  const incoming = /* @__PURE__ */ new Set(), degree = new Map(edit.nodes.map((n) => [n.id, 0])), edges = /* @__PURE__ */ new Map();
  for (const n of edit.nodes) {
    if (!["media", "detection", "condition", "selection", "action", "breakpoint"].includes(n.kind)) throw Error(`${n.name}: choose a supported node kind.`);
    if (new Set(n.inputs.map((p) => p.id)).size !== n.inputs.length || new Set(n.outputs.map((p) => p.id)).size !== n.outputs.length) throw Error(`${n.name}: port IDs must be unique.`);
  }
  for (const c of edit.connections) {
    const a = nodes.get(c.from.node), b = nodes.get(c.to.node), out = a?.outputs.find((p) => p.id === c.from.port), input = b?.inputs.find((p) => p.id === c.to.port);
    if (!a || !b || !out || !input) throw Error("A connection references a missing node or port. Reconnect it.");
    if (!compatible(out.type, input.type)) throw Error(`${a.name} (${out.type}) cannot connect to ${b.name} \u2192 ${input.name} (${input.type}). Add an explicit cast.`);
    const key = `${b.id}:${input.id}`;
    if (incoming.has(key)) throw Error(`${b.name} \u2192 ${input.name} accepts one connection. Use a condition to combine signals.`);
    incoming.add(key);
    degree.set(b.id, degree.get(b.id) + 1);
    edges.set(a.id, [...edges.get(a.id) ?? [], b.id]);
  }
  if (!options.allowIncomplete) {
    for (const n of edit.nodes) for (const p of n.inputs) if (p.required && !incoming.has(`${n.id}:${p.id}`)) throw Error(`${n.name}: connect the required input \u201C${p.name}\u201D.`);
  }
  for (const slot of edit.slots) {
    const node2 = nodes.get(slot.nodeId);
    if (!node2 || node2.kind !== "media") throw Error(`Slot \u201C${slot.name}\u201D must reference a Media node.`);
    if (!node2.outputs.length || !compatible(slot.type, node2.outputs[0].type)) throw Error(`Slot \u201C${slot.name}\u201D and its Media output need compatible types.`);
    const value = bindings[slot.id];
    if (slot.required && !value) throw Error(`Choose media for the required slot \u201C${slot.name}\u201D.`);
    if (value && !compatible(value.type, slot.type)) throw Error(`Slot \u201C${slot.name}\u201D needs ${slot.type}, received ${value.type}. Add an explicit cast.`);
  }
  for (const n of edit.nodes) {
    const successors = edit.connections.filter((c) => c.from.node === n.id && n.outputs.find((p) => p.id === c.from.port)?.type !== "selection").map((c) => nodes.get(c.to.node)).filter((b) => b.kind === "action" && ["remove", "speed"].includes(String(b.params.action)));
    if (successors.length > 1) throw Error(`${n.name}: keep structural actions in one linear chain.`);
  }
  const ready = edit.nodes.filter((n) => degree.get(n.id) === 0), order = [];
  while (ready.length) {
    const n = ready.shift();
    order.push(n);
    for (const id of edges.get(n.id) ?? []) {
      degree.set(id, degree.get(id) - 1);
      if (degree.get(id) === 0) ready.push(nodes.get(id));
    }
  }
  if (order.length !== edit.nodes.length) throw Error("This Edit contains a cycle. Disconnect the loop; version 1 runs forward only.");
  return order;
}

// src/pipeline/serialize.ts
function serialize(value) {
  return JSON.stringify(value, (_key, v) => v instanceof Float32Array ? { $type: "Float32Array", data: Array.from(v) } : v, 2);
}
function migrate(value) {
  const graph = structuredClone(value);
  if (graph.schemaVersion === 0) graph.schemaVersion = 1;
  if (graph.schemaVersion !== 1) throw Error("Unsupported schema version. Export this Edit with a compatible editor.");
  return graph;
}
function parse(text) {
  return JSON.parse(text, (_k, v) => {
    if (v?.$type === "Float32Array") {
      if (!Array.isArray(v.data) || !v.data.every((n) => typeof n === "number" && Number.isFinite(n))) throw Error("Signal arrays must contain finite numbers.");
      return Float32Array.from(v.data);
    }
    return v;
  });
}
function importEdit(text) {
  const edit = migrate(parse(text));
  const bindings = Object.fromEntries(edit.slots.map((s) => [s.id, { type: s.type }]));
  validateGraph(edit, bindings);
  return edit;
}
function importRun(text) {
  const run = parse(text);
  if (run.schemaVersion !== 1 || !["running", "awaiting-approval", "awaiting-continue", "paused-at-breakpoint", "complete", "failed"].includes(run.status) || !Array.isArray(run.queue) || !Number.isInteger(run.cursor)) throw Error("Invalid saved run state.");
  validateGraph(run.edit, run.bindings);
  return run;
}

export {
  clone,
  media,
  validateGraph,
  port,
  node,
  example,
  serialize,
  migrate,
  importEdit,
  importRun
};
//# sourceMappingURL=chunk-2WC73ZMS.js.map
