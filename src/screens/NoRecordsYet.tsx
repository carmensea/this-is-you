import { Footer } from '../components/controls';
import { s } from '../components/styles';
import { VIEW_LABELS } from '../state/store';
import { useStore } from '../state/useStore';
import { C, SERIF } from '../theme';
import { shellVM } from '../viewmodels/shell';

/** Shown on record-based screens in a real archive. Nothing is extracted from documents yet. */
export function NoRecordsYet() {
  const store = useStore();
  const v = shellVM(store);
  return (
    <main style={{ maxWidth: 1480, margin: '0 auto', padding: '28px var(--gutter) 64px' }}>
      <h1
        style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 52, lineHeight: 1, letterSpacing: '-0.02em', margin: 0 }}
      >
        {VIEW_LABELS[store.state.view]}
      </h1>
      <p
        style={{ margin: '18px 0 0', fontSize: 14, lineHeight: 1.55, color: C.ink2, maxWidth: 560, textWrap: 'pretty' }}
      >
        This screen shows records extracted from your documents. This version reads basic details such as a document's
        type and date, but not the results inside it, so there is nothing to show here yet.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 16 }}>
        <button onClick={() => store.go('documents')} style={s.link13}>
          Your documents
        </button>
        <button onClick={() => store.go('import')} style={s.link13}>
          Import
        </button>
        <button onClick={v.switchArchive} style={s.link13}>
          See this screen with fictional data
        </button>
      </div>
      <Footer />
    </main>
  );
}
