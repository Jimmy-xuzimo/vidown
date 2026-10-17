import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 4,
  });
  await page.setContent(
    "<style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>" +
      (await readFile("assets/icon.svg", "utf8")),
  );
  await page.screenshot({
    path: "assets/icon-render.png",
    omitBackground: true,
  });
} finally {
  await browser.close();
}
