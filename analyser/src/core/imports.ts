import ts from 'typescript';

/**
 * The imports in one file (importers spec, Req 1), found with TypeScript's own parser, so imports in comments and strings never
 * count. Pure: a path (for the script kind) and the text in, the specifiers out, unresolved.
 */
export type ImportKind = 'static' | 'reexport' | 'dynamic' | 'require';

export interface ImportRef {
  specifier: string;
  typeOnly: boolean;
  kind: ImportKind;
}

export interface FoundImports {
  refs: ImportRef[];
  /** `import(x)` or `require(x)` with an argument that isn't a string literal: counted, not followed. */
  nonLiteral: number;
}

export function scriptKindOf(path: string): ts.ScriptKind {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'tsx') return ts.ScriptKind.TSX;
  if (ext === 'jsx') return ts.ScriptKind.JSX;
  if (ext === 'ts' || ext === 'mts' || ext === 'cts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

const literalOf = (node: ts.Node | undefined): string | undefined =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;

/** An import declaration is type-only when its clause says so, or when it has only named bindings and every one is a type. */
function importIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false; // `import './x'`: run for its effects
  if (clause.isTypeOnly) return true;
  if (clause.name) return false; // a default binding is a value
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return false; // a namespace import is a value
  return bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
}

function exportIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly);
}

export function findImports(path: string, text: string): FoundImports {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, false, scriptKindOf(path));
  const refs: ImportRef[] = [];
  let nonLiteral = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = literalOf(node.moduleSpecifier);
      if (specifier !== undefined) refs.push({ specifier, typeOnly: importIsTypeOnly(node), kind: 'static' });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = literalOf(node.moduleSpecifier);
      if (specifier !== undefined) refs.push({ specifier, typeOnly: exportIsTypeOnly(node), kind: 'reexport' });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = literalOf(node.moduleReference.expression);
      if (specifier !== undefined) refs.push({ specifier, typeOnly: node.isTypeOnly, kind: 'require' });
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isImport || isRequire) {
        const specifier = node.arguments.length >= 1 ? literalOf(node.arguments[0]) : undefined;
        if (specifier !== undefined) refs.push({ specifier, typeOnly: false, kind: isImport ? 'dynamic' : 'require' });
        else nonLiteral++;
      }
    } else if (ts.isImportTypeNode(node)) {
      // `typeof import('./x')` in a type position: a type-only use.
      const arg = node.argument;
      const specifier = ts.isLiteralTypeNode(arg) ? literalOf(arg.literal) : undefined;
      if (specifier !== undefined) refs.push({ specifier, typeOnly: true, kind: 'dynamic' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { refs, nonLiteral };
}
