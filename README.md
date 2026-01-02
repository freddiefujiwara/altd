[![npm version](https://badge.fury.io/js/altd.svg)](https://badge.fury.io/js/altd)

# altd
Web server access log tail dispatcher for running whitelisted commands based on GET requests.

This tool runs the command names you whitelist exactly as provided. There is no PATH
resolution, argument validation, rate limiting, or output limiting built in. Treat the
access log source as trusted input.

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

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/freddiefujiwara/altd
