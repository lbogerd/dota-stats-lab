import { writeFile } from "node:fs/promises";

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${jsonStringify(value)}\n`, { encoding: "utf8", flag: "wx" });
}
