const EventEmitter = require('events').EventEmitter;
const _ = require('lodash');

module.exports = Connection;

Connection.prototype = new EventEmitter();

let con_id = 0;

const defaultOpts = {
	connectTimeout: 2000,
	keepAliveInterval: 1000,
	idleTimeout: 10000
};

/*
 * 3-way handshake very loosely based on TCP connection.
 * Regarding TCP though:
 *  * Re-ordering is done by ReorderBuffer.
 *  * Fragmentation and retransmission is not necessary so is not implemented.
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

	const cookie = opts.cookie || randomKey(40);

	if (!cookie && typeof port !== 'string') {
		throw new Error('Port must be a string');
	}

	let state = 'opening';

	let connectTimeoutTimer = null;
	let idleTimeoutTimer = null;
	let keepAliveTimer = null;

	const setState = newState => {
		state = newState;
	};

	/* Timer for establishing connection */
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

	/* No packet received in idle timeout interval */
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
		if (state !== 'closed') {
			this.emit('send', { port, type, cookie, data });
		}
	};

	/* Open the connection */
	const open = mode => {
		setConnectionTimer();
		switch (mode) {
		case 'server': return transmit('ack');
		case 'client': return transmit('syn', { keepAliveInterval, idleTimeout });
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
		transmit('ack');
		clearConnectionTimer();
		resetIdleTimer();
		startKeepAlive();
		this.emit('open');
	};

	/* Receive a packet */
	const write = data => {
		if (data.cookie !== cookie || state === 'closed') {
			return;
		}
		resetIdleTimer();
		if (state === 'opening') {
			switch (data.type) {
			case 'synack': return opened();
			case 'ack': return transmit('synack'), opened();
			}
		} else if (state === 'open') {
			switch (data.type) {
			case 'ack': return;
			case 'fin': return close();
			case 'data': return this.emit('message', data.data);
			}
		}
		console.warn('Unexpected/unknown packet type: ' + data.type);
	};

	const send = data => transmit('data', data);

	process.nextTick(() => open(opts.cookie ? 'server' : 'client'));

	this.getState = () => state;
	this.getCookie = () => cookie;
	this.send = send;
	this.write = write;
	this.close = close;
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
