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

run(fileValue,program.whitelist);

function path(line){
    let match = line.match(/GET\s((\/[a-z0-9-._~%!$&'()*+,;=:@?]+)+\/?)\sHTTP/i);
    if(null !== match && match.length > 2){
        return match[1];
    }
    return '';
}

function commandWithArgs(path){
    if(!(typeof path === 'string')){
        return [];
    }
    let commands = path.split(/\//).map(function(element, index, array) { 
        return decodeURIComponent(element); 
    });
    commands.shift();
    return commands;
}

function filterByWhiteList(commandWithArgs,whitelist){
    if(!isArray(commandWithArgs) ||
        !isArray(whitelist) ||
        commandWithArgs.length == 0 || 
        whitelist.indexOf(commandWithArgs[0]) == -1
    ){
        return [];
    }
    return commandWithArgs;
}

function dispatch(commandWithArgs){
    if(commandWithArgs.length == 0){
        return;
    }
    let command = commandWithArgs.shift();
    var spawn = require('child_process').spawn;
    let proc = spawn(command,commandWithArgs);
    proc.on('error', (err) => { console.error(err); });
    proc.stdout.on('data', (data) => { process.stdout.write(data.toString()); });
}

function isArray(obj) { return Object.prototype.toString.call(obj) === '[object Array]'; }

function run(file,whitelist){
    const Tail = require('nodejs-tail');
    const tail = new Tail(file,{ alwaysStat: true, ignoreInitial: true, persistent: true, });
    tail.on('line', (line) => { 
        dispatch(filterByWhiteList(commandWithArgs(path(line)),whitelist));
    }); 
    tail.on('close', () => { console.log('watching stopped'); }) ;
    tail.watch();
}
