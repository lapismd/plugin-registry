# History

File history

## Install for static composition

```sh
pnpm add @lapis-notes/history
```

Register the exported plugin class in the application's `PluginProfile`. Import
`@lapis-notes/history/styles.css?inline` and pass the CSS through the static
registration so the host owns its lifecycle.

The runtime plugin ID is `history`. A matching signed
`history-0.1.2.lapis-plugin` archive is attached to the
package-scoped GitHub release for manual or registry installation.

See the [repository README](https://github.com/lapismd/lapis-plugins#readme) for
development, validation, and release-gate details.
