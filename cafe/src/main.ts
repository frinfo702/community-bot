import { CafeAudio } from "./audio";

const stage = document.getElementById("stage")!;
const soundHint = document.getElementById("sound")!;
const audio = new CafeAudio();

const mode = new URLSearchParams(location.search).get("scene");
if (mode === "3d") {
  void import("./scene3d").then(({ start3d }) => start3d(stage));
} else {
  void import("./pixelScene").then(({ startPixel }) => startPixel(stage));
}

function unlockAudio(): void {
  audio.start();
  window.setTimeout(() => {
    soundHint.classList.toggle("show", !audio.running);
  }, 700);
}

window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });
window.setTimeout(() => {
  if (!audio.running) soundHint.classList.add("show");
}, 1600);
