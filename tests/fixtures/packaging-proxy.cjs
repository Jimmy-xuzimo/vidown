const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { dirname, join } = require("node:path");
const { readFile } = require("node:fs/promises");

// Use the legacy downloader actually selected by electron-builder, isolated
// because bootstrap replaces Node's global HTTP agents for this process.
const fromBuilder = createRequire(
  require.resolve("app-builder-lib/package.json"),
);
const entry = fromBuilder.resolve("@electron/get");
const { initializeProxy } = fromBuilder("@electron/get");
initializeProxy();
assert(global.GLOBAL_AGENT, "Packaging proxy initialization failed");
assert.equal(
  global.GLOBAL_AGENT.HTTPS_PROXY,
  process.env.GLOBAL_AGENT_HTTPS_PROXY,
);
const { GotDownloader } = require(join(dirname(entry), "GotDownloader.js"));

(async () => {
  const [url, target] = process.argv.slice(2);
  await new GotDownloader().download(url, target, {
    quiet: true,
    retry: { limit: 0 },
    timeout: { request: 5000 },
  });
  assert.equal(await readFile(target, "utf8"), "controlled-packaging-download");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
