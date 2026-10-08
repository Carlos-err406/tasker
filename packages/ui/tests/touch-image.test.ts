import { describe, expect, it } from "vitest";
import { appendTaskImage } from "../src/lib/touch-image.js";
import { parseTaskDescription } from "@tasker/core/parsers";
describe("attaching an image on a phone", () => {
  it("keeps metadata on the last line so attaching does not clear it", () => {
    const value = appendTaskImage(
      "Title\nNotes\np1 @tomorrow #work",
      "/attachments/test",
    );
    expect(value).toBe(
      "Title\nNotes\n![image](/attachments/test)\np1 @tomorrow #work",
    );
    expect(parseTaskDescription(value).priority).toBe(1);
    expect(parseTaskDescription(value).tags).toEqual(["work"]);
  });
  it("appends a body to titles without metadata and handles an empty draft", () => {
    expect(appendTaskImage("Title", "/attachments/test")).toBe(
      "Title\n![image](/attachments/test)",
    );
    expect(appendTaskImage("", "/attachments/test")).toBe(
      "Image\n![image](/attachments/test)",
    );
  });
});
