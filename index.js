#!/usr/bin/env node
let program = require('commander');
let pkg = require('./package');
let fileValue = undefined;
let whitelist = undefined;

program
    .version(pkg.version)
    .description(pkg.description)
    .arguments('<file>')
    .option('-w, --whitelist <commands>', 'Add commands to whitelist', (commands)=>commands.split(','))
    .action(function(file){
        fileValue = file;
    });
program.parse(process.argv);
if(typeof fileValue === 'undefined' || 
    typeof program.whitelist === 'undefined'){
    console.log('altd <file> -w <commands...>');
    process.exit(1);
}
let AccessLogTailDispatcher = require('./lib/altd');

let altd = new AccessLogTailDispatcher(fileValue,program.whitelist);
altd.run();
