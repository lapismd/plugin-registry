# Source Editor

Source editing for text, JSON, and YAML files

## Install for static composition

```sh
pnpm add @lapis-notes/source-editor
```

Register the exported plugin class in the application's `PluginProfile`. Import
`@lapis-notes/source-editor/styles.css?inline` and pass the CSS through the static
registration so the host owns its lifecycle.

The runtime plugin ID is `lapis-source-editor`. A matching signed
`lapis-source-editor-0.1.1.lapis-plugin` archive is attached to the
package-scoped GitHub release for manual or registry installation.

See the [repository README](https://github.com/lapismd/lapis-plugins#readme) for
development, validation, and release-gate details.
