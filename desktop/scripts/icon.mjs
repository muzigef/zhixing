import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const root = path.resolve(import.meta.dirname, "..");
const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-icon-"));
const app = await electron.launch({
  args: [root],
  env: {
    ...process.env,
    ZHIXING_DESKTOP_TEST_DATA: data,
    PI_CODING_AGENT_DIR: path.join(data, "pi"),
    ZHIXING_ALLOW_LIVE_PROVIDER: "0",
  },
  timeout: 30_000,
});
try {
  const page = await app.firstWindow();
  const svg = await fs.readFile(path.join(root, "assets/icon.svg"), "utf8");
  const png = await page.evaluate(async (svg) => {
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  }, svg);
  await fs.writeFile(
    path.join(root, "assets/icon.png"),
    Buffer.from(png, "base64"),
  );
  console.log("Generated application icon from the repository SVG.");
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true });
}
