import { parseTaskDescription } from "@tasker/core/parsers";

export function appendTaskImage(source: string, reference: string): string {
  const text = source.trimEnd();
  const image = `![image](${reference})`;
  if (parseTaskDescription(text).lastLineIsMetadataOnly) {
    const split = text.lastIndexOf("\n");
    return `${text.slice(0, split)}\n${image}\n${text.slice(split + 1)}`;
  }
  return `${text || "Image"}\n${image}`;
}
