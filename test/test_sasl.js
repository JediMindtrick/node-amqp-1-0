var debug       = require('debug')('amqp10-test_sasl'),
    should      = require('should'),
    builder     = require('buffer-builder'),

    constants   = require('../lib/constants'),

    PolicyBase  = require('../lib/policies/policy_base'),

    MockServer  = require('./mock_amqp'),
    AMQPError   = require('../lib/types/amqp_error'),
    Symbol      = require('../lib/types/symbol'),
    Source      = require('../lib/types/source_target').Source,
    Target      = require('../lib/types/source_target').Target,
    M           = require('../lib/types/message'),

    CloseFrame  = require('../lib/frames/close_frame'),
    FlowFrame   = require('../lib/frames/flow_frame'),
    OpenFrame   = require('../lib/frames/open_frame'),
    SaslFrames  = require('../lib/frames/sasl_frame'),

    Connection  = require('../lib/connection'),
    Session     = require('../lib/session').Session,
    Link        = require('../lib/session').Link,
    Sasl        = require('../lib/sasl'),

    tu          = require('./testing_utils');

PolicyBase.connectPolicy.options.containerId = 'test';

function initBuf() {
    var init = new SaslFrames.SaslInit({
        mechanism: new Symbol('PLAIN'),
        initialResponse: tu.newBuf([0, builder.prototype.appendString, 'user', 0, builder.prototype.appendString, 'pass'])
    });
    return init.outgoing();
}

function mechanismsBuf() {
    var mech = new SaslFrames.SaslMechanisms(['PLAIN']);
    return mech.outgoing();
}

function outcomeBuf() {
    var outcome = new SaslFrames.SaslOutcome({code: constants.saslOutcomes.ok});
    return outcome.outgoing();
}

function openBuf() {
    var open = new OpenFrame(PolicyBase.connectPolicy.options);
    return open.outgoing();
}

function closeBuf(err) {
    var close = new CloseFrame(err);
    return close.outgoing();
}

describe('Sasl', function () {
    var assertTransitions = function (actual, expected) {
        actual.length.should.eql(expected.length - 1, "Wrong number of state transitions: Actual " + JSON.stringify(actual) + " vs. Expected " + JSON.stringify(expected));
        for (var idx = 0; idx < expected.length - 1; ++idx) {
            var curTransition = expected[idx] + '=>' + expected[idx + 1];
            actual[idx].should.eql(curTransition, "Wrong transition at step " + idx);
        }
    };

    describe('Connection.open()', function () {
        var server = null;

        afterEach(function (done) {
            if (server) {
                server.teardown();
                server = null;
            }
            done();
        });

        it('should go through sasl negotiation and then open/close cycle as asked', function (done) {
            server = new MockServer();
            server.setSequence(
                [constants.saslVersion, initBuf(), constants.amqpVersion, openBuf(), closeBuf()],
                [constants.saslVersion, [true, mechanismsBuf()], outcomeBuf(), constants.amqpVersion, openBuf(), [true, closeBuf(new AMQPError(AMQPError.ConnectionForced, 'test'))]]);
            var conn = new Connection(PolicyBase.connectPolicy);
            server.setup(conn);
            var transitions = [];
            var recordTransitions = function (evt, oldS, newS) {
                transitions.push(oldS + '=>' + newS);
            };
            conn.connSM.bind(recordTransitions);
            conn.open({protocol: 'amqp', host: 'localhost', port: server.port, user: 'user', pass: 'pass'}, new Sasl());
            server.assertSequence(function () {
                conn.close();
                assertTransitions(transitions, ['DISCONNECTED', 'START', 'IN_SASL', 'HDR_SENT', 'HDR_EXCH', 'OPEN_SENT', 'OPENED', 'CLOSE_RCVD', 'DISCONNECTED']);
                done();
            });
        });
    });
});
