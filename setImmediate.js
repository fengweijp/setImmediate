/* jshint -W067 */
/* jshint unused: false */
(function(global, undefined) {
    'use strict';

    if (global.setImmediate) {
        return;
    }

    var doc = global.document;
    var slice = Array.prototype.slice;
    var toString = Object.prototype.toString;

    var handleManager = {
        implementation: {},
        nextId: 1,
        tasks: {},
        currentlyRunningATask: false,

        runIfPresent: function(handleId) {
            // From the spec: "Wait until any invocations of this algorithm started before this one have completed."
            // So if we're currently running a task, we'll need to delay this invocation.
            if (handleManager.currentlyRunningATask) {
                // Delay by doing a setTimeout. setImmediate was tried instead, but in Firefox 7 it generated a
                // "too much recursion" error.
                setTimeout( handleManager.partiallyApplied( handleManager.runIfPresent, handleId ), 0 );

            } else {
                var task = handleManager.tasks[ handleId ];

                if (task) {
                    handleManager.currentlyRunningATask = true;

                    try {
                        task();

                    } finally {
                        handleManager.unregister( handleId );
                        handleManager.currentlyRunningATask = false;
                    }
                }
            }
        },

        // This function accepts the same arguments as setImmediate, but
        // returns a function that requires no arguments.
        partiallyApplied: function(handler) {
            var args = slice.call(arguments, 1);

            return function() {
                if (typeof(handler) === 'function') {
                    handler.apply(undefined, args);

                } else {
                    /* jshint -W054 */
                    (new Function(String(handler)))();
                }
            };
        },

        register: function(args) {
            handleManager.tasks[ handleManager.nextId ] = handleManager.partiallyApplied.apply(undefined, args);
            return handleManager.nextId++;
        },

        unregister: function(handleId) {
            delete handleManager.tasks[ handleId ];
        }
    };

    /* implementation/messageChannel.js begin */
/* global handleManager */

handleManager.implementation.messageChannel = function() {
    var channel = new MessageChannel();

    channel.port1.onmessage = function(event) {
        var handle = event.data;
        handleManager.runIfPresent(handle);
    };

    return function() {
        var handleId = handleManager.register(arguments);
        channel.port2.postMessage(handleId);
        return handleId;
    };
};

/* implementation/messageChannel.js end */

    /* implementation/nextTick.js begin */
/* global global, handleManager */

handleManager.implementation.nextTick = function() {
    return function() {
        var handleId = handleManager.register(arguments);
        global.process.nextTick( handleManager.partiallyApplied( handleManager.runIfPresent, handleId ) );
        return handleId;
    };
};

/* implementation/nextTick.js end */

    /* implementation/postMessage.js begin */
/* global global, handleManager */

handleManager.implementation.postMessage = function() {
    // Installs an event handler on `global` for the `message` event: see
    // * https://developer.mozilla.org/en/DOM/window.postMessage
    // * http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#crossDocumentMessages

    var messagePrefix = 'setImmediate$' + Math.random() + '$';
    var onGlobalMessage = function(event) {
        if (event.source === global &&
            typeof(event.data) === 'string' &&
            event.data.indexOf(messagePrefix) === 0) {

            handleManager.runIfPresent(Number(event.data.slice(messagePrefix.length)));
        }
    };

    if (global.addEventListener) {
        global.addEventListener('message', onGlobalMessage, false);

    } else {
        global.attachEvent('onmessage', onGlobalMessage);
    }

    return function() {
        var handleId = handleManager.register(arguments);
        global.postMessage(messagePrefix + handleId, '*');
        return handleId;
    };
};

/* implementation/postMessage.js end */

    /* implementation/readyStateChange.js begin */
/* global handleManager, doc */

handleManager.implementation.readyStateChange = function() {
    var html = doc.documentElement;

    return function() {
        var handleId = handleManager.register(arguments);
        // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
        // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
        var script = doc.createElement('script');
        script.onreadystatechange = function() {
            handleManager.runIfPresent(handleId);
            script.onreadystatechange = null;
            html.removeChild(script);
            script = null;
        };
        html.appendChild(script);
        return handleId;
    };
};

/* implementation/readyStateChange.js end */

    /* implementation/setTimeout.js begin */
/* global handleManager */

handleManager.implementation.setTimeout = function() {
    return function() {
        var handleId = handleManager.register(arguments);
        setTimeout( handleManager.partiallyApplied( handleManager.runIfPresent, handleId ), 0 );
        return handleId;
    };
};

/* implementation/setTimeout.js end */



    function canUsePostMessage() {
        // The test against `importScripts` prevents this implementation from being installed inside a web worker,
        // where `global.postMessage` means something completely different and can't be used for this purpose.
        if (global.postMessage && !global.importScripts) {
            var postMessageIsAsynchronous = true;
            var oldOnMessage = global.onmessage;
            global.onmessage = function() {
                postMessageIsAsynchronous = false;
            };
            global.postMessage('', '*');
            global.onmessage = oldOnMessage;
            return postMessageIsAsynchronous;
        }
    }


    var implementation;

    // Don't get fooled by e.g. browserify environments.
    // For Node.js before 0.9
    if (toString.call(global.process) === '[object process]') {
        implementation = 'nextTick';

    // For non-IE10 modern browsers
    } else if (canUsePostMessage()) {
        implementation = 'postMessage';

    // For web workers, where supported
    } else if (global.MessageChannel) {
        implementation = 'messageChannel';

    // For IE 6–8
    } else if (doc && ('onreadystatechange' in doc.createElement('script'))) {
        implementation = 'readyStateChange';

    // For older browsers
    } else {
        implementation = 'setTimeout';
    }

    // If supported, we should attach to the prototype of global, since that is where setTimeout et al. live.
    var attachTo = Object.getPrototypeOf && Object.getPrototypeOf(global);
    attachTo = (attachTo && attachTo.setTimeout ? attachTo : global);

    attachTo.setImmediate = handleManager.implementation[ implementation ]();
    attachTo.clearImmediate = handleManager.unregister;

}(function() {
    return this || (1, eval)('this');
}()));
