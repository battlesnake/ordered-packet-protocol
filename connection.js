const EventEmitter = require('events').EventEmitter;
const _ = require('lodash');

const randChars = require('random').chars();

const ReorderBuffer = require('./reorder-buffer');

module.exports = Connection;

Connection.prototype = new EventEmitter();

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
 * Constructor: Connection([opts], [data])
 *  * opts:
 *    * port - a string identifying the service to connect to
 *    * connectTimeout - timeout for connection to complete
 *    * keepAliveInterval - how often to send keep-alive packets
 *    * idleTimeout - close if no packets are received for this interval
 *  * initdata: some initialisation data to send when opening a connection
 *
 * Properties:
 *  * metadata - User-defined metadata for the connection, default: {}
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
 *  * open(initdata) - Connection is now open
 *  * close() - Connection is now closed
 *  * initdata(data) - Received initdata from other side (pre-open)
 */

function Connection(opts, initdata) {
	EventEmitter.call(this);

	opts = _.defaults({}, opts, defaultOpts);

	const { port, connectTimeout, keepAliveInterval, idleTimeout } = opts;

	const isServer = !!opts.cookie;

	/* ~6 bits of entropy per char */
	const cookie = isServer ? opts.cookie : randChars(8);

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
			transmit('syn', { keepAliveInterval, idleTimeout, initdata });
			initdata = null;
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
	const opened = data => {
		if (state !== 'opening') {
			return;
		}
		setState('open');
		clearConnectionTimer();
		resetIdleTimer();
		startKeepAlive();
		this.emit('open', data);
	};

	/* Receive a packet */
	const write = data => {
		if (ReorderBuffer.peek(data).cookie !== cookie || state === 'closed') {
			return false;
		}
		return rob.write(data);
	};

	/* Send some data */
	const send = data => {
		if (state !== 'open') {
			return this.emit('error', 'Attempted to send data while connection is not open');
		}
		transmit('data', data);
	};

	let remote_initdata;

	/* Bind re-order buffer events */
	rob.on('message', data => {
		const type = data.type;
		if (process.env.DEBUG_OPP) {
			console.info(isServer ? 'server' : 'client', cookie, state, type);
		}
		if (state === 'opening') {
			if (isServer) {
				let r_initdata;
				switch (type) {
				case 'syn':
					r_initdata = data.data.initdata;
					/* Store their initdata */
					this.emit('initdata', r_initdata);
					remote_initdata = r_initdata;
					/* Transmit our initdata */
					transmit('synack', { initdata });
					return;
				case 'ack':
					/* Connection open
					 * Clear our copy of the remote initdata when notifying
					 */
					r_initdata = remote_initdata;
					remote_initdata = null;
					return opened(r_initdata);
				}
			} else {
				switch (type) {
				case 'synack':
					const r_initdata = data.data.initdata;
					/* Notify with their initdata */
					this.emit('initdata', r_initdata);
					/* Connection open */
					transmit('ack');
					opened(r_initdata);
					return;
				}
			}
		} else if (state === 'open') {
			resetIdleTimer();
			switch (type) {
			case 'ack': return;
			case 'fin': return close();
			case 'data': return process.nextTick(() => this.emit('message', data.data));
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

	this.metadata = {};

	process.nextTick(open);
}

/* Peek at the data in an encoded packet */
Connection.peek = packet => {
	if (!packet) {
		throw new Error('Not a valid packet');
	}
	const a = ReorderBuffer.peek(packet);
	if (!a) {
		throw new Error('Not a valid packet');
	}
	if (a.type === 'data') {
		return a.data;
	} else {
		return;
	}
};
