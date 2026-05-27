import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

// NEW LANTERN — X-Ray Runner is the default page.
app.get("/", (_req, res) => res.sendFile(join(__dirname, "public", "game.html")));
// The original 2-key fidget visualizer stays available here.
app.get("/widget", (_req, res) => res.sendFile(join(__dirname, "public", "index.html")));

app.use(express.static(join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`\n  NEW LANTERN — X-Ray Runner`);
  console.log(`  →  http://localhost:${PORT}\n`);
  console.log(`  Pick a runner, hit START, and jump through the scanners.`);
  console.log(`  BIND KEYS to map your USB 2-key pad (brake + jump).`);
  console.log(`  Fidget visualizer still at  /widget . Ctrl+C to stop.\n`);
});
