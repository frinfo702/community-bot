export interface Track {
  title: string;
  src: string;
}

export const TRACKS: Track[] = [{ title: "Jinja cafe", src: "./music/jinja-cafe.m4a" }];

const VOLUME = 0.6;
/** Overlap, in seconds, when a track runs into the next (or into itself). */
const LOOP_FADE = 6;
/** Overlap when the listener presses prev / next. */
const SKIP_FADE = 0.8;

/** Equal-power fade curves, so the overlap does not dip in loudness. */
const FADE_OUT = new Float32Array(64).map((_, i) => VOLUME * Math.cos((i / 63) * (Math.PI / 2)));
const FADE_IN = new Float32Array(64).map((_, i) => VOLUME * Math.sin((i / 63) * (Math.PI / 2)));

/**
 * Background music on two <audio> decks. Near the end of a track the other
 * deck starts the next one and the two crossfade, so a recording that stops
 * mid-phrase still loops without a cut. Gains live in Web Audio because iOS
 * ignores HTMLMediaElement.volume.
 */
export class MusicPlayer {
  index = 0;
  onChange: () => void = () => {};
  private readonly decks = [new Audio(), new Audio()];
  private gains: GainNode[] = [];
  private ctx: AudioContext | null = null;
  private live = 0;
  private fadeTimer = 0;

  constructor(private readonly tracks: Track[]) {
    for (const el of this.decks) {
      el.preload = "auto";
      el.addEventListener("play", () => this.onChange());
      el.addEventListener("pause", () => this.onChange());
      el.addEventListener("timeupdate", () => this.watch(el));
      // fallback if timeupdate never came close enough to the end
      el.addEventListener("ended", () => {
        if (el === this.deck) this.crossfade(1, 0);
      });
    }
    this.deck.src = this.track.src;
  }

  get track(): Track {
    return this.tracks[this.index]!;
  }

  get count(): number {
    return this.tracks.length;
  }

  get playing(): boolean {
    return !this.deck.paused;
  }

  private get deck(): HTMLAudioElement {
    return this.decks[this.live]!;
  }

  /** Resolves false when the browser still blocks autoplay. */
  async play(): Promise<boolean> {
    try {
      this.connect();
      await this.ctx!.resume();
      await this.deck.play();
      return true;
    } catch {
      return false;
    }
  }

  toggle(): void {
    if (!this.playing) {
      void this.play();
      return;
    }
    this.settle();
    this.deck.pause();
  }

  /** Moves through the playlist; with one track this restarts it. */
  skip(step: number): void {
    if (this.playing) {
      this.crossfade(step, SKIP_FADE);
      return;
    }
    this.settle();
    this.index = (this.index + step + this.count) % this.count;
    this.deck.src = this.track.src;
    this.onChange();
  }

  /** Built on the first play, inside the user's gesture. */
  private connect(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.gains = this.decks.map((el, i) => {
      const gain = ctx.createGain();
      gain.gain.value = i === this.live ? VOLUME : 0;
      ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
      return gain;
    });
  }

  private watch(el: HTMLAudioElement): void {
    if (el !== this.deck || this.fadeTimer || el.paused) return;
    if (el.duration - el.currentTime <= LOOP_FADE) this.crossfade(1, LOOP_FADE);
  }

  private crossfade(step: number, seconds: number): void {
    this.settle();
    const from = this.live;
    const to = 1 - from;
    this.index = (this.index + step + this.count) % this.count;
    this.live = to;

    const next = this.decks[to]!;
    next.src = this.track.src;
    void next.play();

    const ctx = this.ctx;
    if (ctx && seconds > 0) {
      const now = ctx.currentTime;
      this.gains[from]!.gain.cancelScheduledValues(now);
      this.gains[from]!.gain.setValueCurveAtTime(FADE_OUT, now, seconds);
      this.gains[to]!.gain.cancelScheduledValues(now);
      this.gains[to]!.gain.setValueCurveAtTime(FADE_IN, now, seconds);
      this.fadeTimer = window.setTimeout(() => this.settle(), seconds * 1000);
    } else {
      this.settle();
    }
    this.onChange();
  }

  /** Ends any crossfade now: the live deck at full volume, the other silent. */
  private settle(): void {
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = 0;
    const other = this.decks[1 - this.live]!;
    other.pause();
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.gains.forEach((g, i) => {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(i === this.live ? VOLUME : 0, now);
    });
  }
}
