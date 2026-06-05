import { describe, expect, test } from "vitest";
import { createCli } from "./index.js";

describe("CLI", () => {
  test("exposes one-shot and model override flags", () => {
    const help = createCli().helpInformation();

    expect(help).toContain("--once <objective>");
    expect(help).toContain("--model <model>");
    expect(help).toContain("connect");
  });
});
