var QueueProducer = function (solaceModule, queueName) {
    'use strict';
    var solace = solaceModule;
    var producer = {};
    producer.session = null;
    producer.queueName = queueName;
    // send a lot of messages without stopping
    // when we hit an "OperationError: Guaranteed Message Window Closed" error
    producer.numOfMessages = 100000;
    producer.messageAckRecvd = 0;

    // Logger
    producer.log = function (line) {
        var now = new Date();
        var time = [('0' + now.getHours()).slice(-2), ('0' + now.getMinutes()).slice(-2),
            ('0' + now.getSeconds()).slice(-2)];
        var timestamp = '[' + time.join(':') + '] ';
        console.log(timestamp + line);
    };

    producer.log('\n*** Producer to queue "' + producer.queueName + '" is ready to connect ***');

    // main function
    producer.run = function (argv) {
        producer.connect(argv);
    };

    // Establishes connection to Solace PubSub+ Event Broker
    producer.connect = function (argv) {
        if (producer.session !== null) {
            producer.log('Already connected and ready to publish.');
            return;
        }
        // extract params
        if (argv.length < (2 + 3)) { // expecting 3 real arguments
            producer.log('Cannot connect: expecting all arguments' +
                ' wss://mr-connection-d2212zc110i.messaging.solace.cloud:443 solace-cloud-client@my-first-service 6vk505gohppejcup9b93j69oa6\n' +
                'Available protocols are ws://, wss://, http://, https://, tcp://, tcps://');
            process.exit();
        }
        var hosturl = argv.slice(2)[0];
        producer.log('Connecting to Solace PubSub+ Event Broker using url: ' + hosturl);
        var usernamevpn = argv.slice(3)[0];
        var username = usernamevpn.split('@')[0];
        producer.log('Client username: ' + username);
        var vpn = usernamevpn.split('@')[1];
        producer.log('Solace PubSub+ Event Broker VPN name: ' + vpn);
        var pass = argv.slice(4)[0];
        // create session
        try {
            producer.session = solace.SolclientFactory.createSession({
                // solace.SessionProperties
                url:      hosturl,
                vpnName:  vpn,
                userName: username,
                password: pass,
                publisherProperties: {
                    acknowledgeMode: solace.MessagePublisherAcknowledgeMode.PER_MESSAGE,
                },
            });
        } catch (error) {
            producer.log(error.toString());
        }
        // define session event listeners
        producer.session.on(solace.SessionEventCode.UP_NOTICE, function (sessionEvent) {
            producer.log('=== Successfully connected and ready to send messages. ===');
            producer.sendMessages();
        });
        producer.session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, function (sessionEvent) {
            producer.log('Connection failed to the message router: ' + sessionEvent.infoStr +
                ' - check correct parameter values and connectivity!');
        });
        producer.session.on(solace.SessionEventCode.ACKNOWLEDGED_MESSAGE, function (sessionEvent) {
            producer.log('Delivery of message with correlation key = ' +
                JSON.stringify(sessionEvent.correlationKey) + ' confirmed.');
            producer.messageAckRecvd++;
            if (producer.messageAckRecvd === producer.numOfMessages) {
                producer.exit();
            }
        });
        producer.session.on(solace.SessionEventCode.REJECTED_MESSAGE_ERROR, function (sessionEvent) {
            producer.log('Delivery of message with correlation key = ' +
                JSON.stringify(sessionEvent.correlationKey) + ' rejected, info: ' + sessionEvent.infoStr);
            producer.messageAckRecvd++;
            if (producer.messageAckRecvd === producer.numOfMessages) {
                producer.exit();
            }
        });
        producer.session.on(solace.SessionEventCode.DISCONNECTED, function (sessionEvent) {
            producer.log('Disconnected.');
            if (producer.session !== null) {
                producer.session.dispose();
                producer.session = null;
            }
        });
        // connect the session
        try {
            producer.session.connect();
        } catch (error) {
            producer.log(error.toString());
        }
    };

    // Builds a message
    producer.buildMessage = function (sequenceNr) {
        var messageText = 'Sample Message';
        var message = solace.SolclientFactory.createMessage();
        message.setDestination(solace.SolclientFactory.createDurableQueueDestination(producer.queueName));
        message.setBinaryAttachment(messageText);
        message.setDeliveryMode(solace.MessageDeliveryModeType.PERSISTENT);
        // Define a correlation key object
        const correlationKey = {
            name: "MESSAGE_CORRELATIONKEY",
            id: sequenceNr,
        };
        message.setCorrelationKey(correlationKey);
        return message; // return the message
    };

    // Send many message
    producer.sendMessages = function () {
        if (producer.session !== null) {
            var sentCount = 0;
            const doSend = () => {
                try {
                    producer.log(`Starting send at: ${sentCount}`);
                    while (sentCount < producer.numOfMessages) {
                        var sequenceNr = sentCount + 1;
                        var message = producer.buildMessage(sequenceNr);
                        producer.session.send(message);
                        producer.log('Message #' + sequenceNr + ' sent to queue "' + producer.queueName + '", correlation key = ' + JSON.stringify(message.getCorrelationKey()));
                        ++sentCount;
                    }
                } catch (error) {
                    producer.log(`Aborting send at: ${sentCount}`);
                    producer.log(error.toString());
                    producer.session.once(solace.SessionEventCode.CAN_ACCEPT_DATA, () => {
                        doSend();
                    });
                }
              };
              doSend();
        } else {
            producer.log('Cannot send messages because not connected to Solace PubSub+ Event Broker.');
        }
    }

    // Sends one message - this function is currently not being used anywhere in this example
    // only keeping it here for reference as an example to send a single message
    producer.sendMessage = function (sequenceNr) {
        var message = producer.buildMessage(sequenceNr);
        try {
            producer.session.send(message);
            producer.log('Message #' + sequenceNr + ' sent to queue "' + producer.queueName + '", correlation key = ' + JSON.stringify(message.getCorrelationKey()));
        } catch (error) {
            producer.log(error.toString());
        }
    };

    producer.exit = function () {
        producer.disconnect();
        setTimeout(function () {
            process.exit();
        }, 1000); // wait for 1 second to finish
    };

    // Gracefully disconnects from Solace PubSub+ Event Broker
    producer.disconnect = function () {
        producer.log('Disconnecting from Solace PubSub+ Event Broker...');
        if (producer.session !== null) {
            try {
                producer.session.disconnect();
            } catch (error) {
                producer.log(error.toString());
            }
        } else {
            producer.log('Not connected to Solace PubSub+ Event Broker.');
        }
    };

    return producer;
};

var solace = require('solclientjs').debug; // logging supported

// Initialize factory with the most recent API defaults
var factoryProps = new solace.SolclientFactoryProperties();
factoryProps.profile = solace.SolclientFactoryProfiles.version10;
solace.SolclientFactory.init(factoryProps);

// enable logging to JavaScript console at WARN level
// NOTICE: works only with ('solclientjs').debug
solace.SolclientFactory.setLogLevel(solace.LogLevel.WARN);

// create the producer, specifying the name of the destination queue
var producer = new QueueProducer(solace,  'flight/boarding/fl1234/yow/ewr');

// send message to Solace PubSub+ Event Broker
producer.run(process.argv);