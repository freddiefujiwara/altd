import {spawn} from 'child_process';
import Tail from 'nodejs-tail';
/**
 ** main class of AccessLogTailDispatcher
 */
export default class AccessLogTailDispatcher {
    /**
     * @constructor
     * @param {string} file access_log
     * @param {Array} whitelist ['command1','command2'..]
     */
    constructor(file, whitelist) {
        this.file = file;
        this.whitelist = whitelist;
        this.spawn = undefined;
        this.tail = undefined;
    }
    /**
     * Get the path from 'GET /path/to/dir HTTP'
     * @param {string} line access_log
     * @return {string} /path/to/dir
     */
    path(line) {
        if (!(typeof line === 'string')) {
            return '';
        }
        let match = line.match(
            /GET\s((\/[a-z0-9-._~%!$&'()*+,;=:@?]+)+\/?)\sHTTP/i);
        if (null !== match && match.length > 2) {
            return match[1];
        }
        return '';
    }

    /**
     * Extract command and args
     * @param {string} path
     * @return {Array} [command,arg1,arg2...]
     */
    commandWithArgs(path) {
        if (!(typeof path === 'string')) {
            return [];
        }
        let commands = path.split(/\//).map(function(element, index, array) {
            let ret = "";
            try{
              ret = decodeURIComponent(element);
            }catch(e){
              console.error(e);
            }
            return ret;
        });
        commands.shift();
        return commands;
    }

    /**
     * Filter by whitelist
     * @param {Array} commandWithArgs [command,arg1,arg2...]
     * @param {Array} whitelist ['command1','command2'...]
     * @return {Array} filtered commandWithArgs
     */
    filterByWhitelist(commandWithArgs, whitelist) {
        if (!this.isArray(commandWithArgs) ||
            !this.isArray(whitelist) ||
            commandWithArgs.length == 0 ||
            whitelist.indexOf(commandWithArgs[0]) == -1
        ) {
            return [];
        }
        return commandWithArgs;
    }

    /**
     * Dispatch
     * @param {Array} commandWithArgs [command,arg1,arg2...]
     */
    dispatch(commandWithArgs) {
        if (commandWithArgs.length == 0) {
            return;
        }
        let command = commandWithArgs.shift();
        let proc = this.spawn(command, commandWithArgs);
        proc.on('error', (err) => {
            console.error(err);
        });
        proc.stdout.on('data', (data) => {
            process.stdout.write(data.toString());
        });
    }

    /**
     * isArray
     * @param {object} obj [command,arg1,arg2...]
     * @return {boolean}
     */
    isArray(obj) {
        return Object.prototype.toString.call(obj) === '[object Array]';
    }

    /**
     * run
     * @param {string} file
     * @param {Array} whitelist ['command1','command2'...]
     */
    run(file, whitelist) {
        if ( typeof this.spawn === 'undefined') {
            this.spawn = spawn;
        }
        if ( typeof this.tail === 'undefined') {
            this.tail = new Tail(this.file,
                {alwaysStat: true, ignoreInitial: true, persistent: true});
        }
        this.tail.on('line', (line) => {
            this.dispatch(
                this.filterByWhitelist(
                    this.commandWithArgs(
                        this.path(line)),
                    this.whitelist));
        });
        this.tail.on('close', () => {
            console.log('watching stopped');
        });
        this.tail.watch();
    }
}
