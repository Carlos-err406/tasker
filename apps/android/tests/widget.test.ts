import { expect, it } from "vitest";
import { widgetNotes } from "../src/widget";

it("turns a description preview into plain widget notes", () => {
  expect(
    widgetNotes(
      "- [x] Outline\n- [ ] Draft\n\n> Keep it **short**\n- `syncAndRefresh()` debounce\n![chart](/attachments/x) see [the PR](https://example.com)",
    ),
  ).toBe(
    "☑ Outline\n☐ Draft\nKeep it short\n• syncAndRefresh() debounce\n🖼 chart see the PR",
  );
  expect(widgetNotes(null)).toBeNull();
  expect(widgetNotes("\n> \n")).toBeNull();
});
