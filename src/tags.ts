const TAG_RE = /^#([a-zA-Z][a-zA-Z0-9_-]*)$/;
const TAG_LINE_RE = /^(#[a-zA-Z][a-zA-Z0-9_-]*\s*)+$/;

export function parseTags(content: string): { body: string; tags: string[] } {
  const lines = content.split("\n");
  if (lines.length === 0) return { body: content, tags: [] };

  const lastLine = lines[lines.length - 1].trim();
  if (!lastLine || !TAG_LINE_RE.test(lastLine)) {
    return { body: content, tags: [] };
  }

  const tags = lastLine
    .split(/\s+/)
    .map((t) => {
      const m = t.match(TAG_RE);
      return m ? m[1] : null;
    })
    .filter((t): t is string => t !== null);

  if (tags.length === 0) return { body: content, tags: [] };

  const body = lines.slice(0, -1).join("\n").trimEnd();
  return { body, tags };
}

export function formatTagLine(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(" ");
}

export function appendTags(content: string, newTags: string[]): string {
  if (newTags.length === 0) return content;
  const { body, tags } = parseTags(content);
  const allTags = [...new Set([...tags, ...newTags])];
  const tagLine = formatTagLine(allTags);
  return body ? body + "\n" + tagLine : tagLine;
}
