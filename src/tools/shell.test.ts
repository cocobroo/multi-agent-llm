import { describe, expect, test } from "vitest";
import { createShellTool } from "./shell.js";
import { SharedContext } from "../bus.js";

describe("shell tool", () => {
  test("does not execute commands without confirmation", async () => {
    const tool = createShellTool({
      confirm: async () => false,
      timeoutMs: 5_000,
    });

    const result = await tool.execute({ command: "node -e \"console.log('ran')\"" }, new SharedContext());

    expect(result).toBe("Command cancelled by user.");
  });

  test("executes and captures stdout after confirmation", async () => {
    const tool = createShellTool({
      confirm: async () => true,
      timeoutMs: 5_000,
    });

    const result = await tool.execute(
      { command: "node -e \"console.log('orchestra-shell')\"" },
      new SharedContext(),
    );

    expect(result).toContain("orchestra-shell");
  });
});
