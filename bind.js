/* Connect a chain of layers together (last layer may be array of endpoints */

module.exports = bind;

function bind(...args) {
	if (args.length === 1 && args[0] instanceof Array) {
		return bind(...args);
	}
	if (args.length <= 1) {
		return;
	}
	for (let i = 1; i < args.length; i++) {
		bindOneToMany(args[i - 1], args[i]);
	}
}

function bindOneToMany(l, rs) {
	if (!(rs instanceof Array)) {
		rs = [rs];
	}
	rs.forEach(r => bindOneToOne(l, r));
}

function bindOneToOne(l, r) {
	if (l instanceof Array) {
		throw new Error('Cannot bind many to one');
	}
	l.on('message', data => r.write(data));
	r.on('send', packet => l.send(packet));
	l.on('error', err => r.emit(err));
	l.on('close', () => r.close && r.close());
}
