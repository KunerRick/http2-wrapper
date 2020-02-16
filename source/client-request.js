'use strict';
const http2 = require('http2');
const {Writable} = require('stream');
const {Agent, globalAgent} = require('./agent');
const IncomingMessage = require('./incoming-message');
const urlToOptions = require('./utils/url-to-options');
const proxyEvents = require('./utils/proxy-events');
const {
	ERR_INVALID_ARG_TYPE,
	ERR_INVALID_PROTOCOL,
	ERR_HTTP_HEADERS_SENT,
	ERR_INVALID_HTTP_TOKEN,
	ERR_HTTP_INVALID_HEADER_VALUE,
	ERR_INVALID_CHAR
} = require('./utils/errors');

const {
	NGHTTP2_CANCEL,
	HTTP2_HEADER_STATUS,
	HTTP2_HEADER_METHOD,
	HTTP2_HEADER_PATH,
	HTTP2_METHOD_CONNECT
} = http2.constants;

const kHeaders = Symbol('headers');
const kAuthority = Symbol('authority');
const kSession = Symbol('session');
const kOptions = Symbol('options');
const kFlushedHeaders = Symbol('flushedHeaders');

const isValidHttpToken = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
const isInvalidHeaderValue = /[^\t\u0020-\u007E\u0080-\u00FF]/;

class ClientRequest extends Writable {
	constructor(input, options, callback) {
		super();

		const hasInput = typeof input === 'string' || input instanceof URL;
		if (hasInput) {
			input = urlToOptions(input instanceof URL ? input : new URL(input));
		}

		if (typeof options === 'function') {
			// (options, callback)
			callback = options;
			options = hasInput ? input : {...input};
		} else {
			// (input, options, callback)
			options = {...input, ...options};
		}

		if (options.h2session) {
			this[kSession] = options.h2session;
		} else if (options.agent === false) {
			this.agent = new Agent({maxFreeSessions: 0});
		} else if (typeof options.agent === 'undefined' || options.agent === null) {
			if (typeof options.createConnection === 'function') {
				// This is a workaround - we don't have to create the session on our own.
				this.agent = new Agent({maxFreeSessions: 0});
				this.agent.createConnection = options.createConnection;
			} else {
				this.agent = globalAgent;
			}
		} else if (typeof options.agent.request === 'function') {
			this.agent = options.agent;
		} else {
			throw new ERR_INVALID_ARG_TYPE('options.agent', ['Agent-like Object', 'undefined', 'false'], options.agent);
		}

		if (!options.port) {
			options.port = options.defaultPort || (this.agent && this.agent.defaultPort) || 443;
		}

		options.host = options.hostname || options.host || 'localhost';

		if (options.protocol && options.protocol !== 'https:') {
			throw new ERR_INVALID_PROTOCOL(options.protocol, 'https:');
		}

		const {timeout} = options;
		delete options.timeout;

		this[kHeaders] = Object.create(null);

		this.socket = null;
		this.connection = null;

		this.method = options.method;
		this.path = options.path;

		this.res = null;
		this.aborted = false;
		this.reusedSocket = false;

		if (options.headers) {
			for (const [header, value] of Object.entries(options.headers)) {
				this[kHeaders][header.toLowerCase()] = value;
			}
		}

		if (options.auth && !Reflect.has(this[kHeaders], 'authorization')) {
			this[kHeaders].authorization = 'Basic ' + Buffer.from(options.auth).toString('base64');
		}

		options.session = options.tlsSession;
		options.path = options.socketPath;

		this[kOptions] = options;
		this[kAuthority] = Agent.normalizeAuthority(options, options.servername);

		if (!Reflect.has(this[kHeaders], ':authority')) {
			this[kHeaders][':authority'] = this[kAuthority].slice(8);
		}

		if (this.agent && options.preconnect !== false) {
			this.agent.getSession(this[kAuthority], options).catch(() => {});
		}

		if (timeout) {
			this.setTimeout(timeout);
		}

		if (callback) {
			this.once('response', callback);
		}

		this[kFlushedHeaders] = false;
	}

	get method() {
		return this[kHeaders][HTTP2_HEADER_METHOD];
	}

	set method(value) {
		if (value) {
			this[kHeaders][HTTP2_HEADER_METHOD] = value.toUpperCase();
		}
	}

	get path() {
		return this[kHeaders][HTTP2_HEADER_PATH];
	}

	set path(value) {
		if (value) {
			this[kHeaders][HTTP2_HEADER_PATH] = value;
		}
	}

	_write(chunk, encoding, callback) {
		this.flushHeaders();

		const callWrite = () => this._request.write(chunk, encoding, callback);
		if (this._request) {
			callWrite();
		} else {
			this.once('socket', callWrite);
		}
	}

	_final(callback) {
		if (this.destroyed || this.aborted) {
			return;
		}

		this.flushHeaders();

		const callEnd = () => this._request.end(callback);
		if (this._request) {
			callEnd();
		} else {
			this.once('socket', callEnd);
		}
	}

	abort() {
		if (!this.aborted) {
			process.nextTick(() => this.emit('abort'));
		}

		this.aborted = true;

		if (this.res) {
			this.res._dump();
		}

		if (this._request) {
			this._request.close(NGHTTP2_CANCEL);
		}
	}

	_destroy(error) {
		if (this._request) {
			this._request.destroy(error);
		} else if (error) {
			process.nextTick(() => this.emit('error', error));
		}
	}

	async flushHeaders() {
		if (this[kFlushedHeaders] || this.destroyed || this.aborted) {
			return;
		}

		this[kFlushedHeaders] = true;

		const isConnectMethod = this.method === HTTP2_METHOD_CONNECT;

		// The real magic is here
		const onStream = stream => {
			this._request = stream;

			if (this.destroyed || this.aborted) {
				this._request.close(NGHTTP2_CANCEL);
				return;
			}

			// Forwards `timeout`, `continue`, `close` and `error` events to this instance.
			if (!isConnectMethod) {
				proxyEvents(this._request, this, ['timeout', 'continue', 'close', 'error']);
			}

			// This event tells we are ready to listen for the data.
			this._request.once('response', (headers, flags, rawHeaders) => {
				// If we were to emit raw request stream, it would be as fast as the native approach.
				// Note that wrapping the raw stream in a Proxy instance won't improve the performance (already tested it).
				this.res = new IncomingMessage(this.socket, this._request.readableHighWaterMark);
				this.res.req = this;
				this.res.statusCode = headers[HTTP2_HEADER_STATUS];
				this.res.headers = headers;
				this.res.rawHeaders = rawHeaders;

				this.res.once('end', () => {
					if (this.aborted) {
						this.res.aborted = true;
						this.res.emit('aborted');
					} else {
						this.res.complete = true;
					}
				});

				if (isConnectMethod) {
					this.res.upgrade = true;

					// The HTTP1 API says the socket is detached here,
					// but we can't do that so we pass the original HTTP2 request.
					if (this.emit('connect', this.res, this._request, Buffer.alloc(0))) {
						this.emit('close');
					} else {
						// No listeners attached, destroy the original request.
						this._request.destroy();
					}
				} else {
					// Forwards data
					this._request.pipe(this.res);

					if (!this.emit('response', this.res)) {
						// No listeners attached, dump the response.
						this.res._dump();
					}
				}
			});

			// Emits `information` event
			this._request.once('headers', headers => this.emit('information', {statusCode: headers[HTTP2_HEADER_STATUS]}));

			this._request.once('trailers', (trailers, flags, rawTrailers) => {
				// Assigns trailers to the response object.
				this.res.trailers = trailers;
				this.res.rawTrailers = rawTrailers;
			});

			this.socket = this._request.session.socket;
			this.connection = this._request.session.socket;

			process.nextTick(() => {
				this.emit('socket', this.socket);
			});
		};

		// Makes a HTTP2 request
		if (this[kSession]) {
			try {
				onStream(this[kSession].request(this[kHeaders], {
					endStream: false
				}));
			} catch (error) {
				this.emit('error', error);
			}
		} else {
			this.reusedSocket = true;

			try {
				onStream(await this.agent.request(this[kAuthority], this[kOptions], this[kHeaders]));
			} catch (error) {
				this.emit('error', error);
			}
		}
	}

	getHeader(name) {
		if (typeof name !== 'string') {
			throw new ERR_INVALID_ARG_TYPE('name', 'string', name);
		}

		return this[kHeaders][name.toLowerCase()];
	}

	get headersSent() {
		return this[kFlushedHeaders];
	}

	removeHeader(name) {
		if (typeof name !== 'string') {
			throw new ERR_INVALID_ARG_TYPE('name', 'string', name);
		}

		if (this.headersSent) {
			throw new ERR_HTTP_HEADERS_SENT('remove');
		}

		delete this[kHeaders][name.toLowerCase()];
	}

	setHeader(name, value) {
		if (this.headersSent) {
			throw new ERR_HTTP_HEADERS_SENT('set');
		}

		if (typeof name !== 'string' || !isValidHttpToken.test(name)) {
			throw new ERR_INVALID_HTTP_TOKEN('Header name', name);
		}

		if (typeof value === 'undefined') {
			throw new ERR_HTTP_INVALID_HEADER_VALUE(value, name);
		}

		if (isInvalidHeaderValue.test(value)) {
			throw new ERR_INVALID_CHAR('header content', name);
		}

		this[kHeaders][name.toLowerCase()] = value;
	}

	setNoDelay() {
		// HTTP2 sockets cannot be malformed, do nothing.
	}

	setSocketKeepAlive() {
		// HTTP2 sockets cannot be malformed, do nothing.
	}

	setTimeout(ms, callback) {
		if (this._request) {
			this._request.setTimeout(ms, callback);
		} else {
			this.once('socket', () => {
				this._request.setTimeout(ms, callback);
			});
		}

		return this;
	}

	get maxHeadersCount() {
		if (this._request) {
			return this._request.session.localSettings.maxHeaderListSize;
		}

		return undefined;
	}

	set maxHeadersCount(_value) {
		// Updating HTTP2 settings would affect all requests, do nothing.
	}
}

module.exports = ClientRequest;
