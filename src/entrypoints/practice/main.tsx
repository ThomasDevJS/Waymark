import { render } from 'preact';
import { watchPageTheme } from '../../ui/theme';
import { Practice } from './Practice';

watchPageTheme(); // the theme chosen in Settings (D200)
render(<Practice />, document.getElementById('app')!);
