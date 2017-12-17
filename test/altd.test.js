/* eslint require-jsdoc: 0 */
import chai from 'chai';
chai.should();
import AccessLogTailDispatcher from '../src/altd';
describe('AccessLogTailDispatcher test.', (suite) => {
    it('should have properties ', () => {
        const altd = new AccessLogTailDispatcher(
            '/path/to/dir', ['command1', 'command2']);
        altd.should.be.a('object');
        altd.should.have.property('file')
            .with.a('string').with.equal('/path/to/dir');
        altd.should.have.property('whitelist')
            .with.a('Array').with.deep.equal(['command1', 'command2']);
        altd.should.have.property('spawn').with.equal(undefined);
        altd.should.have.property('tail').with.equal(undefined);
    });
    it('get path from a line ', () => {
        const altd =
            new AccessLogTailDispatcher(
                '/path/to/dir', ['command1', 'command2']);
        altd.should.have.property('path').with.a('function');
        altd.path({})
            .should.equal('');
        altd.path('')
            .should.equal('');
        altd.path(`133.237.7.76 - - `+
            `[16/Dec/2017:12:47:44 +0900] `+
            `"GET `+
            `/google-home-notifier/Hello%20World `+
            `HTTP/1.1" 404 580 "`+
            `-" "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36`+
            ` (KHTML, like Gecko) Chrome/63.0.3239.84 Safari/537.36"`)
            .should.equal('/google-home-notifier/Hello%20World');
    });
    it('get command with args from a path ', () => {
        const altd =
            new AccessLogTailDispatcher(
                '/path/to/dir', ['command1', 'command2']);
        altd.should.have.property('commandWithArgs').with.a('function');
        altd.commandWithArgs(undefined)
            .should.deep.equal([]);
        altd.commandWithArgs(
            '/google-home-notifier/Hello%20World')
            .should.deep.equal(
                ['google-home-notifier', 'Hello World']);
    });
    it('filter command with args with whitelist ', () => {
        const altd =
            new AccessLogTailDispatcher(
                '/path/to/dir', ['command1', 'command2']);
        altd.should.have.property('filterByWhitelist').with.a('function');
        altd.filterByWhitelist(undefined, undefined)
            .should.deep.equal([]);
        altd.filterByWhitelist(['command1', 'arg1', 'arg2'], undefined)
            .should.deep.equal([]);
        altd.filterByWhitelist(undefined, ['command1', 'command2'])
            .should.deep.equal([]);
        altd.filterByWhitelist(['command1', 'arg1', 'arg2']
            , ['command3', 'command4'])
            .should.deep.equal([]);
        altd.filterByWhitelist(['command1', 'arg1', 'arg2']
            , ['command1', 'command2'])
            .should.deep.equal(['command1', 'arg1', 'arg2']);
    });
    it('detect array properly ', () => {
        const altd =
            new AccessLogTailDispatcher(
                '/path/to/dir', ['command1', 'command2']);
        altd.should.have.property('isArray').with.a('function');
        altd.isArray(undefined)
            .should.equal(false);
        altd.isArray({})
            .should.equal(false);
        altd.isArray(1)
            .should.equal(false);
        altd.isArray('1')
            .should.equal(false);
        altd.isArray(['command1', 'arg1', 'arg2'])
            .should.equal(true);
    });
    it('dispatch properly', () => {
        const altd =
            new AccessLogTailDispatcher(
                '/path/to/dir', ['command1', 'command2']);
        altd.should.have.property('dispatch').with.a('function');
        altd.spawn = spawnDummy;
        altd.dispatch(['command', 'arg1', 'arg2']);
    });
});

function spawnDummy(command, args) {
    return {
        on: (str, func) => {
        },
        stdout: {
            on: (str, func) => {
            },
        },
    };
}
