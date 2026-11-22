/**
 * The last guard for the token (bury-and-resurrect Req 7.2, P5): every response body and log line passes through here. The real
 * protection is that the token is never put into a message in the first place; this catches a mistake.
 */

/** Anything that looks like a GitHub token, configured or not. */
const TOKEN_PATTERNS: readonly RegExp[] = [/github_pat_[A-Za-z0-9_]+/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g];
const REPLACEMENTS = ['[redacted]', '***', '<hidden>'];

export function redact(text: string, secrets: ReadonlyArray<string | undefined> = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret === undefined || secret.length < 4) continue;
    // A replacement that can't itself contain the secret, so the loop ends and nothing is rebuilt from the pieces.
    const replacement = REPLACEMENTS.find((r) => !r.includes(secret) && !secret.includes(r)) ?? '';
    while (out.includes(secret)) out = out.split(secret).join(replacement);
  }
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}
