const EventEmitter = require('events').EventEmitter;
const _ = require('lodash');

const ReorderBuffer = require('./reorder-buffer');

module.exports = Connection;

Connection.prototype = new EventEmitter();

let con_id = 0;

const defaultOpts = {
	connectTimeout: 10000,
	keepAliveInterval: 5000,
	idleTimeout: 15000
};

/*
 * Uses ReorderBuffer to recover original order of packets.
 *
 * Implements 3-way handshake very loosely based on TCP connection.
 *
 * Intentionally does not handle packet-loss or duplicates.
 *
 * Regarding TCP though:
 *  * Re-ordering is done by ReorderBuffer.
 *  * Fragmentation and retransmission is not necessary so is not implemented.
 *
 * Constructor: Connection([opts])
 *  * opts:
 *    * port - a string identifying the service to connect to
 *    * connectTimeout - timeout for connection to complete
 *    * keepAliveInterval - how often to send keep-alive packets
 *    * idleTimeout - close if no packets are received for this interval
 *
 * Methods:
 *  * getState() - Get state of connection (opening/open/closed/failed)
 *  * getCookie() - Get connection cookie
 *  * send(data) - Send data through connection to next layer
 *  * write(packet) - Write received packet received from next layer
 *
 * Events:
 *  * send(packet) - Transmit a packet to the next layer
 *  * message(data) - Receive data from connection
 *  * open() - Connection is now open
 *  * close() - Connection is now closed
 */

function Connection(opts) {
	EventEmitter.call(this);

	const id = ++con_id;

	opts = _.defaults({}, opts, defaultOpts);

	const { port, connectTimeout, keepAliveInterval, idleTimeout } = opts;

	const isServer = !!opts.cookie;

	const cookie = isServer ? opts.cookie : randomKey(40);

	if (!cookie && typeof port !== 'string') {
		throw new Error('Port must be a string');
	}

	let state = 'opening';

	let connectTimeoutTimer = null;
	let idleTimeoutTimer = null;
	let keepAliveTimer = null;

	/* Buffer for re-ordering received packets and sequencing sent packets */
	const rob = new ReorderBuffer();

	/* Use this when changing connection state (so we can debug state changes easily */
	const setState = newState => state = newState;

	/* Connection timeout */

	const connectTimedOut = () => {
		if (state !== 'opening') {
			return;
		}
		setState('failed');
		const err = new Error('Connection timeout');
		this.emit('error', err);
	};

	const clearConnectionTimer = () => clearTimeout(connectTimeoutTimer);

	const setConnectionTimer = () => {
		clearConnectionTimer();
		connectTimeoutTimer = setTimeout(connectTimedOut, connectTimeout);
	};

	/* Idle timeout */

	const idleTimedOut = () => {
		if (state !== 'open') {
			return;
		}
		close();
		const err = new Error('Session timeout');
		this.emit('error', err);
	};

	const clearIdleTimer = () => clearTimeout(idleTimeoutTimer);

	const resetIdleTimer = () => {
		clearIdleTimer();
		if (state === 'open') {
			idleTimeoutTimer = setTimeout(idleTimedOut, idleTimeout);
		}
	};

	/* Keep-alive */
	const stopKeepAlive = () => clearInterval(keepAliveTimer);

	const startKeepAlive = () => {
		stopKeepAlive();
		keepAliveTimer = setInterval(() => transmit('ack'), keepAliveInterval);
	};

	/* Send a packet */
	const transmit = (type, data) => {
		if (state === 'closed') {
			return;
		}
		rob.send({ port, type, cookie, data });
	};

	/* Open the connection */
	const open = () => {
		setConnectionTimer();
		if (!isServer) {
			transmit('syn', { keepAliveInterval, idleTimeout });
		}
	};

	/* Close the connection */
	const close = () => {
		if (state === 'closed') {
			return;
		}
		transmit('fin');
		setState('closed');
		clearConnectionTimer();
		clearIdleTimer();
		stopKeepAlive();
		this.emit('close');
	};

	/* Called when connection has been established */
	const opened = () => {
		if (state !== 'opening') {
			return;
		}
		setState('open');
		clearConnectionTimer();
		resetIdleTimer();
		startKeepAlive();
		this.emit('open');
	};

	/* Receive a packet */
	const write = data => {
		if (ReorderBuffer.peek(data).cookie !== cookie || state === 'closed') {
			return;
		}
		rob.write(data);
	};

	/* Send some data */
	const send = data => {
		if (state !== 'open') {
			return this.emit('error', 'Attempted to send data while connection is not open');
		}
		transmit('data', data);
	};

	/* Bind re-order buffer events */
	rob.on('message', data => {
		const type = data.type;
		if (state === 'opening') {
			if (isServer) {
				switch (type) {
				case 'syn': return transmit('synack');
				case 'ack': return opened();
				}
			} else {
				switch (type) {
				case 'synack': return transmit('ack'), opened();
				}
			}
		} else if (state === 'open') {
			resetIdleTimer();
			switch (type) {
			case 'ack': return;
			case 'fin': return close();
			case 'data': return this.emit('message', data.data);
			}
		}
		console.warn('Unexpected/unknown packet type: ' + data.type);
	});

	rob.on('send', data => {
		this.emit('send', data);
	});

	rob.on('error', err => {
		close();
		this.emit('error', err);
	});

	this.getState = () => state;
	this.getCookie = () => cookie;
	this.send = send;
	this.write = write;
	this.close = close;

	process.nextTick(open);
}

/* Helper functions for cookie generation */

function randomByte() {
	return Math.floor(Math.random() * 256);
}

function byteToHex(b) {
	const hex = '0123456789abcdef';
	return hex[b >> 4 & 0xf] + hex[b & 0xf];
}

function randomKey(bytes) {
	let s = '';
	for (let i = 0; i < bytes; i++) {
		s += byteToHex(randomByte());
	}
	return s;
}
