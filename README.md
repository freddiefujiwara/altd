[![Build Status](https://travis-ci.org/freddiefujiwara/altd.svg?branch=master)](https://travis-ci.org/freddiefujiwara/altd)
[![Build status](https://ci.appveyor.com/api/projects/status/f6wch68buqp93hc7/branch/master?svg=true)](https://ci.appveyor.com/project/freddiefujiwara/altd/branch/master)
[![CircleCI](https://circleci.com/gh/freddiefujiwara/altd.svg?style=svg)](https://circleci.com/gh/freddiefujiwara/altd)
[![npm version](https://badge.fury.io/js/altd.svg)](https://badge.fury.io/js/altd)
[![codecov](https://codecov.io/gh/freddiefujiwara/altd/branch/master/graph/badge.svg)](https://codecov.io/gh/freddiefujiwara/altd)
[![dependencies Status](https://david-dm.org/freddiefujiwara/altd/status.svg)](https://david-dm.org/freddiefujiwara/altd)

# altd
Web Server(like nginx..) Access log tail dispatcher

## Requirements

 - Node 7.6 or later

## Installation

```bash
npm i -g altd
```

## Usage
```bash                                                                                     
  Usage: altd <access_log.file> -w [commands]
                                                                                                                               
                                                                                                                               
  Options:                                                                                                                     
                                                                                                                               
    -V, --version     output the version number
    -h, --help        output usage information  
```

## Example
```bash
altd /var/log/nginx/access_log -w ls,hostname
```

## FAQ

[FAQ](https://github.com/freddiefujiwara/altd/wiki/FAQ)

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/freddiefujiwara/altd
