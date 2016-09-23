const ReorderBuffer = require('./reorder-buffer');

function test_one(message) {
	const buf = new ReorderBuffer({ maxPending: 100 });
	/* Loop back */
	buf.on('send', packet =>
		setTimeout(() => buf.write(packet), Math.random() * 100));
	let res = '';
	buf.on('message', data => {
		if (data === null) {
			if (res === message) {
				console.info('TEST PASSED');
			} else {
				console.error('TEST FAILED: ' + res);
			}
		} else {
			res += data;
		}
	});
	message.split('').forEach(c => buf.send(c));
	buf.send(null);
}

test_one('PoTatO');
test_one('a longer message to test things a bit further, let\'s see how this goes');
