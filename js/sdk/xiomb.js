/*!
 * xiomb v0.1.4
 * Copyright (c) 2026 Jaxima LLC
 * @license MIT
 * @link https://github.com/Xiomb/xiomb
 */

(function () {
  'use strict';

  /**
   * @this {Promise}
   */
  function finallyConstructor(callback) {
    var constructor = this.constructor;
    return this.then(
      function(value) {
        // @ts-ignore
        return constructor.resolve(callback()).then(function() {
          return value;
        });
      },
      function(reason) {
        // @ts-ignore
        return constructor.resolve(callback()).then(function() {
          // @ts-ignore
          return constructor.reject(reason);
        });
      }
    );
  }

  function allSettled(arr) {
    var P = this;
    return new P(function(resolve, reject) {
      if (!(arr && typeof arr.length !== 'undefined')) {
        return reject(
          new TypeError(
            typeof arr +
              ' ' +
              arr +
              ' is not iterable(cannot read property Symbol(Symbol.iterator))'
          )
        );
      }
      var args = Array.prototype.slice.call(arr);
      if (args.length === 0) return resolve([]);
      var remaining = args.length;

      function res(i, val) {
        if (val && (typeof val === 'object' || typeof val === 'function')) {
          var then = val.then;
          if (typeof then === 'function') {
            then.call(
              val,
              function(val) {
                res(i, val);
              },
              function(e) {
                args[i] = { status: 'rejected', reason: e };
                if (--remaining === 0) {
                  resolve(args);
                }
              }
            );
            return;
          }
        }
        args[i] = { status: 'fulfilled', value: val };
        if (--remaining === 0) {
          resolve(args);
        }
      }

      for (var i = 0; i < args.length; i++) {
        res(i, args[i]);
      }
    });
  }

  /**
   * @constructor
   */
  function AggregateError(errors, message) {
    (this.name = 'AggregateError'), (this.errors = errors);
    this.message = message || '';
  }
  AggregateError.prototype = Error.prototype;

  function any(arr) {
    var P = this;
    return new P(function(resolve, reject) {
      if (!(arr && typeof arr.length !== 'undefined')) {
        return reject(new TypeError('Promise.any accepts an array'));
      }

      var args = Array.prototype.slice.call(arr);
      if (args.length === 0) return reject();

      var rejectionReasons = [];
      for (var i = 0; i < args.length; i++) {
        try {
          P.resolve(args[i])
            .then(resolve)
            .catch(function(error) {
              rejectionReasons.push(error);
              if (rejectionReasons.length === args.length) {
                reject(
                  new AggregateError(
                    rejectionReasons,
                    'All promises were rejected'
                  )
                );
              }
            });
        } catch (ex) {
          reject(ex);
        }
      }
    });
  }

  // Store setTimeout reference so promise-polyfill will be unaffected by
  // other code modifying setTimeout (like sinon.useFakeTimers())
  var setTimeoutFunc = setTimeout;

  function isArray(x) {
    return Boolean(x && typeof x.length !== 'undefined');
  }

  function noop() {}

  // Polyfill for Function.prototype.bind
  function bind(fn, thisArg) {
    return function() {
      fn.apply(thisArg, arguments);
    };
  }

  /**
   * @constructor
   * @param {Function} fn
   */
  function Promise$1(fn) {
    if (!(this instanceof Promise$1))
      throw new TypeError('Promises must be constructed via new');
    if (typeof fn !== 'function') throw new TypeError('not a function');
    /** @type {!number} */
    this._state = 0;
    /** @type {!boolean} */
    this._handled = false;
    /** @type {Promise|undefined} */
    this._value = undefined;
    /** @type {!Array<!Function>} */
    this._deferreds = [];

    doResolve(fn, this);
  }

  function handle(self, deferred) {
    while (self._state === 3) {
      self = self._value;
    }
    if (self._state === 0) {
      self._deferreds.push(deferred);
      return;
    }
    self._handled = true;
    Promise$1._immediateFn(function() {
      var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
      if (cb === null) {
        (self._state === 1 ? resolve : reject)(deferred.promise, self._value);
        return;
      }
      var ret;
      try {
        ret = cb(self._value);
      } catch (e) {
        reject(deferred.promise, e);
        return;
      }
      resolve(deferred.promise, ret);
    });
  }

  function resolve(self, newValue) {
    try {
      // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
      if (newValue === self)
        throw new TypeError('A promise cannot be resolved with itself.');
      if (
        newValue &&
        (typeof newValue === 'object' || typeof newValue === 'function')
      ) {
        var then = newValue.then;
        if (newValue instanceof Promise$1) {
          self._state = 3;
          self._value = newValue;
          finale(self);
          return;
        } else if (typeof then === 'function') {
          doResolve(bind(then, newValue), self);
          return;
        }
      }
      self._state = 1;
      self._value = newValue;
      finale(self);
    } catch (e) {
      reject(self, e);
    }
  }

  function reject(self, newValue) {
    self._state = 2;
    self._value = newValue;
    finale(self);
  }

  function finale(self) {
    if (self._state === 2 && self._deferreds.length === 0) {
      Promise$1._immediateFn(function() {
        if (!self._handled) {
          Promise$1._unhandledRejectionFn(self._value);
        }
      });
    }

    for (var i = 0, len = self._deferreds.length; i < len; i++) {
      handle(self, self._deferreds[i]);
    }
    self._deferreds = null;
  }

  /**
   * @constructor
   */
  function Handler(onFulfilled, onRejected, promise) {
    this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
    this.onRejected = typeof onRejected === 'function' ? onRejected : null;
    this.promise = promise;
  }

  /**
   * Take a potentially misbehaving resolver function and make sure
   * onFulfilled and onRejected are only called once.
   *
   * Makes no guarantees about asynchrony.
   */
  function doResolve(fn, self) {
    var done = false;
    try {
      fn(
        function(value) {
          if (done) return;
          done = true;
          resolve(self, value);
        },
        function(reason) {
          if (done) return;
          done = true;
          reject(self, reason);
        }
      );
    } catch (ex) {
      if (done) return;
      done = true;
      reject(self, ex);
    }
  }

  Promise$1.prototype['catch'] = function(onRejected) {
    return this.then(null, onRejected);
  };

  Promise$1.prototype.then = function(onFulfilled, onRejected) {
    // @ts-ignore
    var prom = new this.constructor(noop);

    handle(this, new Handler(onFulfilled, onRejected, prom));
    return prom;
  };

  Promise$1.prototype['finally'] = finallyConstructor;

  Promise$1.all = function(arr) {
    return new Promise$1(function(resolve, reject) {
      if (!isArray(arr)) {
        return reject(new TypeError('Promise.all accepts an array'));
      }

      var args = Array.prototype.slice.call(arr);
      if (args.length === 0) return resolve([]);
      var remaining = args.length;

      function res(i, val) {
        try {
          if (val && (typeof val === 'object' || typeof val === 'function')) {
            var then = val.then;
            if (typeof then === 'function') {
              then.call(
                val,
                function(val) {
                  res(i, val);
                },
                reject
              );
              return;
            }
          }
          args[i] = val;
          if (--remaining === 0) {
            resolve(args);
          }
        } catch (ex) {
          reject(ex);
        }
      }

      for (var i = 0; i < args.length; i++) {
        res(i, args[i]);
      }
    });
  };

  Promise$1.any = any;

  Promise$1.allSettled = allSettled;

  Promise$1.resolve = function(value) {
    if (value && typeof value === 'object' && value.constructor === Promise$1) {
      return value;
    }

    return new Promise$1(function(resolve) {
      resolve(value);
    });
  };

  Promise$1.reject = function(value) {
    return new Promise$1(function(resolve, reject) {
      reject(value);
    });
  };

  Promise$1.race = function(arr) {
    return new Promise$1(function(resolve, reject) {
      if (!isArray(arr)) {
        return reject(new TypeError('Promise.race accepts an array'));
      }

      for (var i = 0, len = arr.length; i < len; i++) {
        Promise$1.resolve(arr[i]).then(resolve, reject);
      }
    });
  };

  // Use polyfill for setImmediate for performance gains
  Promise$1._immediateFn =
    // @ts-ignore
    (typeof setImmediate === 'function' &&
      function(fn) {
        // @ts-ignore
        setImmediate(fn);
      }) ||
    function(fn) {
      setTimeoutFunc(fn, 0);
    };

  Promise$1._unhandledRejectionFn = function _unhandledRejectionFn(err) {
    if (typeof console !== 'undefined' && console) {
      console.warn('Possible Unhandled Promise Rejection:', err); // eslint-disable-line no-console
    }
  };

  /** @suppress {undefinedVars} */
  var globalNS = (function() {
    // the only reliable means to get the global object is
    // `Function('return this')()`
    // However, this causes CSP violations in Chrome apps.
    if (typeof self !== 'undefined') {
      return self;
    }
    if (typeof window !== 'undefined') {
      return window;
    }
    if (typeof global !== 'undefined') {
      return global;
    }
    throw new Error('unable to locate global object');
  })();

  // Expose the polyfill if Promise is undefined or set to a
  // non-function value. The latter can be due to a named HTMLElement
  // being exposed by browsers for legacy reasons.
  // https://github.com/taylorhakes/promise-polyfill/issues/114
  if (typeof globalNS['Promise'] !== 'function') {
    globalNS['Promise'] = Promise$1;
  } else {
    if (!globalNS.Promise.prototype['finally']) {
      globalNS.Promise.prototype['finally'] = finallyConstructor;
    }
    if (!globalNS.Promise.allSettled) {
      globalNS.Promise.allSettled = allSettled;
    }
    if (!globalNS.Promise.any) {
      globalNS.Promise.any = any;
    }
  }

  function _arrayLikeToArray(r, a) {
    (null == a || a > r.length) && (a = r.length);
    for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
    return n;
  }
  function _classPrivateFieldLooseBase(e, t) {
    if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");
    return e;
  }
  var id = 0;
  function _classPrivateFieldLooseKey(e) {
    return "__private_" + id++ + "_" + e;
  }
  function _construct(t, e, r) {
    if (_isNativeReflectConstruct()) return Reflect.construct.apply(null, arguments);
    var o = [null];
    o.push.apply(o, e);
    var p = new (t.bind.apply(t, o))();
    return r && _setPrototypeOf(p, r.prototype), p;
  }
  function _createForOfIteratorHelperLoose(r, e) {
    var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
    if (t) return (t = t.call(r)).next.bind(t);
    if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e) {
      t && (r = t);
      var o = 0;
      return function () {
        return o >= r.length ? {
          done: true
        } : {
          done: false,
          value: r[o++]
        };
      };
    }
    throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  function _extends() {
    return _extends = Object.assign ? Object.assign.bind() : function (n) {
      for (var e = 1; e < arguments.length; e++) {
        var t = arguments[e];
        for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);
      }
      return n;
    }, _extends.apply(null, arguments);
  }
  function _getPrototypeOf(t) {
    return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) {
      return t.__proto__ || Object.getPrototypeOf(t);
    }, _getPrototypeOf(t);
  }
  function _inheritsLoose(t, o) {
    t.prototype = Object.create(o.prototype), t.prototype.constructor = t, _setPrototypeOf(t, o);
  }
  function _isNativeFunction(t) {
    try {
      return -1 !== Function.toString.call(t).indexOf("[native code]");
    } catch (n) {
      return "function" == typeof t;
    }
  }
  function _isNativeReflectConstruct() {
    try {
      var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));
    } catch (t) {}
    return (_isNativeReflectConstruct = function () {
      return !!t;
    })();
  }
  function _setPrototypeOf(t, e) {
    return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) {
      return t.__proto__ = e, t;
    }, _setPrototypeOf(t, e);
  }
  function _unsupportedIterableToArray(r, a) {
    if (r) {
      if ("string" == typeof r) return _arrayLikeToArray(r, a);
      var t = {}.toString.call(r).slice(8, -1);
      return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
    }
  }
  function _wrapNativeSuper(t) {
    var r = "function" == typeof Map ? new Map() : void 0;
    return _wrapNativeSuper = function (t) {
      if (null === t || !_isNativeFunction(t)) return t;
      if ("function" != typeof t) throw new TypeError("Super expression must either be null or a function");
      if (void 0 !== r) {
        if (r.has(t)) return r.get(t);
        r.set(t, Wrapper);
      }
      function Wrapper() {
        return _construct(t, arguments, _getPrototypeOf(this).constructor);
      }
      return Wrapper.prototype = Object.create(t.prototype, {
        constructor: {
          value: Wrapper,
          enumerable: false,
          writable: true,
          configurable: true
        }
      }), _setPrototypeOf(Wrapper, t);
    }, _wrapNativeSuper(t);
  }

  var _listenerMap = /*#__PURE__*/_classPrivateFieldLooseKey("listenerMap");
  var _add = /*#__PURE__*/_classPrivateFieldLooseKey("add");
  var xiombEmitter = /*#__PURE__*/function () {
    function xiombEmitter() {
      Object.defineProperty(this, _add, {
        value: _add2
      });
      Object.defineProperty(this, _listenerMap, {
        writable: true,
        value: {}
      });
    }
    var _proto = xiombEmitter.prototype;
    _proto.on = function on(name, callback) {
      return _classPrivateFieldLooseBase(this, _add)[_add](name, callback, false);
    };
    _proto.once = function once(name, callback) {
      return _classPrivateFieldLooseBase(this, _add)[_add](name, callback, true);
    };
    _proto.off = function off(name, callback) {
      if (!_classPrivateFieldLooseBase(this, _listenerMap)[_listenerMap].hasOwnProperty(name)) {
        return this;
      }
      var listenerList = _classPrivateFieldLooseBase(this, _listenerMap)[_listenerMap][name].filter(function (listener) {
        return listener.callback !== callback;
      });
      if (listenerList.length) {
        _classPrivateFieldLooseBase(this, _listenerMap)[_listenerMap][name] = listenerList;
      } else {
        delete _classPrivateFieldLooseBase(this, _listenerMap)[_listenerMap][name];
      }
      return this;
    };
    _proto.emit = function emit(name) {
      if (!_classPrivateFieldLooseBase(this, _listenerMap)[_listenerMap].hasOwnProperty(name)) {
        return this;
      }
      for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        args[_key - 1] = arguments[_key];
      }
      for (var _iterator = _createForOfIteratorHelperLoose(_classPrivateFieldLooseBase(this, _listenerMap)[_listenerMap][name].slice()), _step; !(_step = _iterator()).done;) {
        var listener = _step.value;
        if (listener.once) {
          this.off(name, listener.callback);
        }
        try {
          listener.callback.apply(this, args);
        } catch (e) {
          console.error('[xiomb]', e);
        }
      }
      return this;
    };
    return xiombEmitter;
  }();
  function _add2(name, callback, once) {
    if (typeof name !== 'string' || typeof callback !== 'function') {
      return this;
    }
    if (!_classPrivateFieldLooseBase(this, _listenerMap)[_listenerMap].hasOwnProperty(name)) {
      _classPrivateFieldLooseBase(this, _listenerMap)[_listenerMap][name] = [];
    }
    _classPrivateFieldLooseBase(this, _listenerMap)[_listenerMap][name].push({
      callback: callback,
      once: once
    });
    return this;
  }

  var xiombError = /*#__PURE__*/function (_Error) {
    function xiombError(name, message, cause) {
      var _this;
      var errorName = name || 'INTERNAL';
      _this = _Error.call(this, message || errorName) || this;
      _this.name = errorName;
      _this.cause = cause || null;
      return _this;
    }
    _inheritsLoose(xiombError, _Error);
    return xiombError;
  }(/*#__PURE__*/_wrapNativeSuper(Error));

  var getValue = function getValue(value) {
    return value === undefined ? null : value;
  };
  var _isPublish$3 = /*#__PURE__*/_classPrivateFieldLooseKey("isPublish");
  var _lastByteMap = /*#__PURE__*/_classPrivateFieldLooseKey("lastByteMap");
  var _createTrackStat = /*#__PURE__*/_classPrivateFieldLooseKey("createTrackStat");
  var xiombStat = /*#__PURE__*/function () {
    function xiombStat(isPublish) {
      Object.defineProperty(this, _createTrackStat, {
        value: _createTrackStat2
      });
      Object.defineProperty(this, _isPublish$3, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, _lastByteMap, {
        writable: true,
        value: {}
      });
      _classPrivateFieldLooseBase(this, _isPublish$3)[_isPublish$3] = isPublish;
    }
    var _proto = xiombStat.prototype;
    _proto.reset = function reset() {
      _classPrivateFieldLooseBase(this, _lastByteMap)[_lastByteMap] = {};
    };
    _proto.collect = function collect(peerConnection) {
      try {
        var _this = this;
        var stat = {
          timestamp: Date.now(),
          video: null,
          audio: null,
          rtt: null,
          remotePacketLostList: {}
        };
        if (!peerConnection) {
          return Promise.resolve(stat);
        }
        return Promise.resolve(peerConnection.getStats()).then(function (report) {
          var rtpType = _classPrivateFieldLooseBase(_this, _isPublish$3)[_isPublish$3] ? 'outbound-rtp' : 'inbound-rtp';
          report.forEach(function (item) {
            var kind = item.kind || item.mediaType;
            var isMediaKind = kind === 'video' || kind === 'audio';
            if (item.type === rtpType && !item.isRemote) {
              if (isMediaKind) {
                stat[kind] = _classPrivateFieldLooseBase(_this, _createTrackStat)[_createTrackStat](report, item);
              }
            } else if (item.type === 'candidate-pair' && item.nominated && item.state === 'succeeded') {
              stat.rtt = getValue(item.currentRoundTripTime);
            } else if (_classPrivateFieldLooseBase(_this, _isPublish$3)[_isPublish$3] && item.type === 'remote-inbound-rtp' && isMediaKind) {
              stat.remotePacketLostList[kind] = getValue(item.packetsLost);
            }
          });
          return stat;
        });
      } catch (e) {
        return Promise.reject(e);
      }
    };
    return xiombStat;
  }();
  function _createTrackStat2(report, item) {
    var byteCount = (_classPrivateFieldLooseBase(this, _isPublish$3)[_isPublish$3] ? item.bytesSent : item.bytesReceived) || 0;
    var lastByte = _classPrivateFieldLooseBase(this, _lastByteMap)[_lastByteMap][item.id];
    var seconds = lastByte ? (item.timestamp - lastByte.timestamp) / 1000 : 0;
    var codec = item.codecId ? report.get(item.codecId) : null;
    _classPrivateFieldLooseBase(this, _lastByteMap)[_lastByteMap][item.id] = {
      byteCount: byteCount,
      timestamp: item.timestamp
    };
    return {
      codec: codec && codec.mimeType ? codec.mimeType.split('/')[1] : null,
      bitrate: seconds > 0 ? Math.round((byteCount - lastByte.byteCount) * 8 / seconds) : 0,
      byteCount: byteCount,
      packetCount: getValue(_classPrivateFieldLooseBase(this, _isPublish$3)[_isPublish$3] ? item.packetsSent : item.packetsReceived),
      packetLostCount: getValue(item.packetsLost),
      jitter: getValue(item.jitter),
      width: getValue(item.frameWidth),
      height: getValue(item.frameHeight),
      fps: getValue(item.framesPerSecond),
      frameDroppedCount: getValue(item.framesDropped)
    };
  }

  function _catch$4(body, recover) {
    try {
      var result = body();
    } catch (e) {
      return recover(e);
    }
    if (result && result.then) {
      return result.then(void 0, recover);
    }
    return result;
  }
  var _getUserMedia2 = function _getUserMedia2(constraints) {
    try {
      var _this9 = this;
      var mediaDevices = navigator.mediaDevices;
      if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
        throw window.isSecureContext === false ? new xiombError('INSECURE_CONTEXT', 'Insecure context') : new xiombError('NOT_SUPPORTED', 'Not supported');
      }
      return Promise.resolve(_catch$4(function () {
        return Promise.resolve(requestUserMedia(mediaDevices, constraints));
      }, function (e) {
        var error = createMediaError(e);
        _this9.updateDeviceList().catch(function () {});
        _this9.emit('error', error);
        throw error;
      }));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var ICON_PATH_MAP = {
    mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z',
    cam: 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z',
    sound: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z',
    settings: 'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54a7.4 7.4 0 0 0-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58a5.8 5.8 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
    fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
  };
  var TEXT_MAP = {
    publishStart: 'Go live',
    publishStop: 'Stop',
    playStart: 'Play',
    playStop: 'Stop',
    preview: 'Preview',
    live: 'Live',
    devices: 'Devices',
    camera: 'Camera',
    microphone: 'Microphone',
    done: 'Done'
  };
  var ACTIVE_STATUS_LIST = ['connect', 'publish', 'play', 'reconnect'];
  var IDLE_TIMEOUT = 3000;
  var HLS_NETWORK_ERROR_MAX = 3;
  var createEl = function createEl(tagName, className, parentEl) {
    var el = document.createElement(tagName);
    if (className) {
      el.className = className;
    }
    if (parentEl) {
      parentEl.appendChild(el);
    }
    return el;
  };
  var createButtonEl = function createButtonEl(className, iconName, title, parentEl) {
    var el = createEl('button', "xiombPlayer_button " + className, parentEl);
    el.type = 'button';
    el.title = title || '';
    el.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"" + ICON_PATH_MAP[iconName] + "\"/><line class=\"xiombPlayer_slash\" x1=\"4\" y1=\"4\" x2=\"20\" y2=\"20\"/></svg>";
    return el;
  };
  var onClick = function onClick(el, callback) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      callback(e);
    });
  };
  var getDefaultConstraints = function getDefaultConstraints() {
    return {
      audio: true,
      video: {
        width: {
          ideal: 1280
        },
        height: {
          ideal: 720
        },
        frameRate: {
          ideal: 30
        }
      }
    };
  };
  var createMediaError = function createMediaError(e) {
    switch (e && e.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return new xiombError('PERMISSION_DENIED', 'Permission denied', e);
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return new xiombError('DEVICE_NOT_FOUND', 'Device not found', e);
      case 'NotReadableError':
      case 'TrackStartError':
      case 'AbortError':
        return new xiombError('DEVICE_BUSY', 'Device busy', e);
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return new xiombError('CONSTRAINT_NOT_SATISFIED', "Constraint not satisfied: " + (e.constraint || ''), e);
      case 'TypeError':
        return new xiombError('INVALID_CONSTRAINTS', 'Invalid constraints', e);
      default:
        return new xiombError('MEDIA_ERROR', e && e.message || 'Media error', e);
    }
  };
  var isConstraintError = function isConstraintError(e) {
    return !!e && (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError');
  };
  var getSimpleConstraints = function getSimpleConstraints(constraints) {
    var simpleConstraints = {};
    for (var _i = 0, _Object$keys = Object.keys(constraints); _i < _Object$keys.length; _i++) {
      var kind = _Object$keys[_i];
      var source = constraints[kind];
      simpleConstraints[kind] = typeof source === 'object' && source ? source.deviceId ? {
        deviceId: source.deviceId
      } : true : source;
    }
    return simpleConstraints;
  };
  var requestUserMedia = function requestUserMedia(mediaDevices, constraints) {
    try {
      return Promise.resolve(_catch$4(function () {
        return Promise.resolve(mediaDevices.getUserMedia(constraints));
      }, function (e) {
        var simpleConstraints = getSimpleConstraints(constraints);
        if (isConstraintError(e) && JSON.stringify(simpleConstraints) !== JSON.stringify(constraints)) {
          return mediaDevices.getUserMedia(simpleConstraints);
        }
        throw e;
      }));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var getTrackKind = function getTrackKind(kind) {
    return kind === 'videoinput' ? 'video' : 'audio';
  };
  var _isPublish$2 = /*#__PURE__*/_classPrivateFieldLooseKey("isPublish");
  var _targetEl = /*#__PURE__*/_classPrivateFieldLooseKey("targetEl");
  var _options$4 = /*#__PURE__*/_classPrivateFieldLooseKey("options");
  var _textMap = /*#__PURE__*/_classPrivateFieldLooseKey("textMap");
  var _idleTimer = /*#__PURE__*/_classPrivateFieldLooseKey("idleTimer");
  var _constraints = /*#__PURE__*/_classPrivateFieldLooseKey("constraints");
  var _params$1 = /*#__PURE__*/_classPrivateFieldLooseKey("params");
  var _rootEl = /*#__PURE__*/_classPrivateFieldLooseKey("rootEl");
  var _videoEl = /*#__PURE__*/_classPrivateFieldLooseKey("videoEl");
  var _titleEl = /*#__PURE__*/_classPrivateFieldLooseKey("titleEl");
  var _messageEl = /*#__PURE__*/_classPrivateFieldLooseKey("messageEl");
  var _actionEl = /*#__PURE__*/_classPrivateFieldLooseKey("actionEl");
  var _muteEl = /*#__PURE__*/_classPrivateFieldLooseKey("muteEl");
  var _videoMuteEl = /*#__PURE__*/_classPrivateFieldLooseKey("videoMuteEl");
  var _videoInputEl = /*#__PURE__*/_classPrivateFieldLooseKey("videoInputEl");
  var _audioInputEl = /*#__PURE__*/_classPrivateFieldLooseKey("audioInputEl");
  var _mediaStream$1 = /*#__PURE__*/_classPrivateFieldLooseKey("mediaStream");
  var _playURL$1 = /*#__PURE__*/_classPrivateFieldLooseKey("playURL");
  var _hlsObject = /*#__PURE__*/_classPrivateFieldLooseKey("hlsObject");
  var _hlsNetworkErrorCount = /*#__PURE__*/_classPrivateFieldLooseKey("hlsNetworkErrorCount");
  var _deviceIDMap = /*#__PURE__*/_classPrivateFieldLooseKey("deviceIDMap");
  var _captured = /*#__PURE__*/_classPrivateFieldLooseKey("captured");
  var _boundTrackList = /*#__PURE__*/_classPrivateFieldLooseKey("boundTrackList");
  var _status$3 = /*#__PURE__*/_classPrivateFieldLooseKey("status");
  var _muted = /*#__PURE__*/_classPrivateFieldLooseKey("muted");
  var _videoMuted = /*#__PURE__*/_classPrivateFieldLooseKey("videoMuted");
  var _volume = /*#__PURE__*/_classPrivateFieldLooseKey("volume");
  var _destroyed$1 = /*#__PURE__*/_classPrivateFieldLooseKey("destroyed");
  var _isKindEnabled$1 = /*#__PURE__*/_classPrivateFieldLooseKey("isKindEnabled");
  var _hasConstraint = /*#__PURE__*/_classPrivateFieldLooseKey("hasConstraint");
  var _filterConstraints = /*#__PURE__*/_classPrivateFieldLooseKey("filterConstraints");
  var _renderKindList = /*#__PURE__*/_classPrivateFieldLooseKey("renderKindList");
  var _getTrackList = /*#__PURE__*/_classPrivateFieldLooseKey("getTrackList");
  var _getTrack = /*#__PURE__*/_classPrivateFieldLooseKey("getTrack");
  var _hasSource = /*#__PURE__*/_classPrivateFieldLooseKey("hasSource");
  var _destroyHls = /*#__PURE__*/_classPrivateFieldLooseKey("destroyHls");
  var _loadPlayURL = /*#__PURE__*/_classPrivateFieldLooseKey("loadPlayURL");
  var _isActiveStatus = /*#__PURE__*/_classPrivateFieldLooseKey("isActiveStatus");
  var _render = /*#__PURE__*/_classPrivateFieldLooseKey("render");
  var _applyTrackState = /*#__PURE__*/_classPrivateFieldLooseKey("applyTrackState");
  var _bindTrackEnded = /*#__PURE__*/_classPrivateFieldLooseKey("bindTrackEnded");
  var _getUserMedia = /*#__PURE__*/_classPrivateFieldLooseKey("getUserMedia");
  var _getKindConstraints = /*#__PURE__*/_classPrivateFieldLooseKey("getKindConstraints");
  var _getCaptureConstraints = /*#__PURE__*/_classPrivateFieldLooseKey("getCaptureConstraints");
  var _getCurrentDeviceID = /*#__PURE__*/_classPrivateFieldLooseKey("getCurrentDeviceID");
  var _fillDeviceSelect = /*#__PURE__*/_classPrivateFieldLooseKey("fillDeviceSelect");
  var _toggleFullscreen = /*#__PURE__*/_classPrivateFieldLooseKey("toggleFullscreen");
  var _wake = /*#__PURE__*/_classPrivateFieldLooseKey("wake");
  var _createLayout = /*#__PURE__*/_classPrivateFieldLooseKey("createLayout");
  var xiombPlayer = /*#__PURE__*/function (_xiombEmitter) {
    function xiombPlayer(isPublish, targetEl, options) {
      var _this;
      _this = _xiombEmitter.call(this) || this;
      Object.defineProperty(_this, _createLayout, {
        value: _createLayout2
      });
      Object.defineProperty(_this, _fillDeviceSelect, {
        value: _fillDeviceSelect2
      });
      Object.defineProperty(_this, _getCurrentDeviceID, {
        value: _getCurrentDeviceID2
      });
      Object.defineProperty(_this, _getCaptureConstraints, {
        value: _getCaptureConstraints2
      });
      Object.defineProperty(_this, _getKindConstraints, {
        value: _getKindConstraints2
      });
      Object.defineProperty(_this, _getUserMedia, {
        value: _getUserMedia2
      });
      Object.defineProperty(_this, _bindTrackEnded, {
        value: _bindTrackEnded2
      });
      Object.defineProperty(_this, _applyTrackState, {
        value: _applyTrackState2
      });
      Object.defineProperty(_this, _render, {
        value: _render2
      });
      Object.defineProperty(_this, _isActiveStatus, {
        value: _isActiveStatus2
      });
      // hls.js через MSE, иначе родной HLS (Safari)
      Object.defineProperty(_this, _loadPlayURL, {
        value: _loadPlayURL2
      });
      Object.defineProperty(_this, _destroyHls, {
        value: _destroyHls2
      });
      Object.defineProperty(_this, _hasSource, {
        value: _hasSource2
      });
      Object.defineProperty(_this, _getTrack, {
        value: _getTrack2
      });
      Object.defineProperty(_this, _getTrackList, {
        value: _getTrackList2
      });
      Object.defineProperty(_this, _renderKindList, {
        value: _renderKindList2
      });
      Object.defineProperty(_this, _filterConstraints, {
        value: _filterConstraints2
      });
      Object.defineProperty(_this, _hasConstraint, {
        value: _hasConstraint2
      });
      Object.defineProperty(_this, _isKindEnabled$1, {
        value: _isKindEnabled2$1
      });
      Object.defineProperty(_this, _isPublish$2, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _targetEl, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _options$4, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _textMap, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _idleTimer, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _constraints, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _params$1, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _rootEl, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _videoEl, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _titleEl, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _messageEl, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _actionEl, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _muteEl, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _videoMuteEl, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _videoInputEl, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _audioInputEl, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _mediaStream$1, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _playURL$1, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _hlsObject, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _hlsNetworkErrorCount, {
        writable: true,
        value: 0
      });
      Object.defineProperty(_this, _deviceIDMap, {
        writable: true,
        value: {
          audioinput: '',
          videoinput: ''
        }
      });
      Object.defineProperty(_this, _captured, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _boundTrackList, {
        writable: true,
        value: []
      });
      Object.defineProperty(_this, _status$3, {
        writable: true,
        value: 'new'
      });
      Object.defineProperty(_this, _muted, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _videoMuted, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _volume, {
        writable: true,
        value: 1
      });
      Object.defineProperty(_this, _destroyed$1, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _toggleFullscreen, {
        writable: true,
        value: function value() {
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            return;
          }
          var request = _classPrivateFieldLooseBase(_this, _rootEl)[_rootEl].requestFullscreen || _classPrivateFieldLooseBase(_this, _rootEl)[_rootEl].webkitRequestFullscreen;
          if (request) {
            request.call(_classPrivateFieldLooseBase(_this, _rootEl)[_rootEl]);
          }
        }
      });
      Object.defineProperty(_this, _wake, {
        writable: true,
        value: function value() {
          _classPrivateFieldLooseBase(_this, _rootEl)[_rootEl].setAttribute('data-idle', false);
          clearTimeout(_classPrivateFieldLooseBase(_this, _idleTimer)[_idleTimer]);
          _classPrivateFieldLooseBase(_this, _idleTimer)[_idleTimer] = setTimeout(function () {
            if (_classPrivateFieldLooseBase(_this, _rootEl)[_rootEl].getAttribute('data-settings') === 'true') {
              return _classPrivateFieldLooseBase(_this, _wake)[_wake]();
            }
            _classPrivateFieldLooseBase(_this, _rootEl)[_rootEl].setAttribute('data-idle', true);
          }, IDLE_TIMEOUT);
        }
      });
      _classPrivateFieldLooseBase(_this, _isPublish$2)[_isPublish$2] = !!isPublish;
      _classPrivateFieldLooseBase(_this, _options$4)[_options$4] = options || {};
      _classPrivateFieldLooseBase(_this, _targetEl)[_targetEl] = targetEl && targetEl.jquery ? targetEl[0] : targetEl || null;
      _classPrivateFieldLooseBase(_this, _params$1)[_params$1] = _classPrivateFieldLooseBase(_this, _options$4)[_options$4].params || {
        audio: true,
        video: true
      };
      _classPrivateFieldLooseBase(_this, _constraints)[_constraints] = _classPrivateFieldLooseBase(_this, _filterConstraints)[_filterConstraints](_classPrivateFieldLooseBase(_this, _options$4)[_options$4].constraints || getDefaultConstraints());
      _classPrivateFieldLooseBase(_this, _textMap)[_textMap] = _extends({}, TEXT_MAP, _classPrivateFieldLooseBase(_this, _options$4)[_options$4].textList);
      _classPrivateFieldLooseBase(_this, _createLayout)[_createLayout]();
      _this.setTitle(_classPrivateFieldLooseBase(_this, _options$4)[_options$4].title || '');
      _classPrivateFieldLooseBase(_this, _render)[_render]();
      _classPrivateFieldLooseBase(_this, _wake)[_wake]();
      if (_classPrivateFieldLooseBase(_this, _targetEl)[_targetEl]) {
        _classPrivateFieldLooseBase(_this, _targetEl)[_targetEl].appendChild(_classPrivateFieldLooseBase(_this, _rootEl)[_rootEl]);
      }
      if (_classPrivateFieldLooseBase(_this, _isPublish$2)[_isPublish$2] && navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
        navigator.mediaDevices.addEventListener('devicechange', function () {
          if (!_classPrivateFieldLooseBase(_this, _destroyed$1)[_destroyed$1] && _classPrivateFieldLooseBase(_this, _mediaStream$1)[_mediaStream$1]) {
            _this.updateDeviceList().catch(function () {});
          }
        });
      }
      return _this;
    }
    _inheritsLoose(xiombPlayer, _xiombEmitter);
    var _proto = xiombPlayer.prototype;
    _proto.isPublish = function isPublish() {
      return _classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2];
    };
    _proto.getElement = function getElement() {
      return _classPrivateFieldLooseBase(this, _rootEl)[_rootEl];
    };
    _proto.getTargetElement = function getTargetElement() {
      return _classPrivateFieldLooseBase(this, _targetEl)[_targetEl];
    };
    _proto.getVideoElement = function getVideoElement() {
      return _classPrivateFieldLooseBase(this, _videoEl)[_videoEl];
    };
    _proto.getParams = function getParams() {
      return _classPrivateFieldLooseBase(this, _params$1)[_params$1];
    };
    _proto.getConstraints = function getConstraints() {
      return _classPrivateFieldLooseBase(this, _constraints)[_constraints];
    };
    _proto.setConstraints = function setConstraints(constraints) {
      _classPrivateFieldLooseBase(this, _constraints)[_constraints] = _classPrivateFieldLooseBase(this, _filterConstraints)[_filterConstraints](constraints || getDefaultConstraints());
      _classPrivateFieldLooseBase(this, _renderKindList)[_renderKindList]();
    };
    _proto.getMediaStream = function getMediaStream() {
      return _classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1];
    };
    _proto.isCaptured = function isCaptured() {
      return _classPrivateFieldLooseBase(this, _captured)[_captured];
    };
    _proto.isPlaying = function isPlaying() {
      return _classPrivateFieldLooseBase(this, _hasSource)[_hasSource]() && !_classPrivateFieldLooseBase(this, _videoEl)[_videoEl].paused;
    };
    _proto.isDestroyed = function isDestroyed() {
      return _classPrivateFieldLooseBase(this, _destroyed$1)[_destroyed$1];
    };
    _proto.getStatus = function getStatus() {
      return _classPrivateFieldLooseBase(this, _status$3)[_status$3];
    };
    _proto.setStatus = function setStatus(status, message) {
      _classPrivateFieldLooseBase(this, _status$3)[_status$3] = status || 'new';
      this.setMessage(message || '');
      _classPrivateFieldLooseBase(this, _render)[_render]();
    };
    _proto.setMessage = function setMessage(message) {
      _classPrivateFieldLooseBase(this, _messageEl)[_messageEl].textContent = message || '';
      _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].setAttribute('data-message', !!message);
    };
    _proto.setTitle = function setTitle(title) {
      _classPrivateFieldLooseBase(this, _titleEl)[_titleEl].textContent = title || '';
    };
    _proto.setText = function setText(key, text) {
      _classPrivateFieldLooseBase(this, _textMap)[_textMap][key] = text;
      _classPrivateFieldLooseBase(this, _render)[_render]();
    };
    _proto.getPlayURL = function getPlayURL() {
      return _classPrivateFieldLooseBase(this, _playURL$1)[_playURL$1];
    };
    _proto.setPlayURL = function setPlayURL(playURL, Hls, hlsConfig) {
      var nextPlayURL = playURL || null;
      if (_classPrivateFieldLooseBase(this, _playURL$1)[_playURL$1] === nextPlayURL) {
        return;
      }
      _classPrivateFieldLooseBase(this, _destroyHls)[_destroyHls]();
      if (nextPlayURL && _classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1]) {
        this.setMediaStream(null);
      }
      _classPrivateFieldLooseBase(this, _playURL$1)[_playURL$1] = nextPlayURL;
      if (_classPrivateFieldLooseBase(this, _playURL$1)[_playURL$1]) {
        _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].srcObject = null;
        _classPrivateFieldLooseBase(this, _loadPlayURL)[_loadPlayURL](Hls, hlsConfig);
      } else {
        _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].removeAttribute('src');
        _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].load();
      }
      _classPrivateFieldLooseBase(this, _render)[_render]();
    };
    _proto.setMediaStream = function setMediaStream(mediaStream, captured) {
      if (_classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1] === mediaStream) {
        return;
      }
      if (mediaStream && _classPrivateFieldLooseBase(this, _playURL$1)[_playURL$1]) {
        this.setPlayURL(null);
      }
      if (_classPrivateFieldLooseBase(this, _captured)[_captured]) {
        var nextTrackList = mediaStream ? mediaStream.getTracks() : [];
        for (var _iterator = _createForOfIteratorHelperLoose(_classPrivateFieldLooseBase(this, _getTrackList)[_getTrackList]()), _step; !(_step = _iterator()).done;) {
          var track = _step.value;
          if (nextTrackList.indexOf(track) === -1) {
            track.stop();
          }
        }
      }
      _classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1] = mediaStream || null;
      _classPrivateFieldLooseBase(this, _captured)[_captured] = !!mediaStream && !!captured;
      _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].srcObject = _classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1];
      if (_classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1]) {
        _classPrivateFieldLooseBase(this, _applyTrackState)[_applyTrackState]();
        _classPrivateFieldLooseBase(this, _bindTrackEnded)[_bindTrackEnded](_classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1]);
      }
      _classPrivateFieldLooseBase(this, _render)[_render]();
      this.emit('stream', _classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1]);
    };
    _proto.getUserMedia = function getUserMedia(constraints) {
      try {
        var _this2 = this;
        if (constraints) {
          _this2.setConstraints(constraints);
        }
        return Promise.resolve(_classPrivateFieldLooseBase(_this2, _getUserMedia)[_getUserMedia](_classPrivateFieldLooseBase(_this2, _getCaptureConstraints)[_getCaptureConstraints]())).then(function (mediaStream) {
          _this2.setMediaStream(mediaStream, true);
          _this2.updateDeviceList().catch(function () {});
          return Promise.resolve(_this2.play()).then(function () {
            return mediaStream;
          });
        });
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.setDevice = function setDevice(kind, deviceID) {
      try {
        var _temp2 = function _temp2(_result) {
          var _classPrivateFieldLoo;
          return _exit ? _result : Promise.resolve(_classPrivateFieldLooseBase(_this3, _getUserMedia)[_getUserMedia]((_classPrivateFieldLoo = {}, _classPrivateFieldLoo[trackKind] = _classPrivateFieldLooseBase(_this3, _getKindConstraints)[_getKindConstraints](trackKind, deviceID), _classPrivateFieldLoo))).then(function (deviceStream) {
            var trackList = _classPrivateFieldLooseBase(_this3, _getTrackList)[_getTrackList]().filter(function (track) {
              return track.kind !== trackKind;
            });
            _this3.setMediaStream(new MediaStream([].concat(trackList, deviceStream.getTracks())), true);
            _this3.updateDeviceList().catch(function () {});
            _this3.emit('device', kind, deviceID);
            return _this3.play();
          });
        };
        var _exit = false;
        var _this3 = this;
        var trackKind = getTrackKind(kind);
        if (!_classPrivateFieldLooseBase(_this3, _hasConstraint)[_hasConstraint](trackKind)) {
          throw new xiombError('INVALID_CONSTRAINTS', 'Invalid constraints');
        }
        _classPrivateFieldLooseBase(_this3, _deviceIDMap)[_deviceIDMap][kind] = deviceID || '';
        var _temp = function () {
          if (!_classPrivateFieldLooseBase(_this3, _mediaStream$1)[_mediaStream$1]) {
            return Promise.resolve(_this3.getUserMedia()).then(function (mediaStream) {
              _this3.emit('device', kind, deviceID);
              _exit = true;
              return mediaStream;
            });
          }
        }();
        return Promise.resolve(_temp && _temp.then ? _temp.then(_temp2) : _temp2(_temp));
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.getDeviceName = function getDeviceName(kind) {
      var track = _classPrivateFieldLooseBase(this, _getTrack)[_getTrack](getTrackKind(kind));
      return track ? track.label || '' : '';
    };
    _proto.getDeviceID = function getDeviceID(kind) {
      return _classPrivateFieldLooseBase(this, _getCurrentDeviceID)[_getCurrentDeviceID](getTrackKind(kind)) || _classPrivateFieldLooseBase(this, _deviceIDMap)[_deviceIDMap][kind] || '';
    };
    _proto.getDeviceList = function getDeviceList(kind) {
      try {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
          throw new xiombError('NOT_SUPPORTED', 'Not supported');
        }
        return Promise.resolve(navigator.mediaDevices.enumerateDevices()).then(function (deviceList) {
          return kind ? deviceList.filter(function (device) {
            return device.kind === kind;
          }) : deviceList;
        });
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.updateDeviceList = function updateDeviceList() {
      try {
        var _this4 = this;
        if (!_classPrivateFieldLooseBase(_this4, _isPublish$2)[_isPublish$2]) {
          return Promise.resolve([]);
        }
        return Promise.resolve(_this4.getDeviceList()).then(function (deviceList) {
          _classPrivateFieldLooseBase(_this4, _fillDeviceSelect)[_fillDeviceSelect](_classPrivateFieldLooseBase(_this4, _videoInputEl)[_videoInputEl], deviceList, 'videoinput', _classPrivateFieldLooseBase(_this4, _textMap)[_textMap].camera);
          _classPrivateFieldLooseBase(_this4, _fillDeviceSelect)[_fillDeviceSelect](_classPrivateFieldLooseBase(_this4, _audioInputEl)[_audioInputEl], deviceList, 'audioinput', _classPrivateFieldLooseBase(_this4, _textMap)[_textMap].microphone);
          return deviceList;
        });
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.openSettings = function openSettings() {
      _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].setAttribute('data-settings', true);
      this.updateDeviceList().catch(function () {});
    };
    _proto.closeSettings = function closeSettings() {
      _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].setAttribute('data-settings', false);
    };
    _proto.toggleSettings = function toggleSettings() {
      if (_classPrivateFieldLooseBase(this, _rootEl)[_rootEl].getAttribute('data-settings') === 'true') {
        this.closeSettings();
      } else {
        this.openSettings();
      }
    };
    _proto.play = function play() {
      try {
        var _temp4 = function _temp4(_result2) {
          if (_exit2) return _result2;
          _this5.emit('play');
        };
        var _exit2 = false;
        var _this5 = this;
        if (!_classPrivateFieldLooseBase(_this5, _hasSource)[_hasSource]()) {
          throw new xiombError('NO_STREAM', 'No stream');
        }
        var _temp3 = _catch$4(function () {
          return Promise.resolve(_classPrivateFieldLooseBase(_this5, _videoEl)[_videoEl].play()).then(function () {});
        }, function (e) {
          if (e && e.name === 'AbortError') {
            _exit2 = true;
            return;
          }
          if (!e || e.name !== 'NotAllowedError' || _classPrivateFieldLooseBase(_this5, _videoEl)[_videoEl].muted) {
            throw new xiombError('PLAY_FAILED', e && e.message, e);
          }
          _classPrivateFieldLooseBase(_this5, _muted)[_muted] = true;
          _classPrivateFieldLooseBase(_this5, _videoEl)[_videoEl].muted = true;
          _classPrivateFieldLooseBase(_this5, _render)[_render]();
          _this5.emit('mute', true);
          return _catch$4(function () {
            return Promise.resolve(_classPrivateFieldLooseBase(_this5, _videoEl)[_videoEl].play()).then(function () {});
          }, function (retryError) {
            throw new xiombError('AUTOPLAY_BLOCKED', 'Autoplay blocked', retryError);
          });
        });
        return Promise.resolve(_temp3 && _temp3.then ? _temp3.then(_temp4) : _temp4(_temp3));
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.pause = function pause() {
      _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].pause();
      this.emit('pause');
    };
    _proto.stop = function stop() {
      _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].pause();
      this.setMediaStream(null);
      this.setPlayURL(null);
      this.emit('stop');
    };
    _proto.mute = function mute() {
      _classPrivateFieldLooseBase(this, _muted)[_muted] = true;
      _classPrivateFieldLooseBase(this, _applyTrackState)[_applyTrackState]();
      if (!_classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2]) {
        _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].muted = true;
      }
      _classPrivateFieldLooseBase(this, _render)[_render]();
      this.emit('mute', true);
    };
    _proto.unmute = function unmute() {
      _classPrivateFieldLooseBase(this, _muted)[_muted] = false;
      _classPrivateFieldLooseBase(this, _applyTrackState)[_applyTrackState]();
      if (!_classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2]) {
        _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].muted = !_classPrivateFieldLooseBase(this, _isKindEnabled$1)[_isKindEnabled$1]('audio');
      }
      _classPrivateFieldLooseBase(this, _render)[_render]();
      this.emit('mute', false);
    };
    _proto.isMuted = function isMuted() {
      return _classPrivateFieldLooseBase(this, _muted)[_muted];
    };
    _proto.muteVideo = function muteVideo() {
      _classPrivateFieldLooseBase(this, _videoMuted)[_videoMuted] = true;
      _classPrivateFieldLooseBase(this, _applyTrackState)[_applyTrackState]();
      _classPrivateFieldLooseBase(this, _render)[_render]();
      this.emit('videoMute', true);
    };
    _proto.unmuteVideo = function unmuteVideo() {
      _classPrivateFieldLooseBase(this, _videoMuted)[_videoMuted] = false;
      _classPrivateFieldLooseBase(this, _applyTrackState)[_applyTrackState]();
      _classPrivateFieldLooseBase(this, _render)[_render]();
      this.emit('videoMute', false);
    };
    _proto.isVideoMuted = function isVideoMuted() {
      return _classPrivateFieldLooseBase(this, _videoMuted)[_videoMuted];
    };
    _proto.setVolume = function setVolume(volume) {
      _classPrivateFieldLooseBase(this, _volume)[_volume] = Math.min(1, Math.max(0, Number(volume) || 0));
      _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].volume = _classPrivateFieldLooseBase(this, _volume)[_volume];
      this.emit('volume', _classPrivateFieldLooseBase(this, _volume)[_volume]);
    };
    _proto.getVolume = function getVolume() {
      return _classPrivateFieldLooseBase(this, _volume)[_volume];
    };
    _proto.getVideoSize = function getVideoSize() {
      return {
        width: _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].videoWidth,
        height: _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].videoHeight
      };
    };
    _proto.destroy = function destroy() {
      if (_classPrivateFieldLooseBase(this, _destroyed$1)[_destroyed$1]) {
        return;
      }
      _classPrivateFieldLooseBase(this, _destroyed$1)[_destroyed$1] = true;
      clearTimeout(_classPrivateFieldLooseBase(this, _idleTimer)[_idleTimer]);
      this.stop();
      if (_classPrivateFieldLooseBase(this, _rootEl)[_rootEl].parentNode) {
        _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].parentNode.removeChild(_classPrivateFieldLooseBase(this, _rootEl)[_rootEl]);
      }
      this.emit('destroy');
    };
    return xiombPlayer;
  }(xiombEmitter);
  function _isKindEnabled2$1(kind) {
    return _classPrivateFieldLooseBase(this, _params$1)[_params$1][kind] !== false;
  }
  function _hasConstraint2(kind) {
    return _classPrivateFieldLooseBase(this, _isKindEnabled$1)[_isKindEnabled$1](kind) && !!_classPrivateFieldLooseBase(this, _constraints)[_constraints][kind];
  }
  function _filterConstraints2(constraints) {
    var filteredConstraints = {};
    for (var _i2 = 0, _Object$keys2 = Object.keys(constraints); _i2 < _Object$keys2.length; _i2++) {
      var key = _Object$keys2[_i2];
      if (_classPrivateFieldLooseBase(this, _isKindEnabled$1)[_isKindEnabled$1](key)) {
        filteredConstraints[key] = constraints[key];
      }
    }
    return filteredConstraints;
  }
  function _renderKindList2() {
    _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].setAttribute('data-audio', _classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2] ? _classPrivateFieldLooseBase(this, _hasConstraint)[_hasConstraint]('audio') : _classPrivateFieldLooseBase(this, _isKindEnabled$1)[_isKindEnabled$1]('audio'));
    _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].setAttribute('data-video', _classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2] ? _classPrivateFieldLooseBase(this, _hasConstraint)[_hasConstraint]('video') : _classPrivateFieldLooseBase(this, _isKindEnabled$1)[_isKindEnabled$1]('video'));
  }
  function _getTrackList2() {
    return _classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1] ? _classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1].getTracks() : [];
  }
  function _getTrack2(trackKind) {
    return _classPrivateFieldLooseBase(this, _getTrackList)[_getTrackList]().filter(function (track) {
      return track.kind === trackKind;
    })[0];
  }
  function _hasSource2() {
    return !!_classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1] || !!_classPrivateFieldLooseBase(this, _playURL$1)[_playURL$1];
  }
  function _destroyHls2() {
    if (_classPrivateFieldLooseBase(this, _hlsObject)[_hlsObject]) {
      _classPrivateFieldLooseBase(this, _hlsObject)[_hlsObject].destroy();
      _classPrivateFieldLooseBase(this, _hlsObject)[_hlsObject] = null;
    }
  }
  function _loadPlayURL2(Hls, hlsConfig) {
    var _this6 = this;
    if (!Hls || typeof Hls.isSupported !== 'function' || !Hls.isSupported()) {
      _classPrivateFieldLooseBase(this, _videoEl)[_videoEl].src = _classPrivateFieldLooseBase(this, _playURL$1)[_playURL$1];
      return;
    }
    var hlsObject = new Hls(hlsConfig || {});
    _classPrivateFieldLooseBase(this, _hlsObject)[_hlsObject] = hlsObject;
    _classPrivateFieldLooseBase(this, _hlsNetworkErrorCount)[_hlsNetworkErrorCount] = 0;
    hlsObject.on(Hls.Events.LEVEL_LOADED, function () {
      _classPrivateFieldLooseBase(_this6, _hlsNetworkErrorCount)[_hlsNetworkErrorCount] = 0;
    });
    hlsObject.on(Hls.Events.ERROR, function (event, data) {
      if (hlsObject !== _classPrivateFieldLooseBase(_this6, _hlsObject)[_hlsObject] || !data || !data.fatal) {
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && ++_classPrivateFieldLooseBase(_this6, _hlsNetworkErrorCount)[_hlsNetworkErrorCount] <= HLS_NETWORK_ERROR_MAX) {
        hlsObject.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hlsObject.recoverMediaError();
      } else {
        _this6.emit('playError', new xiombError('PLAY_FAILED', data.details, data));
      }
    });
    hlsObject.loadSource(_classPrivateFieldLooseBase(this, _playURL$1)[_playURL$1]);
    hlsObject.attachMedia(_classPrivateFieldLooseBase(this, _videoEl)[_videoEl]);
  }
  function _isActiveStatus2() {
    return ACTIVE_STATUS_LIST.indexOf(_classPrivateFieldLooseBase(this, _status$3)[_status$3]) !== -1;
  }
  function _render2() {
    var isActive = _classPrivateFieldLooseBase(this, _isActiveStatus)[_isActiveStatus]();
    _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].setAttribute('data-status', _classPrivateFieldLooseBase(this, _status$3)[_status$3]);
    _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].setAttribute('data-active', isActive);
    _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].setAttribute('data-muted', _classPrivateFieldLooseBase(this, _muted)[_muted]);
    _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].setAttribute('data-video-muted', _classPrivateFieldLooseBase(this, _videoMuted)[_videoMuted]);
    _classPrivateFieldLooseBase(this, _rootEl)[_rootEl].setAttribute('data-stream', _classPrivateFieldLooseBase(this, _hasSource)[_hasSource]());
    _classPrivateFieldLooseBase(this, _actionEl)[_actionEl].textContent = _classPrivateFieldLooseBase(this, _textMap)[_textMap][(_classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2] ? 'publish' : 'play') + (isActive ? 'Stop' : 'Start')];
    _classPrivateFieldLooseBase(this, _muteEl)[_muteEl].setAttribute('data-off', _classPrivateFieldLooseBase(this, _muted)[_muted]);
    _classPrivateFieldLooseBase(this, _videoMuteEl)[_videoMuteEl].setAttribute('data-off', _classPrivateFieldLooseBase(this, _videoMuted)[_videoMuted]);
  }
  function _applyTrackState2() {
    if (!_classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2] || !_classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1]) {
      return;
    }
    for (var _iterator2 = _createForOfIteratorHelperLoose(_classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1].getAudioTracks()), _step2; !(_step2 = _iterator2()).done;) {
      var track = _step2.value;
      track.enabled = !_classPrivateFieldLooseBase(this, _muted)[_muted];
    }
    for (var _iterator3 = _createForOfIteratorHelperLoose(_classPrivateFieldLooseBase(this, _mediaStream$1)[_mediaStream$1].getVideoTracks()), _step3; !(_step3 = _iterator3()).done;) {
      var _track = _step3.value;
      _track.enabled = !_classPrivateFieldLooseBase(this, _videoMuted)[_videoMuted];
    }
  }
  function _bindTrackEnded2(mediaStream) {
    var _this7 = this;
    var _loop = function _loop() {
      var track = _step4.value;
      if (_classPrivateFieldLooseBase(_this7, _boundTrackList)[_boundTrackList].indexOf(track) !== -1) {
        return 1; // continue
      }
      _classPrivateFieldLooseBase(_this7, _boundTrackList)[_boundTrackList].push(track);
      track.addEventListener('ended', function () {
        if (_classPrivateFieldLooseBase(_this7, _getTrackList)[_getTrackList]().indexOf(track) !== -1) {
          _this7.emit('ended', track.kind);
        }
      });
    };
    for (var _iterator4 = _createForOfIteratorHelperLoose(mediaStream.getTracks()), _step4; !(_step4 = _iterator4()).done;) {
      if (_loop()) continue;
    }
  }
  function _getKindConstraints2(kind, deviceID) {
    var source = _classPrivateFieldLooseBase(this, _constraints)[_constraints][kind];
    var constraints = typeof source === 'object' && source ? _extends({}, source) : {};
    if (deviceID) {
      constraints.deviceId = {
        exact: deviceID
      };
    }
    return constraints;
  }
  function _getCaptureConstraints2() {
    var constraints = {};
    var kindMap = {
      audio: 'audioinput',
      video: 'videoinput'
    };
    for (var _i3 = 0, _Object$keys3 = Object.keys(kindMap); _i3 < _Object$keys3.length; _i3++) {
      var kind = _Object$keys3[_i3];
      if (!_classPrivateFieldLooseBase(this, _hasConstraint)[_hasConstraint](kind)) {
        continue;
      }
      var deviceID = _classPrivateFieldLooseBase(this, _deviceIDMap)[_deviceIDMap][kindMap[kind]];
      constraints[kind] = deviceID || typeof _classPrivateFieldLooseBase(this, _constraints)[_constraints][kind] === 'object' ? _classPrivateFieldLooseBase(this, _getKindConstraints)[_getKindConstraints](kind, deviceID) : _classPrivateFieldLooseBase(this, _constraints)[_constraints][kind];
    }
    return constraints;
  }
  function _getCurrentDeviceID2(trackKind) {
    var track = _classPrivateFieldLooseBase(this, _getTrack)[_getTrack](trackKind);
    var settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
    return settings.deviceId || '';
  }
  function _fillDeviceSelect2(selectEl, deviceList, kind, label) {
    var currentDeviceID = _classPrivateFieldLooseBase(this, _getCurrentDeviceID)[_getCurrentDeviceID](getTrackKind(kind)) || _classPrivateFieldLooseBase(this, _deviceIDMap)[_deviceIDMap][kind];
    var itemList = deviceList.filter(function (device) {
      return device.kind === kind && device.deviceId;
    });
    selectEl.innerHTML = '';
    itemList.forEach(function (item, i) {
      var optionEl = createEl('option', '', selectEl);
      optionEl.value = item.deviceId;
      optionEl.textContent = item.label || label + " " + (i + 1);
      optionEl.selected = item.deviceId === currentDeviceID;
    });
    selectEl.disabled = itemList.length < 2;
  }
  function _createLayout2() {
    var _this8 = this;
    var rootEl = _classPrivateFieldLooseBase(this, _rootEl)[_rootEl] = createEl('div', 'xiombPlayer');
    rootEl.setAttribute('data-publish', _classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2]);
    rootEl.setAttribute('data-settings', false);
    _classPrivateFieldLooseBase(this, _renderKindList)[_renderKindList]();
    var videoEl = _classPrivateFieldLooseBase(this, _videoEl)[_videoEl] = createEl('video', 'xiombPlayer_video', createEl('div', 'xiombPlayer_screen', rootEl));
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    videoEl.muted = _classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2] || !_classPrivateFieldLooseBase(this, _isKindEnabled$1)[_isKindEnabled$1]('audio');
    videoEl.addEventListener('error', function () {
      if (_classPrivateFieldLooseBase(_this8, _playURL$1)[_playURL$1] && !_classPrivateFieldLooseBase(_this8, _hlsObject)[_hlsObject]) {
        _this8.emit('playError', new xiombError('PLAY_FAILED', 'Play failed'));
      }
    });
    var topEl = createEl('div', 'xiombPlayer_top', rootEl);
    var badgeEl = createEl('span', 'xiombPlayer_badge', topEl);
    createEl('span', 'xiombPlayer_badgePreview', badgeEl).textContent = _classPrivateFieldLooseBase(this, _textMap)[_textMap].preview;
    createEl('span', 'xiombPlayer_badgeLive', badgeEl).textContent = _classPrivateFieldLooseBase(this, _textMap)[_textMap].live;
    _classPrivateFieldLooseBase(this, _titleEl)[_titleEl] = createEl('span', 'xiombPlayer_title', topEl);
    onClick(createButtonEl('xiombPlayer_close', 'close', 'Close', topEl), function () {
      return _this8.destroy();
    });
    var centerEl = createEl('div', 'xiombPlayer_center', rootEl);
    createEl('span', 'xiombPlayer_spinner', centerEl);
    _classPrivateFieldLooseBase(this, _messageEl)[_messageEl] = createEl('span', 'xiombPlayer_message', centerEl);
    _classPrivateFieldLooseBase(this, _actionEl)[_actionEl] = createEl('button', 'xiombPlayer_action', centerEl);
    _classPrivateFieldLooseBase(this, _actionEl)[_actionEl].type = 'button';
    onClick(_classPrivateFieldLooseBase(this, _actionEl)[_actionEl], function () {
      return _this8.emit('request', _classPrivateFieldLooseBase(_this8, _isActiveStatus)[_isActiveStatus]() ? 'stop' : 'start');
    });
    var barEl = createEl('div', 'xiombPlayer_bar', rootEl);
    _classPrivateFieldLooseBase(this, _muteEl)[_muteEl] = createButtonEl('xiombPlayer_mute', _classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2] ? 'mic' : 'sound', _classPrivateFieldLooseBase(this, _isPublish$2)[_isPublish$2] ? 'Microphone' : 'Sound', barEl);
    onClick(_classPrivateFieldLooseBase(this, _muteEl)[_muteEl], function () {
      return _classPrivateFieldLooseBase(_this8, _muted)[_muted] ? _this8.unmute() : _this8.mute();
    });
    _classPrivateFieldLooseBase(this, _videoMuteEl)[_videoMuteEl] = createButtonEl('xiombPlayer_videoMute', 'cam', 'Camera', barEl);
    onClick(_classPrivateFieldLooseBase(this, _videoMuteEl)[_videoMuteEl], function () {
      return _classPrivateFieldLooseBase(_this8, _videoMuted)[_videoMuted] ? _this8.unmuteVideo() : _this8.muteVideo();
    });
    createEl('span', 'xiombPlayer_space', barEl);
    onClick(createButtonEl('xiombPlayer_settingsButton', 'settings', _classPrivateFieldLooseBase(this, _textMap)[_textMap].devices, barEl), function () {
      return _this8.toggleSettings();
    });
    onClick(createButtonEl('xiombPlayer_fullscreen', 'fullscreen', 'Fullscreen', barEl), _classPrivateFieldLooseBase(this, _toggleFullscreen)[_toggleFullscreen]);
    var settingsPanelEl = createEl('div', 'xiombPlayer_settings', rootEl);
    createEl('div', 'xiombPlayer_settingsTitle', settingsPanelEl).textContent = _classPrivateFieldLooseBase(this, _textMap)[_textMap].devices;
    var videoLabelEl = createEl('label', 'xiombPlayer_field xiombPlayer_fieldVideo', settingsPanelEl);
    createEl('span', '', videoLabelEl).textContent = _classPrivateFieldLooseBase(this, _textMap)[_textMap].camera;
    _classPrivateFieldLooseBase(this, _videoInputEl)[_videoInputEl] = createEl('select', '', videoLabelEl);
    var audioLabelEl = createEl('label', 'xiombPlayer_field xiombPlayer_fieldAudio', settingsPanelEl);
    createEl('span', '', audioLabelEl).textContent = _classPrivateFieldLooseBase(this, _textMap)[_textMap].microphone;
    _classPrivateFieldLooseBase(this, _audioInputEl)[_audioInputEl] = createEl('select', '', audioLabelEl);
    var doneEl = createEl('button', 'xiombPlayer_settingsDone', settingsPanelEl);
    doneEl.type = 'button';
    doneEl.textContent = _classPrivateFieldLooseBase(this, _textMap)[_textMap].done;
    onClick(doneEl, function () {
      return _this8.closeSettings();
    });
    _classPrivateFieldLooseBase(this, _videoInputEl)[_videoInputEl].addEventListener('change', function () {
      _this8.setDevice('videoinput', _classPrivateFieldLooseBase(_this8, _videoInputEl)[_videoInputEl].value).catch(function (error) {
        return _this8.emit('deviceError', error);
      });
    });
    _classPrivateFieldLooseBase(this, _audioInputEl)[_audioInputEl].addEventListener('change', function () {
      _this8.setDevice('audioinput', _classPrivateFieldLooseBase(_this8, _audioInputEl)[_audioInputEl].value).catch(function (error) {
        return _this8.emit('deviceError', error);
      });
    });
    rootEl.addEventListener('dblclick', _classPrivateFieldLooseBase(this, _toggleFullscreen)[_toggleFullscreen]);
    for (var _i4 = 0, _arr = ['mousemove', 'mouseenter', 'touchstart', 'click']; _i4 < _arr.length; _i4++) {
      var eventName = _arr[_i4];
      rootEl.addEventListener(eventName, _classPrivateFieldLooseBase(this, _wake)[_wake]);
    }
  }

  // MEDIA_NOT_FOUND — сервер проекта после перезапуска не знает медиа (ответ media.resume)
  var RESTART_REASON_LIST = ['SERVICE_UNAVAILABLE', 'MEDIA_TERMINATED', 'SESSION_RESET', 'MEDIA_NOT_FOUND'];
  var PLAY_RESTART_REASON_LIST = ['STREAM_ENDED', 'STREAM_NOT_FOUND', 'STREAM_NOT_READY'];
  var START_RETRY_REASON_LIST = ['NOT_CONNECTED', 'TIMEOUT'];
  var RESTART_DELAY_MIN = 1000;
  var RESTART_DELAY_MAX = 10000;

  /**
   * Перезапуск сессии после закрытия по причине, которую стоит повторить: переезд проекта на другое ядро и т.п.
   */
  var _isPublish$1 = /*#__PURE__*/_classPrivateFieldLooseKey("isPublish");
  var _options$3 = /*#__PURE__*/_classPrivateFieldLooseKey("options");
  var _startedAt = /*#__PURE__*/_classPrivateFieldLooseKey("startedAt");
  var _delay = /*#__PURE__*/_classPrivateFieldLooseKey("delay");
  var _timer = /*#__PURE__*/_classPrivateFieldLooseKey("timer");
  var _stopped = /*#__PURE__*/_classPrivateFieldLooseKey("stopped");
  var _getTimeout = /*#__PURE__*/_classPrivateFieldLooseKey("getTimeout");
  var xiombRestart = /*#__PURE__*/function () {
    function xiombRestart(isPublish, options) {
      Object.defineProperty(this, _getTimeout, {
        value: _getTimeout2
      });
      Object.defineProperty(this, _isPublish$1, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, _options$3, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, _startedAt, {
        writable: true,
        value: 0
      });
      Object.defineProperty(this, _delay, {
        writable: true,
        value: RESTART_DELAY_MIN
      });
      Object.defineProperty(this, _timer, {
        writable: true,
        value: null
      });
      Object.defineProperty(this, _stopped, {
        writable: true,
        value: false
      });
      _classPrivateFieldLooseBase(this, _isPublish$1)[_isPublish$1] = isPublish;
      _classPrivateFieldLooseBase(this, _options$3)[_options$3] = options;
    }
    var _proto = xiombRestart.prototype;
    _proto.canRestart = function canRestart(reason, isStartError) {
      if (_classPrivateFieldLooseBase(this, _stopped)[_stopped] || _classPrivateFieldLooseBase(this, _options$3)[_options$3].autoRestart === false || !reason || !reason.name) {
        return false;
      }
      var reasonList = [].concat(RESTART_REASON_LIST, _classPrivateFieldLooseBase(this, _isPublish$1)[_isPublish$1] ? [] : PLAY_RESTART_REASON_LIST, isStartError ? START_RETRY_REASON_LIST : []);
      if (reasonList.indexOf(reason.name) === -1) {
        return false;
      }
      return !_classPrivateFieldLooseBase(this, _startedAt)[_startedAt] || Date.now() - _classPrivateFieldLooseBase(this, _startedAt)[_startedAt] < _classPrivateFieldLooseBase(this, _getTimeout)[_getTimeout]();
    };
    _proto.schedule = function schedule(callback) {
      if (!_classPrivateFieldLooseBase(this, _startedAt)[_startedAt]) {
        _classPrivateFieldLooseBase(this, _startedAt)[_startedAt] = Date.now();
      }
      clearTimeout(_classPrivateFieldLooseBase(this, _timer)[_timer]);
      _classPrivateFieldLooseBase(this, _timer)[_timer] = setTimeout(callback, _classPrivateFieldLooseBase(this, _delay)[_delay]);
      _classPrivateFieldLooseBase(this, _delay)[_delay] = Math.min(_classPrivateFieldLooseBase(this, _delay)[_delay] * 2, RESTART_DELAY_MAX);
    };
    _proto.reset = function reset() {
      clearTimeout(_classPrivateFieldLooseBase(this, _timer)[_timer]);
      _classPrivateFieldLooseBase(this, _startedAt)[_startedAt] = 0;
      _classPrivateFieldLooseBase(this, _delay)[_delay] = RESTART_DELAY_MIN;
    };
    _proto.stop = function stop() {
      _classPrivateFieldLooseBase(this, _stopped)[_stopped] = true;
      clearTimeout(_classPrivateFieldLooseBase(this, _timer)[_timer]);
    };
    return xiombRestart;
  }();
  function _getTimeout2() {
    return _classPrivateFieldLooseBase(this, _options$3)[_options$3].restartTimeout || 60000;
  }

  function _catch$3(body, recover) {
    try {
      var result = body();
    } catch (e) {
      return recover(e);
    }
    if (result && result.then) {
      return result.then(void 0, recover);
    }
    return result;
  }
  var _applySignal2 = function _applySignal2(peerConnection, data) {
    try {
      var _this9 = this;
      var _temp1 = function () {
        if (data.description) {
          return Promise.resolve(peerConnection.setRemoteDescription(data.description)).then(function () {
            var candidateList = _classPrivateFieldLooseBase(_this9, _remoteCandidateList)[_remoteCandidateList];
            _classPrivateFieldLooseBase(_this9, _remoteCandidateList)[_remoteCandidateList] = [];
            return Promise.resolve(Promise.all(candidateList.map(function (candidate) {
              return peerConnection.addIceCandidate(candidate);
            }))).then(function () {});
          });
        } else {
          var _temp10 = function () {
            if (data.candidate && data.candidate.candidate) {
              var _temp9 = function () {
                if (peerConnection.remoteDescription) {
                  return Promise.resolve(peerConnection.addIceCandidate(data.candidate)).then(function () {});
                } else {
                  _classPrivateFieldLooseBase(_this9, _remoteCandidateList)[_remoteCandidateList].push(data.candidate);
                }
              }();
              if (_temp9 && _temp9.then) return _temp9.then(function () {});
            }
          }();
          if (_temp10 && _temp10.then) return _temp10.then(function () {});
        }
      }();
      return Promise.resolve(_temp1 && _temp1.then ? _temp1.then(function () {}) : void 0);
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var _attemptRestart2$1 = function _attemptRestart2() {
    try {
      var _temp8 = function _temp8(_result3) {
        if (_exit3) return _result3;
        _classPrivateFieldLooseBase(_this8, _restart$1)[_restart$1].reset();
        _this8.emit('restarted', {
          ID: _classPrivateFieldLooseBase(_this8, _ID$1)[_ID$1]
        });
        _this8.emit('status', {
          status: _classPrivateFieldLooseBase(_this8, _status$2)[_status$2],
          renegotiate: false,
          reason: null
        });
      };
      var _exit3 = false;
      var _this8 = this;
      if (_classPrivateFieldLooseBase(_this8, _closed$1)[_closed$1]) {
        return Promise.resolve();
      }
      var _temp7 = _catch$3(function () {
        return Promise.resolve(_classPrivateFieldLooseBase(_this8, _start$2)[_start$2]()).then(function () {});
      }, function (e) {
        if (_classPrivateFieldLooseBase(_this8, _closed$1)[_closed$1]) {
          _exit3 = true;
          return;
        }
        var reason = {
          name: e && e.name,
          message: e && e.message
        };
        if (_classPrivateFieldLooseBase(_this8, _restart$1)[_restart$1].canRestart(reason, true)) {
          _classPrivateFieldLooseBase(_this8, _restart$1)[_restart$1].schedule(function () {
            return _classPrivateFieldLooseBase(_this8, _attemptRestart$1)[_attemptRestart$1]();
          });
        } else {
          _classPrivateFieldLooseBase(_this8, _close$1)[_close$1](reason);
        }
        _exit3 = true;
      });
      return Promise.resolve(_temp7 && _temp7.then ? _temp7.then(_temp8) : _temp8(_temp7));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var _start2$2 = function _start2() {
    try {
      var _temp6 = function _temp6(_result) {
        var _exit2 = false;
        if (_exit) return _result;
        function _temp4(_result2) {
          if (_exit2) ;
          _classPrivateFieldLooseBase(_this7, _ID$1)[_ID$1] = mediaSessionInfo.ID;
          _classPrivateFieldLooseBase(_this7, _name$1)[_name$1] = mediaSessionInfo.name;
          _classPrivateFieldLooseBase(_this7, _status$2)[_status$2] = mediaSessionInfo.status;
          _classPrivateFieldLooseBase(_this7, _acceptPeerConnection)[_acceptPeerConnection]();
          _classPrivateFieldLooseBase(_this7, _xiomb$2)[_xiomb$2].addMediaSession(_this7);
          return _this7;
        }
        var _temp3 = function () {
          if (_classPrivateFieldLooseBase(_this7, _closed$1)[_closed$1]) {
            return Promise.resolve(_classPrivateFieldLooseBase(_this7, _xiomb$2)[_xiomb$2].request('media.close', {
              ID: mediaSessionInfo.ID
            }).catch(function () {})).then(function () {
              throw new xiombError('STOPPED', 'Stopped');
            });
          }
        }();
        return _temp3 && _temp3.then ? _temp3.then(_temp4) : _temp4(_temp3);
      };
      var _exit = false;
      var _this7 = this;
      var mediaSessionInfo;
      var _temp5 = _catch$3(function () {
        return Promise.resolve(_classPrivateFieldLooseBase(_this7, _createOffer)[_createOffer]()).then(function (offer) {
          return Promise.resolve(_classPrivateFieldLooseBase(_this7, _xiomb$2)[_xiomb$2].request("media." + _classPrivateFieldLooseBase(_this7, _direction)[_direction], {
            name: _classPrivateFieldLooseBase(_this7, _name$1)[_name$1],
            offer: offer,
            codecs: _classPrivateFieldLooseBase(_this7, _getCodecList)[_getCodecList](),
            projectID: _classPrivateFieldLooseBase(_this7, _options$2)[_options$2].projectID || '',
            custom: _classPrivateFieldLooseBase(_this7, _options$2)[_options$2].custom || {},
            turn: _classPrivateFieldLooseBase(_this7, _turn)[_turn]
          })).then(function (_classPrivateFieldLoo) {
            mediaSessionInfo = _classPrivateFieldLoo;
          });
        });
      }, function (e) {
        _classPrivateFieldLooseBase(_this7, _cleanup)[_cleanup]();
        throw e;
      });
      return Promise.resolve(_temp5 && _temp5.then ? _temp5.then(_temp6) : _temp6(_temp5));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var _renegotiate2$1 = function _renegotiate2() {
    try {
      var _temp2 = function _temp2() {
        _classPrivateFieldLooseBase(_this6, _renegotiating$1)[_renegotiating$1] = false;
        if (done) {
          _classPrivateFieldLooseBase(_this6, _retryDelay$1)[_retryDelay$1] = RENEGOTIATE_RETRY_MIN$1;
          _classPrivateFieldLooseBase(_this6, _acceptPeerConnection)[_acceptPeerConnection]();
        }
        _classPrivateFieldLooseBase(_this6, _localCandidateList)[_localCandidateList] = [];
        if (_classPrivateFieldLooseBase(_this6, _closed$1)[_closed$1] || !_classPrivateFieldLooseBase(_this6, _needRenegotiate$1)[_needRenegotiate$1]) {
          return;
        }
        if (done && _classPrivateFieldLooseBase(_this6, _renegotiateAgain)[_renegotiateAgain]) {
          return _classPrivateFieldLooseBase(_this6, _renegotiate$1)[_renegotiate$1]();
        }
        if (!done) {
          _classPrivateFieldLooseBase(_this6, _retryTimer$1)[_retryTimer$1] = setTimeout(function () {
            return _classPrivateFieldLooseBase(_this6, _renegotiate$1)[_renegotiate$1]();
          }, _classPrivateFieldLooseBase(_this6, _retryDelay$1)[_retryDelay$1]);
          _classPrivateFieldLooseBase(_this6, _retryDelay$1)[_retryDelay$1] = Math.min(_classPrivateFieldLooseBase(_this6, _retryDelay$1)[_retryDelay$1] * 2, RENEGOTIATE_RETRY_MAX$1);
        }
      };
      var _this6 = this;
      if (_classPrivateFieldLooseBase(_this6, _closed$1)[_closed$1] || !_classPrivateFieldLooseBase(_this6, _needRenegotiate$1)[_needRenegotiate$1]) {
        return Promise.resolve();
      }
      if (_classPrivateFieldLooseBase(_this6, _renegotiating$1)[_renegotiating$1]) {
        _classPrivateFieldLooseBase(_this6, _renegotiateAgain)[_renegotiateAgain] = true;
        return Promise.resolve();
      }
      clearTimeout(_classPrivateFieldLooseBase(_this6, _retryTimer$1)[_retryTimer$1]);
      _classPrivateFieldLooseBase(_this6, _renegotiating$1)[_renegotiating$1] = true;
      _classPrivateFieldLooseBase(_this6, _renegotiateAgain)[_renegotiateAgain] = false;
      var done = false;
      var _temp = _catch$3(function () {
        return Promise.resolve(_classPrivateFieldLooseBase(_this6, _createOffer)[_createOffer]()).then(function (offer) {
          return Promise.resolve(_classPrivateFieldLooseBase(_this6, _xiomb$2)[_xiomb$2].request('media.renegotiate', {
            ID: _classPrivateFieldLooseBase(_this6, _ID$1)[_ID$1],
            offer: offer,
            codecs: _classPrivateFieldLooseBase(_this6, _getCodecList)[_getCodecList](),
            turn: _classPrivateFieldLooseBase(_this6, _turn)[_turn]
          })).then(function () {
            done = true;
          });
        });
      }, function (e) {
        console.warn('[xiomb] renegotiate failed:', e && e.name);
        _classPrivateFieldLooseBase(_this6, _restorePreviousPeerConnection)[_restorePreviousPeerConnection]();
      });
      return Promise.resolve(_temp && _temp.then ? _temp.then(_temp2) : _temp2(_temp));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var _createOffer2 = function _createOffer2() {
    try {
      var _this5 = this;
      // старая нода показывает, пока новая не подключится
      if (_classPrivateFieldLooseBase(_this5, _peerConnection)[_peerConnection] && !_classPrivateFieldLooseBase(_this5, _previousPeerConnection)[_previousPeerConnection] && _classPrivateFieldLooseBase(_this5, _peerConnectionAccepted)[_peerConnectionAccepted] && _classPrivateFieldLooseBase(_this5, _peerConnection)[_peerConnection].connectionState === 'connected') {
        _classPrivateFieldLooseBase(_this5, _previousPeerConnection)[_previousPeerConnection] = _classPrivateFieldLooseBase(_this5, _peerConnection)[_peerConnection];
      } else if (_classPrivateFieldLooseBase(_this5, _peerConnection)[_peerConnection]) {
        _classPrivateFieldLooseBase(_this5, _peerConnection)[_peerConnection].close();
      }
      _classPrivateFieldLooseBase(_this5, _peerConnection)[_peerConnection] = null;
      _classPrivateFieldLooseBase(_this5, _pendingTrackList)[_pendingTrackList] = [];
      _classPrivateFieldLooseBase(_this5, _remoteCandidateList)[_remoteCandidateList] = [];
      _classPrivateFieldLooseBase(_this5, _localCandidateList)[_localCandidateList] = [];
      _classPrivateFieldLooseBase(_this5, _peerConnectionAccepted)[_peerConnectionAccepted] = false;
      return Promise.resolve(_classPrivateFieldLooseBase(_this5, _xiomb$2)[_xiomb$2].getIceServers()).then(function (_ref) {
        var iceServerList = _ref.iceServerList,
          turn = _ref.turn;
        _classPrivateFieldLooseBase(_this5, _turn)[_turn] = turn;
        var peerConnection = new RTCPeerConnection({
          iceServers: iceServerList
        });
        _classPrivateFieldLooseBase(_this5, _peerConnection)[_peerConnection] = peerConnection;
        peerConnection.onicecandidate = function (event) {
          if (!event.candidate || peerConnection !== _classPrivateFieldLooseBase(_this5, _peerConnection)[_peerConnection]) {
            return;
          }
          var candidate = {
            candidate: event.candidate.candidate,
            sdpMLineIndex: event.candidate.sdpMLineIndex
          };
          if (_classPrivateFieldLooseBase(_this5, _peerConnectionAccepted)[_peerConnectionAccepted]) {
            _classPrivateFieldLooseBase(_this5, _sendCandidate)[_sendCandidate](candidate);
          } else {
            _classPrivateFieldLooseBase(_this5, _localCandidateList)[_localCandidateList].push(candidate);
          }
        };
        peerConnection.onconnectionstatechange = function () {
          if (peerConnection !== _classPrivateFieldLooseBase(_this5, _peerConnection)[_peerConnection]) {
            return;
          }
          if (peerConnection.connectionState === 'connected' || peerConnection.connectionState === 'failed') {
            _classPrivateFieldLooseBase(_this5, _closePreviousPeerConnection)[_closePreviousPeerConnection]();
          }
          _this5.emit('state', peerConnection.connectionState);
        };
        if (_this5.isPublish()) {
          for (var _iterator6 = _createForOfIteratorHelperLoose(_classPrivateFieldLooseBase(_this5, _mediaStream)[_mediaStream].getTracks()), _step6; !(_step6 = _iterator6()).done;) {
            var track = _step6.value;
            if (_classPrivateFieldLooseBase(_this5, _isKindEnabled)[_isKindEnabled](track.kind)) {
              peerConnection.addTrack(track, _classPrivateFieldLooseBase(_this5, _mediaStream)[_mediaStream]);
            }
          }
          _classPrivateFieldLooseBase(_this5, _addInactiveTransceiver)[_addInactiveTransceiver](peerConnection);
        } else {
          peerConnection.addTransceiver('video', {
            direction: _classPrivateFieldLooseBase(_this5, _isKindEnabled)[_isKindEnabled]('video') ? 'recvonly' : 'inactive'
          });
          peerConnection.addTransceiver('audio', {
            direction: _classPrivateFieldLooseBase(_this5, _isKindEnabled)[_isKindEnabled]('audio') ? 'recvonly' : 'inactive'
          });
          peerConnection.ontrack = function (event) {
            if (peerConnection !== _classPrivateFieldLooseBase(_this5, _peerConnection)[_peerConnection]) {
              return;
            }
            if (_classPrivateFieldLooseBase(_this5, _previousPeerConnection)[_previousPeerConnection]) {
              _classPrivateFieldLooseBase(_this5, _pendingTrackList)[_pendingTrackList].push(event.track);
            } else {
              _classPrivateFieldLooseBase(_this5, _addTrack)[_addTrack](event.track);
            }
          };
        }
        _classPrivateFieldLooseBase(_this5, _preferCodecList)[_preferCodecList](peerConnection);
        return Promise.resolve(peerConnection.createOffer()).then(function (offer) {
          return Promise.resolve(peerConnection.setLocalDescription(offer)).then(function () {
            return {
              type: offer.type,
              sdp: offer.sdp
            };
          });
        });
      });
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var RENEGOTIATE_RETRY_MIN$1 = 1000;
  var RENEGOTIATE_RETRY_MAX$1 = 5000;
  var SERVICE_CODEC_LIST = ['RTX', 'RED', 'ULPFEC', 'FLEXFEC-03', 'CN', 'TELEPHONE-EVENT'];
  var _xiomb$2 = /*#__PURE__*/_classPrivateFieldLooseKey("xiomb");
  var _direction = /*#__PURE__*/_classPrivateFieldLooseKey("direction");
  var _name$1 = /*#__PURE__*/_classPrivateFieldLooseKey("name");
  var _options$2 = /*#__PURE__*/_classPrivateFieldLooseKey("options");
  var _ID$1 = /*#__PURE__*/_classPrivateFieldLooseKey("ID");
  var _turn = /*#__PURE__*/_classPrivateFieldLooseKey("turn");
  var _status$2 = /*#__PURE__*/_classPrivateFieldLooseKey("status");
  var _lastStat$1 = /*#__PURE__*/_classPrivateFieldLooseKey("lastStat");
  var _closed$1 = /*#__PURE__*/_classPrivateFieldLooseKey("closed");
  var _peerConnection = /*#__PURE__*/_classPrivateFieldLooseKey("peerConnection");
  var _peerConnectionAccepted = /*#__PURE__*/_classPrivateFieldLooseKey("peerConnectionAccepted");
  var _previousPeerConnection = /*#__PURE__*/_classPrivateFieldLooseKey("previousPeerConnection");
  var _pendingTrackList = /*#__PURE__*/_classPrivateFieldLooseKey("pendingTrackList");
  var _mediaStream = /*#__PURE__*/_classPrivateFieldLooseKey("mediaStream");
  var _localCandidateList = /*#__PURE__*/_classPrivateFieldLooseKey("localCandidateList");
  var _remoteCandidateList = /*#__PURE__*/_classPrivateFieldLooseKey("remoteCandidateList");
  var _renegotiating$1 = /*#__PURE__*/_classPrivateFieldLooseKey("renegotiating");
  var _needRenegotiate$1 = /*#__PURE__*/_classPrivateFieldLooseKey("needRenegotiate");
  var _renegotiateAgain = /*#__PURE__*/_classPrivateFieldLooseKey("renegotiateAgain");
  var _retryDelay$1 = /*#__PURE__*/_classPrivateFieldLooseKey("retryDelay");
  var _retryTimer$1 = /*#__PURE__*/_classPrivateFieldLooseKey("retryTimer");
  var _restart$1 = /*#__PURE__*/_classPrivateFieldLooseKey("restart");
  var _isKindEnabled = /*#__PURE__*/_classPrivateFieldLooseKey("isKindEnabled");
  var _addInactiveTransceiver = /*#__PURE__*/_classPrivateFieldLooseKey("addInactiveTransceiver");
  var _getCodecList = /*#__PURE__*/_classPrivateFieldLooseKey("getCodecList");
  var _sendCandidate = /*#__PURE__*/_classPrivateFieldLooseKey("sendCandidate");
  var _acceptPeerConnection = /*#__PURE__*/_classPrivateFieldLooseKey("acceptPeerConnection");
  var _closePreviousPeerConnection = /*#__PURE__*/_classPrivateFieldLooseKey("closePreviousPeerConnection");
  var _addTrack = /*#__PURE__*/_classPrivateFieldLooseKey("addTrack");
  var _cleanup = /*#__PURE__*/_classPrivateFieldLooseKey("cleanup");
  var _preferCodecList = /*#__PURE__*/_classPrivateFieldLooseKey("preferCodecList");
  var _createOffer = /*#__PURE__*/_classPrivateFieldLooseKey("createOffer");
  var _restorePreviousPeerConnection = /*#__PURE__*/_classPrivateFieldLooseKey("restorePreviousPeerConnection");
  var _renegotiate$1 = /*#__PURE__*/_classPrivateFieldLooseKey("renegotiate");
  var _start$2 = /*#__PURE__*/_classPrivateFieldLooseKey("start");
  var _restartLater$1 = /*#__PURE__*/_classPrivateFieldLooseKey("restartLater");
  var _attemptRestart$1 = /*#__PURE__*/_classPrivateFieldLooseKey("attemptRestart");
  var _close$1 = /*#__PURE__*/_classPrivateFieldLooseKey("close");
  var _applySignal = /*#__PURE__*/_classPrivateFieldLooseKey("applySignal");
  var xiombSession = /*#__PURE__*/function (_xiombEmitter) {
    function xiombSession(xiomb, direction, _name2, options) {
      var _this;
      _this = _xiombEmitter.call(this) || this;
      Object.defineProperty(_this, _applySignal, {
        value: _applySignal2
      });
      Object.defineProperty(_this, _close$1, {
        value: _close2$1
      });
      Object.defineProperty(_this, _attemptRestart$1, {
        value: _attemptRestart2$1
      });
      Object.defineProperty(_this, _restartLater$1, {
        value: _restartLater2$1
      });
      Object.defineProperty(_this, _start$2, {
        value: _start2$2
      });
      Object.defineProperty(_this, _renegotiate$1, {
        value: _renegotiate2$1
      });
      Object.defineProperty(_this, _restorePreviousPeerConnection, {
        value: _restorePreviousPeerConnection2
      });
      Object.defineProperty(_this, _createOffer, {
        value: _createOffer2
      });
      Object.defineProperty(_this, _preferCodecList, {
        value: _preferCodecList2
      });
      Object.defineProperty(_this, _cleanup, {
        value: _cleanup2
      });
      Object.defineProperty(_this, _addTrack, {
        value: _addTrack2
      });
      Object.defineProperty(_this, _closePreviousPeerConnection, {
        value: _closePreviousPeerConnection2
      });
      Object.defineProperty(_this, _acceptPeerConnection, {
        value: _acceptPeerConnection2
      });
      Object.defineProperty(_this, _sendCandidate, {
        value: _sendCandidate2
      });
      Object.defineProperty(_this, _getCodecList, {
        value: _getCodecList2
      });
      Object.defineProperty(_this, _addInactiveTransceiver, {
        value: _addInactiveTransceiver2
      });
      Object.defineProperty(_this, _isKindEnabled, {
        value: _isKindEnabled2
      });
      Object.defineProperty(_this, _xiomb$2, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _direction, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _name$1, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _options$2, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _ID$1, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _turn, {
        writable: true,
        value: ''
      });
      Object.defineProperty(_this, _status$2, {
        writable: true,
        value: 'connect'
      });
      Object.defineProperty(_this, _lastStat$1, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _closed$1, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _peerConnection, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _peerConnectionAccepted, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _previousPeerConnection, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _pendingTrackList, {
        writable: true,
        value: []
      });
      Object.defineProperty(_this, _mediaStream, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _localCandidateList, {
        writable: true,
        value: []
      });
      Object.defineProperty(_this, _remoteCandidateList, {
        writable: true,
        value: []
      });
      Object.defineProperty(_this, _renegotiating$1, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _needRenegotiate$1, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _renegotiateAgain, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _retryDelay$1, {
        writable: true,
        value: RENEGOTIATE_RETRY_MIN$1
      });
      Object.defineProperty(_this, _retryTimer$1, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _restart$1, {
        writable: true,
        value: void 0
      });
      _classPrivateFieldLooseBase(_this, _xiomb$2)[_xiomb$2] = xiomb;
      _classPrivateFieldLooseBase(_this, _direction)[_direction] = direction;
      _classPrivateFieldLooseBase(_this, _name$1)[_name$1] = _name2;
      _classPrivateFieldLooseBase(_this, _options$2)[_options$2] = options || {};
      _classPrivateFieldLooseBase(_this, _restart$1)[_restart$1] = new xiombRestart(direction === 'publish', _classPrivateFieldLooseBase(_this, _options$2)[_options$2]);
      _classPrivateFieldLooseBase(_this, _mediaStream)[_mediaStream] = direction === 'publish' ? _classPrivateFieldLooseBase(_this, _options$2)[_options$2].mediaStream : new MediaStream();
      return _this;
    }
    _inheritsLoose(xiombSession, _xiombEmitter);
    var _proto = xiombSession.prototype;
    _proto.getID = function getID() {
      return _classPrivateFieldLooseBase(this, _ID$1)[_ID$1];
    };
    _proto.getName = function getName() {
      return _classPrivateFieldLooseBase(this, _name$1)[_name$1];
    };
    _proto.getDirection = function getDirection() {
      return _classPrivateFieldLooseBase(this, _direction)[_direction];
    };
    _proto.isPublish = function isPublish() {
      return _classPrivateFieldLooseBase(this, _direction)[_direction] === 'publish';
    };
    _proto.getTransport = function getTransport() {
      return 'webrtc';
    };
    _proto.getPlayURL = function getPlayURL() {
      return null;
    };
    _proto.getStatus = function getStatus() {
      return _classPrivateFieldLooseBase(this, _status$2)[_status$2];
    };
    _proto.isClosed = function isClosed() {
      return _classPrivateFieldLooseBase(this, _closed$1)[_closed$1];
    };
    _proto.getMediaStream = function getMediaStream() {
      return _classPrivateFieldLooseBase(this, _mediaStream)[_mediaStream];
    };
    _proto.getPeerConnection = function getPeerConnection() {
      return _classPrivateFieldLooseBase(this, _peerConnection)[_peerConnection];
    };
    _proto.getLastStat = function getLastStat() {
      return _classPrivateFieldLooseBase(this, _lastStat$1)[_lastStat$1];
    };
    _proto.replaceMediaStream = function replaceMediaStream(mediaStream) {
      try {
        var _this2 = this;
        if (!_this2.isPublish()) {
          return Promise.resolve();
        }
        _classPrivateFieldLooseBase(_this2, _mediaStream)[_mediaStream] = mediaStream;
        var transceiverList = _classPrivateFieldLooseBase(_this2, _peerConnection)[_peerConnection] ? _classPrivateFieldLooseBase(_this2, _peerConnection)[_peerConnection].getTransceivers() : [];
        var promiseList = [];
        var _loop = function _loop() {
          var transceiver = _step.value;
          var kind = transceiver.receiver.track ? transceiver.receiver.track.kind : null;
          if (!_classPrivateFieldLooseBase(_this2, _isKindEnabled)[_isKindEnabled](kind)) {
            return 1; // continue
          }
          var track = mediaStream.getTracks().filter(function (mediaTrack) {
            return mediaTrack.kind === kind;
          })[0] || null;
          if (transceiver.sender.track !== track) {
            promiseList.push(transceiver.sender.replaceTrack(track));
          }
        };
        for (var _iterator = _createForOfIteratorHelperLoose(transceiverList), _step; !(_step = _iterator()).done;) {
          if (_loop()) continue;
        }
        return Promise.all(promiseList);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.start = function start() {
      return _classPrivateFieldLooseBase(this, _start$2)[_start$2]();
    };
    _proto.close = function close() {
      try {
        var _this3 = this;
        if (_classPrivateFieldLooseBase(_this3, _closed$1)[_closed$1]) {
          return Promise.resolve();
        }
        _classPrivateFieldLooseBase(_this3, _restart$1)[_restart$1].stop();
        var ID = _classPrivateFieldLooseBase(_this3, _ID$1)[_ID$1];
        _this3.onClosed({
          reason: null
        });
        if (ID) {
          return Promise.resolve(_classPrivateFieldLooseBase(_this3, _xiomb$2)[_xiomb$2].request('media.close', {
            ID: ID
          }).catch(function () {}));
        }
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.onSignal = function onSignal(data) {
      if (_classPrivateFieldLooseBase(this, _peerConnection)[_peerConnection]) {
        _classPrivateFieldLooseBase(this, _applySignal)[_applySignal](_classPrivateFieldLooseBase(this, _peerConnection)[_peerConnection], data).catch(function (e) {
          return console.error('[xiomb] signal', e);
        });
      }
    };
    _proto.onStat = function onStat(data) {
      _classPrivateFieldLooseBase(this, _lastStat$1)[_lastStat$1] = data;
      this.emit('stat', data);
    };
    _proto.onStatus = function onStatus(data) {
      _classPrivateFieldLooseBase(this, _status$2)[_status$2] = data.status;
      _classPrivateFieldLooseBase(this, _needRenegotiate$1)[_needRenegotiate$1] = data.status === 'reconnect' && !!data.renegotiate;
      this.emit('status', {
        status: data.status,
        renegotiate: data.renegotiate,
        reason: data.reason
      });
      if (_classPrivateFieldLooseBase(this, _needRenegotiate$1)[_needRenegotiate$1]) {
        _classPrivateFieldLooseBase(this, _renegotiate$1)[_renegotiate$1]();
      } else {
        clearTimeout(_classPrivateFieldLooseBase(this, _retryTimer$1)[_retryTimer$1]);
      }
    };
    _proto.onClosed = function onClosed(data) {
      if (_classPrivateFieldLooseBase(this, _closed$1)[_closed$1]) {
        return;
      }
      var reason = data && data.reason ? data.reason : null;
      if (_classPrivateFieldLooseBase(this, _ID$1)[_ID$1] && _classPrivateFieldLooseBase(this, _restart$1)[_restart$1].canRestart(reason, false)) {
        return _classPrivateFieldLooseBase(this, _restartLater$1)[_restartLater$1](reason);
      }
      _classPrivateFieldLooseBase(this, _close$1)[_close$1](reason);
    };
    return xiombSession;
  }(xiombEmitter);
  function _isKindEnabled2(kind) {
    return _classPrivateFieldLooseBase(this, _xiomb$2)[_xiomb$2].getParams()[kind] !== false;
  }
  function _addInactiveTransceiver2(peerConnection) {
    var kindList = peerConnection.getTransceivers().map(function (transceiver) {
      return transceiver.receiver.track.kind;
    });
    for (var _i = 0, _arr = ['video', 'audio']; _i < _arr.length; _i++) {
      var kind = _arr[_i];
      if (kindList.indexOf(kind) === -1 && !_classPrivateFieldLooseBase(this, _isKindEnabled)[_isKindEnabled](kind)) {
        peerConnection.addTransceiver(kind, {
          direction: 'inactive'
        });
      }
    }
  }
  function _getCodecList2() {
    return _classPrivateFieldLooseBase(this, _options$2)[_options$2].codecList || [];
  }
  function _sendCandidate2(candidate) {
    _classPrivateFieldLooseBase(this, _xiomb$2)[_xiomb$2].notify('media.signal', {
      ID: _classPrivateFieldLooseBase(this, _ID$1)[_ID$1],
      candidate: candidate
    });
  }
  function _acceptPeerConnection2() {
    _classPrivateFieldLooseBase(this, _peerConnectionAccepted)[_peerConnectionAccepted] = true;
    for (var _iterator2 = _createForOfIteratorHelperLoose(_classPrivateFieldLooseBase(this, _localCandidateList)[_localCandidateList]), _step2; !(_step2 = _iterator2()).done;) {
      var candidate = _step2.value;
      _classPrivateFieldLooseBase(this, _sendCandidate)[_sendCandidate](candidate);
    }
    _classPrivateFieldLooseBase(this, _localCandidateList)[_localCandidateList] = [];
  }
  function _closePreviousPeerConnection2() {
    var trackList = _classPrivateFieldLooseBase(this, _pendingTrackList)[_pendingTrackList];
    _classPrivateFieldLooseBase(this, _pendingTrackList)[_pendingTrackList] = [];
    for (var _iterator3 = _createForOfIteratorHelperLoose(trackList), _step3; !(_step3 = _iterator3()).done;) {
      var track = _step3.value;
      _classPrivateFieldLooseBase(this, _addTrack)[_addTrack](track);
    }
    if (_classPrivateFieldLooseBase(this, _previousPeerConnection)[_previousPeerConnection]) {
      _classPrivateFieldLooseBase(this, _previousPeerConnection)[_previousPeerConnection].close();
    }
    _classPrivateFieldLooseBase(this, _previousPeerConnection)[_previousPeerConnection] = null;
  }
  function _addTrack2(track) {
    var trackList = _classPrivateFieldLooseBase(this, _mediaStream)[_mediaStream].getTracks();
    if (trackList.indexOf(track) !== -1 || !_classPrivateFieldLooseBase(this, _isKindEnabled)[_isKindEnabled](track.kind)) {
      return;
    }
    _classPrivateFieldLooseBase(this, _mediaStream)[_mediaStream] = new MediaStream([].concat(trackList.filter(function (oldTrack) {
      return oldTrack.kind !== track.kind;
    }), [track]));
    this.emit('stream', _classPrivateFieldLooseBase(this, _mediaStream)[_mediaStream]);
  }
  function _cleanup2() {
    if (_classPrivateFieldLooseBase(this, _previousPeerConnection)[_previousPeerConnection]) {
      _classPrivateFieldLooseBase(this, _previousPeerConnection)[_previousPeerConnection].close();
    }
    _classPrivateFieldLooseBase(this, _previousPeerConnection)[_previousPeerConnection] = null;
    _classPrivateFieldLooseBase(this, _pendingTrackList)[_pendingTrackList] = [];
    if (_classPrivateFieldLooseBase(this, _peerConnection)[_peerConnection]) {
      _classPrivateFieldLooseBase(this, _peerConnection)[_peerConnection].close();
    }
    _classPrivateFieldLooseBase(this, _peerConnection)[_peerConnection] = null;
    _classPrivateFieldLooseBase(this, _peerConnectionAccepted)[_peerConnectionAccepted] = false;
    if (!this.isPublish()) {
      for (var _iterator4 = _createForOfIteratorHelperLoose(_classPrivateFieldLooseBase(this, _mediaStream)[_mediaStream].getTracks()), _step4; !(_step4 = _iterator4()).done;) {
        var track = _step4.value;
        track.stop();
      }
    }
  }
  function _preferCodecList2(peerConnection) {
    var wantedCodecList = _classPrivateFieldLooseBase(this, _getCodecList)[_getCodecList]().map(function (codec) {
      return String(codec).toUpperCase();
    });
    var capabilitySource = this.isPublish() ? window.RTCRtpSender : window.RTCRtpReceiver;
    if (!wantedCodecList.length || !capabilitySource || typeof capabilitySource.getCapabilities !== 'function') {
      return;
    }
    var capabilities = capabilitySource.getCapabilities('video');
    var codecList = capabilities && capabilities.codecs ? capabilities.codecs : [];
    var getName = function getName(codec) {
      return codec.mimeType.split('/')[1].toUpperCase();
    };
    var preferredCodecList = wantedCodecList.flatMap(function (name) {
      return codecList.filter(function (codec) {
        return getName(codec) === name;
      });
    });
    if (!preferredCodecList.length) {
      return;
    }
    var orderedCodecList = [].concat(preferredCodecList, codecList.filter(function (codec) {
      return SERVICE_CODEC_LIST.indexOf(getName(codec)) !== -1;
    }));
    for (var _iterator5 = _createForOfIteratorHelperLoose(peerConnection.getTransceivers()), _step5; !(_step5 = _iterator5()).done;) {
      var transceiver = _step5.value;
      var track = transceiver.sender.track || transceiver.receiver.track;
      if (track && track.kind === 'video' && typeof transceiver.setCodecPreferences === 'function') {
        transceiver.setCodecPreferences(orderedCodecList);
      }
    }
  }
  function _restorePreviousPeerConnection2() {
    if (!_classPrivateFieldLooseBase(this, _previousPeerConnection)[_previousPeerConnection]) {
      return;
    }
    if (_classPrivateFieldLooseBase(this, _peerConnection)[_peerConnection]) {
      _classPrivateFieldLooseBase(this, _peerConnection)[_peerConnection].close();
    }
    _classPrivateFieldLooseBase(this, _peerConnection)[_peerConnection] = _classPrivateFieldLooseBase(this, _previousPeerConnection)[_previousPeerConnection];
    _classPrivateFieldLooseBase(this, _previousPeerConnection)[_previousPeerConnection] = null;
    _classPrivateFieldLooseBase(this, _pendingTrackList)[_pendingTrackList] = [];
    _classPrivateFieldLooseBase(this, _peerConnectionAccepted)[_peerConnectionAccepted] = true;
  }
  function _restartLater2$1(reason) {
    var _this4 = this;
    _classPrivateFieldLooseBase(this, _xiomb$2)[_xiomb$2].deleteMediaSession(this);
    _classPrivateFieldLooseBase(this, _ID$1)[_ID$1] = null;
    clearTimeout(_classPrivateFieldLooseBase(this, _retryTimer$1)[_retryTimer$1]);
    _classPrivateFieldLooseBase(this, _needRenegotiate$1)[_needRenegotiate$1] = false;
    _classPrivateFieldLooseBase(this, _cleanup)[_cleanup]();
    if (!this.isPublish()) {
      _classPrivateFieldLooseBase(this, _mediaStream)[_mediaStream] = new MediaStream();
    }
    _classPrivateFieldLooseBase(this, _status$2)[_status$2] = 'reconnect';
    this.emit('status', {
      status: 'reconnect',
      renegotiate: false,
      reason: reason
    });
    _classPrivateFieldLooseBase(this, _restart$1)[_restart$1].schedule(function () {
      return _classPrivateFieldLooseBase(_this4, _attemptRestart$1)[_attemptRestart$1]();
    });
  }
  function _close2$1(reason) {
    _classPrivateFieldLooseBase(this, _closed$1)[_closed$1] = true;
    _classPrivateFieldLooseBase(this, _status$2)[_status$2] = 'stop';
    clearTimeout(_classPrivateFieldLooseBase(this, _retryTimer$1)[_retryTimer$1]);
    _classPrivateFieldLooseBase(this, _cleanup)[_cleanup]();
    if (_classPrivateFieldLooseBase(this, _ID$1)[_ID$1]) {
      _classPrivateFieldLooseBase(this, _xiomb$2)[_xiomb$2].deleteMediaSession(this);
    }
    this.emit('closed', reason);
  }

  function _catch$2(body, recover) {
    try {
      var result = body();
    } catch (e) {
      return recover(e);
    }
    if (result && result.then) {
      return result.then(void 0, recover);
    }
    return result;
  }
  var _attemptRestart2 = function _attemptRestart2() {
    try {
      var _temp4 = function _temp4(_result3) {
        if (_exit2) return _result3;
        _classPrivateFieldLooseBase(_this6, _restart)[_restart].reset();
        _this6.emit('restarted', {
          ID: _classPrivateFieldLooseBase(_this6, _ID)[_ID]
        });
        _this6.emit('status', {
          status: _classPrivateFieldLooseBase(_this6, _status$1)[_status$1],
          renegotiate: false,
          reason: null
        });
      };
      var _exit2 = false;
      var _this6 = this;
      if (_classPrivateFieldLooseBase(_this6, _closed)[_closed]) {
        return Promise.resolve();
      }
      var _temp3 = _catch$2(function () {
        return Promise.resolve(_classPrivateFieldLooseBase(_this6, _start$1)[_start$1]()).then(function () {});
      }, function (e) {
        if (_classPrivateFieldLooseBase(_this6, _closed)[_closed]) {
          _exit2 = true;
          return;
        }
        var reason = {
          name: e && e.name,
          message: e && e.message
        };
        if (_classPrivateFieldLooseBase(_this6, _restart)[_restart].canRestart(reason, true)) {
          _classPrivateFieldLooseBase(_this6, _restart)[_restart].schedule(function () {
            return _classPrivateFieldLooseBase(_this6, _attemptRestart)[_attemptRestart]();
          });
        } else {
          _classPrivateFieldLooseBase(_this6, _close)[_close](reason);
        }
        _exit2 = true;
      });
      return Promise.resolve(_temp3 && _temp3.then ? _temp3.then(_temp4) : _temp4(_temp3));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var _start2$1 = function _start2() {
    try {
      var _this5 = this;
      var hlsEntry = _classPrivateFieldLooseBase(_this5, _xiomb$1)[_xiomb$1].getHlsEntry();
      if (hlsEntry) {
        return Promise.resolve(_classPrivateFieldLooseBase(_this5, _startByLink)[_startByLink](hlsEntry));
      }
      return Promise.resolve(_classPrivateFieldLooseBase(_this5, _xiomb$1)[_xiomb$1].request('media.play', {
        name: _classPrivateFieldLooseBase(_this5, _name)[_name],
        transport: 'hls',
        projectID: _classPrivateFieldLooseBase(_this5, _options$1)[_options$1].projectID || '',
        custom: _classPrivateFieldLooseBase(_this5, _options$1)[_options$1].custom || {}
      })).then(function (mediaSessionInfo) {
        var _exit = false;
        function _temp2(_result2) {
          if (_exit) ;
          _classPrivateFieldLooseBase(_this5, _ID)[_ID] = mediaSessionInfo.ID;
          _classPrivateFieldLooseBase(_this5, _name)[_name] = mediaSessionInfo.name;
          _classPrivateFieldLooseBase(_this5, _status$1)[_status$1] = mediaSessionInfo.status;
          _classPrivateFieldLooseBase(_this5, _xiomb$1)[_xiomb$1].addMediaSession(_this5);
          _classPrivateFieldLooseBase(_this5, _setPlayURL)[_setPlayURL](mediaSessionInfo.playURL);
          return _this5;
        }
        var _temp = function () {
          if (_classPrivateFieldLooseBase(_this5, _closed)[_closed]) {
            return Promise.resolve(_classPrivateFieldLooseBase(_this5, _xiomb$1)[_xiomb$1].request('media.close', {
              ID: mediaSessionInfo.ID
            }).catch(function () {})).then(function () {
              throw new xiombError('STOPPED', 'Stopped');
            });
          }
        }();
        return _temp && _temp.then ? _temp.then(_temp2) : _temp2(_temp);
      });
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var _renegotiate2 = function _renegotiate2() {
    try {
      var _this4 = this;
      if (_classPrivateFieldLooseBase(_this4, _closed)[_closed] || !_classPrivateFieldLooseBase(_this4, _needRenegotiate)[_needRenegotiate] || _classPrivateFieldLooseBase(_this4, _renegotiating)[_renegotiating]) {
        return Promise.resolve();
      }
      clearTimeout(_classPrivateFieldLooseBase(_this4, _retryTimer)[_retryTimer]);
      _classPrivateFieldLooseBase(_this4, _renegotiating)[_renegotiating] = true;
      return Promise.resolve(_catch$2(function () {
        return Promise.resolve(_classPrivateFieldLooseBase(_this4, _xiomb$1)[_xiomb$1].request('media.renegotiate', {
          ID: _classPrivateFieldLooseBase(_this4, _ID)[_ID]
        })).then(function (mediaSessionInfo) {
          _classPrivateFieldLooseBase(_this4, _renegotiating)[_renegotiating] = false;
          _classPrivateFieldLooseBase(_this4, _retryDelay)[_retryDelay] = RENEGOTIATE_RETRY_MIN;
          if (!_classPrivateFieldLooseBase(_this4, _closed)[_closed]) {
            _classPrivateFieldLooseBase(_this4, _setPlayURL)[_setPlayURL](mediaSessionInfo.playURL);
          }
        });
      }, function (e) {
        _classPrivateFieldLooseBase(_this4, _renegotiating)[_renegotiating] = false;
        console.warn('[xiomb] renegotiate failed:', e && e.name);
        if (_classPrivateFieldLooseBase(_this4, _closed)[_closed] || !_classPrivateFieldLooseBase(_this4, _needRenegotiate)[_needRenegotiate]) {
          return;
        }
        _classPrivateFieldLooseBase(_this4, _retryTimer)[_retryTimer] = setTimeout(function () {
          return _classPrivateFieldLooseBase(_this4, _renegotiate)[_renegotiate]();
        }, _classPrivateFieldLooseBase(_this4, _retryDelay)[_retryDelay]);
        _classPrivateFieldLooseBase(_this4, _retryDelay)[_retryDelay] = Math.min(_classPrivateFieldLooseBase(_this4, _retryDelay)[_retryDelay] * 2, RENEGOTIATE_RETRY_MAX);
      }));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var RENEGOTIATE_RETRY_MIN = 1000;
  var RENEGOTIATE_RETRY_MAX = 5000;
  var _xiomb$1 = /*#__PURE__*/_classPrivateFieldLooseKey("xiomb");
  var _name = /*#__PURE__*/_classPrivateFieldLooseKey("name");
  var _options$1 = /*#__PURE__*/_classPrivateFieldLooseKey("options");
  var _ID = /*#__PURE__*/_classPrivateFieldLooseKey("ID");
  var _status$1 = /*#__PURE__*/_classPrivateFieldLooseKey("status");
  var _lastStat = /*#__PURE__*/_classPrivateFieldLooseKey("lastStat");
  var _closed = /*#__PURE__*/_classPrivateFieldLooseKey("closed");
  var _playURL = /*#__PURE__*/_classPrivateFieldLooseKey("playURL");
  var _byLink = /*#__PURE__*/_classPrivateFieldLooseKey("byLink");
  var _renegotiating = /*#__PURE__*/_classPrivateFieldLooseKey("renegotiating");
  var _needRenegotiate = /*#__PURE__*/_classPrivateFieldLooseKey("needRenegotiate");
  var _retryDelay = /*#__PURE__*/_classPrivateFieldLooseKey("retryDelay");
  var _retryTimer = /*#__PURE__*/_classPrivateFieldLooseKey("retryTimer");
  var _restart = /*#__PURE__*/_classPrivateFieldLooseKey("restart");
  var _setPlayURL = /*#__PURE__*/_classPrivateFieldLooseKey("setPlayURL");
  var _renegotiate = /*#__PURE__*/_classPrivateFieldLooseKey("renegotiate");
  var _startByLink = /*#__PURE__*/_classPrivateFieldLooseKey("startByLink");
  var _start$1 = /*#__PURE__*/_classPrivateFieldLooseKey("start");
  var _restartLater = /*#__PURE__*/_classPrivateFieldLooseKey("restartLater");
  var _attemptRestart = /*#__PURE__*/_classPrivateFieldLooseKey("attemptRestart");
  var _close = /*#__PURE__*/_classPrivateFieldLooseKey("close");
  var xiombHlsSession = /*#__PURE__*/function (_xiombEmitter) {
    function xiombHlsSession(xiomb, name, options) {
      var _this;
      _this = _xiombEmitter.call(this) || this;
      Object.defineProperty(_this, _close, {
        value: _close2
      });
      Object.defineProperty(_this, _attemptRestart, {
        value: _attemptRestart2
      });
      Object.defineProperty(_this, _restartLater, {
        value: _restartLater2
      });
      Object.defineProperty(_this, _start$1, {
        value: _start2$1
      });
      // по ссылке: <вход ядра>/<проект>/<поток>/index.m3u8?<параметры сокета>; решают auth и play проекта
      Object.defineProperty(_this, _startByLink, {
        value: _startByLink2
      });
      Object.defineProperty(_this, _renegotiate, {
        value: _renegotiate2
      });
      Object.defineProperty(_this, _setPlayURL, {
        value: _setPlayURL2
      });
      Object.defineProperty(_this, _xiomb$1, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _name, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _options$1, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _ID, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _status$1, {
        writable: true,
        value: 'connect'
      });
      Object.defineProperty(_this, _lastStat, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _closed, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _playURL, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _byLink, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _renegotiating, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _needRenegotiate, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _retryDelay, {
        writable: true,
        value: RENEGOTIATE_RETRY_MIN
      });
      Object.defineProperty(_this, _retryTimer, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _restart, {
        writable: true,
        value: void 0
      });
      _classPrivateFieldLooseBase(_this, _xiomb$1)[_xiomb$1] = xiomb;
      _classPrivateFieldLooseBase(_this, _name)[_name] = name;
      _classPrivateFieldLooseBase(_this, _options$1)[_options$1] = options || {};
      _classPrivateFieldLooseBase(_this, _restart)[_restart] = new xiombRestart(false, _classPrivateFieldLooseBase(_this, _options$1)[_options$1]);
      return _this;
    }
    _inheritsLoose(xiombHlsSession, _xiombEmitter);
    var _proto = xiombHlsSession.prototype;
    _proto.getID = function getID() {
      return _classPrivateFieldLooseBase(this, _ID)[_ID];
    };
    _proto.getName = function getName() {
      return _classPrivateFieldLooseBase(this, _name)[_name];
    };
    _proto.getDirection = function getDirection() {
      return 'play';
    };
    _proto.getTransport = function getTransport() {
      return 'hls';
    };
    _proto.isPublish = function isPublish() {
      return false;
    };
    _proto.getStatus = function getStatus() {
      return _classPrivateFieldLooseBase(this, _status$1)[_status$1];
    };
    _proto.isClosed = function isClosed() {
      return _classPrivateFieldLooseBase(this, _closed)[_closed];
    };
    _proto.getPlayURL = function getPlayURL() {
      return _classPrivateFieldLooseBase(this, _playURL)[_playURL];
    };
    _proto.getMediaStream = function getMediaStream() {
      return null;
    };
    _proto.getPeerConnection = function getPeerConnection() {
      return null;
    };
    _proto.getLastStat = function getLastStat() {
      return _classPrivateFieldLooseBase(this, _lastStat)[_lastStat];
    };
    _proto.replaceMediaStream = function replaceMediaStream() {
      return Promise.resolve();
    };
    _proto.start = function start() {
      return _classPrivateFieldLooseBase(this, _start$1)[_start$1]();
    };
    _proto.close = function close() {
      try {
        var _this2 = this;
        if (_classPrivateFieldLooseBase(_this2, _closed)[_closed]) {
          return Promise.resolve();
        }
        _classPrivateFieldLooseBase(_this2, _restart)[_restart].stop();
        if (_classPrivateFieldLooseBase(_this2, _byLink)[_byLink]) {
          // по ссылке: нода закроет зрителя сама, когда плеер перестанет спрашивать плейлист
          _classPrivateFieldLooseBase(_this2, _close)[_close](null);
          return Promise.resolve();
        }
        var ID = _classPrivateFieldLooseBase(_this2, _ID)[_ID];
        _this2.onClosed({
          reason: null
        });
        if (ID) {
          return Promise.resolve(_classPrivateFieldLooseBase(_this2, _xiomb$1)[_xiomb$1].request('media.close', {
            ID: ID
          }).catch(function () {}));
        }
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.onSignal = function onSignal() {};
    _proto.onStat = function onStat(data) {
      _classPrivateFieldLooseBase(this, _lastStat)[_lastStat] = data;
      this.emit('stat', data);
    };
    _proto.onStatus = function onStatus(data) {
      _classPrivateFieldLooseBase(this, _status$1)[_status$1] = data.status;
      _classPrivateFieldLooseBase(this, _needRenegotiate)[_needRenegotiate] = data.status === 'reconnect' && !!data.renegotiate;
      this.emit('status', {
        status: data.status,
        renegotiate: data.renegotiate,
        reason: data.reason
      });
      if (_classPrivateFieldLooseBase(this, _needRenegotiate)[_needRenegotiate]) {
        _classPrivateFieldLooseBase(this, _renegotiate)[_renegotiate]();
      } else {
        clearTimeout(_classPrivateFieldLooseBase(this, _retryTimer)[_retryTimer]);
      }
    };
    _proto.onClosed = function onClosed(data) {
      if (_classPrivateFieldLooseBase(this, _closed)[_closed]) {
        return;
      }
      var reason = data && data.reason ? data.reason : null;
      if (_classPrivateFieldLooseBase(this, _ID)[_ID] && _classPrivateFieldLooseBase(this, _restart)[_restart].canRestart(reason, false)) {
        return _classPrivateFieldLooseBase(this, _restartLater)[_restartLater](reason);
      }
      _classPrivateFieldLooseBase(this, _close)[_close](reason);
    };
    return xiombHlsSession;
  }(xiombEmitter);
  function _setPlayURL2(playURL) {
    if (!playURL) {
      throw new xiombError('NOT_SUPPORTED', 'HLS not supported');
    }
    _classPrivateFieldLooseBase(this, _playURL)[_playURL] = playURL;
    this.emit('stream', _classPrivateFieldLooseBase(this, _playURL)[_playURL]);
  }
  function _startByLink2(hlsEntry) {
    var projectID = _classPrivateFieldLooseBase(this, _options$1)[_options$1].projectID || hlsEntry.projectID;
    var queryMap = _classPrivateFieldLooseBase(this, _xiomb$1)[_xiomb$1].getQuery();
    var query = Object.keys(queryMap).map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(queryMap[key] == null ? '' : queryMap[key]);
    }).join('&');
    _classPrivateFieldLooseBase(this, _byLink)[_byLink] = true;
    _classPrivateFieldLooseBase(this, _ID)[_ID] = null;
    _classPrivateFieldLooseBase(this, _setPlayURL)[_setPlayURL](hlsEntry.url + "/" + encodeURIComponent(projectID) + "/" + encodeURIComponent(_classPrivateFieldLooseBase(this, _name)[_name]) + "/index.m3u8" + (query ? "?" + query : ''));
    _classPrivateFieldLooseBase(this, _status$1)[_status$1] = 'play';
    this.emit('status', {
      status: 'play',
      renegotiate: false,
      reason: null
    });
    return this;
  }
  function _restartLater2(reason) {
    var _this3 = this;
    _classPrivateFieldLooseBase(this, _xiomb$1)[_xiomb$1].deleteMediaSession(this);
    _classPrivateFieldLooseBase(this, _ID)[_ID] = null;
    clearTimeout(_classPrivateFieldLooseBase(this, _retryTimer)[_retryTimer]);
    _classPrivateFieldLooseBase(this, _needRenegotiate)[_needRenegotiate] = false;
    _classPrivateFieldLooseBase(this, _status$1)[_status$1] = 'reconnect';
    this.emit('status', {
      status: 'reconnect',
      renegotiate: false,
      reason: reason
    });
    _classPrivateFieldLooseBase(this, _restart)[_restart].schedule(function () {
      return _classPrivateFieldLooseBase(_this3, _attemptRestart)[_attemptRestart]();
    });
  }
  function _close2(reason) {
    _classPrivateFieldLooseBase(this, _closed)[_closed] = true;
    _classPrivateFieldLooseBase(this, _status$1)[_status$1] = 'stop';
    clearTimeout(_classPrivateFieldLooseBase(this, _retryTimer)[_retryTimer]);
    if (_classPrivateFieldLooseBase(this, _ID)[_ID]) {
      _classPrivateFieldLooseBase(this, _xiomb$1)[_xiomb$1].deleteMediaSession(this);
    }
    this.emit('closed', reason);
  }

  function _catch$1(body, recover) {
    try {
      var result = body();
    } catch (e) {
      return recover(e);
    }
    if (result && result.then) {
      return result.then(void 0, recover);
    }
    return result;
  }
  var _start2 = function _start2(startID) {
    try {
      var _this7 = this;
      var mediaSession = null;
      _classPrivateFieldLooseBase(_this7, _setStatus)[_setStatus]('connect');
      return Promise.resolve(_catch$1(function () {
        return Promise.resolve(_classPrivateFieldLooseBase(_this7, _xiomb)[_xiomb].connect()).then(function () {
          function _temp6() {
            _classPrivateFieldLooseBase(_this7, _checkStart)[_checkStart](startID);
            mediaSession = _classPrivateFieldLooseBase(_this7, _xiomb)[_xiomb].createMediaSession(_classPrivateFieldLooseBase(_this7, _isPublish)[_isPublish] ? 'publish' : 'play', _classPrivateFieldLooseBase(_this7, _streamName)[_streamName], {
              transport: _classPrivateFieldLooseBase(_this7, _transport)[_transport],
              codecList: _classPrivateFieldLooseBase(_this7, _options)[_options].codecList || [],
              projectID: _classPrivateFieldLooseBase(_this7, _options)[_options].projectID || '',
              custom: _classPrivateFieldLooseBase(_this7, _getCustom)[_getCustom](),
              mediaStream: _classPrivateFieldLooseBase(_this7, _isPublish)[_isPublish] ? _classPrivateFieldLooseBase(_this7, _player)[_player].getMediaStream() : null
            });
            _classPrivateFieldLooseBase(_this7, _mediaSession)[_mediaSession] = mediaSession;
            _classPrivateFieldLooseBase(_this7, _bindMediaSession)[_bindMediaSession](mediaSession);
            if (!_classPrivateFieldLooseBase(_this7, _isPublish)[_isPublish]) {
              _classPrivateFieldLooseBase(_this7, _attachMedia)[_attachMedia](mediaSession);
            }
            return Promise.resolve(mediaSession.start()).then(function () {
              _classPrivateFieldLooseBase(_this7, _checkStart)[_checkStart](startID);
              _classPrivateFieldLooseBase(_this7, _setStatus)[_setStatus](mediaSession.getStatus());
              _this7.emit('start', _this7);
              return _this7;
            });
          }
          _classPrivateFieldLooseBase(_this7, _checkStart)[_checkStart](startID);
          _classPrivateFieldLooseBase(_this7, _transport)[_transport] = _classPrivateFieldLooseBase(_this7, _isPublish)[_isPublish] ? 'webrtc' : _classPrivateFieldLooseBase(_this7, _xiomb)[_xiomb].selectTransport(_classPrivateFieldLooseBase(_this7, _options)[_options].transport);
          var _temp5 = function () {
            if (_classPrivateFieldLooseBase(_this7, _isPublish)[_isPublish]) {
              return Promise.resolve(_this7.capture()).then(function () {});
            }
          }();
          return _temp5 && _temp5.then ? _temp5.then(_temp6) : _temp6(_temp5);
        });
      }, function (e) {
        var error = createError(e);
        if (startID === _classPrivateFieldLooseBase(_this7, _startID)[_startID]) {
          ++_classPrivateFieldLooseBase(_this7, _startID)[_startID];
          _classPrivateFieldLooseBase(_this7, _finishSession)[_finishSession](error);
          if (mediaSession) {
            mediaSession.close();
          }
        }
        throw error;
      }));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var _capture2 = function _capture2() {
    try {
      var _temp4 = function _temp4(_result) {
        if (_exit) return _result;
        _classPrivateFieldLooseBase(_this6, _capturePromise)[_capturePromise] = null;
        if (!_classPrivateFieldLooseBase(_this6, _startPromise)[_startPromise] && !_classPrivateFieldLooseBase(_this6, _destroyed)[_destroyed]) {
          _classPrivateFieldLooseBase(_this6, _setStatus)[_setStatus]('preview');
        }
        return mediaStream;
      };
      var _exit = false;
      var _this6 = this;
      var mediaStream;
      var _temp3 = _catch$1(function () {
        return Promise.resolve(_classPrivateFieldLooseBase(_this6, _player)[_player].getUserMedia(_classPrivateFieldLooseBase(_this6, _options)[_options].constraints)).then(function (_classPrivateFieldLoo) {
          mediaStream = _classPrivateFieldLoo;
        });
      }, function (e) {
        var error = createError(e);
        _classPrivateFieldLooseBase(_this6, _capturePromise)[_capturePromise] = null;
        if (!_classPrivateFieldLooseBase(_this6, _startPromise)[_startPromise] && !_classPrivateFieldLooseBase(_this6, _destroyed)[_destroyed]) {
          _classPrivateFieldLooseBase(_this6, _setStatus)[_setStatus]('failed', _classPrivateFieldLooseBase(_this6, _xiomb)[_xiomb].getMessage(error));
          _this6.emit('error', error);
        }
        throw error;
      });
      return Promise.resolve(_temp3 && _temp3.then ? _temp3.then(_temp4) : _temp4(_temp3));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var STAT_INTERVAL = 1000;
  var createError = function createError(e) {
    if (e instanceof xiombError) {
      return e;
    }
    if (e && typeof e.name === 'string' && e.name && !(e instanceof Error)) {
      return new xiombError(e.name, e.message, e);
    }
    return new xiombError('MEDIA_ERROR', e && e.message, e);
  };
  var _xiomb = /*#__PURE__*/_classPrivateFieldLooseKey("xiomb");
  var _isPublish = /*#__PURE__*/_classPrivateFieldLooseKey("isPublish");
  var _streamName = /*#__PURE__*/_classPrivateFieldLooseKey("streamName");
  var _options = /*#__PURE__*/_classPrivateFieldLooseKey("options");
  var _player = /*#__PURE__*/_classPrivateFieldLooseKey("player");
  var _ownPlayer = /*#__PURE__*/_classPrivateFieldLooseKey("ownPlayer");
  var _mediaSession = /*#__PURE__*/_classPrivateFieldLooseKey("mediaSession");
  var _transport = /*#__PURE__*/_classPrivateFieldLooseKey("transport");
  var _mediaStat = /*#__PURE__*/_classPrivateFieldLooseKey("mediaStat");
  var _status = /*#__PURE__*/_classPrivateFieldLooseKey("status");
  var _startID = /*#__PURE__*/_classPrivateFieldLooseKey("startID");
  var _startPromise = /*#__PURE__*/_classPrivateFieldLooseKey("startPromise");
  var _capturePromise = /*#__PURE__*/_classPrivateFieldLooseKey("capturePromise");
  var _destroyed = /*#__PURE__*/_classPrivateFieldLooseKey("destroyed");
  var _statTimer = /*#__PURE__*/_classPrivateFieldLooseKey("statTimer");
  var _getIdleStatus = /*#__PURE__*/_classPrivateFieldLooseKey("getIdleStatus");
  var _setStatus = /*#__PURE__*/_classPrivateFieldLooseKey("setStatus");
  var _showError = /*#__PURE__*/_classPrivateFieldLooseKey("showError");
  var _checkStart = /*#__PURE__*/_classPrivateFieldLooseKey("checkStart");
  var _finishSession = /*#__PURE__*/_classPrivateFieldLooseKey("finishSession");
  var _attachMedia = /*#__PURE__*/_classPrivateFieldLooseKey("attachMedia");
  var _bindMediaSession = /*#__PURE__*/_classPrivateFieldLooseKey("bindMediaSession");
  var _getCustom = /*#__PURE__*/_classPrivateFieldLooseKey("getCustom");
  var _onPlayerRequest = /*#__PURE__*/_classPrivateFieldLooseKey("onPlayerRequest");
  var _onPlayerDestroy = /*#__PURE__*/_classPrivateFieldLooseKey("onPlayerDestroy");
  var _onPlayerDeviceError = /*#__PURE__*/_classPrivateFieldLooseKey("onPlayerDeviceError");
  var _onPlayerPlayError = /*#__PURE__*/_classPrivateFieldLooseKey("onPlayerPlayError");
  var _onPlayerStream = /*#__PURE__*/_classPrivateFieldLooseKey("onPlayerStream");
  var _capture = /*#__PURE__*/_classPrivateFieldLooseKey("capture");
  var _start = /*#__PURE__*/_classPrivateFieldLooseKey("start");
  var xiombObject = /*#__PURE__*/function (_xiombEmitter) {
    function xiombObject(xiomb, isPublish, streamName, options) {
      var _this;
      _this = _xiombEmitter.call(this) || this;
      Object.defineProperty(_this, _start, {
        value: _start2
      });
      Object.defineProperty(_this, _capture, {
        value: _capture2
      });
      Object.defineProperty(_this, _getCustom, {
        value: _getCustom2
      });
      Object.defineProperty(_this, _bindMediaSession, {
        value: _bindMediaSession2
      });
      Object.defineProperty(_this, _attachMedia, {
        value: _attachMedia2
      });
      Object.defineProperty(_this, _finishSession, {
        value: _finishSession2
      });
      Object.defineProperty(_this, _checkStart, {
        value: _checkStart2
      });
      Object.defineProperty(_this, _showError, {
        value: _showError2
      });
      Object.defineProperty(_this, _setStatus, {
        value: _setStatus2
      });
      Object.defineProperty(_this, _getIdleStatus, {
        value: _getIdleStatus2
      });
      Object.defineProperty(_this, _xiomb, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _isPublish, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _streamName, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _options, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _player, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _ownPlayer, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _mediaSession, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _transport, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _mediaStat, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _status, {
        writable: true,
        value: 'new'
      });
      Object.defineProperty(_this, _startID, {
        writable: true,
        value: 0
      });
      Object.defineProperty(_this, _startPromise, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _capturePromise, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _destroyed, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _statTimer, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _onPlayerRequest, {
        writable: true,
        value: function value(action) {
          switch (action) {
            case 'start':
              return _this.start().catch(function () {});
            case 'stop':
              return _this.stop();
          }
        }
      });
      Object.defineProperty(_this, _onPlayerDestroy, {
        writable: true,
        value: function value() {
          _this.destroy();
        }
      });
      Object.defineProperty(_this, _onPlayerDeviceError, {
        writable: true,
        value: function value(error) {
          if (!_classPrivateFieldLooseBase(_this, _startPromise)[_startPromise] && !_classPrivateFieldLooseBase(_this, _capturePromise)[_capturePromise] && !_classPrivateFieldLooseBase(_this, _player)[_player].getMediaStream()) {
            _classPrivateFieldLooseBase(_this, _setStatus)[_setStatus]('failed', _classPrivateFieldLooseBase(_this, _xiomb)[_xiomb].getMessage(error));
            _this.emit('error', error);
          } else {
            _classPrivateFieldLooseBase(_this, _showError)[_showError](error);
          }
        }
      });
      Object.defineProperty(_this, _onPlayerPlayError, {
        writable: true,
        value: function value(error) {
          _classPrivateFieldLooseBase(_this, _showError)[_showError](error);
        }
      });
      Object.defineProperty(_this, _onPlayerStream, {
        writable: true,
        value: function value(mediaStream) {
          if (!_classPrivateFieldLooseBase(_this, _isPublish)[_isPublish] || !mediaStream) {
            return;
          }
          if (!_classPrivateFieldLooseBase(_this, _startPromise)[_startPromise] && !_classPrivateFieldLooseBase(_this, _capturePromise)[_capturePromise] && (_classPrivateFieldLooseBase(_this, _status)[_status] === 'failed' || _classPrivateFieldLooseBase(_this, _status)[_status] === 'new')) {
            _classPrivateFieldLooseBase(_this, _setStatus)[_setStatus]('preview');
          }
          if (_classPrivateFieldLooseBase(_this, _mediaSession)[_mediaSession]) {
            _classPrivateFieldLooseBase(_this, _mediaSession)[_mediaSession].replaceMediaStream(mediaStream).catch(function (e) {
              return _classPrivateFieldLooseBase(_this, _showError)[_showError](createError(e));
            });
          }
        }
      });
      _classPrivateFieldLooseBase(_this, _xiomb)[_xiomb] = xiomb;
      _classPrivateFieldLooseBase(_this, _isPublish)[_isPublish] = !!isPublish;
      _classPrivateFieldLooseBase(_this, _streamName)[_streamName] = streamName;
      _classPrivateFieldLooseBase(_this, _options)[_options] = options || {};
      _classPrivateFieldLooseBase(_this, _ownPlayer)[_ownPlayer] = !_classPrivateFieldLooseBase(_this, _options)[_options].player;
      _classPrivateFieldLooseBase(_this, _player)[_player] = _classPrivateFieldLooseBase(_this, _options)[_options].player || xiomb.createPlayer(_classPrivateFieldLooseBase(_this, _isPublish)[_isPublish], _classPrivateFieldLooseBase(_this, _options)[_options].targetEl || null, {
        constraints: _classPrivateFieldLooseBase(_this, _options)[_options].constraints,
        title: _classPrivateFieldLooseBase(_this, _options)[_options].title,
        textList: _classPrivateFieldLooseBase(_this, _options)[_options].textList
      });
      if (_classPrivateFieldLooseBase(_this, _player)[_player].isPublish() !== _classPrivateFieldLooseBase(_this, _isPublish)[_isPublish]) {
        throw new xiombError('INVALID_PLAYER', 'Invalid player');
      }
      _classPrivateFieldLooseBase(_this, _mediaStat)[_mediaStat] = new xiombStat(_classPrivateFieldLooseBase(_this, _isPublish)[_isPublish]);
      _classPrivateFieldLooseBase(_this, _player)[_player].on('request', _classPrivateFieldLooseBase(_this, _onPlayerRequest)[_onPlayerRequest]);
      _classPrivateFieldLooseBase(_this, _player)[_player].on('stream', _classPrivateFieldLooseBase(_this, _onPlayerStream)[_onPlayerStream]);
      _classPrivateFieldLooseBase(_this, _player)[_player].on('deviceError', _classPrivateFieldLooseBase(_this, _onPlayerDeviceError)[_onPlayerDeviceError]);
      _classPrivateFieldLooseBase(_this, _player)[_player].on('playError', _classPrivateFieldLooseBase(_this, _onPlayerPlayError)[_onPlayerPlayError]);
      _classPrivateFieldLooseBase(_this, _player)[_player].on('destroy', _classPrivateFieldLooseBase(_this, _onPlayerDestroy)[_onPlayerDestroy]);
      _classPrivateFieldLooseBase(_this, _setStatus)[_setStatus](_classPrivateFieldLooseBase(_this, _getIdleStatus)[_getIdleStatus]());
      setTimeout(function () {
        if (_classPrivateFieldLooseBase(_this, _destroyed)[_destroyed]) {
          return;
        }
        var autoStart = _classPrivateFieldLooseBase(_this, _options)[_options].autoStart === undefined ? !_classPrivateFieldLooseBase(_this, _isPublish)[_isPublish] : _classPrivateFieldLooseBase(_this, _options)[_options].autoStart;
        if (autoStart) {
          _this.start().catch(function () {});
        } else if (_classPrivateFieldLooseBase(_this, _isPublish)[_isPublish]) {
          _this.capture().catch(function () {});
        }
      }, 0);
      return _this;
    }
    _inheritsLoose(xiombObject, _xiombEmitter);
    var _proto = xiombObject.prototype;
    _proto.getID = function getID() {
      return _classPrivateFieldLooseBase(this, _mediaSession)[_mediaSession] ? _classPrivateFieldLooseBase(this, _mediaSession)[_mediaSession].getID() : null;
    };
    _proto.getStreamName = function getStreamName() {
      return _classPrivateFieldLooseBase(this, _streamName)[_streamName];
    };
    _proto.isPublish = function isPublish() {
      return _classPrivateFieldLooseBase(this, _isPublish)[_isPublish];
    };
    _proto.getStatus = function getStatus() {
      return _classPrivateFieldLooseBase(this, _status)[_status];
    };
    _proto.isActive = function isActive() {
      return !!_classPrivateFieldLooseBase(this, _startPromise)[_startPromise];
    };
    _proto.isDestroyed = function isDestroyed() {
      return _classPrivateFieldLooseBase(this, _destroyed)[_destroyed];
    };
    _proto.getOptions = function getOptions() {
      return _classPrivateFieldLooseBase(this, _options)[_options];
    };
    _proto.getPlayer = function getPlayer() {
      return _classPrivateFieldLooseBase(this, _player)[_player];
    };
    _proto.getMediaSession = function getMediaSession() {
      return _classPrivateFieldLooseBase(this, _mediaSession)[_mediaSession];
    };
    _proto.getTransport = function getTransport() {
      return _classPrivateFieldLooseBase(this, _transport)[_transport];
    };
    _proto.getMediaStream = function getMediaStream() {
      return _classPrivateFieldLooseBase(this, _player)[_player].getMediaStream();
    };
    _proto.getServerStat = function getServerStat() {
      return _classPrivateFieldLooseBase(this, _mediaSession)[_mediaSession] ? _classPrivateFieldLooseBase(this, _mediaSession)[_mediaSession].getLastStat() : null;
    };
    _proto.capture = function capture() {
      if (!_classPrivateFieldLooseBase(this, _isPublish)[_isPublish]) {
        return Promise.reject(new xiombError('NOT_PUBLISH', 'Not publish'));
      }
      if (_classPrivateFieldLooseBase(this, _player)[_player].getMediaStream()) {
        return Promise.resolve(_classPrivateFieldLooseBase(this, _player)[_player].getMediaStream());
      }
      if (!_classPrivateFieldLooseBase(this, _capturePromise)[_capturePromise]) {
        if (!_classPrivateFieldLooseBase(this, _startPromise)[_startPromise]) {
          _classPrivateFieldLooseBase(this, _setStatus)[_setStatus]('capture');
        }
        _classPrivateFieldLooseBase(this, _capturePromise)[_capturePromise] = _classPrivateFieldLooseBase(this, _capture)[_capture]();
      }
      return _classPrivateFieldLooseBase(this, _capturePromise)[_capturePromise];
    };
    _proto.start = function start() {
      if (_classPrivateFieldLooseBase(this, _destroyed)[_destroyed]) {
        return Promise.reject(new xiombError('DESTROYED', 'Destroyed'));
      }
      if (!_classPrivateFieldLooseBase(this, _startPromise)[_startPromise]) {
        _classPrivateFieldLooseBase(this, _startPromise)[_startPromise] = _classPrivateFieldLooseBase(this, _start)[_start](++_classPrivateFieldLooseBase(this, _startID)[_startID]);
      }
      return _classPrivateFieldLooseBase(this, _startPromise)[_startPromise];
    };
    _proto.stop = function stop() {
      try {
        var _this2 = this;
        if (!_classPrivateFieldLooseBase(_this2, _startPromise)[_startPromise]) {
          return Promise.resolve();
        }
        ++_classPrivateFieldLooseBase(_this2, _startID)[_startID];
        var mediaSession = _classPrivateFieldLooseBase(_this2, _finishSession)[_finishSession](null);
        if (mediaSession) {
          return Promise.resolve(mediaSession.close());
        }
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.getStat = function getStat() {
      try {
        var _this3 = this;
        var peerConnection = _classPrivateFieldLooseBase(_this3, _mediaSession)[_mediaSession] ? _classPrivateFieldLooseBase(_this3, _mediaSession)[_mediaSession].getPeerConnection() : null;
        return Promise.resolve(_classPrivateFieldLooseBase(_this3, _mediaStat)[_mediaStat].collect(peerConnection)).then(function (stat) {
          stat.status = _classPrivateFieldLooseBase(_this3, _status)[_status];
          stat.transport = _classPrivateFieldLooseBase(_this3, _transport)[_transport];
          stat.connectionState = peerConnection ? peerConnection.connectionState : null;
          stat.server = _this3.getServerStat();
          return stat;
        });
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.startStat = function startStat(interval) {
      var _this4 = this;
      this.stopStat();
      var tickInterval = interval || STAT_INTERVAL;
      var _tick = function tick() {
        try {
          var _temp2 = function _temp2() {
            if (_classPrivateFieldLooseBase(_this4, _statTimer)[_statTimer] !== null) {
              _classPrivateFieldLooseBase(_this4, _statTimer)[_statTimer] = setTimeout(_tick, tickInterval);
            }
          };
          var _temp = _catch$1(function () {
            var _emit = _this4.emit;
            return Promise.resolve(_this4.getStat()).then(function (_this4$getStat) {
              _emit.call(_this4, 'stat', _this4$getStat);
            });
          }, function (e) {
            console.warn('[xiomb] stat', e);
          });
          return Promise.resolve(_temp && _temp.then ? _temp.then(_temp2) : _temp2(_temp));
        } catch (e) {
          return Promise.reject(e);
        }
      };
      _classPrivateFieldLooseBase(this, _statTimer)[_statTimer] = setTimeout(_tick, 0);
    };
    _proto.stopStat = function stopStat() {
      clearTimeout(_classPrivateFieldLooseBase(this, _statTimer)[_statTimer]);
      _classPrivateFieldLooseBase(this, _statTimer)[_statTimer] = null;
    };
    _proto.destroy = function destroy() {
      if (_classPrivateFieldLooseBase(this, _destroyed)[_destroyed]) {
        return;
      }
      _classPrivateFieldLooseBase(this, _destroyed)[_destroyed] = true;
      this.stop().catch(function () {});
      _classPrivateFieldLooseBase(this, _player)[_player].off('request', _classPrivateFieldLooseBase(this, _onPlayerRequest)[_onPlayerRequest]);
      _classPrivateFieldLooseBase(this, _player)[_player].off('stream', _classPrivateFieldLooseBase(this, _onPlayerStream)[_onPlayerStream]);
      _classPrivateFieldLooseBase(this, _player)[_player].off('deviceError', _classPrivateFieldLooseBase(this, _onPlayerDeviceError)[_onPlayerDeviceError]);
      _classPrivateFieldLooseBase(this, _player)[_player].off('playError', _classPrivateFieldLooseBase(this, _onPlayerPlayError)[_onPlayerPlayError]);
      if (_classPrivateFieldLooseBase(this, _ownPlayer)[_ownPlayer]) {
        _classPrivateFieldLooseBase(this, _player)[_player].destroy();
      } else if (_classPrivateFieldLooseBase(this, _isPublish)[_isPublish] && _classPrivateFieldLooseBase(this, _player)[_player].isCaptured()) {
        _classPrivateFieldLooseBase(this, _player)[_player].stop();
      }
      _classPrivateFieldLooseBase(this, _status)[_status] = 'destroy';
      this.emit('destroy');
    };
    return xiombObject;
  }(xiombEmitter);
  function _getIdleStatus2() {
    return _classPrivateFieldLooseBase(this, _isPublish)[_isPublish] ? _classPrivateFieldLooseBase(this, _player)[_player].getMediaStream() ? 'preview' : 'new' : 'stop';
  }
  function _setStatus2(status, message) {
    _classPrivateFieldLooseBase(this, _status)[_status] = status;
    _classPrivateFieldLooseBase(this, _player)[_player].setStatus(status, message);
    this.emit('status', status, message || '');
  }
  function _showError2(error) {
    _classPrivateFieldLooseBase(this, _player)[_player].setMessage(_classPrivateFieldLooseBase(this, _xiomb)[_xiomb].getMessage(error));
    this.emit('error', error);
  }
  function _checkStart2(startID) {
    if (_classPrivateFieldLooseBase(this, _destroyed)[_destroyed] || startID !== _classPrivateFieldLooseBase(this, _startID)[_startID]) {
      throw new xiombError('STOPPED', 'Stopped');
    }
  }
  function _finishSession2(reason) {
    var mediaSession = _classPrivateFieldLooseBase(this, _mediaSession)[_mediaSession];
    this.stopStat();
    _classPrivateFieldLooseBase(this, _mediaStat)[_mediaStat].reset();
    _classPrivateFieldLooseBase(this, _mediaSession)[_mediaSession] = null;
    _classPrivateFieldLooseBase(this, _startPromise)[_startPromise] = null;
    if (!_classPrivateFieldLooseBase(this, _isPublish)[_isPublish] && !_classPrivateFieldLooseBase(this, _destroyed)[_destroyed]) {
      _classPrivateFieldLooseBase(this, _player)[_player].setMediaStream(null);
      _classPrivateFieldLooseBase(this, _player)[_player].setPlayURL(null);
    }
    if (_classPrivateFieldLooseBase(this, _destroyed)[_destroyed]) {
      return mediaSession;
    }
    if (!_classPrivateFieldLooseBase(this, _isPublish)[_isPublish] && reason && reason.name === 'STREAM_ENDED') {
      _classPrivateFieldLooseBase(this, _setStatus)[_setStatus]('stop');
      this.emit('stop', reason);
      return mediaSession;
    }
    if (reason) {
      _classPrivateFieldLooseBase(this, _setStatus)[_setStatus]('failed', _classPrivateFieldLooseBase(this, _xiomb)[_xiomb].getMessage(reason));
      this.emit('error', reason);
    } else {
      _classPrivateFieldLooseBase(this, _setStatus)[_setStatus](_classPrivateFieldLooseBase(this, _getIdleStatus)[_getIdleStatus]());
    }
    this.emit('stop', reason || null);
    return mediaSession;
  }
  function _attachMedia2(mediaSession) {
    if (mediaSession.getTransport() === 'hls') {
      _classPrivateFieldLooseBase(this, _player)[_player].setPlayURL(mediaSession.getPlayURL(), _classPrivateFieldLooseBase(this, _xiomb)[_xiomb].getHls(), _classPrivateFieldLooseBase(this, _xiomb)[_xiomb].getHlsConfig());
    } else {
      _classPrivateFieldLooseBase(this, _player)[_player].setMediaStream(mediaSession.getMediaStream());
    }
  }
  function _bindMediaSession2(mediaSession) {
    var _this5 = this;
    var isCurrent = function isCurrent() {
      return mediaSession === _classPrivateFieldLooseBase(_this5, _mediaSession)[_mediaSession];
    };
    mediaSession.on('status', function (data) {
      if (isCurrent()) {
        _classPrivateFieldLooseBase(_this5, _setStatus)[_setStatus](data.status);
      }
    });
    mediaSession.on('state', function (connectionState) {
      if (isCurrent()) {
        _this5.emit('state', connectionState);
      }
    });
    mediaSession.on('stat', function (data) {
      if (isCurrent()) {
        _this5.emit('serverStat', data);
      }
    });
    mediaSession.on('stream', function () {
      if (!isCurrent()) {
        return;
      }
      if (!_classPrivateFieldLooseBase(_this5, _isPublish)[_isPublish]) {
        _classPrivateFieldLooseBase(_this5, _attachMedia)[_attachMedia](mediaSession);
      }
      _classPrivateFieldLooseBase(_this5, _player)[_player].play().catch(function (error) {
        return _classPrivateFieldLooseBase(_this5, _showError)[_showError](error);
      });
    });
    mediaSession.on('closed', function (reason) {
      if (isCurrent()) {
        ++_classPrivateFieldLooseBase(_this5, _startID)[_startID];
        _classPrivateFieldLooseBase(_this5, _finishSession)[_finishSession](reason ? createError(typeof reason === 'object' ? reason : {
          name: String(reason)
        }) : null);
      }
    });
  }
  function _getCustom2() {
    var custom = typeof _classPrivateFieldLooseBase(this, _options)[_options].custom === 'function' ? _classPrivateFieldLooseBase(this, _options)[_options].custom(this) : _classPrivateFieldLooseBase(this, _options)[_options].custom;
    return _extends({}, custom);
  }

  var exports$1 = {}, module$1 = {exports: exports$1};
  /**
   * xSocket v2.3.0
   * @licence MIT
   * @author Vadim Pride (pride.mk.ua@gmail.com)
   * @link https://github.com/pride-oO/xsocket
   */
  (function (global, factory) {
      typeof exports$1 === 'object' && typeof module$1 !== 'undefined' ? module$1.exports = factory() :
      typeof define === 'function' && define.amd ? define(factory) :
      (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.xSocket = factory());
  })(undefined, (function () {
      var xSocket = function xSocket(serverUrl, query, settings) {
        return new xSocket.Client(serverUrl, query, settings);
      };
      xSocket.VERSION = '2.3.0';
      xSocket.window = typeof window === 'object' ? window : false;
      xSocket.WebSocket = typeof WebSocket !== 'undefined' ? WebSocket : false;
      xSocket.process = false;

      var EventEmitter = /*#__PURE__*/function () {
        function EventEmitter() {
          this.__listenerMap = Object.create(null);
          this.__maxListeners = 10;
        }

        /**
         * Append EE listener
         * @param name
         * @param callback
         * @param once
         * @return {EventEmitter}
         */
        var _proto = EventEmitter.prototype;
        _proto.on = function on(name, callback, once) {
          if (typeof name !== 'string' || typeof callback !== 'function') {
            return this;
          }
          var listenerList = this.__listenerMap[name] || (this.__listenerMap[name] = []);
          listenerList.push({
            'callback': callback,
            'once': once === true
          });
          if (this.__maxListeners > 0 && listenerList.length > this.__maxListeners) {
            console.warn('EventEmitter ', name, ', exceeded maxListeners : ', this.__maxListeners + '/' + listenerList.length, '. Use EE.setMaxListeners(n)!');
          }
          return this;
        }

        /**
         * Append once EE listener
         * @param name
         * @param callback
         * @return {EventEmitter}
         */;
        _proto.once = function once(name, callback) {
          return this.on(name, callback, true);
        }

        /**
         * Getter all listener name
         * @returns {string[]}
         */;
        _proto.getListerensName = function getListerensName() {
          return Object.keys(this.__listenerMap);
        }

        /**
         * Clear all listener
         * @returns {{}}
         */;
        _proto.clearAllListerens = function clearAllListerens() {
          this.__listenerMap = Object.create(null);
          return this.__listenerMap;
        }

        /**
         * Getter count EE listener
         * @param name
         * @returns {number}
         */;
        _proto.listenerCount = function listenerCount(name) {
          var listenerList = this.__listenerMap[name];
          return listenerList ? listenerList.length : 0;
        }

        /**
         * Set max listeners
         * @param count
         * @returns {boolean}
         */;
        _proto.setMaxListeners = function setMaxListeners(count) {
          if (typeof count !== 'number') {
            return false;
          }
          this.__maxListeners = parseInt(count);
          return true;
        }

        /**
         * Delete EE listener
         * @param name
         * @param callback
         * @return {EventEmitter}
         */;
        _proto.off = function off(name, callback) {
          var listenerList = this.__listenerMap[name];
          if (!listenerList || typeof callback !== 'function') {
            return this;
          }
          for (var i = listenerList.length - 1; i >= 0; i--) {
            if (listenerList[i].callback === callback) {
              listenerList.splice(i, 1);
            }
          }
          if (!listenerList.length) {
            delete this.__listenerMap[name];
          }
          return this;
        }

        /**
         * Delete all EE listener
         * @param name
         * @return {EventEmitter}
         */;
        _proto.offAll = function offAll(name) {
          delete this.__listenerMap[name];
          return this;
        }

        /**
         * Emit EE listener
         * @param name
         * @param argList
         * @return {EventEmitter}
         */;
        _proto.emit = function emit(name) {
          var listenerList = this.__listenerMap[name];
          if (!listenerList) {
            return this;
          }
          listenerList = listenerList.slice();
          for (var _len = arguments.length, argList = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
            argList[_key - 1] = arguments[_key];
          }
          for (var i = 0; i < listenerList.length; i++) {
            var currentList = this.__listenerMap[name];
            var index = currentList ? currentList.indexOf(listenerList[i]) : -1;
            if (index === -1) {
              continue;
            }
            if (listenerList[i].once) {
              currentList.splice(index, 1);
              if (!currentList.length) {
                delete this.__listenerMap[name];
              }
            }
            listenerList[i].callback.apply(this, argList);
          }
          return this;
        };
        return EventEmitter;
      }();

      var MSG_SO_UPDATE = 0;
      var MSG_SD_CREATE = 1;
      var MSG_SD_UPDATE = 2;
      var MSG_SO_TIME = 3;

      /**
       *
       * @returns {Window|*}
       */
      var getWindow = function getWindow() {
        return xSocket.window;
      };

      /**
       *
       * @returns {any}
       */
      var getProcess = function getProcess() {
        return xSocket.process;
      };

      /**
       *
       * @param min
       * @param max
       * @returns {number}
       */
      var getRandInt = function getRandInt(min, max) {
        return Math.floor(min + Math.random() * (max + 1 - min));
      };

      /**
       *
       * @param data
       * @returns {boolean}
       */
      var isBinary = function isBinary(data) {
        return typeof ArrayBuffer === 'function' && (data instanceof ArrayBuffer || ArrayBuffer.isView(data));
      };

      /**
       *
       * @param type
       * @returns {number}
       */
      var getMessageDataIndex = function getMessageDataIndex(type) {
        return type === MSG_SD_CREATE ? 4 : 2;
      };

      /**
       *
       * @param text
       * @returns {Uint8Array}
       */
      var encodeText = function encodeText(text) {
        if (typeof TextEncoder === 'function') {
          return new TextEncoder().encode(text);
        }
        var binary = unescape(encodeURIComponent(text));
        var byteList = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
          byteList[i] = binary.charCodeAt(i);
        }
        return byteList;
      };

      /**
       *
       * @param byteList
       * @returns {string}
       */
      var decodeText = function decodeText(byteList) {
        if (typeof TextDecoder === 'function') {
          return new TextDecoder().decode(byteList);
        }
        var binary = '';
        for (var i = 0; i < byteList.length; i++) {
          binary += String.fromCharCode(byteList[i]);
        }
        return decodeURIComponent(escape(binary));
      };

      /**
       *
       * @param body
       * @returns {string|Uint8Array}
       */
      var encodeMessage = function encodeMessage(body) {
        var dataIndex = getMessageDataIndex(body[0]);
        var data = body[dataIndex];
        if (!isBinary(data)) {
          return JSON.stringify(body);
        }
        body = body.slice();
        body[dataIndex] = null;
        var headerBytes = encodeText(JSON.stringify(body));
        var dataBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        var frame = new Uint8Array(4 + headerBytes.length + dataBytes.length);
        new DataView(frame.buffer).setUint32(0, headerBytes.length);
        frame.set(headerBytes, 4);
        frame.set(dataBytes, 4 + headerBytes.length);
        return frame;
      };

      /**
       *
       * @param raw
       * @returns {Array|boolean}
       */
      var decodeMessage = function decodeMessage(raw) {
        var body;
        try {
          if (typeof raw === 'string') {
            body = JSON.parse(raw);
          } else {
            var frame = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
            var headerLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0);
            body = JSON.parse(decodeText(frame.subarray(4, 4 + headerLength)));
            if (Array.isArray(body)) {
              body[getMessageDataIndex(body[0])] = frame.subarray(4 + headerLength);
            }
          }
        } catch (e) {
          return false;
        }
        return Array.isArray(body) && typeof body[0] === 'number' ? body : false;
      };
      var helpers = {
        getWindow: getWindow,
        getProcess: getProcess,
        getRandInt: getRandInt,
        isBinary: isBinary,
        getMessageDataIndex: getMessageDataIndex,
        encodeText: encodeText,
        decodeText: decodeText,
        encodeMessage: encodeMessage,
        decodeMessage: decodeMessage,
        EventEmitter: EventEmitter
      };

      function _inheritsLoose(t, o) {
        t.prototype = Object.create(o.prototype), t.prototype.constructor = t, _setPrototypeOf(t, o);
      }
      function _setPrototypeOf(t, e) {
        return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) {
          return t.__proto__ = e, t;
        }, _setPrototypeOf(t, e);
      }

      /**
       * @this {Promise}
       */
      function finallyConstructor(callback) {
        var constructor = this.constructor;
        return this.then(function (value) {
          // @ts-ignore
          return constructor.resolve(callback()).then(function () {
            return value;
          });
        }, function (reason) {
          // @ts-ignore
          return constructor.resolve(callback()).then(function () {
            // @ts-ignore
            return constructor.reject(reason);
          });
        });
      }

      function allSettled(arr) {
        var P = this;
        return new P(function (resolve, reject) {
          if (!(arr && typeof arr.length !== 'undefined')) {
            return reject(new TypeError(typeof arr + ' ' + arr + ' is not iterable(cannot read property Symbol(Symbol.iterator))'));
          }
          var args = Array.prototype.slice.call(arr);
          if (args.length === 0) return resolve([]);
          var remaining = args.length;
          function res(i, val) {
            if (val && (typeof val === 'object' || typeof val === 'function')) {
              var then = val.then;
              if (typeof then === 'function') {
                then.call(val, function (val) {
                  res(i, val);
                }, function (e) {
                  args[i] = {
                    status: 'rejected',
                    reason: e
                  };
                  if (--remaining === 0) {
                    resolve(args);
                  }
                });
                return;
              }
            }
            args[i] = {
              status: 'fulfilled',
              value: val
            };
            if (--remaining === 0) {
              resolve(args);
            }
          }
          for (var i = 0; i < args.length; i++) {
            res(i, args[i]);
          }
        });
      }

      /**
       * @constructor
       */
      function AggregateError(errors, message) {
        this.name = 'AggregateError', this.errors = errors;
        this.message = message || '';
      }
      AggregateError.prototype = Error.prototype;
      function any(arr) {
        var P = this;
        return new P(function (resolve, reject) {
          if (!(arr && typeof arr.length !== 'undefined')) {
            return reject(new TypeError('Promise.any accepts an array'));
          }
          var args = Array.prototype.slice.call(arr);
          if (args.length === 0) return reject();
          var rejectionReasons = [];
          for (var i = 0; i < args.length; i++) {
            try {
              P.resolve(args[i]).then(resolve).catch(function (error) {
                rejectionReasons.push(error);
                if (rejectionReasons.length === args.length) {
                  reject(new AggregateError(rejectionReasons, 'All promises were rejected'));
                }
              });
            } catch (ex) {
              reject(ex);
            }
          }
        });
      }

      // Store setTimeout reference so promise-polyfill will be unaffected by
      // other code modifying setTimeout (like sinon.useFakeTimers())
      var setTimeoutFunc = setTimeout;
      function isArray(x) {
        return Boolean(x && typeof x.length !== 'undefined');
      }
      function noop() {}

      // Polyfill for Function.prototype.bind
      function bind(fn, thisArg) {
        return function () {
          fn.apply(thisArg, arguments);
        };
      }

      /**
       * @constructor
       * @param {Function} fn
       */
      function Promise$2(fn) {
        if (!(this instanceof Promise$2)) throw new TypeError('Promises must be constructed via new');
        if (typeof fn !== 'function') throw new TypeError('not a function');
        /** @type {!number} */
        this._state = 0;
        /** @type {!boolean} */
        this._handled = false;
        /** @type {Promise|undefined} */
        this._value = undefined;
        /** @type {!Array<!Function>} */
        this._deferreds = [];
        doResolve(fn, this);
      }
      function handle(self, deferred) {
        while (self._state === 3) {
          self = self._value;
        }
        if (self._state === 0) {
          self._deferreds.push(deferred);
          return;
        }
        self._handled = true;
        Promise$2._immediateFn(function () {
          var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
          if (cb === null) {
            (self._state === 1 ? resolve : reject)(deferred.promise, self._value);
            return;
          }
          var ret;
          try {
            ret = cb(self._value);
          } catch (e) {
            reject(deferred.promise, e);
            return;
          }
          resolve(deferred.promise, ret);
        });
      }
      function resolve(self, newValue) {
        try {
          // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
          if (newValue === self) throw new TypeError('A promise cannot be resolved with itself.');
          if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
            var then = newValue.then;
            if (newValue instanceof Promise$2) {
              self._state = 3;
              self._value = newValue;
              finale(self);
              return;
            } else if (typeof then === 'function') {
              doResolve(bind(then, newValue), self);
              return;
            }
          }
          self._state = 1;
          self._value = newValue;
          finale(self);
        } catch (e) {
          reject(self, e);
        }
      }
      function reject(self, newValue) {
        self._state = 2;
        self._value = newValue;
        finale(self);
      }
      function finale(self) {
        if (self._state === 2 && self._deferreds.length === 0) {
          Promise$2._immediateFn(function () {
            if (!self._handled) {
              Promise$2._unhandledRejectionFn(self._value);
            }
          });
        }
        for (var i = 0, len = self._deferreds.length; i < len; i++) {
          handle(self, self._deferreds[i]);
        }
        self._deferreds = null;
      }

      /**
       * @constructor
       */
      function Handler(onFulfilled, onRejected, promise) {
        this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
        this.onRejected = typeof onRejected === 'function' ? onRejected : null;
        this.promise = promise;
      }

      /**
       * Take a potentially misbehaving resolver function and make sure
       * onFulfilled and onRejected are only called once.
       *
       * Makes no guarantees about asynchrony.
       */
      function doResolve(fn, self) {
        var done = false;
        try {
          fn(function (value) {
            if (done) return;
            done = true;
            resolve(self, value);
          }, function (reason) {
            if (done) return;
            done = true;
            reject(self, reason);
          });
        } catch (ex) {
          if (done) return;
          done = true;
          reject(self, ex);
        }
      }
      Promise$2.prototype['catch'] = function (onRejected) {
        return this.then(null, onRejected);
      };
      Promise$2.prototype.then = function (onFulfilled, onRejected) {
        // @ts-ignore
        var prom = new this.constructor(noop);
        handle(this, new Handler(onFulfilled, onRejected, prom));
        return prom;
      };
      Promise$2.prototype['finally'] = finallyConstructor;
      Promise$2.all = function (arr) {
        return new Promise$2(function (resolve, reject) {
          if (!isArray(arr)) {
            return reject(new TypeError('Promise.all accepts an array'));
          }
          var args = Array.prototype.slice.call(arr);
          if (args.length === 0) return resolve([]);
          var remaining = args.length;
          function res(i, val) {
            try {
              if (val && (typeof val === 'object' || typeof val === 'function')) {
                var then = val.then;
                if (typeof then === 'function') {
                  then.call(val, function (val) {
                    res(i, val);
                  }, reject);
                  return;
                }
              }
              args[i] = val;
              if (--remaining === 0) {
                resolve(args);
              }
            } catch (ex) {
              reject(ex);
            }
          }
          for (var i = 0; i < args.length; i++) {
            res(i, args[i]);
          }
        });
      };
      Promise$2.any = any;
      Promise$2.allSettled = allSettled;
      Promise$2.resolve = function (value) {
        if (value && typeof value === 'object' && value.constructor === Promise$2) {
          return value;
        }
        return new Promise$2(function (resolve) {
          resolve(value);
        });
      };
      Promise$2.reject = function (value) {
        return new Promise$2(function (resolve, reject) {
          reject(value);
        });
      };
      Promise$2.race = function (arr) {
        return new Promise$2(function (resolve, reject) {
          if (!isArray(arr)) {
            return reject(new TypeError('Promise.race accepts an array'));
          }
          for (var i = 0, len = arr.length; i < len; i++) {
            Promise$2.resolve(arr[i]).then(resolve, reject);
          }
        });
      };

      // Use polyfill for setImmediate for performance gains
      Promise$2._immediateFn =
      // @ts-ignore
      typeof setImmediate === 'function' && function (fn) {
        // @ts-ignore
        setImmediate(fn);
      } || function (fn) {
        setTimeoutFunc(fn, 0);
      };
      Promise$2._unhandledRejectionFn = function _unhandledRejectionFn(err) {
        if (typeof console !== 'undefined' && console) {
          console.warn('Possible Unhandled Promise Rejection:', err); // eslint-disable-line no-console
        }
      };

      var Promise$1 = typeof Promise === 'function' && typeof Promise.prototype.then === 'function' ? Promise : Promise$2;

      var Data = /*#__PURE__*/function (_EventEmitter) {
        /**
         *
         * @param __isOutput
         * @param __object
         * @param __socketObject
         */
        function Data(__isOutput, __object, __socketObject) {
          var _this;
          _this = _EventEmitter.call(this) || this;
          _this.setMaxListeners(0);
          __object = typeof __object === 'object' && __object ? __object : {};
          _this.__isOutput = !!__isOutput;
          _this.__socketObject = __socketObject || false;
          _this.__ID = typeof __object.ID === 'string' ? __object.ID : '';
          _this.__type = typeof __object.type === 'string' ? __object.type : '';
          _this.__data = typeof __object.data === 'object' ? __object.data : {};
          _this.__ttl = typeof __object.ttl === 'number' && __object.ttl % 1 === 0 && __object.ttl >= 0 ? __object.ttl : Data.DEFAULT_TTL;
          var now = _this.__socketObject ? _this.__socketObject.getTime() : Date.now();
          _this.__time = typeof __object.time === 'number' && __object.time > 0 ? __object.time : now;
          _this.__resData = {};
          _this.__error = false;
          _this.__status = Data.STATUS_NEW;
          _this.__destroy = false;
          _this.__ttlTimeout = setTimeout(function () {
            _this.destroy('ttl', true);
          }, Math.max(0, Math.min(_this.__ttl, _this.__ttl - (now - _this.__time))));
          return _this;
        }

        /**
         *
         * @returns {string}
         */
        _inheritsLoose(Data, _EventEmitter);
        var _proto = Data.prototype;
        _proto.getID = function getID() {
          return String(this.__ID);
        }

        /**
         *
         * @returns {string}
         */;
        _proto.getType = function getType() {
          return String(this.__type);
        }

        /**
         *
         * @returns {number}
         */;
        _proto.getTTL = function getTTL() {
          return this.__ttl;
        }

        /**
         *
         * @returns {number}
         */;
        _proto.getTime = function getTime() {
          return this.__time;
        }

        /**
         *
         * @returns {{}}
         */;
        _proto.getData = function getData() {
          return this.__data || {};
        }

        /**
         *
         * @param key
         * @param def
         * @returns {*}
         */;
        _proto.getDataVal = function getDataVal(key, def) {
          return this.getData()[key] || def;
        }

        /**
         *
         * @returns {{}}
         */;
        _proto.getResData = function getResData() {
          return this.__resData || {};
        }

        /**
         *
         * @param key
         * @param def
         * @returns {*}
         */;
        _proto.getResDataVal = function getResDataVal(key, def) {
          return this.getResData()[key] || def;
        }

        /**
         *
         * @returns {number}
         */;
        _proto.getStatus = function getStatus() {
          return this.__status;
        }

        /**
         *
         * @returns {boolean|string}
         */;
        _proto.getDestroy = function getDestroy() {
          return this.__destroy || false;
        }

        /**
         *
         * @returns {SocketObject|boolean}
         */;
        _proto.getSocketObject = function getSocketObject() {
          return this.__socketObject;
        }

        /**
         *
         * @returns {string|boolean}
         */;
        _proto.getError = function getError() {
          return this.__error || false;
        }

        /**
         *
         * @returns {boolean}
         */;
        _proto.isNew = function isNew() {
          return this.__status === Data.STATUS_NEW;
        }

        /**
         *
         * @returns {boolean}
         */;
        _proto.isSend = function isSend() {
          return this.__status === Data.STATUS_SEND;
        }

        /**
         *
         * @returns {boolean}
         */;
        _proto.isResponse = function isResponse() {
          return this.__status === Data.STATUS_RESPONSE;
        }

        /**
         *
         * @param data
         * @param error
         * @returns {Promise<Data>}
         */;
        _proto.response = function response(data, error) {
          var _this2 = this;
          var promise = new Promise$1(function (resolve, reject) {
            if (_this2.__isOutput) {
              return reject(new Error('Output data'));
            }
            if (_this2.__destroy || _this2.isResponse() || !_this2.__ttl) {
              return reject(new Error('destroy'));
            }
            _this2.setResData(data);
            _this2.setError(error);
            _this2.once('response', function () {
              resolve(_this2);
            });
            _this2.once('destroy', function (msg) {
              reject(new Error(msg));
            });
            _this2.__socketObject.getWsReady().then(function (ws) {
              if (ws.sendObject([MSG_SD_UPDATE, Number(_this2.__ID), _this2.getResData(), _this2.getError()])) {
                _this2.setStatus(Data.STATUS_RESPONSE);
              } else {
                _this2.destroy('Send failed');
              }
            }).catch(function (e) {
              _this2.destroy(e.message || 'Send failed');
            });
          });
          promise.catch(function () {});
          return promise;
        }

        /**
         *
         * @param status
         * @returns {boolean}
         */;
        _proto.setStatus = function setStatus(status) {
          if (status !== Data.STATUS_SEND && status !== Data.STATUS_RESPONSE || this.__status === Data.STATUS_RESPONSE || this.__status === status) {
            return false;
          }
          this.__status = status;
          this.emit('setStatus', status);
          if (status === Data.STATUS_RESPONSE) {
            this.emit('response', this.getResData(), this.getError());
            this.destroy('response');
          }
          return true;
        }

        /**
         *
         * @param errorMsg
         * @returns {boolean}
         */;
        _proto.setError = function setError(errorMsg) {
          if (typeof errorMsg !== 'string') {
            return false;
          }
          this.__error = errorMsg;
          return true;
        }

        /**
         *
         * @param data
         * @returns {boolean}
         */;
        _proto.setResData = function setResData(data) {
          if (typeof data !== 'object') {
            return false;
          }
          this.__resData = data;
          return true;
        }

        /**
         *
         * @param msg
         * @param isSetError
         * @returns {boolean}
         */;
        _proto.destroy = function destroy(msg, isSetError) {
          if (this.__destroy) {
            return false;
          }
          this.__destroy = typeof msg === 'string' && msg.length ? msg : 'destroy';
          clearTimeout(this.__ttlTimeout);
          if (isSetError && !this.__error) {
            this.setError(this.__destroy);
          }
          if (this.__status !== Data.STATUS_RESPONSE) {
            this.setStatus(Data.STATUS_RESPONSE);
          }
          this.emit('destroy', this.__destroy);
          this.clearAllListerens();
          return true;
        };
        return Data;
      }(EventEmitter);
      Data.STATUS_NEW = 0;
      Data.STATUS_SEND = 1;
      Data.STATUS_RESPONSE = 2;
      Data.DEFAULT_TTL = 3000;

      var SocketObject = /*#__PURE__*/function (_EventEmitter) {
        /**
         *
         * @param __ServerConfigure
         * @param __req
         */
        function SocketObject(__ServerConfigure, __req) {
          var _this;
          _this = _EventEmitter.call(this) || this;
          _this.setMaxListeners(0);
          _this.__serverConfigure = __ServerConfigure;
          _this.__req = __req;
          _this.__ws = undefined;
          _this.__ID = '';
          _this.__sign = '';
          _this.__destroy = undefined;
          _this.__isNewConnection = true;
          _this.__socketDataMap = {};
          _this.__socketDataInc = 0;
          _this.__query = {};
          _this.__timeOffset = 0;
          _this.on('destroy', _this.__onDestroy);
          _this.on('ws|disconnect', _this.__onWsDisconnect);
          _this.on('ws|connect', _this.__onWsConnect);
          _this.on('ws|message', _this.__onWsMessage);
          return _this;
        }

        /**
         *
         * @returns {string}
         */
        _inheritsLoose(SocketObject, _EventEmitter);
        var _proto = SocketObject.prototype;
        _proto.getID = function getID() {
          return this.__ID || '';
        }

        /**
         *
         * @returns {string}
         */;
        _proto.getSign = function getSign() {
          return this.__sign || '';
        }

        /**
         *
         * @returns {number}
         */;
        _proto.getTime = function getTime() {
          return Date.now() + this.__timeOffset;
        }

        /**
         *
         * @returns {number}
         */;
        _proto.getTimeOffset = function getTimeOffset() {
          return this.__timeOffset;
        }

        /**
         *
         * @param timeOffset
         * @returns {boolean}
         */;
        _proto.setTimeOffset = function setTimeOffset(timeOffset) {
          if (typeof timeOffset !== 'number' || timeOffset !== timeOffset) {
            return false;
          }
          this.__timeOffset = Math.round(timeOffset);
          return true;
        }

        /**
         *
         * @returns {*|{}}
         */;
        _proto.getReq = function getReq() {
          return this.__req || {};
        }

        /**
         *
         * @returns {*}
         */;
        _proto.getQuery = function getQuery() {
          return typeof this.__query === 'object' ? this.__query : {};
        }

        /**
         *
         * @param key
         * @param def
         * @returns {*}
         */;
        _proto.getQueryVal = function getQueryVal(key, def) {
          return this.getQuery()[key] || def;
        }

        /**
         *
         * @returns {*|{}}
         */;
        _proto.getReqHeaders = function getReqHeaders() {
          return this.getReq()['headers'] || {};
        }

        /**
         *
         * @returns {*|string}
         */;
        _proto.getOrigin = function getOrigin() {
          return this.getReqHeaders()['origin'] || 'unknown';
        }

        /**
         *
         * @returns {string}
         */;
        _proto.getIP = function getIP() {
          return String((this.getReq()['connection'] || {})['remoteAddress'] || 'unknown');
        }

        /**
         *
         * @returns {{}}
         */;
        _proto.getSocketDataList = function getSocketDataList() {
          return this.__socketDataMap;
        }

        /**
         *
         * @param ID
         * @returns {Data|boolean}
         */;
        _proto.getSocketData = function getSocketData(ID) {
          return this.__socketDataMap[ID] || false;
        }

        /**
         *
         * @returns {boolean}
         */;
        _proto.isConnection = function isConnection() {
          return typeof this.__ws === 'object' ? this.__ws.isConnection() : false;
        }

        /**
         *
         * @returns {any|boolean}
         */;
        _proto.getConnection = function getConnection() {
          return this.isConnection() ? this.__ws : false;
        }

        /**
         *
         * @returns {string|boolean}
         */;
        _proto.getDestroy = function getDestroy() {
          return this.__destroy || false;
        }

        /**
         *
         * @returns {boolean}
         */;
        _proto.isDestroy = function isDestroy() {
          return !!this.getDestroy();
        }

        /**
         *
         * @returns {boolean}
         */;
        _proto.isServer = function isServer() {
          return !!this.__serverConfigure;
        }

        /**
         *
         * @returns {Promise}
         */;
        _proto.getWsReady = function getWsReady() {
          var _this2 = this;
          return new Promise$1(function (resolve, reject) {
            if (_this2.getConnection()) {
              return resolve(_this2.getConnection());
            }
            var destroyHandler = function destroyHandler() {
              _this2.off('connect', connectHandler);
              reject(new Error('destroy'));
            };
            var connectHandler = function connectHandler() {
              _this2.off('destroy', destroyHandler);
              if (_this2.getConnection()) {
                resolve(_this2.getConnection());
              } else {
                reject(new Error('Connection failed'));
              }
            };
            _this2.once('connect', connectHandler);
            _this2.once('destroy', destroyHandler);
          });
        }

        /**
         *
         * @param type
         * @param data
         * @param ttl
         * @returns {Promise<Data>}
         */;
        _proto.send = function send(type, data, ttl) {
          var _this3 = this;
          var socketData = new Data(true, {
            'ID': String(++this.__socketDataInc),
            'type': type,
            'data': data,
            'ttl': ttl,
            'time': this.getTime()
          }, this);
          if (socketData.getTTL()) {
            this.__socketDataMap[socketData.getID()] = socketData;
            socketData.once('destroy', function () {
              delete _this3.__socketDataMap[socketData.getID()];
            });
          }
          this.getWsReady().then(function (ws) {
            if (!ws.sendObject([MSG_SD_CREATE, Number(socketData.getID()), socketData.getType(), socketData.getTTL(), socketData.getData(), socketData.getTime()])) {
              return socketData.destroy('Send failed');
            }
            socketData.setStatus(socketData.getTTL() ? Data.STATUS_SEND : Data.STATUS_RESPONSE);
          }).catch(function (e) {
            socketData.destroy(e.message || 'Send failed');
          });
          return Promise$1.resolve(socketData);
        }

        /**
         *
         * @param type
         * @param data
         * @param ttl
         * @returns {Promise<Data>}
         */;
        _proto.sendReadyResponse = function sendReadyResponse(type, data, ttl) {
          return this.send(type, data, ttl).then(function (socketData) {
            return new Promise$1(function (resolve, reject) {
              var responseHandler = function responseHandler() {
                if (socketData.getError()) {
                  return reject(new Error(socketData.getError()));
                }
                resolve(socketData);
              };
              if (socketData.isResponse() || socketData.getDestroy()) {
                return responseHandler();
              }
              socketData.once('response', responseHandler);
            });
          });
        }

        /**
         *
         * @param type
         * @param data
         * @param ttl
         * @returns {Promise<Data>}
         */;
        _proto.sendReady = function sendReady(type, data, ttl) {
          return this.sendReadyResponse(type, data, ttl);
        }

        /**
         *
         * @param msg
         * @returns {boolean}
         */;
        _proto.destroy = function destroy(msg) {
          if (this.isDestroy()) {
            return false;
          }
          this.__destroy = String(msg || 'destroy');
          this.disconnect(this.__destroy);
          this.emit('destroy', this, this.__destroy);
          this.clearAllListerens();
          return true;
        }

        /**
         *
         * @param msg
         * @returns {boolean}
         */;
        _proto.disconnect = function disconnect(msg) {
          var ws = this.getConnection();
          if (!ws) {
            return false;
          }
          return ws.closeConnection(msg);
        }

        /**
         *
         * @param ws
         * @returns {boolean}
         */;
        _proto.update = function update(ws) {
          if (typeof ws !== 'object' || typeof ws.isConnection !== 'function' || typeof ws.query !== 'object') {
            return false;
          }
          if (!ws.isConnection() || this.__destroy) {
            return false;
          }
          if (this.__ID !== ws.query['xSOId'] || this.__sign !== ws.query['xSOSign']) {
            this.__ID = ws.query['xSOId'];
            this.__sign = ws.query['xSOSign'];
            this.__query = Object(ws['query'] || {});
            delete this.__query['xSOId'];
            delete this.__query['xSOSign'];
            delete this.__query['xV'];
            this.emit('update', this);
          }
          if (this.isServer()) {
            ws.sendObject([MSG_SO_UPDATE, this.getID(), this.getSign(), typeof this.__serverConfigure === 'object' ? this.__serverConfigure : {}, xSocket.VERSION, Date.now()]);
          } else {
            this.setTimeOffset(ws.timeOffset);
            ws.sendObject([MSG_SO_TIME, Date.now()]);
          }
          this.__ws = ws;
          ws.SocketObject = this;
          this.emit('ws|connect', ws);
          return true;
        };
        _proto.__onDestroy = function __onDestroy() {
          for (var ID in this.__socketDataMap) {
            this.__socketDataMap[ID].destroy('SocketObject|destroy');
          }
        };
        _proto.__onWsDisconnect = function __onWsDisconnect(msg) {
          msg = typeof msg === 'string' ? msg : 'unknown';
          this.emit('disconnect', this, msg);
          if (msg === 'end') {
            this.destroy('end');
          }
        };
        _proto.__onWsConnect = function __onWsConnect() {
          this.emit('connect', this);
          if (!this.__isNewConnection) {
            this.emit('reconnect', this);
          } else {
            this.__isNewConnection = false;
          }
        };
        _proto.__onWsMessage = function __onWsMessage(body) {
          if (body[0] === MSG_SO_TIME) {
            return this.__onWsTime(body);
          }
          var ID = body[1];
          if (typeof ID !== 'number' || ID % 1 !== 0 || ID < 1) {
            return;
          }
          var socketData;
          if (body[0] === MSG_SD_CREATE) {
            if (typeof body[2] !== 'string' || !body[2].length || typeof body[4] !== 'object') {
              return;
            }
            socketData = new Data(false, {
              'ID': String(ID),
              'type': body[2],
              'ttl': body[3],
              'data': body[4],
              'time': body[5]
            }, this);
            this.emit('data', socketData);
            this.emit('data|' + socketData.getType(), socketData);
            if (!socketData.getTTL()) {
              socketData.setStatus(Data.STATUS_RESPONSE);
            }
          } else if (body[0] === MSG_SD_UPDATE) {
            socketData = this.getSocketData(String(ID));
            if (socketData) {
              socketData.setResData(body[2]);
              socketData.setError(body[3] || false);
              socketData.setStatus(Data.STATUS_RESPONSE);
            }
          }
        };
        _proto.__onWsTime = function __onWsTime(body) {
          var ws = this.getConnection();
          if (!ws || typeof body[1] !== 'number') {
            return;
          }
          if (this.isServer()) {
            ws.sendObject([MSG_SO_TIME, body[1], Date.now()]);
          } else if (typeof body[2] === 'number') {
            var now = Date.now();
            this.setTimeOffset(body[2] + (now - body[1]) / 2 - now);
          }
        };
        return SocketObject;
      }(EventEmitter);
      SocketObject.MSG_SO_UPDATE = MSG_SO_UPDATE;
      SocketObject.MSG_SD_CREATE = MSG_SD_CREATE;
      SocketObject.MSG_SD_UPDATE = MSG_SD_UPDATE;
      SocketObject.MSG_SO_TIME = MSG_SO_TIME;

      var Client = /*#__PURE__*/function (_EventEmitter) {
        /**
         *
         * @param serverUrl
         * @param query
         * @param settings
         */
        function Client(serverUrl, query, settings) {
          var _this;
          _this = _EventEmitter.call(this) || this;
          _this.setMaxListeners(0);
          _this.__urlList = [];
          _this.__ws = undefined;
          _this.__socketObject = false;
          _this.__isVersionWarned = false;
          _this.__settings = typeof settings === 'object' && settings ? settings : {};
          _this.__query = typeof query === 'object' && query ? query : {};
          if (typeof serverUrl === 'object' && serverUrl) {
            for (var i in serverUrl) {
              _this.__urlList.push(serverUrl[i]);
            }
          } else if (typeof serverUrl === 'string') {
            _this.__urlList.push(serverUrl);
          }
          if (!_this.__urlList.length) {
            throw new Error('Invalid urlList');
          }
          var reconnect = function reconnect() {
            setTimeout(function () {
              _this.getWs().catch(function () {});
            }, 1000);
          };
          _this.on('ws|disconnect', reconnect);
          _this.on('ws|error', reconnect);
          var closeConnection = function closeConnection() {
            try {
              _this.__ws.closeConnection('end');
            } catch (e) {}
          };
          if (getWindow()) {
            getWindow().addEventListener('pagehide', closeConnection);
            getWindow().addEventListener('unload', closeConnection);
          } else if (getProcess()) {
            getProcess().on('exit', closeConnection);
          }
          _this.on('connect', function (socketObject) {
            var destroyTimeout = false;
            var setDestroyTimeout = function setDestroyTimeout(action, ttl) {
              if (destroyTimeout) {
                clearTimeout(destroyTimeout);
                destroyTimeout = false;
              }
              if (action) {
                ttl = typeof ttl === 'number' && !isNaN(ttl) && ttl > 0 ? ttl : 0;
                destroyTimeout = setTimeout(function () {
                  socketObject.destroy('socketObjectTimeout');
                  destroyTimeout = false;
                }, ttl);
              }
            };
            socketObject.on('reconnect', function () {
              setDestroyTimeout(false);
            });
            socketObject.on('disconnect', function () {
              var socketObjectTimeout = parseInt(Object(socketObject.getQueryVal('configure', {}))['socketObjectTimeout'] || 0);
              if (typeof socketObjectTimeout === 'number') {
                setDestroyTimeout(true, socketObjectTimeout);
              }
            });
            socketObject.once('destroy', function () {
              setDestroyTimeout(false);
            });
          });
          _this.getWs().catch(function () {});
          return _this;
        }

        /**
         *
         * @returns {{}}
         */
        _inheritsLoose(Client, _EventEmitter);
        var _proto = Client.prototype;
        _proto.getSettings = function getSettings() {
          return this.__settings || {};
        }

        /**
         *
         * @param key
         * @param def
         * @returns {*}
         */;
        _proto.getSettingsVal = function getSettingsVal(key, def) {
          return this.getSettings()[key] || def;
        }

        /**
         *
         * @returns {SocketObject|boolean}
         */;
        _proto.getSocketObject = function getSocketObject() {
          return this.__socketObject;
        }

        /**
         *
         * @returns {Promise<SocketObject>}
         */;
        _proto.getSocketObjectReady = function getSocketObjectReady() {
          var _this2 = this;
          return new Promise$1(function (resolve) {
            if (_this2.getSocketObject()) {
              return resolve(_this2.getSocketObject());
            }
            _this2.once('connect', function (socketObject) {
              resolve(socketObject);
            });
          });
        }

        /**
         *
         * @returns {Promise<{}>}
         */;
        _proto.getWs = function getWs() {
          var _this3 = this;
          return new Promise$1(function (resolve) {
            if (typeof _this3.__ws === 'object') {
              return resolve(_this3.__ws);
            }
            _this3.__ws = null;
            var url = _this3.__urlList[getRandInt(0, _this3.__urlList.length - 1)];
            url += url.indexOf('?') === -1 ? '?' : '&';
            var query = _this3.__query;
            query['xV'] = xSocket.VERSION;
            if (_this3.__socketObject && _this3.__socketObject.getID().length && _this3.__socketObject.getSign().length) {
              query['xSOId'] = String(_this3.__socketObject.getID());
              query['xSOSign'] = String(_this3.__socketObject.getSign());
            }
            for (var i in query) {
              try {
                url += encodeURIComponent(String(i)) + '=' + encodeURIComponent(String(query[i])) + '&';
              } catch (e) {}
            }
            var ws = new xSocket.WebSocket(url);
            ws.binaryType = 'arraybuffer';
            ws.isConnection = function () {
              return ws.readyState === 1;
            };
            ws.closeConnection = function (msg) {
              if (ws.isConnection()) {
                try {
                  ws.close(1000, String(msg || 'close'));
                  return true;
                } catch (e) {
                  console.error(e);
                }
              }
              return false;
            };
            ws.sendMessage = function (msg) {
              try {
                if (ws.isConnection()) {
                  ws.send(String(msg));
                  return true;
                }
              } catch (e) {}
              return false;
            };
            ws.sendObject = function (object) {
              try {
                if (ws.isConnection()) {
                  ws.send(encodeMessage(object));
                  return true;
                }
              } catch (e) {}
              return false;
            };
            var closeMsg;
            var msgInc = 0;
            var pongInterval = false;
            ws.onopen = function () {
              _this3.__ws = ws;
              _this3.emit('ws|connect', ws);
              pongInterval = setInterval(function () {
                if (!msgInc) {
                  ws.closeConnection('pingTimeout');
                }
                msgInc = 0;
              }, 21000);
              resolve(ws);
            };
            ws.onmessage = function (e) {
              msgInc++;
              if (e.data === 'ping') {
                return ws.sendMessage('pong');
              }
              try {
                var body = decodeMessage(e.data);
                if (!body) {
                  return;
                }
                if (body[0] === MSG_SO_UPDATE) {
                  _this3.__onSocketObjectUpdate(ws, body);
                } else if (_this3.__socketObject) {
                  _this3.__socketObject.emit('ws|message', body);
                }
              } catch (e) {}
            };
            ws.onclose = function (e) {
              if (pongInterval) {
                clearInterval(pongInterval);
              }
              _this3.__ws = undefined;
              closeMsg = closeMsg || e.reason || 'close';
              _this3.emit('ws|disconnect', closeMsg);
              if (_this3.__socketObject) {
                _this3.__socketObject.emit('ws|disconnect', closeMsg);
              }
            };
            ws.onerror = function (e) {
              closeMsg = e.message;
              _this3.emit('ws|error', e.message, ws);
            };
          });
        }

        /**
         *
         * @param type
         * @param data
         * @param ttl
         * @returns {Promise<Data>}
         */;
        _proto.send = function send(type, data, ttl) {
          return this.getSocketObjectReady().then(function (socketObject) {
            return socketObject.send(type, data, ttl);
          });
        }

        /**
         *
         * @param type
         * @param data
         * @param ttl
         * @returns {Promise<Data>}
         */;
        _proto.sendReady = function sendReady(type, data, ttl) {
          return this.getSocketObjectReady().then(function (socketObject) {
            return socketObject.sendReady(type, data, ttl);
          });
        }

        /**
         *
         * @param type
         * @param data
         * @param ttl
         * @returns {Promise<Data>}
         */;
        _proto.sendReadyResponse = function sendReadyResponse(type, data, ttl) {
          return this.sendReady(type, data, ttl);
        }

        /**
         *
         * @param msg
         * @returns {boolean}
         */;
        _proto.disconnect = function disconnect(msg) {
          var socketObject = this.getSocketObject();
          if (!socketObject) {
            return false;
          }
          return socketObject.disconnect(msg);
        };
        _proto.__onSocketObjectUpdate = function __onSocketObjectUpdate(ws, body) {
          var _this4 = this;
          if (body[4] !== xSocket.VERSION && !this.__isVersionWarned) {
            this.__isVersionWarned = true;
            console.warn('[warn|xSocket]', 'Version mismatch', 'client ' + xSocket.VERSION + ', server ' + (body[4] || 'unknown'));
          }
          ws.timeOffset = typeof body[5] === 'number' ? body[5] - Date.now() : 0;
          ws.query = {
            'xSOId': String(body[1]),
            'xSOSign': String(body[2]),
            'configure': typeof body[3] === 'object' ? body[3] : {}
          };
          if (this.__socketObject) {
            if (ws.query['xSOId'] === this.__socketObject.getID() && ws.query['xSOSign'] === this.__socketObject.getSign() && this.__socketObject.update(ws)) {
              return;
            }
            this.__socketObject.destroy('update');
          }
          var socketObject = this.__socketObject = new SocketObject();
          socketObject.once('connect', function () {
            _this4.emit('connect', socketObject);
          });
          socketObject.on('destroy', function (socketObject, msg) {
            _this4.__socketObject = false;
            _this4.emit('destroy', socketObject, msg);
          });
          socketObject.on('disconnect', function (socketObject, msg) {
            _this4.emit('disconnect', socketObject, msg);
          });
          socketObject.on('reconnect', function () {
            _this4.emit('reconnect', socketObject);
          });
          socketObject.on('data', function (socketData) {
            _this4.emit('data', socketData);
          });
          if (!socketObject.update(ws)) {
            ws.closeConnection('update');
          }
        };
        return Client;
      }(EventEmitter);

      xSocket.helpers = helpers;
      xSocket.EventEmitter = EventEmitter;
      xSocket.Data = Data;
      xSocket.xSocketObject = SocketObject;
      xSocket.Client = Client;
      xSocket.VERSION;

      return xSocket;

  }));

  var xSocket = module$1.exports;

  function _catch(body, recover) {
    try {
      var result = body();
    } catch (e) {
      return recover(e);
    }
    if (result && result.then) {
      return result.then(void 0, recover);
    }
    return result;
  }
  var _resume2 = function _resume2() {
    try {
      var _temp6 = function _temp6(_result3) {
        if (_exit3) return _result3;
        var resumedList = resumeResult.resumed || [];
        var closedList = resumeResult.closed || [];
        for (var _iterator6 = _createForOfIteratorHelperLoose(resumedList), _step6; !(_step6 = _iterator6()).done;) {
          var resumed = _step6.value;
          var mediaSession = _this9.getMediaSession(resumed.ID);
          if (mediaSession) {
            mediaSession.onStatus(_extends({}, resumed, {
              reason: null
            }));
          }
        }
        for (var _iterator7 = _createForOfIteratorHelperLoose(closedList), _step7; !(_step7 = _iterator7()).done;) {
          var closed = _step7.value;
          var _mediaSession = _this9.getMediaSession(closed.ID);
          if (_mediaSession) {
            _mediaSession.onClosed({
              reason: closed.reason
            });
          }
        }
        _this9.emit('resume', {
          resumed: resumedList.length,
          closed: closedList.length
        });
      };
      var _exit3 = false;
      var _this9 = this;
      var mediaSessionList = _this9.getMediaSessionList();
      if (!mediaSessionList.length) {
        return Promise.resolve();
      }
      var resumeResult;
      var _temp5 = _catch(function () {
        return Promise.resolve(_this9.request('media.resume', {
          IDList: mediaSessionList.map(function (mediaSession) {
            return mediaSession.getID();
          })
        })).then(function (_this9$request) {
          resumeResult = _this9$request;
        });
      }, function () {
        _classPrivateFieldLooseBase(_this9, _closeMediaSessionList)[_closeMediaSessionList]({
          name: 'SESSION_RESET',
          message: 'Session reset'
        });
        _this9.emit('reset');
        _exit3 = true;
      });
      return Promise.resolve(_temp5 && _temp5.then ? _temp5.then(_temp6) : _temp6(_temp5));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var REQUEST_TTL = 20000;
  var EARLY_MESSAGE_TTL = 10000;
  var MEDIA_TYPE_LIST = ['media.signal', 'media.status', 'media.closed', 'media.stat'];
  var DEFAULT_STUN_URL = 'stun:stun.xiomb.com:3478';
  var TRANSPORT_NAME_MAP = {
    webrtc: 'WebRTC',
    hls: 'HLS'
  };
  var _config = /*#__PURE__*/_classPrivateFieldLooseKey("config");
  var _urlList = /*#__PURE__*/_classPrivateFieldLooseKey("urlList");
  var _query = /*#__PURE__*/_classPrivateFieldLooseKey("query");
  var _hlsEntry = /*#__PURE__*/_classPrivateFieldLooseKey("hlsEntry");
  var _iceServerList = /*#__PURE__*/_classPrivateFieldLooseKey("iceServerList");
  var _params = /*#__PURE__*/_classPrivateFieldLooseKey("params");
  var _Hls = /*#__PURE__*/_classPrivateFieldLooseKey("Hls");
  var _hlsConfig = /*#__PURE__*/_classPrivateFieldLooseKey("hlsConfig");
  var _xSocket = /*#__PURE__*/_classPrivateFieldLooseKey("xSocket");
  var _xSocketClient = /*#__PURE__*/_classPrivateFieldLooseKey("xSocketClient");
  var _xSocketObject = /*#__PURE__*/_classPrivateFieldLooseKey("xSocketObject");
  var _ready = /*#__PURE__*/_classPrivateFieldLooseKey("ready");
  var _connected = /*#__PURE__*/_classPrivateFieldLooseKey("connected");
  var _sessionID = /*#__PURE__*/_classPrivateFieldLooseKey("sessionID");
  var _mediaSessionMap = /*#__PURE__*/_classPrivateFieldLooseKey("mediaSessionMap");
  var _earlyMessageMap = /*#__PURE__*/_classPrivateFieldLooseKey("earlyMessageMap");
  var _lostStatusMap = /*#__PURE__*/_classPrivateFieldLooseKey("lostStatusMap");
  var _messageMap = /*#__PURE__*/_classPrivateFieldLooseKey("messageMap");
  var _transportCheckMap = /*#__PURE__*/_classPrivateFieldLooseKey("transportCheckMap");
  var _closeMediaSessionList = /*#__PURE__*/_classPrivateFieldLooseKey("closeMediaSessionList");
  var _deliver = /*#__PURE__*/_classPrivateFieldLooseKey("deliver");
  var _resume = /*#__PURE__*/_classPrivateFieldLooseKey("resume");
  var _setReconnectStatus = /*#__PURE__*/_classPrivateFieldLooseKey("setReconnectStatus");
  var _restoreStatus = /*#__PURE__*/_classPrivateFieldLooseKey("restoreStatus");
  var _onReconnect = /*#__PURE__*/_classPrivateFieldLooseKey("onReconnect");
  var _onDisconnect = /*#__PURE__*/_classPrivateFieldLooseKey("onDisconnect");
  var _onSessionReady = /*#__PURE__*/_classPrivateFieldLooseKey("onSessionReady");
  var _onData = /*#__PURE__*/_classPrivateFieldLooseKey("onData");
  var _createClient = /*#__PURE__*/_classPrivateFieldLooseKey("createClient");
  var xiomb = /*#__PURE__*/function (_xiombEmitter) {
    function xiomb(config) {
      var _this;
      _this = _xiombEmitter.call(this) || this;
      Object.defineProperty(_this, _createClient, {
        value: _createClient2
      });
      Object.defineProperty(_this, _onData, {
        value: _onData2
      });
      Object.defineProperty(_this, _onSessionReady, {
        value: _onSessionReady2
      });
      Object.defineProperty(_this, _onDisconnect, {
        value: _onDisconnect2
      });
      Object.defineProperty(_this, _onReconnect, {
        value: _onReconnect2
      });
      Object.defineProperty(_this, _restoreStatus, {
        value: _restoreStatus2
      });
      Object.defineProperty(_this, _setReconnectStatus, {
        value: _setReconnectStatus2
      });
      Object.defineProperty(_this, _resume, {
        value: _resume2
      });
      Object.defineProperty(_this, _deliver, {
        value: _deliver2
      });
      Object.defineProperty(_this, _closeMediaSessionList, {
        value: _closeMediaSessionList2
      });
      Object.defineProperty(_this, _config, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _urlList, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _query, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _hlsEntry, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _iceServerList, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _params, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _Hls, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _hlsConfig, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _xSocket, {
        writable: true,
        value: void 0
      });
      Object.defineProperty(_this, _xSocketClient, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _xSocketObject, {
        writable: true,
        value: null
      });
      Object.defineProperty(_this, _ready, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _connected, {
        writable: true,
        value: false
      });
      Object.defineProperty(_this, _sessionID, {
        writable: true,
        value: ''
      });
      Object.defineProperty(_this, _mediaSessionMap, {
        writable: true,
        value: {}
      });
      Object.defineProperty(_this, _earlyMessageMap, {
        writable: true,
        value: {}
      });
      Object.defineProperty(_this, _lostStatusMap, {
        writable: true,
        value: {}
      });
      Object.defineProperty(_this, _messageMap, {
        writable: true,
        value: {}
      });
      // чем смотреть: порядок - приоритет по умолчанию, проверка поддержки браузером
      Object.defineProperty(_this, _transportCheckMap, {
        writable: true,
        value: {
          webrtc: function webrtc() {
            return typeof window.RTCPeerConnection === 'function';
          },
          hls: function hls() {
            var Hls = _this.getHls();
            if (Hls && typeof Hls.isSupported === 'function' && Hls.isSupported()) {
              return true;
            }
            var videoEl = document.createElement('video');
            return !!(videoEl.canPlayType && videoEl.canPlayType('application/vnd.apple.mpegurl'));
          }
        }
      });
      _classPrivateFieldLooseBase(_this, _config)[_config] = config || {};
      _classPrivateFieldLooseBase(_this, _urlList)[_urlList] = Array.isArray(_classPrivateFieldLooseBase(_this, _config)[_config].url) ? _classPrivateFieldLooseBase(_this, _config)[_config].url : [_classPrivateFieldLooseBase(_this, _config)[_config].url];
      _this.setMessageList(_classPrivateFieldLooseBase(_this, _config)[_config].messageList);
      _classPrivateFieldLooseBase(_this, _params)[_params] = _extends({
        video: true,
        audio: true
      }, _classPrivateFieldLooseBase(_this, _config)[_config].params);
      _classPrivateFieldLooseBase(_this, _query)[_query] = _classPrivateFieldLooseBase(_this, _config)[_config].query || {};
      _classPrivateFieldLooseBase(_this, _iceServerList)[_iceServerList] = _classPrivateFieldLooseBase(_this, _config)[_config].iceServerList || null;
      _classPrivateFieldLooseBase(_this, _Hls)[_Hls] = _classPrivateFieldLooseBase(_this, _config)[_config].Hls || null;
      _classPrivateFieldLooseBase(_this, _hlsConfig)[_hlsConfig] = _classPrivateFieldLooseBase(_this, _config)[_config].hlsConfig || {};
      _classPrivateFieldLooseBase(_this, _xSocket)[_xSocket] = _classPrivateFieldLooseBase(_this, _config)[_config].xSocket || xSocket;
      if (typeof _classPrivateFieldLooseBase(_this, _xSocket)[_xSocket] !== 'function') {
        throw new xiombError('INTERNAL', 'xSocket not found');
      }
      if (window.addEventListener) {
        window.addEventListener('pagehide', function () {
          for (var _iterator = _createForOfIteratorHelperLoose(_this.getMediaSessionList()), _step; !(_step = _iterator()).done;) {
            var mediaSession = _step.value;
            _this.notify('media.close', {
              ID: mediaSession.getID()
            });
          }
        });
      }
      return _this;
    }
    _inheritsLoose(xiomb, _xiombEmitter);
    var _proto = xiomb.prototype;
    _proto.getConfig = function getConfig() {
      return _classPrivateFieldLooseBase(this, _config)[_config];
    };
    _proto.getSessionID = function getSessionID() {
      return _classPrivateFieldLooseBase(this, _sessionID)[_sessionID];
    }

    // для каждого RTCPeerConnection свой одноразовый логин TURN от сервера
  ;
    _proto.getIceServers = function getIceServers() {
      try {
        var _temp2 = function _temp2(_result) {
          return _exit ? _result : {
            iceServerList: [{
              urls: DEFAULT_STUN_URL
            }],
            turn: ''
          };
        };
        var _exit = false;
        var _this2 = this;
        if (_classPrivateFieldLooseBase(_this2, _iceServerList)[_iceServerList]) {
          return Promise.resolve({
            iceServerList: _classPrivateFieldLooseBase(_this2, _iceServerList)[_iceServerList],
            turn: ''
          });
        }
        var _temp = _catch(function () {
          return Promise.resolve(_this2.request('media.turn', {})).then(function (result) {
            if (result && Array.isArray(result.iceServerList) && result.iceServerList.length) {
              var _iceServerList$turn = {
                iceServerList: result.iceServerList,
                turn: result.turn || ''
              };
              _exit = true;
              return _iceServerList$turn;
            }
          });
        }, function (e) {
          console.warn('[xiomb] TURN unavailable:', e && e.name);
        });
        return Promise.resolve(_temp && _temp.then ? _temp.then(_temp2) : _temp2(_temp));
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.isConnected = function isConnected() {
      return _classPrivateFieldLooseBase(this, _connected)[_connected] && !!_classPrivateFieldLooseBase(this, _xSocketObject)[_xSocketObject];
    };
    _proto.connect = function connect() {
      var _this3 = this;
      return new Promise(function (resolve, reject) {
        if (_this3.isConnected()) {
          return resolve(_this3);
        }
        var onConnect = function onConnect() {
          _this3.off('connectFail', onFail);
          resolve(_this3);
        };
        var onFail = function onFail(error) {
          _this3.off('sessionReady', onConnect);
          reject(error);
        };
        _this3.once('sessionReady', onConnect);
        _this3.once('connectFail', onFail);
        if (!_classPrivateFieldLooseBase(_this3, _xSocketClient)[_xSocketClient]) {
          _classPrivateFieldLooseBase(_this3, _createClient)[_createClient]();
        }
      });
    };
    _proto.setMessageList = function setMessageList(messageList) {
      _classPrivateFieldLooseBase(this, _messageMap)[_messageMap] = _extends({}, _classPrivateFieldLooseBase(this, _messageMap)[_messageMap], messageList);
    };
    _proto.getMessage = function getMessage(error) {
      var isObject = typeof error === 'object' && !!error;
      var keyList = isObject ? [error.name, error.message] : [error];
      for (var _i = 0, _keyList = keyList; _i < _keyList.length; _i++) {
        var key = _keyList[_i];
        if (key && _classPrivateFieldLooseBase(this, _messageMap)[_messageMap].hasOwnProperty(String(key))) {
          return _classPrivateFieldLooseBase(this, _messageMap)[_messageMap][String(key)];
        }
      }
      if (_classPrivateFieldLooseBase(this, _messageMap)[_messageMap].hasOwnProperty('default')) {
        return _classPrivateFieldLooseBase(this, _messageMap)[_messageMap].default;
      }
      return isObject ? error.message || error.name || '' : String(error || '');
    };
    _proto.getCodecList = function getCodecList(isPublish) {
      var codecList = {
        video: [],
        audio: []
      };
      var capabilitySource = isPublish ? window.RTCRtpSender : window.RTCRtpReceiver;
      if (!capabilitySource || typeof capabilitySource.getCapabilities !== 'function') {
        return codecList;
      }
      for (var _i2 = 0, _Object$keys = Object.keys(codecList); _i2 < _Object$keys.length; _i2++) {
        var kind = _Object$keys[_i2];
        var capabilities = capabilitySource.getCapabilities(kind);
        for (var _iterator2 = _createForOfIteratorHelperLoose(capabilities && capabilities.codecs ? capabilities.codecs : []), _step2; !(_step2 = _iterator2()).done;) {
          var item = _step2.value;
          var name = String(item.mimeType || '').split('/')[1] || '';
          if (name && SERVICE_CODEC_LIST.indexOf(name.toUpperCase()) === -1 && codecList[kind].indexOf(name) === -1) {
            codecList[kind].push(name);
          }
        }
      }
      return codecList;
    };
    _proto.getParams = function getParams() {
      return _classPrivateFieldLooseBase(this, _params)[_params];
    };
    _proto.getHls = function getHls() {
      return _classPrivateFieldLooseBase(this, _Hls)[_Hls] || window.Hls || null;
    };
    _proto.getHlsConfig = function getHlsConfig() {
      return _classPrivateFieldLooseBase(this, _hlsConfig)[_hlsConfig];
    };
    _proto.isTransportSupported = function isTransportSupported(transport) {
      return _classPrivateFieldLooseBase(this, _transportCheckMap)[_transportCheckMap].hasOwnProperty(transport) && _classPrivateFieldLooseBase(this, _transportCheckMap)[_transportCheckMap][transport]();
    };
    _proto.getTransportList = function getTransportList() {
      var _this4 = this;
      return Object.keys(_classPrivateFieldLooseBase(this, _transportCheckMap)[_transportCheckMap]).filter(function (transport) {
        return _this4.isTransportSupported(transport);
      });
    };
    _proto.selectTransport = function selectTransport(transport) {
      var transportList = (Array.isArray(transport) ? transport : [transport || 'webrtc']).map(function (item) {
        return String(item).toLowerCase();
      });
      for (var i = 0; i < transportList.length; i++) {
        var name = transportList[i];
        if (!_classPrivateFieldLooseBase(this, _transportCheckMap)[_transportCheckMap].hasOwnProperty(name)) {
          console.error("[xiomb] Unknown transport: " + name);
          continue;
        }
        if (this.isTransportSupported(name)) {
          return name;
        }
        if (name === 'webrtc' && transportList.indexOf('hls') === -1) {
          console.error('[xiomb] WebRTC is not supported by this browser, switching to HLS');
          transportList.push('hls');
        } else {
          console.error("[xiomb] " + TRANSPORT_NAME_MAP[name] + " is not supported by this browser");
        }
      }
      throw new xiombError('NOT_SUPPORTED', 'Not supported');
    };
    _proto.createPlayer = function createPlayer(isPublish, targetEl, options) {
      return new xiombPlayer(isPublish, targetEl || null, _extends({}, options, {
        params: options && options.params || _classPrivateFieldLooseBase(this, _params)[_params]
      }));
    }

    // вход HLS ядра: {url, projectID} или null
  ;
    _proto.getHlsEntry = function getHlsEntry() {
      return _classPrivateFieldLooseBase(this, _hlsEntry)[_hlsEntry];
    }

    // параметры сокета: те же уходят в ссылку HLS для хука auth
  ;
    _proto.getQuery = function getQuery() {
      return _extends({}, _classPrivateFieldLooseBase(this, _query)[_query]);
    };
    _proto.createMediaSession = function createMediaSession(direction, streamName, options) {
      if (direction === 'play' && options && options.transport === 'hls') {
        return new xiombHlsSession(this, streamName, options);
      }
      return new xiombSession(this, direction, streamName, options);
    };
    _proto.publish = function publish(streamName, options) {
      return new xiombObject(this, true, streamName, options || {});
    };
    _proto.play = function play(streamName, options) {
      return new xiombObject(this, false, streamName, options || {});
    };
    _proto.getMediaSessionList = function getMediaSessionList() {
      var _this5 = this;
      return Object.keys(_classPrivateFieldLooseBase(this, _mediaSessionMap)[_mediaSessionMap]).map(function (ID) {
        return _classPrivateFieldLooseBase(_this5, _mediaSessionMap)[_mediaSessionMap][ID];
      });
    };
    _proto.getMediaSession = function getMediaSession(ID) {
      return _classPrivateFieldLooseBase(this, _mediaSessionMap)[_mediaSessionMap].hasOwnProperty(ID) ? _classPrivateFieldLooseBase(this, _mediaSessionMap)[_mediaSessionMap][ID] : null;
    };
    _proto.addMediaSession = function addMediaSession(mediaSession) {
      var ID = mediaSession.getID();
      var earlyMessage = _classPrivateFieldLooseBase(this, _earlyMessageMap)[_earlyMessageMap][ID];
      _classPrivateFieldLooseBase(this, _mediaSessionMap)[_mediaSessionMap][ID] = mediaSession;
      delete _classPrivateFieldLooseBase(this, _earlyMessageMap)[_earlyMessageMap][ID];
      if (earlyMessage) {
        clearTimeout(earlyMessage.timer);
        for (var _iterator3 = _createForOfIteratorHelperLoose(earlyMessage.messageList), _step3; !(_step3 = _iterator3()).done;) {
          var message = _step3.value;
          _classPrivateFieldLooseBase(this, _deliver)[_deliver](mediaSession, message.type, message.data);
        }
      }
      this.emit('session', mediaSession);
    };
    _proto.deleteMediaSession = function deleteMediaSession(mediaSession) {
      delete _classPrivateFieldLooseBase(this, _mediaSessionMap)[_mediaSessionMap][mediaSession.getID()];
    };
    _proto.request = function request(type, data) {
      try {
        var _temp4 = function _temp4(_result2) {
          return _exit2 ? _result2 : xSocketData.getResData();
        };
        var _exit2 = false;
        var _this6 = this;
        if (!_classPrivateFieldLooseBase(_this6, _xSocketObject)[_xSocketObject]) {
          throw new xiombError('NOT_CONNECTED', 'Not connected');
        }
        var xSocketData;
        var _temp3 = _catch(function () {
          return Promise.resolve(_classPrivateFieldLooseBase(_this6, _xSocketObject)[_xSocketObject].sendReady(type, data, REQUEST_TTL)).then(function (_classPrivateFieldLoo) {
            xSocketData = _classPrivateFieldLoo;
          });
        }, function (e) {
          throw new xiombError(e && e.message);
        });
        return Promise.resolve(_temp3 && _temp3.then ? _temp3.then(_temp4) : _temp4(_temp3));
      } catch (e) {
        return Promise.reject(e);
      }
    };
    _proto.notify = function notify(type, data) {
      if (!_classPrivateFieldLooseBase(this, _xSocketObject)[_xSocketObject]) {
        return;
      }
      var result = _classPrivateFieldLooseBase(this, _xSocketObject)[_xSocketObject].send(type, data, 0);
      if (result && typeof result.catch === 'function') {
        result.catch(function () {});
      }
    };
    return xiomb;
  }(xiombEmitter);
  function _closeMediaSessionList2(reason) {
    var mediaSessionList = this.getMediaSessionList();
    for (var _iterator4 = _createForOfIteratorHelperLoose(mediaSessionList), _step4; !(_step4 = _iterator4()).done;) {
      var mediaSession = _step4.value;
      mediaSession.onClosed({
        reason: reason
      });
    }
    return mediaSessionList;
  }
  function _deliver2(mediaSession, type, data) {
    switch (type) {
      case 'media.signal':
        return mediaSession.onSignal(data);
      case 'media.status':
        return mediaSession.onStatus(data);
      case 'media.closed':
        return mediaSession.onClosed(data);
      case 'media.stat':
        return mediaSession.onStat(data);
    }
  }
  function _setReconnectStatus2() {
    for (var _iterator5 = _createForOfIteratorHelperLoose(this.getMediaSessionList()), _step5; !(_step5 = _iterator5()).done;) {
      var mediaSession = _step5.value;
      var ID = mediaSession.getID();
      if (!_classPrivateFieldLooseBase(this, _lostStatusMap)[_lostStatusMap].hasOwnProperty(ID)) {
        _classPrivateFieldLooseBase(this, _lostStatusMap)[_lostStatusMap][ID] = mediaSession.getStatus();
      }
      mediaSession.onStatus({
        status: 'reconnect',
        renegotiate: false,
        reason: null
      });
    }
  }
  function _restoreStatus2() {
    var lostStatusMap = _classPrivateFieldLooseBase(this, _lostStatusMap)[_lostStatusMap];
    _classPrivateFieldLooseBase(this, _lostStatusMap)[_lostStatusMap] = {};
    for (var _i3 = 0, _Object$keys2 = Object.keys(lostStatusMap); _i3 < _Object$keys2.length; _i3++) {
      var ID = _Object$keys2[_i3];
      var mediaSession = this.getMediaSession(ID);
      if (mediaSession && mediaSession.getStatus() === 'reconnect') {
        mediaSession.onStatus({
          status: lostStatusMap[ID],
          renegotiate: false,
          reason: null
        });
      }
    }
  }
  function _onReconnect2(xSocketObject) {
    _classPrivateFieldLooseBase(this, _xSocketObject)[_xSocketObject] = xSocketObject;
    if (!_classPrivateFieldLooseBase(this, _ready)[_ready] || _classPrivateFieldLooseBase(this, _connected)[_connected]) {
      return;
    }
    _classPrivateFieldLooseBase(this, _connected)[_connected] = true;
    _classPrivateFieldLooseBase(this, _restoreStatus)[_restoreStatus]();
    this.emit('reconnect');
    this.emit('sessionReady');
  }
  function _onDisconnect2(reason) {
    var connected = _classPrivateFieldLooseBase(this, _connected)[_connected];
    _classPrivateFieldLooseBase(this, _connected)[_connected] = false;
    _classPrivateFieldLooseBase(this, _xSocketObject)[_xSocketObject] = null;
    if (!_classPrivateFieldLooseBase(this, _ready)[_ready]) {
      var message = String(reason || 'NOT_CONNECTED');
      this.emit('connectFail', new xiombError(/^[A-Z_]+$/.test(message) ? message : 'NOT_CONNECTED', message));
      return;
    }
    if (connected) {
      _classPrivateFieldLooseBase(this, _setReconnectStatus)[_setReconnectStatus]();
      this.emit('disconnect', reason);
    }
  }
  function _onSessionReady2(data) {
    var sessionID = data && data.ID ? data.ID : '';
    _classPrivateFieldLooseBase(this, _hlsEntry)[_hlsEntry] = data && data.hls && data.hls.url ? data.hls : null;
    _classPrivateFieldLooseBase(this, _connected)[_connected] = true;
    if (!_classPrivateFieldLooseBase(this, _ready)[_ready]) {
      _classPrivateFieldLooseBase(this, _ready)[_ready] = true;
      _classPrivateFieldLooseBase(this, _sessionID)[_sessionID] = sessionID;
      this.emit('connect');
      this.emit('sessionReady');
      return;
    }
    if (sessionID !== _classPrivateFieldLooseBase(this, _sessionID)[_sessionID]) {
      _classPrivateFieldLooseBase(this, _sessionID)[_sessionID] = sessionID;
      _classPrivateFieldLooseBase(this, _lostStatusMap)[_lostStatusMap] = {};
      _classPrivateFieldLooseBase(this, _resume)[_resume]();
    } else {
      _classPrivateFieldLooseBase(this, _restoreStatus)[_restoreStatus]();
    }
    this.emit('reconnect');
    this.emit('sessionReady');
  }
  function _onData2(xSocketData) {
    var _this7 = this;
    var type = xSocketData.getType();
    var data = xSocketData.getData();
    if (type === 'session.ready') {
      return _classPrivateFieldLooseBase(this, _onSessionReady)[_onSessionReady](data);
    }
    if (type === 'app.message') {
      return this.emit('message', data ? data.event : undefined, data ? data.data : undefined);
    }
    if (type === 'session.lost') {
      var reason = data && data.reason ? data.reason : null;
      _classPrivateFieldLooseBase(this, _closeMediaSessionList)[_closeMediaSessionList](reason);
      return this.emit('lost', reason);
    }
    if (MEDIA_TYPE_LIST.indexOf(type) === -1 || !data || typeof data.ID !== 'string') {
      return;
    }
    var mediaSession = this.getMediaSession(data.ID);
    if (mediaSession) {
      return _classPrivateFieldLooseBase(this, _deliver)[_deliver](mediaSession, type, data);
    }
    if (!_classPrivateFieldLooseBase(this, _earlyMessageMap)[_earlyMessageMap][data.ID]) {
      _classPrivateFieldLooseBase(this, _earlyMessageMap)[_earlyMessageMap][data.ID] = {
        messageList: [],
        timer: setTimeout(function () {
          delete _classPrivateFieldLooseBase(_this7, _earlyMessageMap)[_earlyMessageMap][data.ID];
        }, EARLY_MESSAGE_TTL)
      };
    }
    _classPrivateFieldLooseBase(this, _earlyMessageMap)[_earlyMessageMap][data.ID].messageList.push({
      type: type,
      data: data
    });
  }
  function _createClient2() {
    var _this8 = this;
    _classPrivateFieldLooseBase(this, _xSocketClient)[_xSocketClient] = new (_classPrivateFieldLooseBase(this, _xSocket)[_xSocket])(_classPrivateFieldLooseBase(this, _urlList)[_urlList], _extends({}, _classPrivateFieldLooseBase(this, _query)[_query]));
    _classPrivateFieldLooseBase(this, _xSocketClient)[_xSocketClient].on('connect', function (xSocketObject) {
      _classPrivateFieldLooseBase(_this8, _xSocketObject)[_xSocketObject] = xSocketObject;
    });
    _classPrivateFieldLooseBase(this, _xSocketClient)[_xSocketClient].on('reconnect', function (xSocketObject) {
      return _classPrivateFieldLooseBase(_this8, _onReconnect)[_onReconnect](xSocketObject);
    });
    _classPrivateFieldLooseBase(this, _xSocketClient)[_xSocketClient].on('ws|disconnect', function (reason) {
      return _classPrivateFieldLooseBase(_this8, _onDisconnect)[_onDisconnect](reason);
    });
    _classPrivateFieldLooseBase(this, _xSocketClient)[_xSocketClient].on('data', function (xSocketData) {
      return _classPrivateFieldLooseBase(_this8, _onData)[_onData](xSocketData);
    });
    _classPrivateFieldLooseBase(this, _xSocketClient)[_xSocketClient].on('destroy', function (xSocketObject, reason) {
      return _classPrivateFieldLooseBase(_this8, _onDisconnect)[_onDisconnect](reason);
    });
  }

  window.xiombEmitter = xiombEmitter;
  window.xiombError = xiombError;
  window.xiombStat = xiombStat;
  window.xiombPlayer = xiombPlayer;
  window.xiombSession = xiombSession;
  window.xiombHlsSession = xiombHlsSession;
  window.xiombObject = xiombObject;
  window.xiomb = xiomb;

})();
