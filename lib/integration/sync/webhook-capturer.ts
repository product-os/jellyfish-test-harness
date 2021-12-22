import bodyParser from 'body-parser';
import express from 'express';
import fs from 'fs';
import { padStart } from 'lodash';
import morgan from 'morgan';
import path from 'path';

export function setup() {
	const outputDirectory = process.cwd();
	const app = express();

	app.set('port', 3000);
	app.set('route', '/event');

	app.use(morgan('dev'));
	app.use(
		bodyParser.json({
			// Services such as Outreach send a content
			// type "application/vnd.api+json"
			type: ['application/*+json', 'application/json'],
		}),
	);

	let counter = 1;

	app.all(app.get('route'), (request, response) => {
		const event = {
			headers: request.headers,
			payload: request.body,
		};

		const name = padStart(counter.toString(), 2, '0');
		const fileName = path.join(outputDirectory, `${name}.json`);

		console.log(`Writing ${fileName}`);
		fs.writeFileSync(fileName, JSON.stringify(event, null, 2), {
			encoding: 'utf-8',
		});

		counter += 1;
		response.status(200).json(event);
	});

	app.listen(app.get('port'), () => {
		console.log(`Listening on port ${app.get('port')}`);
		console.log(`Pipe webhooks to ${app.get('route')}`);
		console.log(`Recording to ${outputDirectory}`);
	});
}
