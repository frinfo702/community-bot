interface Voice {
  type: OscillatorType;
  freq: number;
  gain: number;
  detune?: number;
}

const CHORDS: number[][] = [
  [146.83, 220.0, 261.63, 349.23, 392.0], // Dm9
  [116.54, 174.61, 233.08, 293.66, 349.23], // Bbmaj7
  [87.31, 174.61, 220.0, 261.63, 329.63], // Fmaj7
  [130.81, 196.0, 261.63, 329.63, 392.0], // C
];

const PLUCKS = [293.66, 329.63, 392.0, 440.0, 523.25, 587.33];

/**
 * Procedural tearoom ambience: a slow pad, sparse koto-like plucks, a chime
 * every so often, and a quiet room tone. No audio files, no licensing.
 */
export class CafeAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wet: GainNode | null = null;
  private step = 0;

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 6);
    this.master = master;

    const convolver = ctx.createConvolver();
    convolver.buffer = impulse(ctx, 3.2, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.wet = wet;
    convolver.connect(wet).connect(master);

    // room tone
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 3);
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const ng = ctx.createGain();
    ng.gain.value = 0.035;
    noise.connect(lp).connect(ng).connect(master);
    noise.start();

    this.chord(ctx, 0);
    window.setInterval(() => {
      this.step = (this.step + 1) % CHORDS.length;
      this.chord(ctx, 0);
    }, 11000);

    const pluckLoop = () => {
      if (ctx.state === "running") this.pluck(ctx);
      window.setTimeout(pluckLoop, 2400 + Math.random() * 5200);
    };
    window.setTimeout(pluckLoop, 2200);

    const chimeLoop = () => {
      if (ctx.state === "running") this.chime(ctx);
      window.setTimeout(chimeLoop, 17000 + Math.random() * 21000);
    };
    window.setTimeout(chimeLoop, 9000);

    void ctx.resume();
  }

  private chord(ctx: AudioContext, when: number): void {
    const notes = CHORDS[this.step]!;
    const start = ctx.currentTime + when;
    const voices: Voice[] = notes.map((freq, i) => ({
      type: i === 0 ? "sine" : "triangle",
      freq,
      gain: i === 0 ? 0.05 : 0.024,
      detune: (i % 2 === 0 ? 1 : -1) * (3 + i),
    }));
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, start);
    bus.gain.exponentialRampToValueAtTime(1, start + 3.5);
    bus.gain.setValueAtTime(1, start + 7);
    bus.gain.exponentialRampToValueAtTime(0.0001, start + 12);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1100;
    bus.connect(lp);
    lp.connect(this.master!);
    lp.connect(this.wet!);

    for (const v of voices) {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      osc.frequency.value = v.freq;
      osc.detune.value = v.detune ?? 0;
      const g = ctx.createGain();
      g.gain.value = v.gain;
      osc.connect(g).connect(bus);
      osc.start(start);
      osc.stop(start + 12.5);
    }
  }

  private pluck(ctx: AudioContext): void {
    const freq = PLUCKS[Math.floor(Math.random() * PLUCKS.length)]!;
    const t = ctx.currentTime + 0.05;
    const bus = ctx.createGain();
    bus.gain.value = 0.06;
    bus.connect(this.master!);
    bus.connect(this.wet!);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 1.01, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    const harm = ctx.createOscillator();
    harm.type = "triangle";
    harm.frequency.value = freq * 2;
    const hg = ctx.createGain();
    hg.gain.value = 0.12;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    osc.connect(env);
    harm.connect(hg).connect(env);
    env.connect(bus);
    osc.start(t);
    osc.stop(t + 2);
    harm.start(t);
    harm.stop(t + 1.6);
  }

  private chime(ctx: AudioContext): void {
    const t = ctx.currentTime + 0.05;
    const root = Math.random() > 0.5 ? 1318.5 : 1567.98;
    for (const [freq, gain] of [
      [root, 0.02],
      [root * 1.5, 0.008],
      [root * 2.02, 0.004],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
      osc.connect(env);
      env.connect(this.wet!);
      env.connect(this.master!);
      osc.start(t);
      osc.stop(t + 3.6);
    }
  }
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3;
  }
  return buffer;
}

function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const buffer = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, decay);
    }
  }
  return buffer;
}
