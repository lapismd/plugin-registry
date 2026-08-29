# Spell Check

Harper grammar and spelling diagnostics for open notes

## Install for static composition

```sh
pnpm add @lapis-notes/spellcheck
```

Register the exported plugin class in the application's `PluginProfile`. Import
`@lapis-notes/spellcheck/styles.css?inline` and pass the CSS through the static
registration so the host owns its lifecycle.

The runtime plugin ID is `spellcheck`. A matching signed
`spellcheck-0.1.1.lapis-plugin` archive is attached to the
package-scoped GitHub release for manual or registry installation.

See the [repository README](https://github.com/lapismd/lapis-plugins#readme) for
development, validation, and release-gate details.
