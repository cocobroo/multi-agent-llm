import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCli, isCliEntrypointPath } from "./index.js";

describe("CLI", () => {
  test("exposes one-shot and model override flags", () => {
    const help = createCli().helpInformation();

    expect(help).toContain("--once <objective>");
    expect(help).toContain("--model <model>");
    expect(help).toContain("connect");
  });

  test("detects npm-linked Windows junction paths as the CLI entrypoint", () => {
    const root = mkdtempSync(join(tmpdir(), "orchestra-entrypoint-"));
    const realDir = join(root, "real");
    const linkedDir = join(root, "linked");
    const realFile = join(realDir, "dist", "index.js");
    mkdirSync(join(realDir, "dist"), { recursive: true });
    writeFileSync(realFile, "", "utf8");
    symlinkSync(realDir, linkedDir, "junction");

    const linkedArgvPath = join(linkedDir, "dist", "index.js");

    expect(isCliEntrypointPath(pathToFileURL(realpathSync(realFile)).href, linkedArgvPath)).toBe(true);
    expect(isCliEntrypointPath(pathToFileURL(resolve(realFile)).href, undefined)).toBe(false);
  });
});
