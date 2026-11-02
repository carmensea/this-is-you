import { C } from '../theme';

/** The real stored file, shown by the browser's own PDF viewer. */
export function OriginalFile({ title, url, height = 720 }: { title: string; url: string; height?: number }) {
  const file = url.split('#')[0];
  return (
    <>
      <div style={{ marginTop: 8, background: '#FFFEFB', border: `1px solid ${C.rule}` }}>
        <iframe
          loading="lazy"
          key={url}
          title={`Original file: ${title}`}
          src={url}
          style={{ display: 'block', width: '100%', height, border: 0 }}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 10, fontSize: 12 }}>
        <a href={file} target="_blank" rel="noreferrer">
          Open original in a new tab
        </a>
        <a href={`${file}?download=true`}>Download original</a>
      </div>
    </>
  );
}
