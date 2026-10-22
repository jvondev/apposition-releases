import { GifFrame, GifUtil, GifCodec } from "gifwrap";
import { PNG } from "pngjs";

export async function encodeFramesToGif(frames, colors = 256) {
  if (!frames || frames.length === 0) {
    throw new Error("No frames provided for GIF encoding");
  }

  const gifFrames = [];

  for (const f of frames) {
    const png = PNG.sync.read(f.pngBuffer);
    const frame = new GifFrame(png.width, png.height, {
      delayCentisecs: f.delayCentisecs || 50,
    });
    png.data.copy(frame.bitmap.data);
    GifUtil.quantizeWu(frame, colors);
    gifFrames.push(frame);
  }

  const codec = new GifCodec();
  const gif = await codec.encodeGif(gifFrames, { loops: 0 });
  return gif.buffer;
}

export async function captureAnimationFrames(page, steps) {
  const frames = [];

  for (const step of steps) {
    if (typeof step.action === "function") {
      await step.action();
    }
    const pngBuffer = await page.screenshot({ type: "png" });
    const delayCentisecs = Math.max(5, Math.round((step.delayMs || 500) / 10));
    frames.push({ pngBuffer, delayCentisecs });
  }

  return frames;
}
