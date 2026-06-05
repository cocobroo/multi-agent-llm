import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AgentTool } from "./index.js";

export interface FilesystemToolOptions {
  rootDir: string;
  maxReadBytes?: number;
}

export function createFilesystemTools(options: FilesystemToolOptions): AgentTool[] {
  const rootDir = resolve(options.rootDir);
  const maxReadBytes = options.maxReadBytes ?? 512_000;

  return [
    {
      name: "read_file",
      description: `Read a UTF-8 file inside the project sandbox. Max ${maxReadBytes} bytes.`,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async (input) => readTextFile(resolveSandboxPath(rootDir, readString(input, "path")), maxReadBytes),
    },
    {
      name: "write_file",
      description: "Write UTF-8 text inside the project sandbox, creating parent directories.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      execute: async (input) => {
        const target = resolveSandboxPath(rootDir, readString(input, "path"));
        await writeTextFile(target, readString(input, "content"));
        return `Wrote ${relativeDisplay(rootDir, target)}.`;
      },
    },
    {
      name: "list_dir",
      description: "List files and directories inside the project sandbox.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async (input) => listDir(resolveSandboxPath(rootDir, readString(input, "path"))),
    },
  ];
}

export async function readTextFile(path: string, maxReadBytes = 512_000): Promise<string> {
  const fileStat = await stat(path);
  if (fileStat.size > maxReadBytes) {
    throw new Error(`File '${path}' exceeds maxReadBytes (${maxReadBytes}).`);
  }

  return readFile(path, "utf8");
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function listDir(path: string): Promise<string> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
    .sort()
    .join("\n");
}

function resolveSandboxPath(rootDir: string, requestedPath: string): string {
  const target = resolve(rootDir, requestedPath);
  const normalizedRoot = rootDir.endsWith("\\") || rootDir.endsWith("/") ? rootDir : `${rootDir}\\`;

  if (target !== rootDir && !target.startsWith(normalizedRoot)) {
    throw new Error(`Path '${requestedPath}' is outside the sandbox root.`);
  }

  return target;
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Tool argument '${key}' must be a non-empty string.`);
  }

  return value;
}

function relativeDisplay(rootDir: string, path: string): string {
  return path.startsWith(rootDir) ? path.slice(rootDir.length).replace(/^[/\\]/, "") : path;
}
