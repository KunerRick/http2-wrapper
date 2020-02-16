# http2-wrapper
> HTTP2 client, just with the familiar `https` API

[![Build Status](https://travis-ci.org/szmarczak/http2-wrapper.svg?branch=master)](https://travis-ci.org/szmarczak/http2-wrapper)
[![Coverage Status](https://coveralls.io/repos/github/szmarczak/http2-wrapper/badge.svg?branch=master)](https://coveralls.io/github/szmarczak/http2-wrapper?branch=master)
[![npm](https://img.shields.io/npm/dm/http2-wrapper.svg)](https://www.npmjs.com/package/http2-wrapper)
[![install size](https://packagephobia.now.sh/badge?p=http2-wrapper)](https://packagephobia.now.sh/result?p=http2-wrapper)

This package was created to support HTTP2 without the need to rewrite your code.<br>
I recommend adapting to the [`http2`](https://nodejs.org/api/http2.html) module if possible - it's much simpler to use and has many cool features!

**Tip**: `http2-wrapper` is very useful when you rely on other modules that use the HTTP1 API and you want to support HTTP2.

## Installation

> `$ npm install http2-wrapper`<br>
> `$ yarn add http2-wrapper`

It's best to run `http2-wrapper` under [**the latest**](https://nodejs.org/en/download/current/) version of Node. It provides the best stability.

## Usage
```js
const http2 = require('http2-wrapper');

const options = {
	hostname: 'nghttp2.org',
	protocol: 'https:',
	path: '/httpbin/post',
	method: 'POST',
	headers: {
		'content-length': 6
	}
};

const request = http2.request(options, response => {
	console.log('statusCode:', response.statusCode);
	console.log('headers:', response.headers);

	const body = [];
	response.on('data', chunk => {
		body.push(chunk);
	});
	response.on('end', () => {
		console.log('body:', Buffer.concat(body).toString());
	});
});

request.on('error', e => console.error(e));

request.write('123');
request.end('456');

// statusCode: 200
// headers: [Object: null prototype] {
//   ':status': 200,
//   date: 'Fri, 27 Sep 2019 19:45:46 GMT',
//   'content-type': 'application/json',
//   'access-control-allow-origin': '*',
//   'access-control-allow-credentials': 'true',
//   'content-length': '239',
//   'x-backend-header-rtt': '0.002516',
//   'strict-transport-security': 'max-age=31536000',
//   server: 'nghttpx',
//   via: '1.1 nghttpx',
//   'alt-svc': 'h3-23=":4433"; ma=3600',
//   'x-frame-options': 'SAMEORIGIN',
//   'x-xss-protection': '1; mode=block',
//   'x-content-type-options': 'nosniff'
// }
// body: {
//   "args": {},
//   "data": "123456",
//   "files": {},
//   "form": {},
//   "headers": {
//     "Content-Length": "6",
//     "Host": "nghttp2.org"
//   },
//   "json": 123456,
//   "origin": "xxx.xxx.xxx.xxx",
//   "url": "https://nghttp2.org/httpbin/post"
// }
```

## API

**Note:** the `session` option was renamed to `tlsSession` for better readability.

### http2.auto(url, options, callback)

Performs [ALPN](https://nodejs.org/api/tls.html#tls_alpn_and_sni) negotiation.
Returns a Promise giving proper `ClientRequest` instance (depending on the ALPN).

**Tip**: the `agent` option also accepts an object with `http`, `https` and `http2` properties.

```js
const http2 = require('http2-wrapper');

const options = {
	hostname: 'httpbin.org',
	protocol: 'http:', // Note the `http:` protocol here
	path: '/post',
	method: 'POST',
	headers: {
		'content-length': 6
	}
};

(async () => {
	try {
		const request = await http2.auto(options, response => {
			console.log('statusCode:', response.statusCode);
			console.log('headers:', response.headers);

			const body = [];
			response.on('data', chunk => body.push(chunk));
			response.on('end', () => {
				console.log('body:', Buffer.concat(body).toString());
			});
		});

		request.on('error', console.error);

		request.write('123');
		request.end('456');
	} catch (error) {
		console.error(error);
	}
})();

// statusCode: 200
// headers: { connection: 'close',
//   server: 'gunicorn/19.9.0',
//   date: 'Sat, 15 Dec 2018 18:19:32 GMT',
//   'content-type': 'application/json',
//   'content-length': '259',
//   'access-control-allow-origin': '*',
//   'access-control-allow-credentials': 'true',
//   via: '1.1 vegur' }
// body: {
//   "args": {},
//   "data": "123456",
//   "files": {},
//   "form": {},
//   "headers": {
//     "Connection": "close",
//     "Content-Length": "6",
//     "Host": "httpbin.org"
//   },
//   "json": 123456,
//   "origin": "xxx.xxx.xxx.xxx",
//   "url": "http://httpbin.org/post"
// }
```

### http2.auto.protocolCache

An instance of [`quick-lru`](https://github.com/sindresorhus/quick-lru) used for ALPN cache.

There is a maximum of 100 entries. You can modify the limit through `protocolCache.maxSize` - note that the change will be visible globally.

### http2.request(url, options, callback)

Same as [`https.request`](https://nodejs.org/api/https.html#https_https_request_options_callback).

##### options.preconnect

Type: `boolean`<br>
Default: `true`

If set to `true`, it will try to connect to the server before sending the request.

##### options.h2session

Type: `Http2Session`<br>

The session used to make the actual request. If none provided, it will use `options.agent`.

### http2.get(url, options, callback)

Same as [`https.get`](https://nodejs.org/api/https.html#https_https_get_options_callback).

### new http2.ClientRequest(url, options, callback)

Same as [`https.ClientRequest`](https://nodejs.org/api/https.html#https_class_https_clientrequest).

### new http2.IncomingMessage(socket)

Same as [`https.IncomingMessage`](https://nodejs.org/api/https.html#https_class_https_incomingmessage).

### new http2.Agent(options)

**Note:** this is **not** compatible with the classic `http.Agent`.

Usage example:

```js
const http2 = require('http2-wrapper');

class MyAgent extends http2.Agent {
	createConnection(authority, options) {
		console.log(`Connecting to ${authority}`);
		return http2.Agent.connect(authority, options);
	}
}

http2.get({
	hostname: 'google.com',
	agent: new MyAgent()
}, res => {
	res.on('data', chunk => console.log(`Received chunk of ${chunk.length} bytes`));
});
```

#### options

Each option is assigned to each `Agent` instance and can be changed later.

##### timeout

Type: `number`<br>
Default: `60000`

If there's no activity after `timeout` milliseconds, the session will be closed.

##### maxSessions

Type: `number`<br>
Default: `Infinity`

The maximum amount of sessions per origin.

##### maxFreeSessions

Type: `number`<br>
Default: `1`

The maximum amount of free sessions per origin.

##### maxCachedTlsSessions

Type: `number`<br>
Default: `100`

The maximum amount of cached TLS sessions.

#### Agent.normalizeAuthority([authority](#authority), servername)

Normalizes the authority URL.

```js
Agent.normalizeAuthority('https://example.com:443');
// => 'https://example.com'
```

#### agent.settings

Type: `object`<br>
Default: `{enablePush: false}`

[Settings](https://nodejs.org/api/http2.html#http2_settings_object) used by the current agent instance.

#### agent.normalizeOptions([options](https://github.com/szmarczak/http2-wrapper/blob/master/source/agent.js))

Returns a string containing normalized options.

```js
Agent.normalizeOptions({servername: 'example.com'});
// => ':example.com'
```

#### agent.getSession(authority, options)

##### [authority](https://nodejs.org/api/http2.html#http2_http2_connect_authority_options_listener)

Type: `string` `URL` `object`

Authority used to create a new session.

##### [options](https://nodejs.org/api/http2.html#http2_http2_connect_authority_options_listener)

Type: `object`

Options used to create a new session.

Returns a Promise giving free `Http2Session`. If no free sessions are found, a new one is created.

#### agent.getSession([authority](#authority), [options](options-1), listener)

##### listener

Type: `object`

```
{
	reject: error => void,
	resolve: session => void
}
```

If the `listener` argument is present, the Promise will resolve immediately. It will use the `resolve` function to pass the session.

#### agent.request([authority](#authority), [options](#options-1), [headers](https://nodejs.org/api/http2.html#http2_headers_object))

Returns a Promise giving `Http2Stream`.

#### agent.createConnection([authority](#authority), [options](#options-1))

Returns a new `TLSSocket`. It defaults to `Agent.connect(authority, options)`.

#### agent.closeFreeSessions()

Makes an attempt to close free sessions. Only sessions with 0 concurrent streams are closed.

#### agent.destroy(reason)

Destroys **all** sessions.

#### Event: 'session'

```js
agent.on('session', session => {
	// A new session has been created by the Agent.
});
```

## Notes

 - If you're interested in [WebSockets over HTTP2](https://tools.ietf.org/html/rfc8441), then [check out this discussion](https://github.com/websockets/ws/issues/1458).
 - [HTTP2 sockets cannot be malformed](https://github.com/nodejs/node/blob/cc8250fab86486632fdeb63892be735d7628cd13/lib/internal/http2/core.js#L725), therefore modifying the socket will have no effect.
 - You can make [a custom Agent](examples/push-stream/index.js) to support push streams.

## Benchmarks

CPU: Intel i7-7700k<br>
Server: H2O v2.2.5 [`h2o.conf`](h2o.conf)<br>
Node: v13.8.0

`auto` means `http2wrapper.auto`.

```
http2-wrapper                         x 10,598 ops/sec ±4.04% (84 runs sampled)
http2-wrapper - preconfigured session x 13,640 ops/sec ±1.71% (86 runs sampled)
http2-wrapper - auto                  x 9,629  ops/sec ±1.58% (84 runs sampled)
http2                                 x 16,540 ops/sec ±1.05% (82 runs sampled)
http2         - 2xPassThrough         x 13,534 ops/sec ±0.99% (86 runs sampled)
https         - auto - keepalive      x 13,108 ops/sec ±2.67% (78 runs sampled)
https                - keepalive      x 13,113 ops/sec ±3.32% (80 runs sampled)
https                                 x 1,541  ops/sec ±2.72% (79 runs sampled)
http                                  x 5,957  ops/sec ±2.34% (72 runs sampled)
Fastest is http2
```

`http2-wrapper`:
- 36% slower than `http2` (22% compared to `http2 - 2xPassThrough`)
- 19% slower than `https - keepalive`
- 78% faster than `http`

`http2-wrapper - preconfigured session`:
- 18% slower than `http2` (as performant as `http2 - 2xPassThrough`)
- as performant as `https - keepalive`
- 129% faster than `http`

`http2-wrapper - auto`:
- 27% slower than `https - keepalive`
- 62% faster than `http`

`https - auto - keepalive`:
- 21% slower than `http2` (as performant as `http2 - 2xPassThrough`)
- as performant as `https - keepalive`
- 120% faster than `http`

## Related

 - [`got`](https://github.com/sindresorhus/got) - Simplified HTTP requests

## License

MIT
