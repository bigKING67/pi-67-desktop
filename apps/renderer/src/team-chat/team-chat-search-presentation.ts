/** Splits a search excerpt into plain and matching runs, case-insensitively, for highlighting. */
export function teamChatSearchSegments(snippet: string, query: string): Array<{ text: string; match: boolean }> {
  const needle = Array.from(query.trim()).map(fold);
  const characters = Array.from(snippet);
  if (needle.length === 0) return [{ text: snippet, match: false }];
  const segments: Array<{ text: string; match: boolean }> = [];
  let plain = "";
  for (let index = 0; index < characters.length;) {
    const matches = index + needle.length <= characters.length
      && needle.every((character, offset) => fold(characters[index + offset]!) === character);
    if (!matches) {
      plain += characters[index];
      index += 1;
      continue;
    }
    if (plain) segments.push({ text: plain, match: false });
    plain = "";
    segments.push({ text: characters.slice(index, index + needle.length).join(""), match: true });
    index += needle.length;
  }
  if (plain) segments.push({ text: plain, match: false });
  return segments;
}

function fold(character: string): string {
  const lower = character.toLocaleLowerCase();
  return Array.from(lower).length === 1 ? lower : character;
}
