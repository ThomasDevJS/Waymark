import { render } from 'preact';
import { watchPageTheme } from '../../ui/theme';
import { App } from './App';

watchPageTheme(); // the theme chosen in Settings (D200)
render(<App />, document.getElementById('app')!);
