import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Preview } from './Preview';
import { loadPreview, parsePreviewQuery, type PreviewData } from './data';

function App() {
  const [data, setData] = useState<PreviewData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadPreview(parsePreviewQuery(location.search))
      .then((d) => {
        setData(d);
        const first = d.guides[0];
        document.title = d.guides.length === 1 && first ? `${first.title} – how-to preview` : 'How-to preview';
      })
      .catch(() => setFailed(true));
  }, []);
  if (failed) return <p class="howto-note">This preview could not be loaded. Open the export again from the side panel.</p>;
  if (!data) return <p class="howto-note" aria-busy="true">Loading…</p>;
  return <Preview {...data} date={new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} />;
}

render(<App />, document.getElementById('app')!);
