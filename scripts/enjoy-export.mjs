#!/usr/bin/env node
// Local export of Enjoy desktop videos into a package zip for the admin catalog import.
// Reads a temporary copy of the desktop database only; no network, no login data.
// See scripts/CLAUDE.md and docs/superpowers/plans/2026-10-27-library-local-export-cloud-import.md.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`需要 Node.js 22.13 或更高版本(当前 ${process.versions.node}),因为使用内置的 node:sqlite。`);
  process.exit(2);
}

const { main } = await import('./enjoy-export/cli.mjs');
process.exitCode = await main(process.argv.slice(2));
