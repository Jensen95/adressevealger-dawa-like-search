// Config for @custom-elements-manifest/analyzer. Generates custom-elements.json
// (the `customElements` field in package.json points at it) from the Lit
// component sources so tooling and IDEs get element/attribute/event metadata.
export default {
  globs: ['src/components/**/*.ts'],
  exclude: ['src/**/*.test.ts'],
  outdir: '.',
  litelement: true,
}
