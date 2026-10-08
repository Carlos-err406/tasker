/** Selection value for the "All lists" view. Not a valid list name, so it cannot collide with one. */
export const ALL_LISTS = "\u0000all";
export const ALL_LISTS_LABEL = "All lists";

export function listLabel(name: string): string {
  return name === ALL_LISTS ? ALL_LISTS_LABEL : name;
}
