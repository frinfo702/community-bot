export interface Track {
  title: string;
  src: string;
}

export const TRACKS: Track[] = [{ title: "Jinja cafe", src: "./music/jinja-cafe.m4a" }];

const VOLUME = 0.6;

/** Background music: one <audio> element walking a looping playlist. */
export class MusicPlayer {
  readonly el = new Audio();
  index = 0;
  onChange: () => void = () => {};

  constructor(private readonly tracks: Track[]) {
    this.el.preload = "auto";
    this.el.volume = VOLUME;
    this.el.addEventListener("ended", () => this.skip(1));
    this.el.addEventListener("play", () => this.onChange());
    this.el.addEventListener("pause", () => this.onChange());
    this.el.src = this.track.src;
  }

  get track(): Track {
    return this.tracks[this.index]!;
  }

  get count(): number {
    return this.tracks.length;
  }

  get playing(): boolean {
    return !this.el.paused;
  }

  /** Resolves false when the browser still blocks autoplay. */
  async play(): Promise<boolean> {
    try {
      await this.el.play();
      return true;
    } catch {
      return false;
    }
  }

  toggle(): void {
    if (this.playing) this.el.pause();
    else void this.play();
  }

  /** Moves through the playlist; with one track this restarts it. */
  skip(step: number): void {
    const resume = this.playing || this.el.ended;
    this.index = (this.index + step + this.count) % this.count;
    this.el.src = this.track.src;
    this.onChange();
    if (resume) void this.play();
  }
}
