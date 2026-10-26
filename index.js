/**
 * @format
 */
import { AppRegistry, I18nManager } from 'react-native';
import App from './src/App';

I18nManager.allowRTL(true);

AppRegistry.registerComponent('GeneralStore', () => App);
