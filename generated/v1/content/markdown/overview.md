# Markdown

Mira-powered Markdown editing with source, live preview, and reading modes.

## Install for static composition

```sh
pnpm add @lapis-notes/markdown
```

Register the exported plugin class in the application's `PluginProfile`. Import
`@lapis-notes/markdown/styles.css?inline` and pass the CSS through the static
registration so the host owns its lifecycle.

The runtime plugin ID is `markdown`. A matching signed
`markdown-0.1.3.lapis-plugin` archive is attached to the
package-scoped GitHub release for manual or registry installation.

See the [repository README](https://github.com/lapismd/lapis-plugins#readme) for
development, validation, and release-gate details.
