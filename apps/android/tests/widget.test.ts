import { expect, it } from "vitest";
import { widgetImages, widgetNotes } from "../src/widget";

it("turns a description preview into plain widget notes", () => {
  expect(
    widgetNotes(
      "- [x] Outline\n- [ ] Draft\n\n> Keep it **short**\n- `syncAndRefresh()` debounce\n![chart](https://example.com/c.png) see [the PR](https://example.com)\n![photo](/attachments/x)",
    ),
  ).toBe(
    "☑ Outline\n☐ Draft\nKeep it short\n• syncAndRefresh() debounce\n🖼 chart see the PR",
  );
  expect(widgetNotes(null)).toBeNull();
  expect(widgetNotes("\n> \n")).toBeNull();
});

it("lists up to three attached images, once each", () => {
  const id = (n: number) => `${n}`.repeat(8) + "-1111-2222-3333-444444444444";
  expect(
    widgetImages(
      `a ![](/attachments/${id(1)}) ![x](/attachments/${id(1)})\n![web](https://e.com/i.png)\n![](/attachments/${id(2)}) ![](/attachments/${id(3)}) ![](/attachments/${id(4)})`,
    ),
  ).toEqual([id(1), id(2), id(3)]);
});
