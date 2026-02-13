import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// This app uses react-native-bare-kit, so it must run in a native development
// build (not Expo Go).
registerRootComponent(App);
