"use strict";
/*
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stop = exports.run = void 0;
var http = require("http");
var path = require("path");
var url = require("url");
var socketio_to_dap_1 = require("./socketio_to_dap");
var socketio_to_pty_1 = require("./socketio_to_pty");
var python_lsp_1 = require("./python_lsp");
var jupyter = require("./jupyter");
var logging = require("./logging");
var reverseProxy = require("./reverseProxy");
var sockets = require("./sockets");
var server;
/**
 * Handles all requests.
 * @param request the incoming HTTP request.
 * @param response the out-going HTTP response.
 * @path the parsed path in the request.
 */
function handleRequest(request, response, requestPath) {
    // The explicit set of paths we proxy to jupyter.
    if ((requestPath.indexOf('/api') === 0) ||
        (requestPath.indexOf('/nbextensions') === 0) ||
        // /files and /static are only used in runlocal.
        (requestPath.indexOf('/files') === 0) ||
        (requestPath.indexOf('/static') === 0)) {
        jupyter.handleRequest(request, response);
        return;
    }
    // Not Found
    response.statusCode = 404;
    response.end();
}
/**
 * Base logic for handling all requests sent to the proxy web server. Some
 * requests are handled within the server, while some are proxied to the
 * Jupyter notebook server.
 *
 * Error handling is left to the caller.
 *
 * @param request the incoming HTTP request.
 * @param response the out-going HTTP response.
 */
function uncheckedRequestHandler(request, response) {
    var e_1, _a;
    var parsedUrl = url.parse(request.url || '', true);
    var urlpath = parsedUrl.pathname || '';
    logging.logRequest(request, response);
    try {
        for (var socketIoHandlers_1 = __values(socketIoHandlers), socketIoHandlers_1_1 = socketIoHandlers_1.next(); !socketIoHandlers_1_1.done; socketIoHandlers_1_1 = socketIoHandlers_1.next()) {
            var handler = socketIoHandlers_1_1.value;
            if (handler.isPathProxied(urlpath)) {
                // Will automatically be handled by socket.io.
                return;
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (socketIoHandlers_1_1 && !socketIoHandlers_1_1.done && (_a = socketIoHandlers_1.return)) _a.call(socketIoHandlers_1);
        }
        finally { if (e_1) throw e_1.error; }
    }
    var proxyPort = reverseProxy.getRequestPort(urlpath);
    if (sockets.isSocketIoPath(urlpath)) {
        // Will automatically be handled by socket.io.
    }
    else if (proxyPort && proxyPort !== request.socket.localPort) {
        // Do not allow proxying to this same port, as that can be used to mask the
        // target path.
        reverseProxy.handleRequest(request, response, proxyPort);
    }
    else {
        handleRequest(request, response, urlpath);
    }
}
function socketHandler(request, socket, head) {
    jupyter.handleSocket(request, socket, head);
}
/**
 * Handles all requests sent to the proxy web server. Some requests are handled within
 * the server, while some are proxied to the Jupyter notebook server.
 * @param request the incoming HTTP request.
 * @param response the out-going HTTP response.
 */
function requestHandler(request, response) {
    try {
        uncheckedRequestHandler(request, response);
    }
    catch (e) {
        logging.getLogger().error("Uncaught error handling a request to \"".concat(request.url, "\": ").concat(e));
    }
}
var socketIoHandlers = [];
/**
 * Runs the proxy web server.
 * @param settings the configuration settings to use.
 */
function run(settings) {
    jupyter.init(settings);
    reverseProxy.init(settings);
    server = http.createServer(requestHandler);
    // Disable HTTP keep-alive connection timeouts in order to avoid connection
    // flakes. Details: b/112151064
    server.keepAliveTimeout = 0;
    server.on('upgrade', socketHandler);
    var socketIoServer = sockets.init(server, settings);
    socketIoHandlers.push(new socketio_to_pty_1.SocketIoToPty('/tty', server, settings.kernelContainerName || ''));
    if (settings.debugAdapterMultiplexerPath) {
        // Handler manages its own lifetime.
        // tslint:disable-next-line:no-unused-expression
        new socketio_to_dap_1.SocketIoToDap(settings.debugAdapterMultiplexerPath, socketIoServer);
    }
    if (settings.enableLsp) {
        var contentDir = path.join(settings.datalabRoot, settings.contentDir);
        var logsDir = path.join(settings.datalabRoot, '/var/log/');
        // Handler manages its own lifetime.
        // tslint:disable-next-line:no-unused-expression
        new python_lsp_1.PythonLsp(socketIoServer, __dirname, contentDir, logsDir, settings.kernelContainerName);
    }
    logging.getLogger().info('Starting server at http://localhost:%d', settings.serverPort);
    process.on('SIGINT', function () { return process.exit(); });
    var options = { port: settings.serverPort, ipv6Only: false, host: settings.serverHost || '' };
    if ('TEST_TMPDIR' in process.env) {
        // Required to avoid "EAFNOSUPPORT: address family not supported" on IPv6-only environments
        // (notably, even with the host override below).
        options['ipv6Only'] = true;
        // ipv6Only alone isn't enough to avoid attempting to bind to 0.0.0.0 (which
        // fails on IPv6-only environments).  Need to specify an IP address because
        // DNS resolution even of ip6-localhost fails on some such environments.
        options['host'] = '::1';
    }
    server.listen(options);
}
exports.run = run;
/**
 * Stops the server and associated Jupyter server.
 */
function stop() {
    jupyter.close();
}
exports.stop = stop;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vdGhpcmRfcGFydHkvY29sYWIvc291cmNlcy9zZXJ2ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7R0FZRzs7Ozs7Ozs7Ozs7Ozs7QUFFSCwyQkFBNkI7QUFFN0IsMkJBQTZCO0FBQzdCLHlCQUEyQjtBQUczQixxREFBZ0Q7QUFDaEQscURBQWdEO0FBQ2hELDJDQUF1QztBQUN2QyxtQ0FBcUM7QUFDckMsbUNBQXFDO0FBQ3JDLDZDQUErQztBQUMvQyxtQ0FBcUM7QUFFckMsSUFBSSxNQUFtQixDQUFDO0FBRXhCOzs7OztHQUtHO0FBQ0gsU0FBUyxhQUFhLENBQUMsT0FBNkIsRUFDN0IsUUFBNkIsRUFDN0IsV0FBbUI7SUFFeEMsaURBQWlEO0lBQ2pELElBQUksQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNuQyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzVDLGdEQUFnRDtRQUNoRCxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ3JDLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRztRQUMzQyxPQUFPLENBQUMsYUFBYSxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQztRQUN6QyxPQUFPO0tBQ1I7SUFFRCxZQUFZO0lBQ1osUUFBUSxDQUFDLFVBQVUsR0FBRyxHQUFHLENBQUM7SUFDMUIsUUFBUSxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBQ2pCLENBQUM7QUFFRDs7Ozs7Ozs7O0dBU0c7QUFDSCxTQUFTLHVCQUF1QixDQUFDLE9BQTZCLEVBQUUsUUFBNkI7O0lBQzNGLElBQU0sU0FBUyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENB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QUFFLFdBQVcsQ0FBQyxDQUFDO1FBQzdELG9DQUFvQztRQUNwQyxnREFBZ0Q7UUFDaEQsSUFBSSxzQkFBUyxDQUFDLGNBQWMsRUFBRSxTQUFTLEVBQUUsVUFBVSxFQUFFLE9BQU8sRUFBRSxRQUFRLENBQUMsbUJBQW1CLENBQUMsQ0FBQztLQUM3RjtJQUVELE9BQU8sQ0FBQyxTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsd0NBQXdDLEVBQ3hDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUM5QyxPQUFPLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxjQUFNLE9BQUEsT0FBTyxDQUFDLElBQUksRUFBRSxFQUFkLENBQWMsQ0FBQyxDQUFDO0lBQzNDLElBQU0sT0FBTyxHQUFHLEVBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLFVBQVUsSUFBSSxFQUFFLEVBQUMsQ0FBQztJQUM5RixJQUFJLGFBQWEsSUFBSSxPQUFPLENBQUMsR0FBRyxFQUFFO1FBQ2hDLDJGQUEyRjtRQUMzRixnREFBZ0Q7UUFDaEQsT0FBTyxDQUFDLFVBQVUsQ0FBQyxHQUFHLElBQUksQ0FBQztRQUMzQiw0RUFBNEU7UUFDNUUsMkVBQTJFO1FBQzNFLHdFQUF3RTtRQUN4RSxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsS0FBSyxDQUFDO0tBQ3pCO0lBQ0QsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUN6QixDQUFDO0FBMUNELGtCQTBDQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsSUFBSTtJQUNsQixPQUFPLENBQUMsS0FBSyxFQUFFLENBQUM7QUFDbEIsQ0FBQztBQUZELG9CQUVDIiwic291cmNlc0NvbnRlbnQiOlsiLypcbiAqIENvcHlyaWdodCAyMDE1IEdvb2dsZSBJbmMuIEFsbCByaWdodHMgcmVzZXJ2ZWQuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTsgeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHRcbiAqIGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS4gWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZSBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZVxuICogaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLCBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3NcbiAqIG9yIGltcGxpZWQuIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmQgbGltaXRhdGlvbnMgdW5kZXJcbiAqIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCAqIGFzIGh0dHAgZnJvbSAnaHR0cCc7XG5pbXBvcnQgKiBhcyBuZXQgZnJvbSAnbmV0JztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyB1cmwgZnJvbSAndXJsJztcblxuaW1wb3J0IHtBcHBTZXR0aW5nc30gZnJvbSAnLi9hcHBTZXR0aW5ncyc7XG5pbXBvcnQge1NvY2tldElvVG9EYXB9IGZyb20gJy4vc29ja2V0aW9fdG9fZGFwJztcbmltcG9ydCB7U29ja2V0SW9Ub1B0eX0gZnJvbSAnLi9zb2NrZXRpb190b19wdHknO1xuaW1wb3J0IHtQeXRob25Mc3B9IGZyb20gJy4vcHl0aG9uX2xzcCc7XG5pbXBvcnQgKiBhcyBqdXB5dGVyIGZyb20gJy4vanVweXRlcic7XG5pbXBvcnQgKiBhcyBsb2dnaW5nIGZyb20gJy4vbG9nZ2luZyc7XG5pbXBvcnQgKiBhcyByZXZlcnNlUHJveHkgZnJvbSAnLi9yZXZlcnNlUHJveHknO1xuaW1wb3J0ICogYXMgc29ja2V0cyBmcm9tICcuL3NvY2tldHMnO1xuXG5sZXQgc2VydmVyOiBodHRwLlNlcnZlcjtcblxuLyoqXG4gKiBIYW5kbGVzIGFsbCByZXF1ZXN0cy5cbiAqIEBwYXJhbSByZXF1ZXN0IHRoZSBpbmNvbWluZyBIVFRQIHJlcXVlc3QuXG4gKiBAcGFyYW0gcmVzcG9uc2UgdGhlIG91dC1nb2luZyBIVFRQIHJlc3BvbnNlLlxuICogQHBhdGggdGhlIHBhcnNlZCBwYXRoIGluIHRoZSByZXF1ZXN0LlxuICovXG5mdW5jdGlvbiBoYW5kbGVSZXF1ZXN0KHJlcXVlc3Q6IGh0dHAuSW5jb21pbmdNZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZTogaHR0cC5TZXJ2ZXJSZXNwb25zZSxcbiAgICAgICAgICAgICAgICAgICAgICAgcmVxdWVzdFBhdGg6IHN0cmluZykge1xuXG4gIC8vIFRoZSBleHBsaWNpdCBzZXQgb2YgcGF0aHMgd2UgcHJveHkgdG8ganVweXRlci5cbiAgaWYgKChyZXF1ZXN0UGF0aC5pbmRleE9mKCcvYXBpJykgPT09IDApIHx8XG4gICAgICAocmVxdWVzdFBhdGguaW5kZXhPZignL25iZXh0ZW5zaW9ucycpID09PSAwKSB8fFxuICAgICAgLy8gL2ZpbGVzIGFuZCAvc3RhdGljIGFyZSBvbmx5IHVzZWQgaW4gcnVubG9jYWwuXG4gICAgICAocmVxdWVzdFBhdGguaW5kZXhPZignL2ZpbGVzJykgPT09IDApIHx8XG4gICAgICAocmVxdWVzdFBhdGguaW5kZXhPZignL3N0YXRpYycpID09PSAwKSkgIHtcbiAgICBqdXB5dGVyLmhhbmRsZVJlcXVlc3QocmVxdWVzdCwgcmVzcG9uc2UpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIE5vdCBGb3VuZFxuICByZXNwb25zZS5zdGF0dXNDb2RlID0gNDA0O1xuICByZXNwb25zZS5lbmQoKTtcbn1cblxuLyoqXG4gKiBCYXNlIGxvZ2ljIGZvciBoYW5kbGluZyBhbGwgcmVxdWVzdHMgc2VudCB0byB0aGUgcHJveHkgd2ViIHNlcnZlci4gU29tZVxuICogcmVxdWVzdHMgYXJlIGhhbmRsZWQgd2l0aGluIHRoZSBzZXJ2ZXIsIHdoaWxlIHNvbWUgYXJlIHByb3hpZWQgdG8gdGhlXG4gKiBKdXB5dGVyIG5vdGVib29rIHNlcnZlci5cbiAqXG4gKiBFcnJvciBoYW5kbGluZyBpcyBsZWZ0IHRvIHRoZSBjYWxsZXIuXG4gKlxuICogQHBhcmFtIHJlcXVlc3QgdGhlIGluY29taW5nIEhUVFAgcmVxdWVzdC5cbiAqIEBwYXJhbSByZXNwb25zZSB0aGUgb3V0LWdvaW5nIEhUVFAgcmVzcG9uc2UuXG4gKi9cbmZ1bmN0aW9uIHVuY2hlY2tlZFJlcXVlc3RIYW5kbGVyKHJlcXVlc3Q6IGh0dHAuSW5jb21pbmdNZXNzYWdlLCByZXNwb25zZTogaHR0cC5TZXJ2ZXJSZXNwb25zZSkge1xuICBjb25zdCBwYXJzZWRVcmwgPSB1cmwucGFyc2UocmVxdWVzdC51cmwgfHwgJycsIHRydWUpO1xuICBjb25zdCB1cmxwYXRoID0gcGFyc2VkVXJsLnBhdGhuYW1lIHx8ICcnO1xuXG4gIGxvZ2dpbmcubG9nUmVxdWVzdChyZXF1ZXN0LCByZXNwb25zZSk7XG5cbiAgZm9yIChjb25zdCBoYW5kbGVyIG9mIHNvY2tldElvSGFuZGxlcnMpIHtcbiAgICBpZiAoaGFuZGxlci5pc1BhdGhQcm94aWVkKHVybHBhdGgpKSB7XG4gICAgICAvLyBXaWxsIGF1dG9tYXRpY2FsbHkgYmUgaGFuZGxlZCBieSBzb2NrZXQuaW8uXG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG5cbiAgY29uc3QgcHJveHlQb3J0ID0gcmV2ZXJzZVByb3h5LmdldFJlcXVlc3RQb3J0KHVybHBhdGgpO1xuICBpZiAoc29ja2V0cy5pc1NvY2tldElvUGF0aCh1cmxwYXRoKSkge1xuICAgIC8vIFdpbGwgYXV0b21hdGljYWxseSBiZSBoYW5kbGVkIGJ5IHNvY2tldC5pby5cbiAgfSBlbHNlIGlmIChwcm94eVBvcnQgJiYgcHJveHlQb3J0ICE9PSByZXF1ZXN0LnNvY2tldC5sb2NhbFBvcnQpIHtcbiAgICAvLyBEbyBub3QgYWxsb3cgcHJveHlpbmcgdG8gdGhpcyBzYW1lIHBvcnQsIGFzIHRoYXQgY2FuIGJlIHVzZWQgdG8gbWFzayB0aGVcbiAgICAvLyB0YXJnZXQgcGF0aC5cbiAgICByZXZlcnNlUHJveHkuaGFuZGxlUmVxdWVzdChyZXF1ZXN0LCByZXNwb25zZSwgcHJveHlQb3J0KTtcbiAgfSBlbHNlIHtcbiAgICBoYW5kbGVSZXF1ZXN0KHJlcXVlc3QsIHJlc3BvbnNlLCB1cmxwYXRoKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBzb2NrZXRIYW5kbGVyKHJlcXVlc3Q6IGh0dHAuSW5jb21pbmdNZXNzYWdlLCBzb2NrZXQ6IG5ldC5Tb2NrZXQsIGhlYWQ6IEJ1ZmZlcikge1xuICBqdXB5dGVyLmhhbmRsZVNvY2tldChyZXF1ZXN0LCBzb2NrZXQsIGhlYWQpO1xufVxuXG4vKipcbiAqIEhhbmRsZXMgYWxsIHJlcXVlc3RzIHNlbnQgdG8gdGhlIHByb3h5IHdlYiBzZXJ2ZXIuIFNvbWUgcmVxdWVzdHMgYXJlIGhhbmRsZWQgd2l0aGluXG4gKiB0aGUgc2VydmVyLCB3aGlsZSBzb21lIGFyZSBwcm94aWVkIHRvIHRoZSBKdXB5dGVyIG5vdGVib29rIHNlcnZlci5cbiAqIEBwYXJhbSByZXF1ZXN0IHRoZSBpbmNvbWluZyBIVFRQIHJlcXVlc3QuXG4gKiBAcGFyYW0gcmVzcG9uc2UgdGhlIG91dC1nb2luZyBIVFRQIHJlc3BvbnNlLlxuICovXG5mdW5jdGlvbiByZXF1ZXN0SGFuZGxlcihyZXF1ZXN0OiBodHRwLkluY29taW5nTWVzc2FnZSwgcmVzcG9uc2U6IGh0dHAuU2VydmVyUmVzcG9uc2UpIHtcbiAgdHJ5IHtcbiAgICB1bmNoZWNrZWRSZXF1ZXN0SGFuZGxlcihyZXF1ZXN0LCByZXNwb25zZSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBsb2dnaW5nLmdldExvZ2dlcigpLmVycm9yKFxuICAgICAgICBgVW5jYXVnaHQgZXJyb3IgaGFuZGxpbmcgYSByZXF1ZXN0IHRvIFwiJHtyZXF1ZXN0LnVybH1cIjogJHtlfWApO1xuICB9XG59XG5cbmNvbnN0IHNvY2tldElvSGFuZGxlcnM6IFNvY2tldElvVG9QdHlbXSA9IFtdO1xuXG4vKipcbiAqIFJ1bnMgdGhlIHByb3h5IHdlYiBzZXJ2ZXIuXG4gKiBAcGFyYW0gc2V0dGluZ3MgdGhlIGNvbmZpZ3VyYXRpb24gc2V0dGluZ3MgdG8gdXNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcnVuKHNldHRpbmdzOiBBcHBTZXR0aW5ncyk6IHZvaWQge1xuICBqdXB5dGVyLmluaXQoc2V0dGluZ3MpO1xuICByZXZlcnNlUHJveHkuaW5pdChzZXR0aW5ncyk7XG5cbiAgc2VydmVyID0gaHR0cC5jcmVhdGVTZXJ2ZXIocmVxdWVzdEhhbmRsZXIpO1xuICAvLyBEaXNhYmxlIEhUVFAga2VlcC1hbGl2ZSBjb25uZWN0aW9uIHRpbWVvdXRzIGluIG9yZGVyIHRvIGF2b2lkIGNvbm5lY3Rpb25cbiAgLy8gZmxha2VzLiBEZXRhaWxzOiBiLzExMjE1MTA2NFxuICBzZXJ2ZXIua2VlcEFsaXZlVGltZW91dCA9IDA7XG4gIHNlcnZlci5vbigndXBncmFkZScsIHNvY2tldEhhbmRsZXIpO1xuXG4gIGNvbnN0IHNvY2tldElvU2VydmVyID0gc29ja2V0cy5pbml0KHNlcnZlciwgc2V0dGluZ3MpO1xuXG4gIHNvY2tldElvSGFuZGxlcnMucHVzaChuZXcgU29ja2V0SW9Ub1B0eSgnL3R0eScsIHNlcnZlciwgc2V0dGluZ3Mua2VybmVsQ29udGFpbmVyTmFtZSB8fCAnJykpO1xuXG4gIGlmIChzZXR0aW5ncy5kZWJ1Z0FkYXB0ZXJNdWx0aXBsZXhlclBhdGgpIHtcbiAgICAvLyBIYW5kbGVyIG1hbmFnZXMgaXRzIG93biBsaWZldGltZS5cbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tdW51c2VkLWV4cHJlc3Npb25cbiAgICBuZXcgU29ja2V0SW9Ub0RhcChzZXR0aW5ncy5kZWJ1Z0FkYXB0ZXJNdWx0aXBsZXhlclBhdGgsIHNvY2tldElvU2VydmVyKTtcbiAgfVxuXG4gIGlmIChzZXR0aW5ncy5lbmFibGVMc3ApIHtcbiAgICBjb25zdCBjb250ZW50RGlyID0gcGF0aC5qb2luKHNldHRpbmdzLmRhdGFsYWJSb290LCBzZXR0aW5ncy5jb250ZW50RGlyKTtcbiAgICBjb25zdCBsb2dzRGlyID0gcGF0aC5qb2luKHNldHRpbmdzLmRhdGFsYWJSb290LCAnL3Zhci9sb2cvJyk7XG4gICAgLy8gSGFuZGxlciBtYW5hZ2VzIGl0cyBvd24gbGlmZXRpbWUuXG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLXVudXNlZC1leHByZXNzaW9uXG4gICAgbmV3IFB5dGhvbkxzcChzb2NrZXRJb1NlcnZlciwgX19kaXJuYW1lLCBjb250ZW50RGlyLCBsb2dzRGlyLCBzZXR0aW5ncy5rZXJuZWxDb250YWluZXJOYW1lKTtcbiAgfVxuXG4gIGxvZ2dpbmcuZ2V0TG9nZ2VyKCkuaW5mbygnU3RhcnRpbmcgc2VydmVyIGF0IGh0dHA6Ly9sb2NhbGhvc3Q6JWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0dGluZ3Muc2VydmVyUG9ydCk7XG4gIHByb2Nlc3Mub24oJ1NJR0lOVCcsICgpID0+IHByb2Nlc3MuZXhpdCgpKTtcbiAgY29uc3Qgb3B0aW9ucyA9IHtwb3J0OiBzZXR0aW5ncy5zZXJ2ZXJQb3J0LCBpcHY2T25seTogZmFsc2UsIGhvc3Q6IHNldHRpbmdzLnNlcnZlckhvc3QgfHwgJyd9O1xuICBpZiAoJ1RFU1RfVE1QRElSJyBpbiBwcm9jZXNzLmVudikge1xuICAgIC8vIFJlcXVpcmVkIHRvIGF2b2lkIFwiRUFGTk9TVVBQT1JUOiBhZGRyZXNzIGZhbWlseSBub3Qgc3VwcG9ydGVkXCIgb24gSVB2Ni1vbmx5IGVudmlyb25tZW50c1xuICAgIC8vIChub3RhYmx5LCBldmVuIHdpdGggdGhlIGhvc3Qgb3ZlcnJpZGUgYmVsb3cpLlxuICAgIG9wdGlvbnNbJ2lwdjZPbmx5J10gPSB0cnVlO1xuICAgIC8vIGlwdjZPbmx5IGFsb25lIGlzbid0IGVub3VnaCB0byBhdm9pZCBhdHRlbXB0aW5nIHRvIGJpbmQgdG8gMC4wLjAuMCAod2hpY2hcbiAgICAvLyBmYWlscyBvbiBJUHY2LW9ubHkgZW52aXJvbm1lbnRzKS4gIE5lZWQgdG8gc3BlY2lmeSBhbiBJUCBhZGRyZXNzIGJlY2F1c2VcbiAgICAvLyBETlMgcmVzb2x1dGlvbiBldmVuIG9mIGlwNi1sb2NhbGhvc3QgZmFpbHMgb24gc29tZSBzdWNoIGVudmlyb25tZW50cy5cbiAgICBvcHRpb25zWydob3N0J10gPSAnOjoxJztcbiAgfVxuICBzZXJ2ZXIubGlzdGVuKG9wdGlvbnMpO1xufVxuXG4vKipcbiAqIFN0b3BzIHRoZSBzZXJ2ZXIgYW5kIGFzc29jaWF0ZWQgSnVweXRlciBzZXJ2ZXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdG9wKCk6IHZvaWQge1xuICBqdXB5dGVyLmNsb3NlKCk7XG59XG4iXX0=