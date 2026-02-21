export function buildDecomposePrompt(taskDescription: string, existingSubtasks: string[]): string {
  const existingSection =
    existingSubtasks.length > 0
      ? `\nExisting subtasks (avoid duplicates):\n${existingSubtasks.map((s) => `- ${s}`).join('\n')}`
      : '';

  return `Break down the following task into a list of concrete, actionable subtasks.

Task: ${taskDescription}${existingSection}

Format your response as XML with each subtask inside a <tasks> block.
You can include brief reasoning prose before the XML.

IMPORTANT: Each <task> element contains the description text, then a NEWLINE, then a metadata-only line.
The metadata line must be the last line and must contain ONLY these tokens (no description words):
- Priority: p1 (high), p2 (medium), p3 (low)
- Due date: @yyyy-mm-dd or relative (@today, @tomorrow, @monday, etc.)
- Tags: #tagname

CORRECT format (metadata is on its own line after a newline):
<tasks>
  <task>Research competitor APIs
p2</task>
  <task>Draft schema design
@2026-03-01</task>
  <task>Implement auth layer
p1 #backend</task>
  <task>Write plain subtask with no metadata</task>
</tasks>

WRONG format (do NOT put metadata on the same line as the description):
<tasks>
  <task>Research competitor APIs p2</task>
  <task>Draft schema design @2026-03-01</task>
</tasks>

Keep subtasks focused and specific. Aim for 3-7 subtasks.`;
}
