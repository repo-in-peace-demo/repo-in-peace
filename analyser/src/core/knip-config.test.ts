import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { KNIP_CONFIG_FILES, hasKnipConfig } from './knip-config';

describe('hasKnipConfig', () => {
  it.each(KNIP_CONFIG_FILES)('finds %s in the root of the tree', (name) => {
    expect(hasKnipConfig(['package.json', 'src/index.ts', name])).toBe(true);
  });

  it('is false for a tree with no Knip config and no package.json', () => {
    expect(hasKnipConfig(['src/index.ts', 'README.md'])).toBe(false);
  });

  it('is false when a config-looking file is not in the root', () => {
    expect(hasKnipConfig(['packages/a/knip.json', 'tools/knip.ts'])).toBe(false);
  });

  it('is false for similar names', () => {
    expect(hasKnipConfig(['knip.json.bak', 'myknip.json', 'knip.md', 'src/knip.ts'])).toBe(false);
  });

  it('is true for a "knip" key in package.json', () => {
    const pkg = JSON.stringify({ name: 'x', knip: { entry: ['src/index.ts'] } });
    expect(hasKnipConfig(['package.json'], pkg)).toBe(true);
  });

  it('is true for an empty "knip" object in package.json', () => {
    expect(hasKnipConfig([], '{"knip":{}}')).toBe(true);
  });

  it.each([
    ['no knip key', '{"name":"x","devDependencies":{"knip":"^5.0.0"}}'],
    ['a null knip key', '{"knip":null}'],
    ['invalid JSON', '{not json'],
    ['a JSON array', '[]'],
    ['an empty string', ''],
  ])('is false for a package.json with %s', (_label, pkg) => {
    expect(hasKnipConfig(['package.json'], pkg)).toBe(false);
  });

  it('accepts any iterable of paths', () => {
    expect(hasKnipConfig(new Set(['knip.json']))).toBe(true);
  });
});

describe('hasKnipConfig properties', () => {
  const ordinaryPath = fc.stringMatching(/^[a-z]{1,8}(\/[a-z]{1,8}){0,3}\.(ts|js|json|md)$/);

  it('is false for any tree with no root config file and no knip key', () => {
    fc.assert(
      fc.property(fc.array(ordinaryPath, { maxLength: 30 }), (paths) => {
        return !hasKnipConfig(paths.filter((p) => !KNIP_CONFIG_FILES.includes(p)), '{"name":"x"}');
      }),
    );
  });

  it('is true whenever a root config file is present, among any other paths', () => {
    fc.assert(
      fc.property(
        fc.array(ordinaryPath, { maxLength: 30 }),
        fc.constantFrom(...KNIP_CONFIG_FILES),
        (paths, config) => hasKnipConfig([...paths, config]),
      ),
    );
  });
});
