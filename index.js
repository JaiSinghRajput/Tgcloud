/**
 * @format
 */

/* global globalThis */
import { Buffer } from 'buffer';
if (typeof global !== 'undefined' && typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}
if (typeof globalThis !== 'undefined' && typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
