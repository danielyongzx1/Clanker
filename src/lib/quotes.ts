// Text picked from the chat with "Ask Clanker" goes out at the top of the next message as markdown
// blockquotes, one per pick with a blank line between, then a blank line and the message. Kept in
// the text itself, it reaches every model and backend as it is, and queued or steered messages
// carry it like any other text.

/** The message text with the quotes ahead of it. */
export function withQuotes(quotes: string[], text: string) {
  const blocks = quotes.map((q) =>
    q
      .split('\n')
      .map((line) => (line.trim() ? `> ${line}` : '>'))
      .join('\n')
  );
  return [...blocks, text].filter(Boolean).join('\n\n');
}

/** Takes the quotes back off the top of a message; text without them comes back whole. */
export function splitQuotes(text: string): { quotes: string[]; text: string } {
  const lines = text.split('\n');
  const quotes: string[] = [];
  let current: string[] | null = null;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^>( |$)/.test(line)) {
      current ??= [];
      current.push(line.replace(/^> ?/, ''));
    } else if (!line.trim() && current) {
      quotes.push(current.join('\n').trim());
      current = null;
    } else break;
  }
  // Quotes end in a blank line, or the end of the message when it's nothing but quotes.
  if (current && i === lines.length) quotes.push(current.join('\n').trim());
  else if (current || !quotes.length) return { quotes: [], text };
  return { quotes, text: lines.slice(i).join('\n') };
}

/** The first line of a message's own text, or of its first quote when it has nothing else. */
export function firstLine(message: string) {
  const { quotes, text } = splitQuotes(message);
  return (text.trim() || quotes[0] || '').split('\n')[0];
}
