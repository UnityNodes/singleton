import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

/**
 * Adds a spoken track to the recording script/record-demo.mjs already made,
 * without touching the burned-in captions or re-encoding the picture.
 *
 * Each caption is synthesised on its own rather than the script read straight
 * through, and placed at the second timeline.json says it appeared. Continuous
 * narration drifts against footage within a handful of seconds, and the moment
 * that matters most here is a hash appearing on screen mid-sentence, so drift is
 * not cosmetic.
 *
 * Needs ELEVENLABS_API_KEY in the environment. Nothing here writes it anywhere.
 *
 *   node script/record-demo.mjs [outDir]
 *   node script/build-narration.mjs [outDir]
 */
const outDir = process.argv[2] ?? path.join(os.tmpdir(), "singleton-demo");
const API = "https://api.elevenlabs.io/v1";
/*
  Daniel, "steady broadcaster": formal, informative, no warmth added to claims
  that are supposed to read as plain fact. A friendlier read undercuts a
  registry whose whole pitch is that nobody has to trust it.
*/
const VOICE = process.env.ELEVENLABS_VOICE ?? "onwK4e9ZLuTAKqWW03F9";
const MODEL = "eleven_multilingual_v2";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set.");

const timelinePath = path.join(outDir, "timeline.json");
if (!fs.existsSync(timelinePath)) {
  throw new Error(`no ${timelinePath}. Run script/record-demo.mjs first.`);
}
const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));

const partsDir = path.join(outDir, "narration-parts");
fs.mkdirSync(partsDir, { recursive: true });

async function synthesize(text) {
  const digest = createHash("sha256").update(`${VOICE}\n${text}`).digest("hex").slice(0, 16);
  const part = path.join(partsDir, `${digest}.mp3`);
  if (fs.existsSync(part)) return part;
  const res = await fetch(`${API}/text-to-speech/${VOICE}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      /* High enough stability that ten separate renders still sound like one take. */
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15 },
    }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs text-to-speech failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }
  fs.writeFileSync(part, Buffer.from(await res.arrayBuffer()));
  return part;
}

function durationOf(file) {
  const out = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ], { encoding: "utf8" });
  return parseFloat(out.stdout.trim());
}

console.log(`synthesising ${timeline.length} lines...`);
const placed = [];
for (const beat of timeline) {
  const part = await synthesize(beat.text);
  const dur = durationOf(part);
  placed.push({ at: beat.at, part, dur });
  console.log(`  [${beat.at.toFixed(1)}s] ${dur.toFixed(1)}s  ${beat.text.slice(0, 56)}`);
}

/*
  A line is never let to start before the one before it has finished. Two
  voices overlapping is far more noticeable than a line landing a second late,
  and hand-tuning gaps after every re-record is the kind of upkeep that stops
  happening.
*/
const GAP = 0.3;
let cursor = 0;
const schedule = [];
for (const { at, part, dur } of placed) {
  const start = Math.max(at, cursor);
  if (start > at + 0.05) {
    console.error(`  ~ line for ${at.toFixed(1)}s pushed to ${start.toFixed(1)}s to clear the one before`);
  }
  schedule.push({ start, part });
  cursor = start + dur + GAP;
}

const videoPath = path.join(outDir, "singleton.mp4");
if (!fs.existsSync(videoPath)) {
  throw new Error(`no ${videoPath}. Run script/record-demo.mjs first, it encodes the silent video.`);
}
const videoDur = durationOf(videoPath);

const narrationPath = path.join(outDir, "narration.mp3");
const inputs = ["-f", "lavfi", "-t", String(videoDur), "-i", "anullsrc=r=44100:cl=stereo"];
const filters = [];
const labels = [];
schedule.forEach(({ start, part }, i) => {
  inputs.push("-i", part);
  filters.push(`[${i + 1}:a]adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)}[d${i}]`);
  labels.push(`[d${i}]`);
});
filters.push(`[0:a]${labels.join("")}amix=inputs=${schedule.length + 1}:duration=first:normalize=0[out]`);

const mix = spawnSync(
  "ffmpeg",
  ["-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[out]",
   "-c:a", "libmp3lame", "-b:a", "192k", narrationPath],
  { stdio: ["ignore", "ignore", "pipe"] },
);
if (mix.error || mix.status !== 0) {
  throw new Error(`ffmpeg did not mix the narration bed.\n${mix.stderr?.toString().trim()}`);
}
console.log(`mixed -> ${narrationPath}`);

/*
  The video track is copied rather than re-encoded: it is already the shipped
  encode, and re-compressing a second time would only cost quality for no
  reason. -shortest exists so a narration bed longer than the video (should not
  happen, but sits here as a guard) cannot extend the file.
*/
const voiced = path.join(outDir, "singleton-voiced.mp4");
const mux = spawnSync(
  "ffmpeg",
  ["-y", "-i", videoPath, "-i", narrationPath,
   "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
   "-shortest", "-movflags", "+faststart", voiced],
  { stdio: ["ignore", "ignore", "pipe"] },
);
if (mux.error || mux.status !== 0) {
  throw new Error(`ffmpeg did not mux voice onto the video.\n${mux.stderr?.toString().trim()}`);
}
console.log(`\nvoiced -> ${voiced}`);
console.log(`ship it with: cp ${voiced} web/public/demo/singleton.mp4`);
