import { MusicPlayer, TRACKS } from "./audio";

const stage = document.getElementById("stage")!;
const soundHint = document.getElementById("sound")!;
const panel = document.getElementById("player")!;
const title = document.getElementById("track-title")!;
const trackNo = document.getElementById("track-no")!;
const toggle = document.getElementById("toggle")!;
const player = new MusicPlayer(TRACKS);

const mode = new URLSearchParams(location.search).get("scene");
if (mode === "3d") {
  void import("./scene3d").then(({ start3d }) => start3d(stage));
} else {
  void import("./pixelScene").then(({ startPixel }) => startPixel(stage));
}

function render(): void {
  title.textContent = player.track.title;
  trackNo.textContent = `${player.index + 1} / ${player.count}`;
  panel.classList.toggle("playing", player.playing);
  toggle.setAttribute("aria-label", player.playing ? "一時停止" : "再生");
  if (player.playing) {
    soundHint.classList.remove("show");
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
  }
}
player.onChange = render;
render();

document.getElementById("prev")!.addEventListener("click", () => player.skip(-1));
document.getElementById("next")!.addEventListener("click", () => player.skip(1));
toggle.addEventListener("click", () => player.toggle());

// The first gesture anywhere but the player starts the music; the player's
// own buttons handle themselves so a click on ⏸ does not start-then-stop.
function unlockAudio(e: Event): void {
  if (e.target instanceof Element && e.target.closest("#player")) return;
  void player.play().then((ok) => soundHint.classList.toggle("show", !ok));
}

window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);
window.setTimeout(() => {
  if (!player.playing) soundHint.classList.add("show");
}, 1600);
