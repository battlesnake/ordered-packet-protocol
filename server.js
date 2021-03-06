const EventEmitter = require('events').EventEmitter;
const _ = require('lodash');

const ReorderBuffer = require('./reorder-buffer');
const Connection = require('./connection');

module.exports = Server;

Server.prototype = new EventEmitter();

const defaultOpts = { };

/*
 * Methods:
 *  * getActive() - Test if server is active
 *  * start() - Start the server
 *  * stop() - Stop the server
 *  * write(packet) - Write a packet received from the next layer
 *
 * Events:
 *  * pre-accept(connection, data) - A client is establishing a connection
 *  * accept(connection, data) - A client has established a connection
 *  * send(data, connection) - Send a packet to the next layer
 *  * initdata(connection, data) - TODO document
 */

function Server(opts, initdata) {
	EventEmitter.call(this);

	opts = _.defaults({}, opts, defaultOpts);

	const connections = [];

	const { port } = opts;

	if (typeof port !== 'string') {
		throw new Error('Port must be a string');
	}

	let active = false;

	const conGet = cookie => _.find(connections, con => con.getCookie() === cookie);

	const conClosed = cookie => {
		const idx = _.findIndex(connections, con => con.getCookie() === cookie);
		if (idx === -1) {
			return;
		}
		connections.splice(idx, 1);
	};

	const write = packet => {
		if (!packet) {
			return false;
		}
		const data = ReorderBuffer.peek(packet);
		/* Packet must have correct port set */
		if (!data || data.port !== port) {
			return false;
		}
		/* Pass packet to client connection if appropriate */
		if (data.cookie && data.type !== 'syn') {
			const con = conGet(data.cookie);
			return con && con.write(packet);
		}
		/* Server must be active and packet must be SYN and first of sequence */
		if (!active || data.type !== 'syn' || !ReorderBuffer.isFirst(packet)) {
			return false;
		}
		/* Create connection if no connection with that cookie exists */
		const { keepAliveInterval, idleTimeout, cookie } = data;
		if (conGet(cookie)) {
			this.emit('error', 'Duplicate connection key');
			return false;
		}
		const con = new Connection({ cookie, keepAliveInterval, idleTimeout },
			initdata);
		connections.push(con);
		/* TODO: Remove listeners on connection close */
		con.on('close', () => conClosed(cookie));
		con.on('error', err => {
			if (con.getState !== 'open') {
				conClosed(cookie);
			}
		});
		con.on('send', packet => this.emit('send', packet, con));
		con.on('open', data => this.emit('accept', con, data));
		con.on('initdata', data => this.emit('initdata', con, data));
		this.emit('pre-accept', con, data.data.data);
		return con.write(packet);
	};

	const start = () => {
		if (active) {
			return;
		}
		active = true;
		this.emit('start', this);
	};

	const stop = killAll => {
		if (!active) {
			return;
		}
		active = false;
		this.emit('stop', this);
		if (killAll) {
			[...connections].forEach(con => con.close());
		}
	};

	this.getActive = () => active;
	this.start = start;
	this.stop = stop;
	this.write = write;
}
