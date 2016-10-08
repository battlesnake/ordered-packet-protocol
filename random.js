module.exports = {
	byte: randomByte,
	key: randomKey
};

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
