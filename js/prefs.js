/* global prefs: true, contextMenus */
'use strict';

// eslint-disable-next-line no-var
var prefs = new function Prefs() {
  const defaults = {
    // new editor opens in a own browser window
    'openEditInWindow': false,
    // detached window position
    'windowPosition': {},
    // display text on popup menu icon
    'show-badge': true,
    // boss key
    'disableAll': false,
    // Add 'stylus-iframe' attribute to HTML element in all iframes
    'exposeIframes': false,

    // display 'New style' links as URL breadcrumbs
    'popup.breadcrumbs': true,
    // use URL path for 'this URL'
    'popup.breadcrumbs.usePath': false,
    // display enabled styles before disabled styles
    'popup.enabledFirst': true,
    // display enabled styles before disabled styles
    'popup.stylesFirst': true,

    // display only enabled styles
    'manage.onlyEnabled': false,
    // display only styles created locally
    'manage.onlyLocal': false,
    'manage.onlyEnabled.invert': false, // display only disabled styles
    'manage.onlyLocal.invert': false,   // display only externally installed styles
    // use the new compact layout
    'manage.newUI': true,
    // show favicons for the sites in applies-to
    'manage.newUI.favicons': false,
    // gray out favicons
    'manage.newUI.faviconsGray': true,
    // max number of applies-to targets visible: 0 = none
    'manage.newUI.targets': 3,

    // CodeMirror.defaults.*
    'editor.options': {},
    // word wrap
    'editor.lineWrapping': true,
    // 'smart' indent
    'editor.smartIndent': true,
    // smart indent with tabs
    'editor.indentWithTabs': false,
    // tab width, in spaces
    'editor.tabSize': 4,
    'editor.keyMap': navigator.appVersion.indexOf('Windows') > 0 ? 'sublime' : 'default',
    // CSS theme
    'editor.theme': 'default',
    // CSS beautifier
    'editor.beautify': {
      selector_separator_newline: true,
      newline_before_open_brace: false,
      newline_after_open_brace: true,
      newline_between_properties: true,
      newline_before_close_brace: true,
      newline_between_rules: false,
      end_with_newline: false,
      indent_conditional: true,
    },
    // lint gutter marker update delay, ms
    'editor.lintDelay': 500,
    // Options: 'csslint', 'stylelint' or 'null'
    'editor.linter': 'csslint',
    // lint report update delay, ms
    'editor.lintReportDelay': 4500,
    // token = token/word under cursor even if nothing is selected
    // selection = only when something is selected
    // '' (empty string) = disabled
    'editor.matchHighlight': 'token',
    // show autocomplete dropdown on typing a word token
    'editor.autocompleteOnTyping': false,
    // "Delete" item in context menu
    'editor.contextDelete': contextDeleteMissing(),

     // 0 = dark-themed icon; 1 = light-themed icon
    'iconset': 0,

    // badge background color when disabled
    'badgeDisabled': '#8B0000',
    // badge background color
    'badgeNormal': '#006666',

    // popup width in pixels
    'popupWidth': 246,

    // user-style automatic update interval, hours (0 = disable)
    'updateInterval': 24,
  };
  const values = deepCopy(defaults);

  const affectsIcon = [
    'show-badge',
    'disableAll',
    'badgeDisabled',
    'badgeNormal',
    'iconset',
  ];

  const onChange = {
    any: new Set(),
    specific: new Map(),
  };

  // FF may think localStorage is a cookie or that it's not secure
  const localStorage = tryCatch(() => window.localStorage) ? window.localStorage : {};

  // coalesce multiple pref changes in broadcast
  let broadcastPrefs = {};

  Object.defineProperty(this, 'readOnlyValues', {value: {}});

  Object.assign(Prefs.prototype, {

    get(key, defaultValue) {
      if (key in values) {
        return values[key];
      }
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      if (key in defaults) {
        return defaults[key];
      }
      console.warn("No default preference for '%s'", key);
    },

    getAll() {
      return deepCopy(values);
    },

    set(key, value, {broadcast = true, sync = true, fromBroadcast} = {}) {
      const oldValue = values[key];
      switch (typeof defaults[key]) {
        case typeof value:
          break;
        case 'string':
          value = String(value);
          break;
        case 'number':
          value |= 0;
          break;
        case 'boolean':
          value = value === true || value === 'true';
          break;
      }
      values[key] = value;
      defineReadonlyProperty(this.readOnlyValues, key, value);
      const hasChanged = !equal(value, oldValue);
      if (!fromBroadcast) {
        if (BG && BG !== window) {
          BG.prefs.set(key, BG.deepCopy(value), {broadcast, sync});
        } else {
          localStorage[key] = typeof defaults[key] === 'object'
            ? JSON.stringify(value)
            : value;
          if (broadcast && hasChanged) {
            this.broadcast(key, value, {sync});
          }
        }
      }
      if (hasChanged) {
        const listener = onChange.specific.get(key);
        if (listener) {
          listener(key, value);
        }
        for (const listener of onChange.any.values()) {
          listener(key, value);
        }
      }
    },

    remove: key => this.set(key, undefined),

    reset: key => this.set(key, deepCopy(defaults[key])),

    broadcast(key, value, {sync = true} = {}) {
      broadcastPrefs[key] = value;
      debounce(doBroadcast);
      if (sync) {
        debounce(doSyncSet);
      }
    },

    subscribe(listener, keys) {
      if (keys) {
        for (const key of keys) {
          onChange.specific.set(key, listener);
        }
      } else {
        onChange.any.add(listener);
      }
    },
  });

  // Unlike sync, HTML5 localStorage is ready at browser startup
  // so we'll mirror the prefs to avoid using the wrong defaults
  // during the startup phase
  for (const key in defaults) {
    const defaultValue = defaults[key];
    let value = localStorage[key];
    if (typeof value === 'string') {
      switch (typeof defaultValue) {
        case 'boolean':
          value = value.toLowerCase() === 'true';
          break;
        case 'number':
          value |= 0;
          break;
        case 'object':
          value = tryJSONparse(value) || defaultValue;
          break;
      }
    } else {
      value = defaultValue;
    }
    if (BG === window) {
      // when in bg page, .set() will write to localStorage
      this.set(key, value, {broadcast: false, sync: false});
    } else {
      values[key] = value;
      defineReadonlyProperty(this.readOnlyValues, key, value);
    }
  }

  if (!BG || BG === window) {
    affectsIcon.forEach(key => this.broadcast(key, values[key], {sync: false}));

    const importFromSync = (synced = {}) => {
      for (const key in defaults) {
        if (key in synced) {
          this.set(key, synced[key], {sync: false});
        }
      }
    };

    getSync().get('settings', ({settings} = {}) => importFromSync(settings));

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && 'settings' in changes) {
        const synced = changes.settings.newValue;
        if (synced) {
          importFromSync(synced);
        } else {
          // user manually deleted our settings, we'll recreate them
          getSync().set({'settings': values});
        }
      }
    });
  }

  // any access to chrome API takes time due to initialization of bindings
  window.addEventListener('load', function _() {
    window.removeEventListener('load', _);
    chrome.runtime.onMessage.addListener(msg => {
      if (msg.prefs) {
        for (const id in msg.prefs) {
          prefs.set(id, msg.prefs[id], {fromBroadcast: true});
        }
      }
    });
  });

  return;

  function doBroadcast() {
    const affects = {
      all: 'disableAll' in broadcastPrefs
        || 'exposeIframes' in broadcastPrefs,
    };
    if (!affects.all) {
      for (const key in broadcastPrefs) {
        affects.icon = affects.icon || affectsIcon.includes(key);
        affects.popup = affects.popup || key.startsWith('popup');
        affects.editor = affects.editor || key.startsWith('editor');
        affects.manager = affects.manager || key.startsWith('manage');
      }
    }
    notifyAllTabs({method: 'prefChanged', prefs: broadcastPrefs, affects});
    broadcastPrefs = {};
  }

  function doSyncSet() {
    getSync().set({'settings': values});
  }

  // Polyfill for Firefox < 53 https://bugzilla.mozilla.org/show_bug.cgi?id=1220494
  function getSync() {
    if ('sync' in chrome.storage) {
      return chrome.storage.sync;
    }
    const crappyStorage = {};
    return {
      get(key, callback) {
        callback(crappyStorage[key] || {});
      },
      set(source, callback) {
        for (const property in source) {
          if (source.hasOwnProperty(property)) {
            crappyStorage[property] = source[property];
          }
        }
        callback();
      }
    };
  }

  function defineReadonlyProperty(obj, key, value) {
    const copy = deepCopy(value);
    if (typeof copy === 'object') {
      Object.freeze(copy);
    }
    Object.defineProperty(obj, key, {value: copy, configurable: true});
  }

  function equal(a, b) {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
      return a === b;
    }
    if (Object.keys(a).length !== Object.keys(b).length) {
      return false;
    }
    for (const k in a) {
      if (typeof a[k] === 'object') {
        if (!equal(a[k], b[k])) {
          return false;
        }
      } else if (a[k] !== b[k]) {
        return false;
      }
    }
    return true;
  }

  function contextDeleteMissing() {
    return (
      // detect browsers without Delete by looking at the end of UA string
      /Vivaldi\/[\d.]+$/.test(navigator.userAgent) ||
      // Chrome and co.
      /Safari\/[\d.]+$/.test(navigator.userAgent) &&
      // skip forks with Flash as those are likely to have the menu e.g. CentBrowser
      !Array.from(navigator.plugins).some(p => p.name === 'Shockwave Flash')
    );
  }
}();


// Accepts an array of pref names (values are fetched via prefs.get)
// and establishes a two-way connection between the document elements and the actual prefs
function setupLivePrefs(
  IDs = Object.getOwnPropertyNames(prefs.readOnlyValues)
    .filter(id => $('#' + id))
) {
  const checkedProps = {};
  for (const id of IDs) {
    const element = $('#' + id);
    checkedProps[id] = element.type === 'checkbox' ? 'checked' : 'value';
    updateElement({id, element, force: true});
    element.addEventListener('change', onChange);
  }
  prefs.subscribe((id, value) => updateElement({id, value}), IDs);

  function onChange() {
    const value = this[checkedProps[this.id]];
    if (prefs.get(this.id) !== value) {
      prefs.set(this.id, value);
    }
  }
  function updateElement({
    id,
    value = prefs.get(id),
    element = $('#' + id),
    force,
  }) {
    const prop = checkedProps[id];
    if (force || element[prop] !== value) {
      element[prop] = value;
      element.dispatchEvent(new Event('change', {bubbles: true, cancelable: true}));
    }
  }
}
