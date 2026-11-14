import {
  audioGain,
  audioSignal,
  demoAudio,
  drawDemo,
  drawLayer,
  duration,
  frameDifference,
  projectEnd,
  sourceAt
} from "./chunks/chunk-PG5JINCA.js";
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  canEncodeAudio,
  canEncodeVideo
} from "./chunks/chunk-YWY5Q6PM.js";
import {
  sourceTime
} from "./chunks/chunk-T3E6QFBJ.js";

// node_modules/soundtouchjs/dist/soundtouch.js
var FifoSampleBuffer = class {
  constructor() {
    this._vector = new Float32Array();
    this._position = 0;
    this._frameCount = 0;
  }
  get vector() {
    return this._vector;
  }
  get position() {
    return this._position;
  }
  get startIndex() {
    return this._position * 2;
  }
  get frameCount() {
    return this._frameCount;
  }
  get endIndex() {
    return (this._position + this._frameCount) * 2;
  }
  clear() {
    this._vector.fill(0);
    this._position = 0;
    this._frameCount = 0;
  }
  put(numFrames) {
    this._frameCount += numFrames;
  }
  putSamples(samples, position, numFrames = 0) {
    position = position || 0;
    const sourceOffset = position * 2;
    if (!(numFrames >= 0)) {
      numFrames = (samples.length - sourceOffset) / 2;
    }
    const numSamples = numFrames * 2;
    this.ensureCapacity(numFrames + this._frameCount);
    const destOffset = this.endIndex;
    this.vector.set(samples.subarray(sourceOffset, sourceOffset + numSamples), destOffset);
    this._frameCount += numFrames;
  }
  putBuffer(buffer, position, numFrames = 0) {
    position = position || 0;
    if (!(numFrames >= 0)) {
      numFrames = buffer.frameCount - position;
    }
    this.putSamples(buffer.vector, buffer.position + position, numFrames);
  }
  receive(numFrames) {
    if (!(numFrames >= 0) || numFrames > this._frameCount) {
      numFrames = this.frameCount;
    }
    this._frameCount -= numFrames;
    this._position += numFrames;
  }
  receiveSamples(output, numFrames = 0) {
    const numSamples = numFrames * 2;
    const sourceOffset = this.startIndex;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
    this.receive(numFrames);
  }
  extract(output, position = 0, numFrames = 0) {
    const sourceOffset = this.startIndex + position * 2;
    const numSamples = numFrames * 2;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
  }
  ensureCapacity(numFrames = 0) {
    const minLength = parseInt(numFrames * 2);
    if (this._vector.length < minLength) {
      const newVector = new Float32Array(minLength);
      newVector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._vector = newVector;
      this._position = 0;
    } else {
      this.rewind();
    }
  }
  ensureAdditionalCapacity(numFrames = 0) {
    this.ensureCapacity(this._frameCount + numFrames);
  }
  rewind() {
    if (this._position > 0) {
      this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._position = 0;
    }
  }
};
var AbstractFifoSamplePipe = class {
  constructor(createBuffers) {
    if (createBuffers) {
      this._inputBuffer = new FifoSampleBuffer();
      this._outputBuffer = new FifoSampleBuffer();
    } else {
      this._inputBuffer = this._outputBuffer = null;
    }
  }
  get inputBuffer() {
    return this._inputBuffer;
  }
  set inputBuffer(inputBuffer) {
    this._inputBuffer = inputBuffer;
  }
  get outputBuffer() {
    return this._outputBuffer;
  }
  set outputBuffer(outputBuffer) {
    this._outputBuffer = outputBuffer;
  }
  clear() {
    this._inputBuffer.clear();
    this._outputBuffer.clear();
  }
};
var RateTransposer = class _RateTransposer extends AbstractFifoSamplePipe {
  constructor(createBuffers) {
    super(createBuffers);
    this.reset();
    this._rate = 1;
  }
  set rate(rate) {
    this._rate = rate;
  }
  reset() {
    this.slopeCount = 0;
    this.prevSampleL = 0;
    this.prevSampleR = 0;
  }
  clear() {
    super.clear();
    this.reset();
  }
  clone() {
    const result = new _RateTransposer();
    result.rate = this._rate;
    return result;
  }
  process() {
    const numFrames = this._inputBuffer.frameCount;
    this._outputBuffer.ensureAdditionalCapacity(numFrames / this._rate + 1);
    const numFramesOutput = this.transpose(numFrames);
    this._inputBuffer.receive();
    this._outputBuffer.put(numFramesOutput);
  }
  transpose(numFrames = 0) {
    if (numFrames === 0) {
      return 0;
    }
    const src = this._inputBuffer.vector;
    const srcOffset = this._inputBuffer.startIndex;
    const dest = this._outputBuffer.vector;
    const destOffset = this._outputBuffer.endIndex;
    let used = 0;
    let i = 0;
    while (this.slopeCount < 1) {
      dest[destOffset + 2 * i] = (1 - this.slopeCount) * this.prevSampleL + this.slopeCount * src[srcOffset];
      dest[destOffset + 2 * i + 1] = (1 - this.slopeCount) * this.prevSampleR + this.slopeCount * src[srcOffset + 1];
      i = i + 1;
      this.slopeCount += this._rate;
    }
    this.slopeCount -= 1;
    if (numFrames !== 1) {
      out: while (true) {
        while (this.slopeCount > 1) {
          this.slopeCount -= 1;
          used = used + 1;
          if (used >= numFrames - 1) {
            break out;
          }
        }
        const srcIndex = srcOffset + 2 * used;
        dest[destOffset + 2 * i] = (1 - this.slopeCount) * src[srcIndex] + this.slopeCount * src[srcIndex + 2];
        dest[destOffset + 2 * i + 1] = (1 - this.slopeCount) * src[srcIndex + 1] + this.slopeCount * src[srcIndex + 3];
        i = i + 1;
        this.slopeCount += this._rate;
      }
    }
    this.prevSampleL = src[srcOffset + 2 * numFrames - 2];
    this.prevSampleR = src[srcOffset + 2 * numFrames - 1];
    return i;
  }
};
var USE_AUTO_SEQUENCE_LEN = 0;
var DEFAULT_SEQUENCE_MS = USE_AUTO_SEQUENCE_LEN;
var USE_AUTO_SEEKWINDOW_LEN = 0;
var DEFAULT_SEEKWINDOW_MS = USE_AUTO_SEEKWINDOW_LEN;
var DEFAULT_OVERLAP_MS = 8;
var _SCAN_OFFSETS = [[124, 186, 248, 310, 372, 434, 496, 558, 620, 682, 744, 806, 868, 930, 992, 1054, 1116, 1178, 1240, 1302, 1364, 1426, 1488, 0], [-100, -75, -50, -25, 25, 50, 75, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [-20, -15, -10, -5, 5, 10, 15, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [-4, -3, -2, -1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
var AUTOSEQ_TEMPO_LOW = 0.25;
var AUTOSEQ_TEMPO_TOP = 4;
var AUTOSEQ_AT_MIN = 125;
var AUTOSEQ_AT_MAX = 50;
var AUTOSEQ_K = (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
var AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;
var AUTOSEEK_AT_MIN = 25;
var AUTOSEEK_AT_MAX = 15;
var AUTOSEEK_K = (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
var AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;
var Stretch = class _Stretch extends AbstractFifoSamplePipe {
  constructor(createBuffers) {
    super(createBuffers);
    this._quickSeek = true;
    this.midBufferDirty = false;
    this.midBuffer = null;
    this.overlapLength = 0;
    this.autoSeqSetting = true;
    this.autoSeekSetting = true;
    this._tempo = 1;
    this.setParameters(44100, DEFAULT_SEQUENCE_MS, DEFAULT_SEEKWINDOW_MS, DEFAULT_OVERLAP_MS);
  }
  clear() {
    super.clear();
    this.clearMidBuffer();
  }
  clearMidBuffer() {
    this.midBufferDirty = false;
    this.midBuffer = null;
    if (this.refMidBuffer) {
      this.refMidBuffer.fill(0);
    }
    this.skipFract = 0;
  }
  setParameters(sampleRate, sequenceMs, seekWindowMs, overlapMs) {
    if (sampleRate > 0) {
      this.sampleRate = sampleRate;
    }
    if (overlapMs > 0) {
      this.overlapMs = overlapMs;
    }
    if (sequenceMs > 0) {
      this.sequenceMs = sequenceMs;
      this.autoSeqSetting = false;
    } else {
      this.autoSeqSetting = true;
    }
    if (seekWindowMs > 0) {
      this.seekWindowMs = seekWindowMs;
      this.autoSeekSetting = false;
    } else {
      this.autoSeekSetting = true;
    }
    this.calculateSequenceParameters();
    this.calculateOverlapLength(this.overlapMs);
    this.tempo = this._tempo;
  }
  set tempo(newTempo) {
    let intskip;
    this._tempo = newTempo;
    this.calculateSequenceParameters();
    this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);
    this.skipFract = 0;
    intskip = Math.floor(this.nominalSkip + 0.5);
    this.sampleReq = Math.max(intskip + this.overlapLength, this.seekWindowLength) + this.seekLength;
  }
  get tempo() {
    return this._tempo;
  }
  get inputChunkSize() {
    return this.sampleReq;
  }
  get outputChunkSize() {
    return this.overlapLength + Math.max(0, this.seekWindowLength - 2 * this.overlapLength);
  }
  calculateOverlapLength(overlapInMsec = 0) {
    let newOvl;
    newOvl = this.sampleRate * overlapInMsec / 1e3;
    newOvl = newOvl < 16 ? 16 : newOvl;
    newOvl -= newOvl % 8;
    this.overlapLength = newOvl;
    this.refMidBuffer = new Float32Array(this.overlapLength * 2);
    this.midBuffer = new Float32Array(this.overlapLength * 2);
  }
  checkLimits(x, mi, ma) {
    return x < mi ? mi : x > ma ? ma : x;
  }
  calculateSequenceParameters() {
    let seq;
    let seek;
    if (this.autoSeqSetting) {
      seq = AUTOSEQ_C + AUTOSEQ_K * this._tempo;
      seq = this.checkLimits(seq, AUTOSEQ_AT_MAX, AUTOSEQ_AT_MIN);
      this.sequenceMs = Math.floor(seq + 0.5);
    }
    if (this.autoSeekSetting) {
      seek = AUTOSEEK_C + AUTOSEEK_K * this._tempo;
      seek = this.checkLimits(seek, AUTOSEEK_AT_MAX, AUTOSEEK_AT_MIN);
      this.seekWindowMs = Math.floor(seek + 0.5);
    }
    this.seekWindowLength = Math.floor(this.sampleRate * this.sequenceMs / 1e3);
    this.seekLength = Math.floor(this.sampleRate * this.seekWindowMs / 1e3);
  }
  set quickSeek(enable) {
    this._quickSeek = enable;
  }
  clone() {
    const result = new _Stretch();
    result.tempo = this._tempo;
    result.setParameters(this.sampleRate, this.sequenceMs, this.seekWindowMs, this.overlapMs);
    return result;
  }
  seekBestOverlapPosition() {
    return this._quickSeek ? this.seekBestOverlapPositionStereoQuick() : this.seekBestOverlapPositionStereo();
  }
  seekBestOverlapPositionStereo() {
    let bestOffset;
    let bestCorrelation;
    let correlation;
    let i = 0;
    this.preCalculateCorrelationReferenceStereo();
    bestOffset = 0;
    bestCorrelation = Number.MIN_VALUE;
    for (; i < this.seekLength; i = i + 1) {
      correlation = this.calculateCrossCorrelationStereo(2 * i, this.refMidBuffer);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = i;
      }
    }
    return bestOffset;
  }
  seekBestOverlapPositionStereoQuick() {
    let bestOffset;
    let bestCorrelation;
    let correlation;
    let scanCount = 0;
    let correlationOffset;
    let tempOffset;
    this.preCalculateCorrelationReferenceStereo();
    bestCorrelation = Number.MIN_VALUE;
    bestOffset = 0;
    correlationOffset = 0;
    tempOffset = 0;
    for (; scanCount < 4; scanCount = scanCount + 1) {
      let j = 0;
      while (_SCAN_OFFSETS[scanCount][j]) {
        tempOffset = correlationOffset + _SCAN_OFFSETS[scanCount][j];
        if (tempOffset >= this.seekLength) {
          break;
        }
        correlation = this.calculateCrossCorrelationStereo(2 * tempOffset, this.refMidBuffer);
        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestOffset = tempOffset;
        }
        j = j + 1;
      }
      correlationOffset = bestOffset;
    }
    return bestOffset;
  }
  preCalculateCorrelationReferenceStereo() {
    let i = 0;
    let context;
    let temp;
    for (; i < this.overlapLength; i = i + 1) {
      temp = i * (this.overlapLength - i);
      context = i * 2;
      this.refMidBuffer[context] = this.midBuffer[context] * temp;
      this.refMidBuffer[context + 1] = this.midBuffer[context + 1] * temp;
    }
  }
  calculateCrossCorrelationStereo(mixingPosition, compare) {
    const mixing = this._inputBuffer.vector;
    mixingPosition += this._inputBuffer.startIndex;
    let correlation = 0;
    let i = 2;
    const calcLength = 2 * this.overlapLength;
    let mixingOffset;
    for (; i < calcLength; i = i + 2) {
      mixingOffset = i + mixingPosition;
      correlation += mixing[mixingOffset] * compare[i] + mixing[mixingOffset + 1] * compare[i + 1];
    }
    return correlation;
  }
  overlap(overlapPosition) {
    this.overlapStereo(2 * overlapPosition);
  }
  overlapStereo(inputPosition) {
    const input2 = this._inputBuffer.vector;
    inputPosition += this._inputBuffer.startIndex;
    const output = this._outputBuffer.vector;
    const outputPosition = this._outputBuffer.endIndex;
    let i = 0;
    let context;
    let tempFrame;
    const frameScale = 1 / this.overlapLength;
    let fi;
    let inputOffset;
    let outputOffset;
    for (; i < this.overlapLength; i = i + 1) {
      tempFrame = (this.overlapLength - i) * frameScale;
      fi = i * frameScale;
      context = 2 * i;
      inputOffset = context + inputPosition;
      outputOffset = context + outputPosition;
      output[outputOffset + 0] = input2[inputOffset + 0] * fi + this.midBuffer[context + 0] * tempFrame;
      output[outputOffset + 1] = input2[inputOffset + 1] * fi + this.midBuffer[context + 1] * tempFrame;
    }
  }
  process() {
    let offset;
    let temp;
    let overlapSkip;
    if (this.midBuffer === null) {
      if (this._inputBuffer.frameCount < this.overlapLength) {
        return;
      }
      this.midBuffer = new Float32Array(this.overlapLength * 2);
      this._inputBuffer.receiveSamples(this.midBuffer, this.overlapLength);
    }
    while (this._inputBuffer.frameCount >= this.sampleReq) {
      offset = this.seekBestOverlapPosition();
      this._outputBuffer.ensureAdditionalCapacity(this.overlapLength);
      this.overlap(Math.floor(offset));
      this._outputBuffer.put(this.overlapLength);
      temp = this.seekWindowLength - 2 * this.overlapLength;
      if (temp > 0) {
        this._outputBuffer.putBuffer(this._inputBuffer, offset + this.overlapLength, temp);
      }
      const start = this._inputBuffer.startIndex + 2 * (offset + this.seekWindowLength - this.overlapLength);
      this.midBuffer.set(this._inputBuffer.vector.subarray(start, start + 2 * this.overlapLength));
      this.skipFract += this.nominalSkip;
      overlapSkip = Math.floor(this.skipFract);
      this.skipFract -= overlapSkip;
      this._inputBuffer.receive(overlapSkip);
    }
  }
};
var testFloatEqual = function(a, b) {
  return (a > b ? a - b : b - a) > 1e-10;
};
var SoundTouch = class _SoundTouch {
  constructor() {
    this.transposer = new RateTransposer(false);
    this.stretch = new Stretch(false);
    this._inputBuffer = new FifoSampleBuffer();
    this._intermediateBuffer = new FifoSampleBuffer();
    this._outputBuffer = new FifoSampleBuffer();
    this._rate = 0;
    this._tempo = 0;
    this.virtualPitch = 1;
    this.virtualRate = 1;
    this.virtualTempo = 1;
    this.calculateEffectiveRateAndTempo();
  }
  clear() {
    this.transposer.clear();
    this.stretch.clear();
  }
  clone() {
    const result = new _SoundTouch();
    result.rate = this.rate;
    result.tempo = this.tempo;
    return result;
  }
  get rate() {
    return this._rate;
  }
  set rate(rate) {
    this.virtualRate = rate;
    this.calculateEffectiveRateAndTempo();
  }
  set rateChange(rateChange) {
    this._rate = 1 + 0.01 * rateChange;
  }
  get tempo() {
    return this._tempo;
  }
  set tempo(tempo) {
    this.virtualTempo = tempo;
    this.calculateEffectiveRateAndTempo();
  }
  set tempoChange(tempoChange) {
    this.tempo = 1 + 0.01 * tempoChange;
  }
  set pitch(pitch) {
    this.virtualPitch = pitch;
    this.calculateEffectiveRateAndTempo();
  }
  set pitchOctaves(pitchOctaves) {
    this.pitch = Math.exp(0.69314718056 * pitchOctaves);
    this.calculateEffectiveRateAndTempo();
  }
  set pitchSemitones(pitchSemitones) {
    this.pitchOctaves = pitchSemitones / 12;
  }
  get inputBuffer() {
    return this._inputBuffer;
  }
  get outputBuffer() {
    return this._outputBuffer;
  }
  calculateEffectiveRateAndTempo() {
    const previousTempo = this._tempo;
    const previousRate = this._rate;
    this._tempo = this.virtualTempo / this.virtualPitch;
    this._rate = this.virtualRate * this.virtualPitch;
    if (testFloatEqual(this._tempo, previousTempo)) {
      this.stretch.tempo = this._tempo;
    }
    if (testFloatEqual(this._rate, previousRate)) {
      this.transposer.rate = this._rate;
    }
    if (this._rate > 1) {
      if (this._outputBuffer != this.transposer.outputBuffer) {
        this.stretch.inputBuffer = this._inputBuffer;
        this.stretch.outputBuffer = this._intermediateBuffer;
        this.transposer.inputBuffer = this._intermediateBuffer;
        this.transposer.outputBuffer = this._outputBuffer;
      }
    } else {
      if (this._outputBuffer != this.stretch.outputBuffer) {
        this.transposer.inputBuffer = this._inputBuffer;
        this.transposer.outputBuffer = this._intermediateBuffer;
        this.stretch.inputBuffer = this._intermediateBuffer;
        this.stretch.outputBuffer = this._outputBuffer;
      }
    }
  }
  process() {
    if (this._rate > 1) {
      this.stretch.process();
      this.transposer.process();
    } else {
      this.transposer.process();
      this.stretch.process();
    }
  }
};

// src/audio.ts
async function* stretchedAudio(track, c) {
  const sink = new AudioSampleSink(track), st = new SoundTouch();
  st.tempo = c.rate;
  st.stretch.setParameters(48e3, 0, 0, 8);
  const wanted = Math.round(duration(c) * 48e3), sourceFrames = Math.round((c.sourceOut - c.sourceIn) * 48e3);
  let produced = 0, resampled = 0;
  function output() {
    const count = Math.min(st.outputBuffer.frameCount, wanted - produced);
    if (count <= 0) return null;
    const out = new Float32Array(count * 2);
    st.outputBuffer.receiveSamples(out, count);
    produced += count;
    return out;
  }
  for await (const sample of sink.samples(c.sourceIn, c.sourceOut)) {
    try {
      const channels = sample.numberOfChannels, frames = sample.numberOfFrames, data = new Float32Array(frames * channels);
      sample.copyTo(data, { format: "f32", planeIndex: 0 });
      const start = Math.max(c.sourceIn, sample.timestamp), end = Math.min(c.sourceOut, sample.timestamp + sample.duration);
      const first = Math.min(sourceFrames, Math.max(resampled, Math.ceil((start - c.sourceIn) * 48e3 - 1e-7))), last = Math.max(first, Math.min(sourceFrames, Math.ceil((end - c.sourceIn) * 48e3 - 1e-7)));
      while (resampled < first) {
        const gap = Math.min(4800, first - resampled), silence = new Float32Array(gap * 2);
        if (c.rate === 1) {
          produced += gap;
          yield silence;
        } else {
          st.inputBuffer.putSamples(silence, 0, gap);
          st.process();
          const out = output();
          if (out) yield out;
        }
        resampled += gap;
      }
      const count = last - resampled, stereo = new Float32Array(count * 2);
      for (let i = first; i < last; i++) {
        const pos = (c.sourceIn + i / 48e3 - sample.timestamp) * sample.sampleRate, j = Math.max(0, Math.min(frames - 1, Math.floor(pos))), k = Math.min(frames - 1, j + 1), f = Math.max(0, Math.min(1, pos - j));
        for (let ch = 0; ch < 2; ch++) {
          const channel = Math.min(ch, channels - 1);
          stereo[(i - resampled) * 2 + ch] = data[j * channels + channel] * (1 - f) + data[k * channels + channel] * f;
        }
      }
      resampled = last;
      if (c.rate === 1) {
        const out = stereo.subarray(0, Math.min(stereo.length, (wanted - produced) * 2));
        produced += out.length / 2;
        if (out.length) yield out;
      } else {
        st.inputBuffer.putSamples(stereo, 0, count);
        st.process();
        const out = output();
        if (out) yield out;
      }
      if (produced >= wanted) break;
    } finally {
      sample.close();
    }
  }
  if (c.rate !== 1) {
    for (let i = 0; i < 8 && produced < wanted; i++) {
      st.inputBuffer.putSamples(new Float32Array(9600), 0, 4800);
      st.process();
      const out = output();
      if (out) yield out;
    }
  }
  while (produced < wanted) {
    const n = Math.min(4800, wanted - produced);
    yield new Float32Array(n * 2);
    produced += n;
  }
}

// src/audio-view.ts
var tables = /* @__PURE__ */ new Map();
function frequencyBins(samples, sampleRate, bins = 48) {
  const n = samples.length;
  if (n < 2 || n & n - 1) throw Error("FFT window must be a power of two.");
  if (!tables.has(n)) {
    const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))), cos = Float64Array.from({ length: n }, (_, i) => Math.cos(-2 * Math.PI * i / n)), sin = Float64Array.from({ length: n }, (_, i) => Math.sin(-2 * Math.PI * i / n));
    tables.set(n, { window, cos, sin });
  }
  const table = tables.get(n), re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = samples[i] * table.window[i];
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    for (let base = 0; base < n; base += len) for (let j = 0; j < len / 2; j++) {
      const cos = table.cos[j * n / len], sin = table.sin[j * n / len], a = base + j, b = a + len / 2, tr = re[b] * cos - im[b] * sin, ti = re[b] * sin + im[b] * cos;
      re[b] = re[a] - tr;
      im[b] = im[a] - ti;
      re[a] += tr;
      im[a] += ti;
    }
  }
  const result = new Uint8Array(bins), maxFreq = Math.min(2e4, sampleRate / 2);
  for (let b = 0; b < bins; b++) {
    const low = 40 * (maxFreq / 40) ** (b / bins), high = 40 * (maxFreq / 40) ** ((b + 1) / bins), from = Math.max(1, Math.floor(low * n / sampleRate)), to = Math.min(n / 2, Math.max(from + 1, Math.ceil(high * n / sampleRate)));
    let power = 0;
    for (let i = from; i < to; i++) power = Math.max(power, re[i] * re[i] + im[i] * im[i]);
    const db = 20 * Math.log10(Math.max(1e-8, Math.sqrt(power) * 4 / n));
    result[b] = Math.max(0, Math.min(255, Math.round((db + 90) / 90 * 255)));
  }
  return result;
}

// src/pipeline/hash.ts
var K = new Uint32Array([1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298]);
var r = (x, n) => x >>> n | x << 32 - n;
var SHA256 = class {
  state = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  buffer = new Uint8Array(64);
  used = 0;
  bytes = 0;
  words = new Uint32Array(64);
  finished = false;
  update(data) {
    if (this.finished) throw Error("Hash has already been finalized.");
    this.bytes += data.length;
    let at = 0;
    while (at < data.length) {
      const n = Math.min(64 - this.used, data.length - at);
      this.buffer.set(data.subarray(at, at + n), this.used);
      this.used += n;
      at += n;
      if (this.used === 64) {
        this.block();
        this.used = 0;
      }
    }
    return this;
  }
  block() {
    const w = this.words, v = new DataView(this.buffer.buffer);
    for (let i = 0; i < 16; i++) w[i] = v.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const a2 = w[i - 15], b2 = w[i - 2];
      w[i] = w[i - 16] + (r(a2, 7) ^ r(a2, 18) ^ a2 >>> 3) + w[i - 7] + (r(b2, 17) ^ r(b2, 19) ^ b2 >>> 10) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i++) {
      const t1 = h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + (e & f ^ ~e & g) + K[i] + w[i] >>> 0, t2 = (r(a, 2) ^ r(a, 13) ^ r(a, 22)) + (a & b ^ a & c ^ b & c) >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v2, i) => this.state[i] = this.state[i] + v2 >>> 0);
  }
  digest() {
    if (this.finished) throw Error("Hash has already been finalized.");
    const length = this.bytes;
    this.buffer[this.used++] = 128;
    if (this.used > 56) {
      this.buffer.fill(0, this.used);
      this.block();
      this.used = 0;
    }
    this.buffer.fill(0, this.used, 56);
    const v = new DataView(this.buffer.buffer);
    v.setUint32(56, Math.floor(length / 536870912));
    v.setUint32(60, length * 8 >>> 0);
    this.block();
    this.finished = true;
    return [...this.state].map((v2) => v2.toString(16).padStart(8, "0")).join("");
  }
};

// src/media-worker.ts
var scope = self;
var files = /* @__PURE__ */ new Map();
var cancelled = /* @__PURE__ */ new Set();
var inputs = /* @__PURE__ */ new Map();
var envelopeCache = /* @__PURE__ */ new Map();
var hashes = /* @__PURE__ */ new Map();
async function fileHash(id, assetId) {
  if (hashes.has(assetId)) return hashes.get(assetId);
  const file = files.get(assetId);
  if (!file) throw Error("Relink the source file first.");
  const reader = file.stream().getReader(), hash = new SHA256();
  let count = 0, last = -1;
  try {
    while (true) {
      check(id);
      const part = await reader.read();
      if (part.done) break;
      hash.update(part.value);
      count += part.value.length;
      const percent = Math.floor(count / Math.max(1, file.size) * 100);
      if (percent !== last) {
        last = percent;
        progress(id, percent / 100, "Checking source content identity");
      }
      if (percent % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const value = hash.digest();
  hashes.set(assetId, value);
  return value;
}
async function pipelineSignal(id, assetId, revision, p) {
  const kind = String(p.detector), rate = Number(p.sampleRateHz ?? 4);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 8) throw Error("Choose a Fast-tier rate between 0 and 8 samples per second.");
  if (["loudness", "variance", "consistency", "silence", "speech"].includes(kind)) {
    let e = envelopeCache.get(assetId);
    if (!e) {
      e = files.get(assetId)?.type.startsWith("image/") ? { duration: revision.durationSec, step: 0.02, rms: new Float32Array(), peak: new Float32Array(), weighted: new Float32Array(), hasAudio: false } : await analyze(id, assetId);
      envelopeCache.set(assetId, e);
    }
    return audioSignal(revision, e, p);
  }
  const values = new Float32Array(Math.ceil(revision.durationSec * rate)), confidence = new Float32Array(values.length), result = { id: `${revision.id}/${kind}`, revisionId: revision.id, kind, sampleRateHz: rate, values, confidence, remappable: false };
  if (kind === "time" || kind === "markers") {
    const ranges = p.ranges ?? [];
    for (let i = 0; i < values.length; i++) {
      values[i] = ranges.some((r2) => i / rate >= r2.start && i / rate < r2.end) ? 1 : 0;
      confidence[i] = 1;
    }
    return result;
  }
  if (!["motion", "scene"].includes(kind)) throw Error("This detector is not implemented in the Fast tier.");
  if (files.get(assetId)?.type.startsWith("image/")) return result;
  const track = await (await input(assetId)).getPrimaryVideoTrack();
  if (!track) return result;
  const timestamps = (function* () {
    for (let i = 0; i < values.length; i++) yield sourceTime(revision.timeMap, i / rate) ?? 0;
  })(), canvas = new OffscreenCanvas(64, 36), ctx = canvas.getContext("2d", { willReadFrequently: true });
  let previous, at = 0, last = 0;
  for await (const frame of new CanvasSink(track, { width: 64, height: 36, fit: "fill", poolSize: 1 }).canvasesAtTimestamps(timestamps)) {
    check(id);
    if (frame) {
      const crop = revision.crop ?? { left: 0, right: 0, top: 0, bottom: 0 };
      ctx.drawImage(frame.canvas, crop.left * 64, crop.top * 36, (1 - crop.left - crop.right) * 64, (1 - crop.top - crop.bottom) * 36, 0, 0, 64, 36);
      const pixels = ctx.getImageData(0, 0, 64, 36).data, diff = frameDifference(previous, pixels);
      values[at] = kind === "motion" ? diff.motion : diff.scene > Number(p.threshold ?? 0.35) ? 1 : 0;
      confidence[at] = at ? 0.8 : 0;
      previous = pixels;
    }
    at++;
    const percent = Math.floor(at / Math.max(1, values.length) * 100);
    if (percent !== last) {
      last = percent;
      scope.postMessage({ id, progress: percent / 100, message: `Tracking ${kind} on downscaled frames`, signal: percent % 10 === 0 ? { ...result, values: values.slice(0, at), confidence: confidence.slice(0, at) } : void 0 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return result;
}
async function input(id) {
  if (!files.has(id)) throw Error("Source media is missing. Relink the file in Assets.");
  if (!inputs.has(id)) inputs.set(id, new Input({ formats: ALL_FORMATS, source: new BlobSource(files.get(id)) }));
  return inputs.get(id);
}
function check(id) {
  if (cancelled.has(id)) throw new DOMException("Cancelled", "AbortError");
}
function progress(id, value, message) {
  scope.postMessage({ id, progress: value, message });
}
function biquad(rate, highpass) {
  const f = highpass ? 38.13547087602444 : 1681.974450955533, Q = highpass ? 0.5003270373238773 : 0.7071752369554196, K2 = Math.tan(Math.PI * f / rate), Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416, a0 = 1 + K2 / Q + K2 * K2;
  const b = highpass ? [1, -2, 1] : [(Vh + Vb * K2 / Q + K2 * K2) / a0, 2 * (K2 * K2 - Vh) / a0, (Vh - Vb * K2 / Q + K2 * K2) / a0];
  const a = [2 * (K2 * K2 - 1) / a0, (1 - K2 / Q + K2 * K2) / a0];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}
async function analyze(id, assetId) {
  const media = await input(assetId), track = await media.getPrimaryAudioTrack(), total = await media.computeDuration(), step = 0.02, length = Math.ceil(total / step), rms = new Float32Array(length), peak = new Float32Array(length), weighted = new Float32Array(length), counts = new Uint32Array(length);
  if (!track) return { step, rms, peak, weighted, duration: total, hasAudio: false };
  let filters = [];
  let last = -1;
  for await (const sample of new AudioSampleSink(track).samples()) {
    try {
      check(id);
      const channels = sample.numberOfChannels, frames = sample.numberOfFrames, data = new Float32Array(frames * channels);
      sample.copyTo(data, { format: "f32", planeIndex: 0 });
      if (!filters.length) filters = Array.from({ length: channels }, () => [biquad(sample.sampleRate, false), biquad(sample.sampleRate, true)]);
      for (let i = 0; i < frames; i++) {
        const window = Math.floor((sample.timestamp + i / sample.sampleRate) / step);
        if (window < 0 || window >= length) continue;
        let energy = 0, weightedEnergy = 0, max = 0;
        for (let ch = 0; ch < channels; ch++) {
          const v = data[i * channels + ch];
          energy = Math.max(energy, v * v);
          max = Math.max(max, Math.abs(v));
          const k = filters[ch][1](filters[ch][0](v));
          weightedEnergy += k * k;
        }
        rms[window] += energy;
        weighted[window] += weightedEnergy;
        peak[window] = Math.max(peak[window], max);
        counts[window]++;
      }
      const percent = Math.floor(100 * (sample.timestamp + sample.duration) / total);
      if (percent !== last) {
        last = percent;
        progress(id, percent / 100, "Analyzing audio in bounded blocks");
      }
    } finally {
      sample.close();
    }
  }
  for (let i = 0; i < length; i++) {
    rms[i] = Math.sqrt(rms[i] / Math.max(1, counts[i]));
    weighted[i] /= Math.max(1, counts[i]);
  }
  return { step, rms, peak, weighted, duration: total, hasAudio: true };
}
async function spectrum(id, assetId) {
  const media = await input(assetId), track = await media.getPrimaryAudioTrack(), total = await media.computeDuration(), step = Math.max(0.05, total / 8192), columns = Math.max(1, Math.ceil(total / step)), bins = 48, data = new Uint8Array(columns * bins);
  if (!track) return { step, columns, bins, data };
  let ring = [], cursor = 0, filled = 0, next = 0, lastProgress = -1;
  for await (const sample of new AudioSampleSink(track).samples()) {
    try {
      check(id);
      const frames = sample.numberOfFrames, channels = sample.numberOfChannels, pcm = new Float32Array(frames * channels);
      sample.copyTo(pcm, { format: "f32", planeIndex: 0 });
      if (!ring.length) ring = Array.from({ length: Math.min(2, channels) }, () => new Float32Array(1024));
      for (let i = 0; i < frames; i++) {
        for (let ch = 0; ch < ring.length; ch++) ring[ch][cursor] = pcm[i * channels + ch];
        cursor = (cursor + 1) % 1024;
        filled = Math.min(1024, filled + 1);
        const time = sample.timestamp + i / sample.sampleRate;
        if (filled === 1024 && time >= next) {
          const column = Math.min(columns - 1, Math.floor(time / step));
          for (const channel of ring) {
            const ordered = new Float32Array(1024);
            ordered.set(channel.subarray(cursor));
            ordered.set(channel.subarray(0, cursor), 1024 - cursor);
            const values = frequencyBins(ordered, sample.sampleRate, bins);
            for (let b = 0; b < bins; b++) data[column * bins + b] = Math.max(data[column * bins + b], values[b]);
          }
          next = (column + 1) * step;
        }
      }
      const percent = Math.floor(100 * (sample.timestamp + sample.duration) / total);
      if (percent !== lastProgress) {
        lastProgress = percent;
        progress(id, Math.min(1, percent / 100), "Building a bounded spectrogram");
      }
    } finally {
      sample.close();
    }
  }
  return { step, columns, bins, data };
}
async function probe(id, assetId) {
  const f = files.get(assetId);
  if (f.type.startsWith("image/")) {
    const image = await createImageBitmap(f), canvas = new OffscreenCanvas(240, 135), ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, 240, 135);
    const thumb2 = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.65 });
    const result = { kind: "image", width: image.width, height: image.height, duration: 5, hasAudio: false, thumb: thumb2 };
    image.close();
    return result;
  }
  const media = await input(assetId), video = await media.getPrimaryVideoTrack(), audio = await media.getPrimaryAudioTrack();
  let thumb;
  if (video) {
    const frame = await new CanvasSink(video, { width: 240, height: 135, fit: "contain", poolSize: 1 }).getCanvas(0);
    if (frame) thumb = await frame.canvas.convertToBlob({ type: "image/jpeg", quality: 0.65 });
  }
  progress(id, 1, "Media ready");
  return { kind: video ? "video" : "audio", width: video ? await video.getDisplayWidth() : 0, height: video ? await video.getDisplayHeight() : 0, duration: await media.computeDuration(), hasAudio: !!audio, thumb };
}
async function takeAudio(cursor, count) {
  const out = new Float32Array(count * 2);
  let filled = 0;
  while (filled < count) {
    if (cursor.offset >= cursor.buffer.length) {
      const next = await cursor.iterator.next();
      if (next.done) break;
      cursor.buffer = next.value;
      cursor.offset = 0;
    }
    const n = Math.min(count - filled, (cursor.buffer.length - cursor.offset) / 2);
    out.set(cursor.buffer.subarray(cursor.offset, cursor.offset + n * 2), filled * 2);
    cursor.offset += n * 2;
    cursor.position += n;
    filled += n;
  }
  return out;
}
async function render(id, p, handle, demo = false) {
  if (!await canEncodeVideo("avc", { width: p.width, height: p.height, bitrate: 6e6 }) || !await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48e3, bitrate: 192e3 })) throw Error("This Chromium installation does not provide the H.264/AAC encoders required for MP4 export.");
  const canvas = new OffscreenCanvas(p.width, p.height), ctx = canvas.getContext("2d");
  const target = handle ? new StreamTarget(await handle.createWritable()) : new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
  const video = new CanvasSource(canvas, { codec: "avc", bitrate: demo ? 15e5 : 6e6, latencyMode: "realtime", keyFrameInterval: 2 }), audio = new AudioSampleSource({ codec: "aac", bitrate: 192e3 });
  output.addVideoTrack(video, { frameRate: p.fps });
  output.addAudioTrack(audio);
  await output.start();
  const total = demo ? 60 : projectEnd(p), frames = Math.ceil(total * p.fps), assets = new Map(p.assets.map((a) => [a.id, a])), videoIter = /* @__PURE__ */ new Map(), audioIter = /* @__PURE__ */ new Map(), images = /* @__PURE__ */ new Map();
  const activeClips = p.clips.filter((c) => c.enabled && !p.tracks.find((t) => t.id === c.trackId)?.muted), ordered = [...p.tracks].sort((a, b) => a.kind === "main" ? -1 : b.kind === "main" ? 1 : 0);
  let audioFrame = 0;
  try {
    for (let frame = 0; frame < frames; frame++) {
      check(id);
      const t = frame / p.fps;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, p.width, p.height);
      if (demo) drawDemo(ctx, p.width, p.height, t);
      else for (const track of ordered) {
        if (track.kind === "audio") continue;
        for (const c of activeClips.filter((c2) => c2.trackId === track.id && t >= c2.start && t < c2.start + duration(c2))) {
          const a = assets.get(c.assetId);
          if (a.kind === "image") {
            if (!images.has(a.id)) images.set(a.id, await createImageBitmap(files.get(a.id)));
            drawLayer(ctx, images.get(a.id), p.width, p.height, c, t);
          } else if (a.kind === "video") {
            if (!videoIter.has(c.id)) {
              const v = await (await input(c.assetId)).getPrimaryVideoTrack();
              if (!v) continue;
              const times = (function* () {
                for (let f = frame; f / p.fps < Math.min(total, c.start + duration(c)); f++) yield sourceAt(c, f / p.fps);
              })();
              videoIter.set(c.id, new CanvasSink(v, { poolSize: 1 }).canvasesAtTimestamps(times));
            }
            const next = await videoIter.get(c.id).next();
            if (!next.done && next.value) drawLayer(ctx, next.value.canvas, p.width, p.height, c, t);
          }
        }
      }
      await video.add(t, Math.min(1 / p.fps, total - t));
      const endAudio = Math.round(Math.min(total, (frame + 1) / p.fps) * 48e3), count = endAudio - audioFrame, mix = new Float32Array(count * 2), blockStart = audioFrame / 48e3, blockEnd = endAudio / 48e3;
      if (demo) {
        for (let i = 0; i < count; i++) {
          const v = demoAudio(blockStart + i / 48e3);
          mix[i * 2] = v;
          mix[i * 2 + 1] = v;
        }
      } else for (const c of activeClips) {
        const a = assets.get(c.assetId);
        if (!a?.hasAudio || c.start >= blockEnd || c.start + duration(c) <= blockStart) continue;
        if (!audioIter.has(c.id)) {
          const audioTrack = await (await input(c.assetId)).getPrimaryAudioTrack();
          if (!audioTrack) continue;
          audioIter.set(c.id, { iterator: stretchedAudio(audioTrack, c), buffer: new Float32Array(), offset: 0, position: 0 });
        }
        const from = Math.max(audioFrame, Math.round(c.start * 48e3)), to = Math.min(endAudio, Math.round((c.start + duration(c)) * 48e3)), n = Math.max(0, to - from), data = await takeAudio(audioIter.get(c.id), n);
        for (let i = 0; i < n; i++) {
          const at = (from + i) / 48e3, gain = audioGain(c, at);
          mix[(from - audioFrame + i) * 2] += data[i * 2] * gain;
          mix[(from - audioFrame + i) * 2 + 1] += data[i * 2 + 1] * gain;
        }
      }
      for (let i = 0; i < mix.length; i++) mix[i] = Math.max(-1, Math.min(1, mix[i]));
      if (count) {
        const sample = new AudioSample({ data: mix, format: "f32", numberOfChannels: 2, sampleRate: 48e3, timestamp: audioFrame / 48e3 });
        await audio.add(sample);
        sample.close();
      }
      audioFrame = endAudio;
      for (const [key, it] of videoIter) {
        const c = activeClips.find((c2) => c2.id === key);
        if (t + 1 / p.fps >= c.start + duration(c)) {
          await it.return(void 0);
          videoIter.delete(key);
        }
      }
      for (const [key, cursor] of audioIter) {
        const c = activeClips.find((c2) => c2.id === key);
        if (blockEnd >= c.start + duration(c)) {
          await cursor.iterator.return(void 0);
          audioIter.delete(key);
        }
      }
      for (const [key, image] of images) if (!activeClips.some((c) => c.assetId === key && t >= c.start && t < c.start + duration(c))) {
        image.close();
        images.delete(key);
      }
      if (frame % p.fps === 0) progress(id, frame / frames, `${demo ? "Creating demo media" : "Exporting"} \xB7 ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")} / ${Math.ceil(total)}s`);
    }
    video.close();
    audio.close();
    progress(id, 0.99, "Finalizing MP4");
    await output.finalize();
    return handle ? { saved: true } : { blob: new Blob([target.buffer], { type: "video/mp4" }) };
  } catch (error) {
    await output.cancel();
    throw error;
  } finally {
    for (const it of videoIter.values()) await it.return(void 0);
    for (const cursor of audioIter.values()) await cursor.iterator.return(void 0);
    for (const image of images.values()) image.close();
  }
}
scope.onmessage = async (e) => {
  const { id, action, ...args } = e.data;
  if (action === "cancel") {
    cancelled.add(args.job);
    return;
  }
  try {
    let result;
    if (action === "register") {
      envelopeCache.delete(args.assetId);
      hashes.delete(args.assetId);
      files.set(args.assetId, args.file);
      inputs.get(args.assetId)?.dispose();
      inputs.delete(args.assetId);
      result = true;
    } else if (action === "hash") result = await fileHash(id, args.assetId);
    else if (action === "pipeline-signal") result = await pipelineSignal(id, args.assetId, args.revision, args.params);
    else if (action === "probe") result = await probe(id, args.assetId);
    else if (action === "thumbnail") {
      const track = await (await input(args.assetId)).getPrimaryVideoTrack();
      if (!track) result = null;
      else {
        const frame = await new CanvasSink(track, { width: 320, height: 180, fit: "contain", poolSize: 1 }).getCanvas(args.time);
        result = frame ? await frame.canvas.convertToBlob({ type: "image/jpeg", quality: 0.65 }) : null;
      }
    } else if (action === "release") {
      inputs.get(args.assetId)?.dispose();
      inputs.delete(args.assetId);
      files.delete(args.assetId);
      envelopeCache.delete(args.assetId);
      hashes.delete(args.assetId);
      result = true;
    } else if (action === "analyze") result = await analyze(id, args.assetId);
    else if (action === "spectrum") result = await spectrum(id, args.assetId);
    else if (action === "export") result = await render(id, args.project, args.handle, false);
    else if (action === "demo") result = await render(id, { width: 1280, height: 720, fps: 24 }, void 0, true);
    else throw Error("Unknown media task.");
    scope.postMessage({ id, result });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    cancelled.delete(id);
  }
};
//# sourceMappingURL=media-worker.js.map
