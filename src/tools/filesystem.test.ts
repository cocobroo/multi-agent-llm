import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { createFilesystemTools } from "./filesystem.js";
import { SharedContext } from "../bus.js";

describe("filesystem tools", () => {
  test("read, write, and list files inside the sandbox root", async () => {
    const root = await mkdtemp(join(tmpdir(), "orchestra-fs-"));
    try {
      const tools = createFilesystemTools({ rootDir: root, maxReadBytes: 1024 });
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      const context = new SharedContext();

      await byName.get("write_file")?.execute(
        { path: "notes/result.txt", content: "hello orchestra" },
        context,
      );
      await writeFile(join(root, "notes", "extra.txt"), "extra", "utf8");

      await expect(readFile(join(root, "notes", "result.txt"), "utf8")).resolves.toBe(
        "hello orchestra",
      );
      await expect(
        byName.get("read_file")?.execute({ path: "notes/result.txt" }, context),
      ).resolves.toBe("hello orchestra");
      await expect(byName.get("list_dir")?.execute({ path: "notes" }, context)).resolves.toContain(
        "result.txt",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects paths outside the sandbox root", async () => {
    const root = await mkdtemp(join(tmpdir(), "orchestra-fs-"));
    try {
      const tools = createFilesystemTools({ rootDir: root, maxReadBytes: 1024 });
      const readTool = tools.find((tool) => tool.name === "read_file");

      await expect(readTool?.execute({ path: "../secret.txt" }, new SharedContext())).rejects.toThrow(
        "outside the sandbox",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects reads over the configured size limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "orchestra-fs-"));
    try {
      await writeFile(join(root, "large.txt"), "1234567890", "utf8");
      const tools = createFilesystemTools({ rootDir: root, maxReadBytes: 4 });
      const readTool = tools.find((tool) => tool.name === "read_file");

      await expect(readTool?.execute({ path: "large.txt" }, new SharedContext())).rejects.toThrow(
        "exceeds maxReadBytes",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
