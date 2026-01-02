[![npm version](https://badge.fury.io/js/altd.svg)](https://badge.fury.io/js/altd)

# altd
Web server access log tail dispatcher for running whitelisted commands based on GET requests.

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
- `-w, --whitelist <commands>` comma-separated list of allowed commands

## Example

```bash
altd /var/log/nginx/access_log -w ls,hostname
```

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/freddiefujiwara/altd
