import type { Counts } from '../model/app-flow';
import { diggingLines } from '../model/boot-script';
import { useTyping } from './useTyping';

/** The short screen while a graveyard loads and its scene is built (interface spec, Req 3), with the real counts. */
export function DiggingScreen({ counts }: { counts: Counts | null }) {
  const typing = useTyping(diggingLines(counts), false);
  return (
    <main className="terminal digging" aria-label="Opening the graveyard">
      <pre className="terminal-text" role="status" aria-live="polite">
        {typing.lines.join('\n')}
        <span className="terminal-cursor" aria-hidden="true" />
      </pre>
    </main>
  );
}
