#!/usr/bin/env node
import { generateRegistryKey, defaultLapisKeyDir } from "./lib/keys.mjs";

function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const parsed = {
    dir: defaultLapisKeyDir(),
    keyId: "",
    force: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      index += 1;
      if (index >= args.length) throw new Error(`Missing value for ${arg}`);
      return args[index];
    };
    switch (arg) {
      case "--dir":
        parsed.dir = next();
        break;
      case "--key-id":
        parsed.keyId = next();
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: pnpm registry:keygen -- [options]

Generate a persistent Ed25519 signing key for official registry metadata.

Options:
  --dir <dir>       Output directory. Defaults to ~/.lapis.
  --key-id <id>     Signing key id. Defaults to lapis-registry-YYYY-MM.
  --force           Replace existing registry key files in the output directory.
  --help, -h        Show this help.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const generated = await generateRegistryKey({
    dir: options.dir,
    keyId: options.keyId || undefined,
    force: options.force,
  });
  console.log(
    JSON.stringify(
      {
        keyId: generated.keyId,
        privateKeyFile: generated.privateKeyFile,
        publicKeyFile: generated.publicKeyFile,
        publicKeyRawFile: generated.publicKeyRawFile,
        metadataFile: generated.metadataFile,
        publicKey: generated.publicKeyRaw,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
