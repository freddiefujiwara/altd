#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import AccessLogTailDispatcher from './src/altd.js';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const program = new Command();

const buildRegistry = (whitelist) => {
  const registry = {};
  for (const command of whitelist) {
    registry[command] = {
      execPath: command,
      buildArgs: (rawArgs) => rawArgs,
    };
  }
  return registry;
};

program
  .name('altd')
  .version(pkg.version)
  .description(pkg.description)
  .argument('<file>')
  .option(
    '-w, --whitelist <commands>',
    'Add commands to whitelist',
    (commands) => commands.split(',').map((command) => command.trim()).filter(Boolean)
  )
  .parse(process.argv);

const fileValue = program.args[0];
const { whitelist } = program.opts();

if (!fileValue || !whitelist || whitelist.length === 0) {
  console.log('altd <file> -w <commands...>');
  process.exit(1);
}

const registry = buildRegistry(whitelist);

const altd = new AccessLogTailDispatcher(fileValue, registry);
altd.run();
