import { describe, expect, it } from 'vitest';
import { entryPointOf, htmlScriptsOf, joinPath, packageEntriesOf } from './entry-points';

const none = { htmlScripts: new Set<string>(), packageEntries: new Set<string>() };
const label = (path: string, context = none) => entryPointOf(path, context)?.label;

describe('entryPointOf', () => {
  it('finds Next.js App Router files under any app folder, but not components named like them', () => {
    expect(label('app/app/(auth)/login/page.tsx')).toBe('Next.js page');
    expect(label('app/app/layout.tsx')).toBe('Next.js layout');
    expect(label('app/app/api/accounts/compare/route.ts')).toBe('Next.js route');
    expect(label('src/app/not-found.tsx')).toBe('Next.js not-found');
    expect(label('app/global-error.tsx')).toBe('Next.js error');
    expect(label('app/components/ui/error.tsx')).toBeUndefined();
    expect(label('app/lib/default.ts')).toBeUndefined();
    expect(label('lib/page.ts')).toBeUndefined();
  });

  it('finds the Pages Router and middleware', () => {
    expect(label('pages/index.tsx')).toBe('Next.js page');
    expect(label('src/pages/_app.tsx')).toBe('Next.js page');
    expect(label('pages/api/hello.ts')).toBe('Next.js API route');
    expect(label('app/middleware.ts')).toBe('Next.js middleware');
    expect(label('middleware.ts')).toBe('Next.js middleware');
    expect(label('app/src/middleware.ts')).toBe('Next.js middleware');
    expect(label('app/lib/auth/middleware.ts')).toBeUndefined();
  });

  it('finds Vite and package entries, configs and tests', () => {
    const ctx = { htmlScripts: new Set(['src/index.ts']), packageEntries: new Set(['bin/cli.js']) };
    expect(entryPointOf('src/index.ts', ctx)).toEqual({ kind: 'framework', label: 'Vite entry' });
    expect(entryPointOf('bin/cli.js', ctx)).toEqual({ kind: 'package', label: 'package entry' });
    expect(entryPointOf('vite.config.ts', none)).toEqual({ kind: 'config', label: 'Vite config' });
    expect(label('app/tailwind.config.ts')).toBe('Tailwind config');
    expect(label('app/postcss.config.mjs')).toBe('PostCSS config');
    expect(label('app/drizzle.config.ts')).toBe('Drizzle config');
    expect(label('jest.config.js')).toBe('Jest config');
    expect(label('knip.ts')).toBe('Knip config');
    expect(label('.eslintrc.cjs')).toBe('ESLint config');
    expect(label('prettier.config.mjs')).toBe('Prettier config');
    expect(label('babel.config.js')).toBe('Babel config');
    expect(label('app/playwright.config.ts')).toBe('Playwright config');
    expect(entryPointOf('src/data/join.test.ts', none)).toEqual({ kind: 'test', label: 'test' });
    expect(label('src/__tests__/x.ts')).toBe('test');
    expect(label('src/x.spec.tsx')).toBe('test');
    expect(label('src/configure.ts')).toBeUndefined();
  });

  it('knows only the configs of known tools: a module merely named *.config is not an entry point', () => {
    expect(entryPointOf('app/auth.config.ts', none)).toBeUndefined();
    expect(label('src/site.config.ts')).toBeUndefined();
    expect(label('src/knip-helpers.ts')).toBeUndefined();
  });

  it('takes the first rule that matches: a test under app/ is a test, a config named page is a page', () => {
    expect(label('app/app/page.test.tsx')).toBe('test');
    expect(entryPointOf('app/page.tsx', { htmlScripts: new Set(['app/page.tsx']), packageEntries: new Set() })?.label).toBe('Next.js page');
  });
});

describe('what index.html and package.json name', () => {
  it('reads module scripts, from the file\'s folder, a leading / meaning that folder', () => {
    expect(htmlScriptsOf('index.html', '<script type="module" src="/src/index.ts"></script>')).toEqual(['src/index.ts']);
    expect(htmlScriptsOf('web/index.html', `<script src="./a.js"></script><script type='module' src='./main.tsx?v=1'></script><script type="module" src="https://cdn.x/y.js"></script>`)).toEqual(['web/main.tsx']);
  });

  it('reads main and bin, as a string or an object', () => {
    expect(packageEntriesOf('package.json', JSON.stringify({ main: './dist/index.js', bin: 'cli.js' }))).toEqual(['dist/index.js', 'cli.js']);
    expect(packageEntriesOf('tools/package.json', JSON.stringify({ bin: { a: './bin/a.js', b: 'bin/b.js' } }))).toEqual(['tools/bin/a.js', 'tools/bin/b.js']);
    expect(packageEntriesOf('package.json', '{not json')).toEqual([]);
  });

  it('joins paths and refuses ones that leave the clone', () => {
    expect(joinPath('a/b', '../c.ts')).toBe('a/c.ts');
    expect(joinPath('', '../x.ts')).toBeUndefined();
  });
});
