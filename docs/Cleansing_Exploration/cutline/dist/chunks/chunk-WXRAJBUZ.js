// src/pipeline/model.ts
var clone = (value) => structuredClone(value);
function media(id, durationSec, type = "av") {
  return { id, originId: id, mediaHash: id, type, durationSec, timeMap: { segments: durationSec ? [{ outStart: 0, outEnd: durationSec, srcStart: 0, srcEnd: durationSec, rate: 1 }] : [] }, tags: [], layouts: [] };
}
function compatible(from, to) {
  return from === to || from === "av" && (to === "video" || to === "audio");
}
function validateGraph(edit, bindings = {}) {
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
  for (const n of edit.nodes) for (const p of n.inputs) if (p.required && !incoming.has(`${n.id}:${p.id}`)) throw Error(`${n.name}: connect the required input \u201C${p.name}\u201D.`);
  for (const slot of edit.slots) {
    const node = nodes.get(slot.nodeId);
    if (!node || node.kind !== "media") throw Error(`Slot \u201C${slot.name}\u201D must reference a Media node.`);
    if (!node.outputs.length || !compatible(slot.type, node.outputs[0].type)) throw Error(`Slot \u201C${slot.name}\u201D and its Media output need compatible types.`);
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

export {
  clone,
  media,
  validateGraph
};
//# sourceMappingURL=chunk-WXRAJBUZ.js.map
