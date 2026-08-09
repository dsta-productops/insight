"use client";

/**
 * Microphone capture → 16 kHz mono 16-bit WAV chunks.
 *
 * Uses Web Audio instead of MediaRecorder so every chunk is a complete,
 * self-contained WAV file (no container/codec issues across browsers, and
 * whisper.cpp consumes it directly).
 */

const SAMPLE_RATE = 16000;

/** Silence-aware chunking: cut at pauses, never mid-word.
 *  MIN is kept low so short phrases flush at the next pause and the transcript
 *  keeps pace with speech (a subtitle-like feel) without ever cutting mid-word;
 *  MAX (a force-cut that CAN land mid-speech) stays conservative to protect
 *  word boundaries on long unbroken runs. Raise MIN if accuracy on very short
 *  phrases suffers. */
const MIN_CHUNK_SEC = 2; // don't flush before this much audio
const MAX_CHUNK_SEC = 8; // force a flush at this point regardless
const QUIET_RMS = 0.012; // block below this RMS counts as silence
const QUIET_BLOCKS = 2; // consecutive quiet blocks (~0.5 s) = a pause

export interface WavChunk {
  blob: Blob;
  /** seconds from recording start */
  offset: number;
  /** seconds */
  duration: number;
}

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buffers: Float32Array[] = [];
  private bufferedSamples = 0;
  private quietRun = 0;
  private speechBlocks = 0;
  private samplesSent = 0;
  // Full-stream capture (incl. silence) for the downloadable recording.
  // Stored as Int16 to halve memory: ~115 MB for a 60-minute mono session.
  private fullPcm: Int16Array[] = [];
  private fullSamples = 0;
  private recordSampleRate = SAMPLE_RATE;

  constructor(private readonly onChunk: (chunk: WavChunk) => void) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.recordSampleRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      const block = new Float32Array(e.inputBuffer.getChannelData(0));
      this.buffers.push(block);
      this.bufferedSamples += block.length;

      // Keep the complete, gap-free stream for the saved recording.
      const i16 = floatToInt16(block);
      this.fullPcm.push(i16);
      this.fullSamples += i16.length;

      // Track a running count of consecutive quiet blocks (~0.25 s each at
      // 16 kHz / 4096 samples) and flush on a pause once we have enough audio.
      const level = rms(block);
      if (level >= QUIET_RMS) this.speechBlocks++;
      this.quietRun = level < QUIET_RMS ? this.quietRun + 1 : 0;
      const sec = this.bufferedSamples / (this.ctx?.sampleRate ?? SAMPLE_RATE);
      if (
        (sec >= MIN_CHUNK_SEC && this.quietRun >= QUIET_BLOCKS) ||
        sec >= MAX_CHUNK_SEC
      ) {
        this.flush();
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
  }

  private flush(): void {
    if (this.buffers.length === 0) return;
    const parts = this.buffers;
    const hadSpeech = this.speechBlocks > 0;
    this.buffers = [];
    this.bufferedSamples = 0;
    this.quietRun = 0;
    this.speechBlocks = 0;
    const total = parts.reduce((n, p) => n + p.length, 0);

    // A chunk with no speech at all is pure silence/room noise — Whisper
    // hallucinates on those ("Thank you." etc.). Skip it, but still advance
    // the clock so later segment offsets stay aligned.
    if (!hadSpeech) {
      this.samplesSent += total;
      return;
    }
    const pcm = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
      pcm.set(p, o);
      o += p.length;
    }
    const sampleRate = this.ctx?.sampleRate ?? SAMPLE_RATE;
    const chunk: WavChunk = {
      blob: encodeWav(pcm, sampleRate),
      offset: this.samplesSent / sampleRate,
      duration: pcm.length / sampleRate,
    };
    this.samplesSent += pcm.length;
    this.onChunk(chunk);
  }

  async stop(): Promise<void> {
    this.flush();
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.ctx = null;
  }

  /**
   * The complete session as one WAV blob (all audio, silences included), or
   * null if nothing was captured. Call after stop(); the buffers persist until
   * the recorder is discarded.
   */
  getRecording(): Blob | null {
    if (this.fullSamples === 0) return null;
    const all = new Int16Array(this.fullSamples);
    let o = 0;
    for (const p of this.fullPcm) {
      all.set(p, o);
      o += p.length;
    }
    return encodeWavInt16(all, this.recordSampleRate);
  }
}

function rms(block: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  return Math.sqrt(sum / block.length);
}

function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function encodeWavInt16(samples: Int16Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  return encodeWavInt16(floatToInt16(samples), sampleRate);
}
