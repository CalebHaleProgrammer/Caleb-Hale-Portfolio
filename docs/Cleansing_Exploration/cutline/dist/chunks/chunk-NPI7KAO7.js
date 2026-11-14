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
  for (const d of currentDefinitions(p.library)) compile(d, p.library);
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
  return 10 ** (valueAt(c, "gainDb", sourceAt(c, time)) / 20) * Math.max(0, Math.min(1, (time - c.start) / Math.max(5e-3, c.fadeIn ?? 0), (c.start + (c.sourceOut - c.sourceIn) / c.rate - time) / Math.max(5e-3, c.fadeOut ?? 0)));
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

export {
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
  demoAudio
};
//# sourceMappingURL=chunk-NPI7KAO7.js.map
