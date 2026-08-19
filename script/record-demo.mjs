import fs from "node:fs";
import path from "node:path";
import { chromium } from "/root/cips/node_modules/playwright-core/index.mjs";

/**
 * Records the ninety second demo against the live site.
 *
 * The narration is burned in as captions rather than spoken, because a judge
 * reviewing dozens of entries watches muted, and a caption a reader can pause on
 * carries a hash better than a voice can. Timings follow docs/DEMO.md; change
 * one and the chapter list on the demo page has to be re-checked against frames.
 *
 *   node script/record-demo.mjs [outDir]
 */
const SITE = process.env.SITE ?? "https://singleton.unitynodes.com";
const REFUSAL = "0xd1fb9eebdca21b5cdf52287efecd8427980b4a58740961bbde8111174fc2849e";
const EXPLORER = "https://creditcoin-testnet.blockscout.com/tx";
const outDir = process.argv[2] ?? "/tmp/rec/out";

const CAPTION_CSS = `
#cap-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
  padding: 18px 40px 20px; pointer-events: none;
  background: linear-gradient(to top, rgba(21,21,23,0.97) 60%, rgba(21,21,23,0));
  font: 500 19px/1.45 ui-sans-serif, system-ui, sans-serif;
  color: #fafafa; letter-spacing: -0.01em;
  opacity: 0; transition: opacity 260ms ease;
}
#cap-bar.on { opacity: 1; }
#cap-dot {
  position: fixed; z-index: 2147483647; width: 18px; height: 18px;
  margin: -9px 0 0 -9px; border-radius: 9999px; pointer-events: none;
  background: rgba(250,250,250,0.9); box-shadow: 0 0 0 2px rgba(21,21,23,0.55), 0 0 18px 4px rgba(250,250,250,0.35);
  opacity: 0; transition: opacity 200ms ease;
}
#cap-dot.on { opacity: 1; }
`;

const INIT = `
(() => {
  const build = () => {
    if (document.getElementById("cap-bar")) return;
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(CAPTION_CSS)};
    document.head.appendChild(style);
    const bar = document.createElement("div");
    bar.id = "cap-bar";
    document.body.appendChild(bar);
    const dot = document.createElement("div");
    dot.id = "cap-dot";
    document.body.appendChild(dot);
    document.addEventListener("mousemove", (e) => {
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
      dot.classList.add("on");
    }, true);
  };
  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
  window.__cap = (text) => {
    build();
    const bar = document.getElementById("cap-bar");
    if (!bar) return;
    if (!text) { bar.classList.remove("on"); return; }
    bar.textContent = text;
    bar.classList.add("on");
  };
  window.__scrollToText = (needle) => {
    const all = document.querySelectorAll("h1,h2,h3,section,li,div");
    for (const el of all) {
      if (el.textContent && el.textContent.trim().startsWith(needle)) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return true;
      }
    }
    return false;
  };
})();
`;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-prefers-reduced-motion=0"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 810 },
  deviceScaleFactor: 1,
  recordVideo: { dir: outDir, size: { width: 1440, height: 810 } },
});
await context.addInitScript(INIT);

const page = await context.newPage();
const say = (text) => page.evaluate((t) => window.__cap(t), text);
const wait = (ms) => page.waitForTimeout(ms);
const mark = (label) => console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${label}`);

const t0 = Date.now();

await page.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 60000 });
await wait(1800);

/* 1. the problem */
await say("A borrower pledges one tokenised deed and takes a loan.");
await page.mouse.move(700, 420, { steps: 20 });
await wait(6400);
mark("1 hero");

/* 2. the same deed again */
await say("An hour later they pledge the same deed to a second lender.");
await page.evaluate(() => window.__scrollToText("one asset. two lenders."));
await wait(8200);
mark("2 collision");

/* 3. why nobody notices */
await say("Neither contract can read the other's logs. So both lend.");
await page.mouse.move(560, 520, { steps: 30 });
await wait(7400);
mark("3 hold");

/*
 * 4. the register answers.
 *
 * networkidle is not the same as answered: every number on this page is an
 * eth_call that starts after the bundle has loaded. Waiting on the state chip
 * waits for the chain, which is the thing being demonstrated.
 */
await say("Singleton watched from outside. First to file is on record.");
await page.goto(`${SITE}/register`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText("claimed, first to file").waitFor({ timeout: 45000 });
await page.mouse.move(1300, 180, { steps: 24 });
await wait(6200);
mark("4 register");

/*
 * 5. the refusal, on a public explorer.
 *
 * Blockscout holds a socket open, so it never reaches networkidle. Waiting on
 * the revert link instead is both faster and the thing the shot is about: the
 * registry is verified there, so the custom error decodes into the asset key
 * and the incumbent lender rather than into a blob of hex.
 */
await say("The second pledge was refused on chain. Open the failure yourself.");
await page.mouse.move(990, 539, { steps: 26 });
await wait(2600);
await page.goto(`${EXPLORER}/${REFUSAL}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText("Show revert reason").waitFor({ timeout: 45000 });
await wait(2200);
await page.getByText("Show revert reason").click();
await wait(1200);
await say("That is not a screenshot. It is a refusal in a block.");
await wait(9200);
mark("5 refusal");

/* 6. a lien ends more than one way */
await page.goto(`${SITE}/register`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText("claimed, first to file").waitFor({ timeout: 45000 });
await say("Settled, released, then the loser re-files legitimately. Four proofs.");
await page.evaluate(() => window.__scrollToText("history"));
await wait(8000);
mark("6 history");

/* 7. two protocols that never heard of us */
await say("Real NFTfi and Blur Blend loans on Ethereum mainnet, read unmodified.");
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await wait(900);
await page.getByText("NFTfi collateral").first().click();
await page.getByText("free to lend against").waitFor({ timeout: 45000 });
await wait(9200);
mark("7 mainnet");

/* 8. what it does not claim */
await say("A positive record and a priority rule. Never proof of absence.");
await page.mouse.move(880, 430, { steps: 20 });
await wait(6800);
mark("8 close");

await say("");
await wait(600);

const video = page.video();
await context.close();
await browser.close();

const raw = await video.path();
const named = path.join(outDir, "raw.webm");
fs.renameSync(raw, named);
console.log(`\nrecorded ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${named}`);
