const EventEmitter = require('events').EventEmitter;
const _ = require('lodash');

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
 * 	* accept(connection) - A new connection was receieved
 * 	* send(data) - Send a packet to the next layer
 */

function Server(opts) {
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

	const write = data => {
		/* Packet must have correct port set */
		if (!data || data.port !== port) {
			return;
		}
		/* Pass packet to client connection if appropriate */
		if (data.cookie && data.type !== 'syn') {
			const con = conGet(data.cookie);
			return con && con.write(data);
		}
		/* Server must be active and packet must be SYN */
		if (!active || data.type !== 'syn') {
			return;
		}
		/* Create connection if no connection with that cookie exists */
		const { keepAliveInterval, idleTimeout, cookie } = data;
		if (conGet(cookie)) {
			return;
		}
		const con = new Connection({ cookie, keepAliveInterval, idleTimeout });
		connections.push(con);
		con.on('close', () => conClosed(cookie));
		con.on('error', err => {
			if (con.getState !== 'open') {
				conClosed(cookie);
			}
		});
		con.on('send', packet => this.emit('send', packet));
		this.emit('accept', con);
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
