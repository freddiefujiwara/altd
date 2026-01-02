#!/usr/bin/env node
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, isAbsolute, join } from 'node:path';
import { Command } from 'commander';
import AccessLogTailDispatcher from './src/altd.js';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const program = new Command();

const resolveExecPath = (command) => {
  if (!command || typeof command !== 'string') return null;
  if (isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }

  const searchPaths = (process.env.PATH ?? '').split(delimiter);
  for (const dir of searchPaths) {
    if (!dir) continue;
    const candidate = join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
};

const buildRegistry = (whitelist) => {
  const registry = {};
  for (const command of whitelist) {
    const execPath = resolveExecPath(command);
    if (!execPath) {
      console.warn(`[altd] skip command: ${command}`);
      continue;
    }
    registry[command] = {
      execPath,
      buildArgs: (rawArgs) => {
        if (!Array.isArray(rawArgs) || rawArgs.length > 20) {
          throw new Error('invalid args');
        }
        for (const arg of rawArgs) {
          if (typeof arg !== 'string' || arg.length > 256) {
            throw new Error('invalid args');
          }
        }
        return rawArgs;
      },
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
if (Object.keys(registry).length === 0) {
  console.error('[altd] no valid commands to run');
  process.exit(1);
}

const altd = new AccessLogTailDispatcher(fileValue, registry);
altd.run();
