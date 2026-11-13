#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import AccessLogTailDispatcher from './src/altd.js';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const program = new Command();

const buildRegistry = (whitelist) => {
  // Null-prototype map: command names must never resolve to inherited
  // Object.prototype members such as "__proto__" or "toString".
  const registry = Object.create(null);
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
  .option(
    '--rules <file>',
    'JSON file with per-command argument rules (regular expressions matched against the space-joined arguments)'
  )
  .parse(process.argv);

const fileValue = program.args[0];
const { whitelist, rules } = program.opts();

if (!fileValue || !whitelist || whitelist.length === 0) {
  console.log('altd <file> -w <commands...>');
  process.exit(1);
}

const loadArgRules = (file) => {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`altd: cannot load rules file ${file}: ${err.message}`);
    process.exit(1);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('altd: rules file must be a JSON object keyed by command name');
    process.exit(1);
  }

  const rules = Object.create(null);
  for (const [command, patterns] of Object.entries(parsed)) {
    if (
      !Array.isArray(patterns) ||
      patterns.some((pattern) => typeof pattern !== 'string')
    ) {
      console.error(`altd: rules for "${command}" must be an array of strings`);
      process.exit(1);
    }
    try {
      rules[command] = patterns.map((pattern) => new RegExp(pattern));
    } catch (err) {
      console.error(`altd: invalid regular expression for "${command}": ${err.message}`);
      process.exit(1);
    }
  }
  return rules;
};

const registry = buildRegistry(whitelist);
const argRules = rules ? loadArgRules(rules) : undefined;

const altd = new AccessLogTailDispatcher(fileValue, registry, { argRules });
altd.run();
