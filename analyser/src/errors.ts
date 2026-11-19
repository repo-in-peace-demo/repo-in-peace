/** A failure the user can act on: bad path, shallow clone, Knip trouble. The CLI prints the message and exits 1, without a stack trace. */
export class AnalyserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyserError';
  }
}
