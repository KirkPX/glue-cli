export type OutputFormat = 'json' | 'pretty';

function getTextPreview(text: string, maxLength: number = 100): string {
  let preview = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  preview = preview
    .replace(/[*_~`]/g, '')
    .replace(/^#+\s+/gm, '')
    .trim();
  if (preview.length > maxLength) {
    preview = preview.substring(0, maxLength) + '...';
  }
  return preview;
}

export interface FormatOptions {
  json?: boolean;
  pretty?: boolean;
}

/** --json wins, then --pretty. With neither: readable at a terminal, JSON anywhere else. */
export function resolveFormat(opts: FormatOptions = {}): OutputFormat {
  if (opts.json) return 'json';
  if (opts.pretty) return 'pretty';
  return process.stdout.isTTY ? 'pretty' : 'json';
}

/**
 * The per-command writer. Every handler starts with `const r = reporter(opts)`, and no command
 * calls console.log, so a command cannot print prose into a pipe by mistake.
 */
export interface Reporter {
  readonly format: OutputFormat;
  /** The result. `pretty` is the human form of the same data. */
  result(data: unknown, pretty?: string): void;
  /** One line of a pretty result. stdout, pretty only. */
  line(message: string): void;
  /** One item of a stream that has no end, such as `watch`: one JSON object per line. */
  event(data: unknown): void;
  /** Progress. stderr, pretty only. */
  note(message: string): void;
  /** Problems worth seeing in both formats. Always stderr. */
  warn(message: string): void;
}

export function reporterFor(format: OutputFormat): Reporter {
  return {
    format,
    result(data, pretty) {
      if (format === 'json' || pretty === undefined) output(data, format);
      else console.log(pretty);
    },
    line(message) {
      if (format === 'pretty') console.log(message);
    },
    event(data) {
      console.log(JSON.stringify(data));
    },
    note(message) {
      if (format === 'pretty') console.error(message);
    },
    warn(message) {
      console.error(message);
    },
  };
}

export function reporter(opts: FormatOptions = {}): Reporter {
  return reporterFor(resolveFormat(opts));
}

export function output(data: unknown, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    prettyPrint(data);
  }
}

function prettyPrint(data: unknown): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      prettyPrintItem(item);
    }
  } else if (typeof data === 'object' && data !== null) {
    prettyPrintItem(data as Record<string, unknown>);
  } else {
    console.log(data);
  }
}

function prettyPrintItem(item: Record<string, unknown>): void {
  // Search results (check before thread since both have 'messages')
  if ('thread' in item && 'matchCount' in item) {
    const r = item as any;
    console.log(`Thread: ${r.thread?.subject || '(No subject)'} (${r.thread?.id})`);
    console.log(`  Matches: ${r.matchCount}`);
    for (const msg of (r.messages || []).slice(0, 5)) {
      const preview = getTextPreview(msg.text || '', 100);
      const user = msg.user?.name || 'Unknown';
      console.log(`  ${user}: ${preview}`);
    }
    if (r.messages?.length > 5) {
      console.log(`  ... and ${r.messages.length - 5} more`);
    }
    console.log('');
    return;
  }

  // Thread with messages
  if ('messages' in item && Array.isArray(item.messages)) {
    console.log(`Thread: ${item.subject || '(No subject)'}`);
    console.log(`ID: ${item.id}`);
    console.log(`Messages: ${item.messages.length}`);
    console.log('---');
    for (const msg of item.messages as any[]) {
      const preview = getTextPreview(msg.text || '', 120);
      const user = msg.user?.name || 'Unknown';
      const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : '';
      console.log(`  ${user}: ${preview}`);
      if (time) console.log(`    ${time}`);
    }
    console.log('');
    return;
  }

  // Group
  if ('id' in item && 'name' in item && Object.keys(item).length <= 4) {
    console.log(`  ${item.name} (${item.id})`);
    return;
  }

  // User info
  if ('id' in item && 'name' in item && !('subject' in item)) {
    console.log(`  ${item.name} (${item.id})`);
    return;
  }

  // Generic object
  for (const [key, value] of Object.entries(item)) {
    console.log(`${key}: ${value}`);
  }
}
