#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import AccessLogTailDispatcher from './src/altd.js';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const program = new Command();

program
  .name('altd')
  .version(pkg.version)
  .description(pkg.description)
  .argument('<file>')
  .option(
    '-w, --whitelist <commands>',
    'Add commands to whitelist',
    (commands) => commands.split(',')
  )
  .parse(process.argv);

const fileValue = program.args[0];
const { whitelist } = program.opts();

if (!fileValue || !whitelist) {
  console.log('altd <file> -w <commands...>');
  process.exit(1);
}

const altd = new AccessLogTailDispatcher(fileValue, whitelist);
altd.run();
