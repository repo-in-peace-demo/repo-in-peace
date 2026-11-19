/**
 * The words of the hover label: the file's name in full contrast, its folder path dimmed, and "ghost" in front of a
 * deleted file. Pure. The folder is the file's real folder path, in full.
 */

export interface HoverLabelText {
  ghost: boolean;
  /** The last part of the path. */
  name: string;
  /** Everything before the name, or "/" for a file in the root folder. */
  folder: string;
}

export function hoverLabel(target: { kind: 'file' | 'ghost'; path: string }): HoverLabelText {
  const cut = target.path.lastIndexOf('/');
  return {
    ghost: target.kind === 'ghost',
    name: target.path.slice(cut + 1),
    folder: cut < 0 ? '/' : target.path.slice(0, cut),
  };
}
