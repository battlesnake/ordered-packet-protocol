const Server = require('./server');
const Client = require('./client');

const onError = err => (console.error(err), process.exit(0));

const fudge = f => setTimeout(f, Math.random() * 100);

const server = new Server({ port: 'test' }, 'to client');
const client = new Client({ port: 'test' }, 'to server');

client.on('send', packet => process.nextTick(() => server.write(packet)));
server.on('send', packet => process.nextTick(() => client.write(packet)));

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

client.on('initdata', data => console.info('CLIENT INITDATA', data));

server.on('accept', (con, data) => {
	console.info('SERVER ACCEPT', data);
	con.on('message', msg => {
		console.log('SERVER RECEIVE', msg.text);
		con.send({ text: 'world' });
	});
	con.on('close', () => {
		console.info('SERVER CLOSE');
	});
});

server.on('initdata', (con, data) => console.info('SERVER INITDATA', data));

server.start();
