import {
  PipelineEngine,
  synthetic
} from "../../chunks/chunk-VDEFAL7U.js";
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  canEncodeVideo
} from "../../chunks/chunk-YWY5Q6PM.js";
import {
  example,
  importEdit,
  importRun,
  serialize
} from "../../chunks/chunk-T3E6QFBJ.js";

// src/pipeline/dev/sample-media.ts
async function sampleMedia(kind, signal) {
  if (!await canEncodeVideo("avc") || !await canEncodeAudio("aac")) throw Error("These sample MP4s require browser H.264 and AAC encoders.");
  const target = new BufferTarget(), out = new Output({ format: new Mp4OutputFormat(), target }), canvas = new OffscreenCanvas(640, 360), ctx = canvas.getContext("2d"), video = new CanvasSource(canvas, { codec: "avc", bitrate: 6e5 }), audio = new AudioSampleSource({ codec: "aac", bitrate: 96e3 }), fixture = synthetic(42, 12, 4);
  out.addVideoTrack(video, { frameRate: 12 });
  out.addAudioTrack(audio);
  await out.start();
  try {
    for (let frame = 0; frame < 144; frame++) {
      signal?.throwIfAborted();
      const t = frame / 12, index = Math.floor(t * 4), a = fixture.signals.speakerA.values[index], b = fixture.signals.speakerB.values[index];
      ctx.fillStyle = "#13232b";
      ctx.fillRect(0, 0, 640, 360);
      ctx.font = "24px sans-serif";
      ctx.fillStyle = "white";
      if (kind === "meeting") {
        for (const [i, level] of [a, b].entries()) {
          ctx.fillStyle = i ? "#4b355f" : "#235b50";
          ctx.fillRect(20 + i * 310, 70, 290, 230);
          ctx.strokeStyle = level > 0.5 ? "#b6ffc5" : "#718493";
          ctx.lineWidth = level > 0.5 ? 8 : 2;
          ctx.strokeRect(20 + i * 310, 70, 290, 230);
          ctx.fillStyle = "white";
          ctx.fillText(`Speaker ${i ? "B" : "A"}`, 60 + i * 310, 190);
        }
      } else if (kind === "podcast") {
        ctx.fillText(t < 2 ? "Podcast intro" : t >= 10 ? "Thanks for listening" : "Host \xB7 local demo", 100, 180);
        ctx.fillStyle = "#91dcb0";
        ctx.fillRect(100, 240, a * 400, 15);
      } else {
        ctx.fillStyle = ["#244d65", "#553d67", "#335b42"][Math.floor(t / 4)];
        ctx.fillRect(25, 25, 590, 310);
        ctx.fillStyle = "white";
        ctx.fillText(`Slide ${Math.floor(t / 4) + 1}`, 230, 180);
      }
      await video.add(t, 1 / 12);
      const rate = 48e3, frames = 4e3, data = new Float32Array(frames * 2);
      for (let i = 0; i < frames; i++) {
        const v = kind === "slideshow" ? 0 : 0.08 * (a * Math.sin(2 * Math.PI * 220 * (t + i / rate)) + b * Math.sin(2 * Math.PI * 330 * (t + i / rate)));
        data[i * 2] = data[i * 2 + 1] = v;
      }
      const sample = new AudioSample({ format: "f32", sampleRate: rate, numberOfChannels: 2, timestamp: t, data });
      try {
        await audio.add(sample);
      } finally {
        sample.close();
      }
    }
    video.close();
    audio.close();
    await out.finalize();
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (error) {
    await out.cancel();
    throw error;
  }
}

// src/pipeline/dev/harness.ts
var host = document.querySelector("#harness");
var engine = new PipelineEngine();
var state;
host.innerHTML = '<select id="recipe"><option value="remove">Remove long silences</option><option value="speaker">Speaker focus</option><option value="cross">Cross-revision tag</option></select><button id="load">Load recipe</button><button id="run">Run JSON</button><button id="continue">Continue</button><button id="save">Export run</button><input id="restore" type="file" accept=".json"><textarea id="graph" aria-label="Graph JSON"></textarea><div id="samples"></div><pre id="status"></pre><div id="results"></div>';
var $ = (id) => document.getElementById(id);
var esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function render() {
  if (!state) return;
  $("status").textContent = state.status + (state.error ? `
${state.error.message}` : "");
  const result = $("results");
  result.replaceChildren();
  for (const [id, outputs] of Object.entries(state.outputs)) {
    const section = document.createElement("section");
    section.innerHTML = `<h2>${esc(id)}</h2>`;
    for (const value of Object.values(outputs)) {
      if ("values" in value) {
        const step = Math.max(1, Math.floor(value.values.length / 500)), points = Array.from(value.values).filter((_, i) => i % step === 0).map((v, i) => `${i * 2},${80 - v * 60}`).join(" ");
        section.innerHTML += `<p>${esc(value.kind)} \xB7 ${value.values.length} samples</p><svg viewBox="0 0 1000 90" aria-label="Signal chart"><polyline points="${points}" fill="none" stroke="#9ee8bd"/></svg>`;
      } else {
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(value, null, 2);
        section.append(pre);
      }
    }
    result.append(section);
  }
  const table = document.createElement("table");
  table.innerHTML = "<tr><th>Operation</th><th>Confidence</th><th>Mode/status</th><th>Resolve</th></tr>";
  for (const op of state.decisions) {
    const row = table.insertRow();
    row.innerHTML = `<td>${esc(op.summary)}</td><td>${op.confidence.toFixed(2)}</td><td>${esc(op.mode)} / ${esc(op.status)}</td>`;
    const cell = row.insertCell();
    for (const decision of ["accept", "reject", "skip"]) {
      const b = document.createElement("button");
      b.textContent = decision;
      b.disabled = !state.queue.includes(op.id);
      b.onclick = () => {
        state = engine.resolve(state, op.id, decision);
        render();
      };
      cell.append(b);
    }
  }
  result.append(table);
}
function safe(fn) {
  return () => {
    void Promise.resolve().then(fn).catch((e) => {
      $("status").textContent = e.message;
    });
  };
}
$("load").onclick = () => {
  $("graph").value = serialize(example($("recipe").value));
};
$("load").click();
$("run").onclick = safe(async () => {
  const graph = importEdit($("graph").value);
  state = await engine.advance(engine.create(graph, { source: synthetic().media }));
  render();
});
$("continue").onclick = safe(async () => {
  if (state) {
    state = await engine.advance(engine.continue(state));
    render();
  }
});
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
$("save").onclick = () => {
  if (state) download(new Blob([serialize(state)], { type: "application/json" }), "pipeline-run.json");
};
$("restore").onchange = safe(async () => {
  const file = $("restore").files?.[0];
  if (file) {
    state = importRun(await file.text());
    render();
  }
});
for (const kind of ["meeting", "podcast", "slideshow"]) {
  const b = document.createElement("button");
  b.textContent = `Generate ${kind} MP4`;
  b.onclick = safe(async () => {
    b.disabled = true;
    try {
      download(await sampleMedia(kind), `${kind}-synthetic.mp4`);
    } finally {
      b.disabled = false;
    }
  });
  $("samples").append(b);
}
//# sourceMappingURL=harness.js.map
