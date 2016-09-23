const Server = require('./server');
const Client = require('./client');
const ReorderBuffer = require('./reorder-buffer');
const bind = require('./bind');

const rob_s = new ReorderBuffer();
const rob_c = new ReorderBuffer();

const onError = err => (console.error(err), process.exit(0));

const fudge = f => setTimeout(f, Math.random() * 100);

const server = new Server({ port: 'test' });
const client = new Client({ port: 'test' });

bind(rob_s, server);
bind(rob_c, client);

rob_s.on('send', packet => fudge(() => rob_c.write(packet)));
rob_c.on('send', packet => fudge(() => rob_s.write(packet)));

rob_s.on('error', onError);
rob_c.on('error', onError);
server.on('error', onError);
client.on('error', onError);

client.on('close', () => {
	console.info('CLIENT CLOSE');
});

client.on('open', () => {
	console.info('CLIENT OPEN');
	client.send({ text: 'hello' });
	client.on('message', msg => {
		console.log('CLIENT RECEIVE', msg.text);
		client.send({ text: '!' });
		client.close();
		server.stop();
	});
});

server.on('accept', con => {
	console.info('SERVER ACCEPT');
	con.on('message', msg => {
		console.log('SERVER RECEIVE', msg.text);
		con.send({ text: 'world' });
	});
	con.on('close', () => {
		console.info('SERVER CLOSE');
	});
});

server.start();