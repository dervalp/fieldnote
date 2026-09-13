#!/usr/bin/env node
import { type Env, type Stream, createOutput, shouldShowBanner } from './render';
import { cliVersion } from './version';
import { helpText } from './help';

const COMING_SOON = [
  '  fieldnote over MCP — coming soon',
  '',
  '  One stdio server, started by your coding agent, answering three',
  "  questions from this repository's own record. Not built.",
  '',
  '  Tracked with Train in docs/roadmap.md.',
].join('\n');

export async function run(argv: string[], stream: Stream, env: Env): Promise<number> {
  const json = argv.includes('--json');
  const out = createOutput(stream, env);
  const [command] = argv.filter((arg) => !arg.startsWith('-'));

  if (argv.includes('--version')) {
    out.line(cliVersion());
    return 0;
  }

  if (command === undefined || argv.includes('--help') || argv.includes('-h')) {
    if (shouldShowBanner(stream, env, { json })) {
      out.banner();
      out.line('');
    }
    out.line(helpText());
    if (command === undefined) {
      out.line('');
      out.line('  fieldnote run       grade this repository');
      out.line('  fieldnote --help    everything else');
    }
    return 0;
  }

  if (command === 'mcp') {
    out.line(COMING_SOON);
    return 0;
  }

  out.line(`  Unknown command: ${command}`);
  out.line('');
  out.line('  Did you mean one of these?');
  out.line('    fieldnote run       grade this repository');
  out.line('    fieldnote login     sign in');
  out.line('    fieldnote --help    everything else');
  return 2;
}

// The only place in the package that touches the process.
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), process.stdout, process.env).then((code) => {
    process.exitCode = code;
  });
}
