import fs from "node:fs";
import path from "node:path";

const SAMPLE_RATE = 48000;
const DURATION_SEC = 35;
const TOTAL_SAMPLES = SAMPLE_RATE * DURATION_SEC;
const buffer = new Float32Array(TOTAL_SAMPLES);

function addTone(startSec, freqStart, freqEnd, durationSec, maxGain, type = "sine") {
  const startSample = Math.floor(startSec * SAMPLE_RATE);
  const totalSamples = Math.floor(durationSec * SAMPLE_RATE);
  let phase = 0;
  for (let i = 0; i < totalSamples; i++) {
    const idx = startSample + i;
    if (idx >= TOTAL_SAMPLES) break;
    const progress = i / totalSamples;
    const freq = freqStart * Math.pow(freqEnd / freqStart, progress);
    const gain = maxGain * Math.exp(-progress * 5);
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    buffer[idx] += gain * (type === "triangle" ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase));
  }
}

function click(sec, gain = 0.28) {
  addTone(sec, 920, 180, 0.016, gain, "sine");
}

function keyThud(sec, gain = 0.25) {
  addTone(sec, 320, 75, 0.026, gain, "triangle");
}

function snap(sec, gain = 0.22) {
  click(sec, gain);
  click(sec + 0.014, gain * 0.7);
}

function successChime(sec, gain = 0.25) {
  addTone(sec, 523.25, 523.25, 0.35, gain, "sine");
  addTone(sec + 0.06, 659.25, 659.25, 0.45, gain * 0.9, "sine");
}

// Scene 1: Command Center (Side-by-side docking)
click(1.5);
click(3.2);
snap(5.0);

// Scene 2: Client Account Isolation
click(8.5);
click(10.5);

// Scene 3: Cmd+K 1-Second Search
keyThud(14.5);
keyThud(14.65);
const typeTimes = [15.2, 15.35, 15.5, 15.65, 15.8, 15.95, 16.1, 16.25, 16.4];
typeTimes.forEach((t) => keyThud(t, 0.18));
keyThud(17.2);

// Scene 4: Client Workspaces
[21.0, 22.2, 23.4, 24.6].forEach((t) => click(t, 0.22));

// Scene 5: Lifetime License & Multi-Device Setup
keyThud(27.5);
keyThud(27.65);
click(29.2);
successChime(30.5);

// Subdued warm analog floor (-48dB 50Hz hum) for zero-fatigue cinema presence
for (let i = 0; i < TOTAL_SAMPLES; i++) {
  buffer[i] += 0.003 * Math.sin((2 * Math.PI * 50 * i) / SAMPLE_RATE);
}

// Encode to 16-bit PCM WAV
const pcm16 = new Int16Array(TOTAL_SAMPLES * 2);
for (let i = 0; i < TOTAL_SAMPLES; i++) {
  const s = Math.max(-1, Math.min(1, buffer[i]));
  const val = s < 0 ? s * 0x8000 : s * 0x7fff;
  pcm16[i * 2] = val;
  pcm16[i * 2 + 1] = val;
}

const wavHeader = Buffer.alloc(44);
wavHeader.write("RIFF", 0);
wavHeader.writeUInt32LE(36 + pcm16.byteLength, 4);
wavHeader.write("WAVE", 8);
wavHeader.write("fmt ", 12);
wavHeader.writeUInt32LE(16, 16);
wavHeader.writeUInt16LE(1, 20); // PCM
wavHeader.writeUInt16LE(2, 22); // Stereo
wavHeader.writeUInt32LE(SAMPLE_RATE, 24);
wavHeader.writeUInt32LE(SAMPLE_RATE * 4, 28);
wavHeader.writeUInt16LE(4, 32);
wavHeader.writeUInt16LE(16, 34);
wavHeader.write("data", 36);
wavHeader.writeUInt32LE(pcm16.byteLength, 40);

const outDir = path.join(process.cwd(), "output", "video");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "appsumo-walkthrough-audio.wav");
fs.writeFileSync(outPath, Buffer.concat([wavHeader, Buffer.from(pcm16.buffer)]));
console.log(`[Audio Synthesizer] Generated synchronized WAV: ${outPath}`);
