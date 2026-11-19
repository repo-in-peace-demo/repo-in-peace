interface StatusMessageProps {
  title: string;
  message: string;
  /** A short list under the message, for example the first problems of an invalid file. */
  details?: readonly string[];
  /** `loading` is announced politely; `error` is announced at once. */
  kind?: 'loading' | 'error';
}

/**
 * The message in the middle of the screen: loading, or why nothing can be drawn. Text only: names and messages that
 * come from the data or the address are put on the page as text, never as markup.
 */
export function StatusMessage({ title, message, details = [], kind = 'error' }: StatusMessageProps) {
  return (
    <main className={`status status-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <h1>{title}</h1>
      <p>{message}</p>
      {details.length > 0 && (
        <ul>
          {details.map((detail, index) => (
            <li key={index}>{detail}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
