import { render } from 'preact';
import { watchPageTheme } from '../../ui/theme';
import { Options } from './Options';

watchPageTheme(); // the theme chosen in Settings (D200)
render(<Options />, document.getElementById('app')!);
