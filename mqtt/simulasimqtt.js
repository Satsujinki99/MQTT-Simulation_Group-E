const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

// ========================
// MQTT CONFIGURATION
// ========================

const MQTT_CONFIG = {
    // Broker Configuration
    broker: {
        host: 'localhost',
        port: 1883,
        securePort: 8883
    },
    
    // Authentication Configuration
    auth: {
        username: 'mqttuser',
        password: 'mqttpass'
    },
    
    // TLS/SSL Configuration for Secure Connection
    tls: {
        ca: fs.readFileSync('/Users/furqonaryadana/mosquitto/certs/ca.crt'),
        cert: fs.readFileSync('/Users/furqonaryadana/mosquitto/certs/client.crt'),
        key: fs.readFileSync('/Users/furqonaryadana/mosquitto/certs/client.key'),
        rejectUnauthorized: true
    }
};

// ========================
// MQTT CLIENT CLASS
// ========================

class MQTTSimulator {
    constructor(clientId, options = {}) {
        this.clientId = clientId;
        this.client = null;
        this.isConnected = false;
        this.messageStats = {
            sent: 0,
            received: 0,
            qos0: 0,
            qos1: 0,
            qos2: 0
        };
        this.performanceStats = {
            startTime: null,
            pingCount: 0,
            pongCount: 0,
            latencies: []
        };
        this.options = {
            secure: options.secure || false,
            qos: options.qos || 0,
            retain: options.retain || false,
            ...options
        };
    }

    // ========================
    // CONNECTION METHODS
    // ========================

    connect() {
        return new Promise((resolve, reject) => {
            console.log(`\n🔌 [${this.clientId}] Connecting to MQTT broker...`);
            
            const connectOptions = {
                clientId: this.clientId,
                clean: true,
                connectTimeout: 4000,
                reconnectPeriod: 1000,
                
                // Authentication
                username: MQTT_CONFIG.auth.username,
                password: MQTT_CONFIG.auth.password,
                
                // Last Will Message
                will: {
                    topic: `status/${this.clientId}`,
                    payload: JSON.stringify({
                        clientId: this.clientId,
                        status: 'offline',
                        timestamp: new Date().toISOString(),
                        reason: 'unexpected_disconnect'
                    }),
                    qos: 1,
                    retain: true
                },

                // Message Properties (MQTT 5.0)
                properties: {
                    sessionExpiryInterval: 300, // 5 minutes
                    requestResponseInformation: 1,
                    requestProblemInformation: 1,
                    maximumPacketSize: 1024 * 1024, // 1MB
                    topicAliasMaximum: 10,
                    receiveMaximum: 100,
                    maximumQoS: 2,
                    retainAvailable: true,
                    wildcardSubscriptionAvailable: true,
                    subscriptionIdentifierAvailable: true,
                    sharedSubscriptionAvailable: true
                }
            };

            // Secure Connection Configuration
            if (this.options.secure) {
                connectOptions.protocol = 'mqtts';
                connectOptions.port = MQTT_CONFIG.broker.securePort;
                connectOptions.rejectUnauthorized = MQTT_CONFIG.tls.rejectUnauthorized;
                if (MQTT_CONFIG.tls.ca) connectOptions.ca = MQTT_CONFIG.tls.ca;
                if (MQTT_CONFIG.tls.cert) connectOptions.cert = MQTT_CONFIG.tls.cert;
                if (MQTT_CONFIG.tls.key) connectOptions.key = MQTT_CONFIG.tls.key;
                console.log(`🔒 [${this.clientId}] Using secure connection (TLS/SSL)`);
            }

            // Create MQTT Client
            const brokerUrl = this.options.secure 
                ? `mqtts://${MQTT_CONFIG.broker.host}:${MQTT_CONFIG.broker.securePort}`
                : `mqtt://${MQTT_CONFIG.broker.host}:${MQTT_CONFIG.broker.port}`;
                
            this.client = mqtt.connect(brokerUrl, connectOptions);
            this.performanceStats.startTime = Date.now();

            // Event Handlers
            this.setupEventHandlers();

            this.client.on('connect', (connack) => {
                this.isConnected = true;
                console.log(`✅ [${this.clientId}] Connected successfully`);
                console.log(`📊 Connection ACK:`, {
                    sessionPresent: connack.sessionPresent,
                    returnCode: connack.returnCode
                });
                
                // Send online status
                this.publishStatus('online');
                resolve(connack);
            });

            this.client.on('error', (error) => {
                console.error(`❌ [${this.clientId}] Connection error:`, error.message);
                reject(error);
            });
        });
    }

    setupEventHandlers() {
        // Message received
        this.client.on('message', (topic, message, packet) => {
            this.handleMessage(topic, message, packet);
        });

        // Ping/Pong for keep-alive
        this.client.on('ping', () => {
            this.performanceStats.pingCount++;
            console.log(`🏓 [${this.clientId}] PING sent`);
        });

        this.client.on('pong', () => {
            this.performanceStats.pongCount++;
            console.log(`🏓 [${this.clientId}] PONG received`);
        });

        // Connection events
        this.client.on('reconnect', () => {
            console.log(`🔄 [${this.clientId}] Reconnecting...`);
        });

        this.client.on('close', () => {
            this.isConnected = false;
            console.log(`🔌 [${this.clientId}] Connection closed`);
        });

        this.client.on('offline', () => {
            this.isConnected = false;
            console.log(`📵 [${this.clientId}] Client offline`);
        });

        // Packet events for flow control
        this.client.on('packetsend', (packet) => {
            this.handlePacketSend(packet);
        });

        this.client.on('packetreceive', (packet) => {
            this.handlePacketReceive(packet);
        });
    }

    // ========================
    // PUBLISH METHODS (QoS 0, 1, 2)
    // ========================

    publish(topic, message, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Client not connected'));
                return;
            }

            const publishOptions = {
                qos: options.qos || this.options.qos || 0,
                retain: options.retain !== undefined ? options.retain : this.options.retain,
                dup: options.dup || false,
                properties: {
                    messageExpiryInterval: options.expiry || 3600, // 1 hour default
                    payloadFormatIndicator: 1, // UTF-8 string
                    contentType: 'application/json',
                    responseTopic: options.responseTopic,
                    correlationData: options.correlationData,
                    userProperties: options.userProperties || {}
                }
            };

            const payload = typeof message === 'object' ? JSON.stringify(message) : message;
            const startTime = Date.now();

            this.client.publish(topic, payload, publishOptions, (error) => {
                const endTime = Date.now();
                const latency = endTime - startTime;
                this.performanceStats.latencies.push(latency);

                if (error) {
                    console.error(`❌ [${this.clientId}] Publish error:`, error.message);
                    reject(error);
                } else {
                    this.messageStats.sent++;
                    this.messageStats[`qos${publishOptions.qos}`]++;
                    
                    console.log(`📤 [${this.clientId}] Published to ${topic}`, {
                        qos: publishOptions.qos,
                        retain: publishOptions.retain,
                        size: payload.length,
                        latency: `${latency}ms`
                    });
                    
                    resolve({ topic, message: payload, options: publishOptions, latency });
                }
            });
        });
    }

    // Convenience methods for different QoS levels
    publishQoS0(topic, message, options = {}) {
        return this.publish(topic, message, { ...options, qos: 0 });
    }

    publishQoS1(topic, message, options = {}) {
        return this.publish(topic, message, { ...options, qos: 1 });
    }

    publishQoS2(topic, message, options = {}) {
        return this.publish(topic, message, { ...options, qos: 2 });
    }

    // Retained message
    publishRetained(topic, message, options = {}) {
        return this.publish(topic, message, { ...options, retain: true });
    }

    // ========================
    // SUBSCRIBE METHODS
    // ========================

    subscribe(topic, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Client not connected'));
                return;
            }

            const subscribeOptions = {
                qos: options.qos || 0,
                nl: options.noLocal || false, // No Local flag
                rap: options.retainAsPublished || false, // Retain as Published
                rh: options.retainHandling || 0, // Retain Handling
                properties: {
                    subscriptionIdentifier: options.subscriptionId,
                    userProperties: options.userProperties || {}
                }
            };

            this.client.subscribe(topic, subscribeOptions, (error, granted) => {
                if (error) {
                    console.error(`❌ [${this.clientId}] Subscribe error:`, error.message);
                    reject(error);
                } else {
                    console.log(`📥 [${this.clientId}] Subscribed to ${topic}`, {
                        qos: granted[0].qos,
                        topic: granted[0].topic
                    });
                    resolve(granted);
                }
            });
        });
    }

    unsubscribe(topic) {
        return new Promise((resolve, reject) => {
            this.client.unsubscribe(topic, (error) => {
                if (error) {
                    console.error(`❌ [${this.clientId}] Unsubscribe error:`, error.message);
                    reject(error);
                } else {
                    console.log(`📥 [${this.clientId}] Unsubscribed from ${topic}`);
                    resolve();
                }
            });
        });
    }

    // ========================
    // MESSAGE HANDLING
    // ========================

    handleMessage(topic, message, packet) {
        this.messageStats.received++;
        this.messageStats[`qos${packet.qos}`]++;

        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message.toString());
        } catch (e) {
            parsedMessage = message.toString();
        }

        console.log(`📨 [${this.clientId}] Received message:`, {
            topic,
            qos: packet.qos,
            retain: packet.retain,
            dup: packet.dup,
            size: message.length,
            messageId: packet.messageId
        });

        // Handle Request-Response pattern
        if (packet.properties && packet.properties.responseTopic) {
            this.handleRequestResponse(packet.properties.responseTopic, packet.properties.correlationData, parsedMessage);
        }

        // Emit custom event for application handling
        this.emit('message', {
            topic,
            message: parsedMessage,
            packet,
            timestamp: new Date().toISOString()
        });
    }

    // ========================
    // REQUEST-RESPONSE PATTERN
    // ========================

    request(requestTopic, message, responseTopic, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const correlationId = this.generateCorrelationId();
            const timeoutId = setTimeout(() => {
                reject(new Error('Request timeout'));
            }, timeout);

            // Subscribe to response topic
            this.subscribe(responseTopic).then(() => {
                // Set up one-time response handler
                const responseHandler = (data) => {
                    if (data.packet.properties && 
                        data.packet.properties.correlationData && 
                        data.packet.properties.correlationData.toString() === correlationId) {
                        clearTimeout(timeoutId);
                        this.off('message', responseHandler);
                        resolve(data);
                    }
                };

                this.on('message', responseHandler);

                // Send request
                this.publish(requestTopic, message, {
                    responseTopic,
                    correlationData: Buffer.from(correlationId)
                }).catch(reject);
            }).catch(reject);
        });
    }

    handleRequestResponse(responseTopic, correlationData, message) {
        // Simulate processing and send response
        const response = {
            status: 'success',
            data: message,
            processedAt: new Date().toISOString(),
            correlationId: correlationData ? correlationData.toString() : null
        };

        this.publish(responseTopic, response, {
            correlationData
        });
    }

    // ========================
    // FLOW CONTROL
    // ========================

    handlePacketSend(packet) {
        if (packet.cmd === 'publish' && packet.qos > 0) {
            console.log(`🚀 [${this.clientId}] Packet sent:`, {
                type: packet.cmd,
                messageId: packet.messageId,
                qos: packet.qos,
                topic: packet.topic
            });
        }
    }

    handlePacketReceive(packet) {
        if (packet.cmd === 'puback' || packet.cmd === 'pubrec' || packet.cmd === 'pubcomp') {
            console.log(`📨 [${this.clientId}] Packet received:`, {
                type: packet.cmd,
                messageId: packet.messageId
            });
        }
    }

    // ========================
    // STATUS AND UTILITIES
    // ========================

    publishStatus(status) {
        const statusMessage = {
            clientId: this.clientId,
            status,
            timestamp: new Date().toISOString(),
            uptime: this.performanceStats.startTime ? Date.now() - this.performanceStats.startTime : 0
        };

        this.publishRetained(`status/${this.clientId}`, statusMessage, { qos: 1 });
    }

    getPerformanceStats() {
        const avgLatency = this.performanceStats.latencies.length > 0
            ? this.performanceStats.latencies.reduce((a, b) => a + b, 0) / this.performanceStats.latencies.length
            : 0;

        return {
            ...this.performanceStats,
            ...this.messageStats,
            averageLatency: Math.round(avgLatency * 100) / 100,
            uptime: this.performanceStats.startTime ? Date.now() - this.performanceStats.startTime : 0,
            isConnected: this.isConnected
        };
    }

    generateCorrelationId() {
        return `${this.clientId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Event emitter methods
    on(event, callback) {
        if (!this._events) this._events = {};
        if (!this._events[event]) this._events[event] = [];
        this._events[event].push(callback);
    }

    off(event, callback) {
        if (!this._events || !this._events[event]) return;
        this._events[event] = this._events[event].filter(cb => cb !== callback);
    }

    emit(event, data) {
        if (!this._events || !this._events[event]) return;
        this._events[event].forEach(callback => callback(data));
    }

    // ========================
    // DISCONNECT
    // ========================

    disconnect() {
        if (this.isConnected) {
            console.log(`🔌 [${this.clientId}] Disconnecting...`);
            this.publishStatus('offline');
            this.client.end();
        }
    }
}

// ========================
// DEMO FUNCTIONS
// ========================

async function demonstrateAllFeatures() {
    console.log('🚀 Starting MQTT Feature Demonstration\n');

    // Create multiple clients
    const publisher = new MQTTSimulator('publisher-01', { secure: true, qos: 1 });
    const subscriber1 = new MQTTSimulator('subscriber-01', { secure: true });
    const subscriber2 = new MQTTSimulator('subscriber-02', { secure: true });    

    try {
        // Connect all clients
        await Promise.all([
            publisher.connect(),
            subscriber1.connect(),
            subscriber2.connect()
        ]);

        console.log('\n📡 Setting up subscriptions...');
        
        // Subscribe to various topics
        await subscriber1.subscribe('sensors/+/temperature', { qos: 1 });
        await subscriber1.subscribe('alerts/#', { qos: 2 });
        await subscriber2.subscribe('status/+', { qos: 0 });

        // Add message handlers
        subscriber1.on('message', (data) => {
            console.log(`🎯 [${subscriber1.clientId}] Handled:`, data.topic);
        });

        subscriber2.on('message', (data) => {
            console.log(`🎯 [${subscriber2.clientId}] Handled:`, data.topic);
        });

        console.log('\n📤 Testing different QoS levels...');

        // Test QoS 0 (Fire and forget)
        await publisher.publishQoS0('sensors/room1/temperature', {
            value: 23.5,
            unit: 'celsius',
            timestamp: new Date().toISOString()
        });

        // Test QoS 1 (At least once)
        await publisher.publishQoS1('sensors/room2/temperature', {
            value: 24.1,
            unit: 'celsius',
            timestamp: new Date().toISOString()
        });

        // Test QoS 2 (Exactly once)
        await publisher.publishQoS2('alerts/fire/building1', {
            level: 'critical',
            message: 'Fire detected in building 1',
            timestamp: new Date().toISOString()
        });

        console.log('\n💾 Testing retained messages...');

        // Test retained message
        await publisher.publishRetained('config/system', {
            version: '1.0.0',
            lastUpdate: new Date().toISOString(),
            features: ['qos', 'retain', 'lwt', 'auth']
        }, { qos: 1 });

        console.log('\n🔄 Testing Request-Response pattern...');

        // Test Request-Response
        try {
            const response = await publisher.request(
                'api/weather/current',
                { city: 'Jakarta' },
                'api/weather/response',
                3000
            );
            console.log('📨 Response received:', response.message);
        } catch (error) {
            console.log('⏰ Request timeout or error:', error.message);
        }

        console.log('\n⏱️ Testing message expiry...');

        // Test message with expiry
        await publisher.publish('temp/data', {
            value: 25.0,
            expires: 'in 30 seconds'
        }, {
            qos: 1,
            expiry: 30 // 30 seconds
        });

        console.log('\n🏓 Testing Ping-Pong (keep-alive)...');
        
        // Wait for some ping-pong activity
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('\n📊 Performance Statistics:');
        console.log('Publisher Stats:', publisher.getPerformanceStats());
        console.log('Subscriber1 Stats:', subscriber1.getPerformanceStats());
        console.log('Subscriber2 Stats:', subscriber2.getPerformanceStats());

        console.log('\n✅ All features demonstrated successfully!');

    } catch (error) {
        console.error('❌ Demo error:', error.message);
    } finally {
        console.log('\n🔌 Cleaning up connections...');
        
        // Disconnect all clients (will trigger Last Will messages)
        setTimeout(() => {
            publisher.disconnect();
            subscriber1.disconnect();
            subscriber2.disconnect();
        }, 1000);
    }
}

// ========================
// USAGE EXAMPLES
// ========================

async function runBasicExample() {
    console.log('📘 Basic MQTT Example\n');
    
    const client = new MQTTSimulator('basic-client');
    
    try {
        await client.connect();
        
        // Subscribe to topic
        await client.subscribe('test/topic');
        
        // Publish message
        await client.publish('test/topic', {
            message: 'Hello MQTT!',
            timestamp: new Date().toISOString()
        });
        
        // Wait a bit then disconnect
        setTimeout(() => client.disconnect(), 2000);
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

async function runSecureExample() {
    console.log('🔒 Secure MQTT Example\n');
    
    const secureClient = new MQTTSimulator('secure-client', { 
        secure: true,
        qos: 1 
    });
    
    try {
        await secureClient.connect();
        console.log('✅ Secure connection established');
        
        setTimeout(() => secureClient.disconnect(), 1000);
        
    } catch (error) {
        console.error('Secure connection failed:', error.message);
        console.log('💡 Note: Secure connection requires proper broker setup');
    }
}

// ========================
// MAIN EXECUTION
// ========================

if (require.main === module) {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    MQTT Feature Simulator                      ║
║                                                                ║
║ Features Included:                                             ║
║ ✅ MQTT Connection (Regular & Secure)                          ║
║ ✅ Authentication (Username/Password)                          ║
║ ✅ QoS Levels (0, 1, 2)                                       ║
║ ✅ Retained Messages                                           ║
║ ✅ Last Will Testament                                         ║
║ ✅ Message Expiry                                              ║
║ ✅ Request-Response Pattern                                    ║
║ ✅ Flow Control                                                ║
║ ✅ Ping-Pong Keep-alive                                       ║
║ ✅ Performance Monitoring                                      ║
╚════════════════════════════════════════════════════════════════╝
    `);

    // Run demonstration
    demonstrateAllFeatures().then(() => {
        console.log('\n🎉 MQTT simulation completed!');
        process.exit(0);
    }).catch((error) => {
        console.error('\n❌ Simulation failed:', error.message);
        process.exit(1);
    });
}

// Export for use as module
module.exports = {
    MQTTSimulator,
    MQTT_CONFIG,
    demonstrateAllFeatures,
    runBasicExample,
    runSecureExample
};