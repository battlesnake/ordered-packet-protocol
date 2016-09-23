const EventEmitter = require('events').EventEmitter;
const _ = require('lodash');

module.exports = ReorderBuffer;

ReorderBuffer.prototype = new EventEmitter();

/*
 * Methods:
 *  * send(data): Send some data
 *  * write(packet): Write a sequenced packet received from the next layer to the buffer
 *
 * Events:
 *  * send(packet): Transmit a sequenced packet to the next layer
 *  * message(data): Receive in-order data
 *  * error(error): Error occurred
 */

function ReorderBuffer(opts) {
	EventEmitter.call(this);

	opts = _.assign({ maxPending: 20, seq_wrap: 0x10000 }, opts);

	const { maxPending, seq_wrap } = opts;

	/* Sequence number of next TX packet */
	let tx_seq = 0;

	/* Expected sequence number of next RX packet */
	let rx_seq = 0;

	/* Re-order buffer */
	const rob = [];
	let pending = 0;

	const seq_next = seq => (seq + 1) % seq_wrap;

	const seq_notBefore = (base, value) => {
		if (value < base) {
			value += seq_wrap;
		}
		return value - base >= seq_wrap / 2;
	};

	/* Adds sequence number to packet and transmits */
	const send = data => {
		if (data === undefined) {
			throw new Error('Data cannot be "undefined"');
		}
		const seq = tx_seq;
		tx_seq = seq_next(tx_seq);
		this.emit('send', { seq, data });
	};

	/* Write packet into the re-order buffer */
	const write = wrapped => {
		const seq = wrapped.seq;
		if (typeof seq !== 'number') {
			return;
		}
		if (seq_notBefore(rx_seq, seq)) {
			/* Discard, is probably a duplicate of an old packet */
			return;
		}
		rob[seq] = wrapped.data;
		pending++;
		if (pending >= maxPending) {
			rob.length = 0;
			if (this.debug) {
				console.error('ROB: Too many pending packets');
			}
			this.emit('error', new Error('Too many pending packets'));
			this.emit('close');
			return;
		}
		if (seq === rx_seq) {
			do {
				const packet = rob[rx_seq];
				delete rob[rx_seq];
				rx_seq = seq_next(rx_seq);
				pending--;
				this.emit('message', packet);
			} while (rob[rx_seq] !== undefined);
		} else if (this.debug) {
			console.info('ROB: ' + pending + ' packets pending');
		}
	};

	this.send = send;
	this.write = write;
}
