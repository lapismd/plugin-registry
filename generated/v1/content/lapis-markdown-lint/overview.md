# Markdown Lint

Markdown diagnostics provider

## Install for static composition

```sh
pnpm add @lapis-notes/markdown-lint
```

Register the exported plugin class in the application's `PluginProfile`. Import
`@lapis-notes/markdown-lint/styles.css?inline` and pass the CSS through the static
registration so the host owns its lifecycle.

The runtime plugin ID is `lapis-markdown-lint`. A matching signed
`lapis-markdown-lint-0.1.1.lapis-plugin` archive is attached to the
package-scoped GitHub release for manual or registry installation.

See the [repository README](https://github.com/lapismd/lapis-plugins#readme) for
development, validation, and release-gate details.
