import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
if (process.platform !== "win32") {
  console.log("Windows WebView2 host build is only required on Windows.");
  process.exit(0);
}
const local = resolve("work/dotnet-sdk/dotnet.exe");
const dotnet =
  process.env.VIDOWN_DOTNET || (existsSync(local) ? local : "dotnet");
const output = resolve("resources/webview2-host");
const result = spawnSync(
  dotnet,
  [
    "publish",
    "native/WebViewHost",
    "-c",
    "Release",
    "-r",
    "win-x64",
    "--self-contained",
    "true",
    "-p:RestoreLockedMode=true",
    "-o",
    output,
    "-p:DebugType=None",
    "-p:DebugSymbols=false",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      DOTNET_NOLOGO: "1",
    },
  },
);
if (result.error)
  throw new Error(
    "Building the Windows browser host requires .NET SDK 8. Set VIDOWN_DOTNET to its dotnet executable. " +
      result.error.message,
  );
if (result.status !== 0) process.exit(result.status || 1);
// Retain component notices beside the redistributed native assemblies.
const nuget =
  process.env.NUGET_PACKAGES ||
  join(process.env.USERPROFILE, ".nuget/packages");
for (const file of ["LICENSE.txt", "NOTICE.txt"])
  copyFileSync(
    join(nuget, "microsoft.web.webview2/1.0.3537.50", file),
    join(output, "WebView2-" + file),
  );
const runtime = JSON.parse(
  readFileSync(join(output, "Vidown.WebView2.runtimeconfig.json"), "utf8"),
);
for (const framework of runtime.runtimeOptions.includedFrameworks) {
  const core = framework.name === "Microsoft.NETCore.App";
  const folder = join(
    nuget,
    core
      ? "microsoft.netcore.app.runtime.win-x64"
      : "microsoft.windowsdesktop.app.runtime.win-x64",
    framework.version,
  );
  for (const file of core
    ? ["LICENSE.TXT", "THIRD-PARTY-NOTICES.TXT"]
    : ["LICENSE"])
    copyFileSync(join(folder, file), join(output, framework.name + "-" + file));
}
