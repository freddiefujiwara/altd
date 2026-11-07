[![npm version](https://badge.fury.io/js/altd.svg)](https://badge.fury.io/js/altd)

# altd
Web server access log tail dispatcher for running whitelisted commands based on GET requests.

This tool runs the command names you whitelist exactly as provided. There is no PATH
resolution, rate limiting, or output limiting built in. Argument validation is
available as an opt-in strict mode through `--rules` (see below); without it,
arguments are passed through unchecked. Treat the access log source as trusted input.

## Requirements

- Node.js 18 or later

## Installation

```bash
npm i -g altd
```

## Build

```bash
npm run build
```

## Usage

```bash
altd <access_log.file> -w [commands]
```

### Options

- `-V, --version` output the version number
- `-h, --help` output usage information
- `-w, --whitelist <commands>` comma-separated list of allowed commands (executed directly)
- `--rules <file>` JSON file with per-command argument rules (see Argument rules)

## Example

```bash
altd /var/log/nginx/access_log -w ls,hostname
```

Log lines are expected to include a request line like:

```
GET /hostname HTTP/1.1
```

This would execute `hostname` with no arguments. Additional path segments are passed as
arguments, for example:

```
GET /ls/-la HTTP/1.1
```

Would execute: `ls -la`.

## Argument rules

With `--rules`, whitelisting becomes strict: a command runs only when its
arguments also match one of the regular expressions listed for it in a JSON
rules file.

```bash
altd /var/log/nginx/access_log -w ls,hostname --rules ./rules.json
```

```json
{
  "ls": ["^-la$", "^-l /var/log$"],
  "hostname": ["^$"]
}
```

The patterns are tested against the decoded arguments joined with single
spaces (`ls -la` above is tested as `-la`; a command with no arguments is
tested as the empty string). Patterns carry their own anchors, so write
`^...$` for a full match.

In this mode:

- A whitelisted command with no entry in the rules file never runs.
- A request that is not executed — an unknown command or arguments that
  match no rule — is logged to stderr, for example:
  `[altd] blocked (no matching rule): ls -rf /`
- If the rules file cannot be read, is not valid JSON, or contains an
  invalid pattern, altd exits at startup instead of running unguarded.

Without `--rules`, the behavior is unchanged: only command names are
checked and skipped requests are not logged.

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/freddiefujiwara/altd
