import { Fragment, useEffect } from 'react';
import { Footer, Checkbox } from '../components/controls';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { s } from '../components/styles';
import { shellVM } from '../viewmodels/shell';
import { documentsVM } from '../viewmodels/documents';

type VM = ReturnType<typeof shellVM> & ReturnType<typeof documentsVM>;

function DocumentList({ v }: { v: VM }) {
  return (
    <section aria-label="Document list" style={{ flex: '1 1 520px', minWidth: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 500 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '100px minmax(0,1fr) 120px 112px',
              gap: '0 14px',
              padding: '6px 8px',
              fontSize: 11.5,
              fontWeight: 500,
              color: C.ink3,
              borderBottom: `1px solid ${C.ink}`,
            }}
          >
            <span>Date</span>
            <span>Document</span>
            <span>Status</span>
            <span style={s.alignRight}>Extracted</span>
          </div>
          {v.dRows.map((r, i2) => (
            <Fragment key={i2}>
              {r.isYear && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    padding: '16px 8px 4px',
                    borderBottom: `1px solid ${C.rule}`,
                  }}
                >
                  <span style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1 }}>{r.year}</span>
                  <span style={s.meta115}>{r.count}</span>
                </div>
              )}{' '}
              {r.isDoc && (
                <button
                  onClick={r.onClick}
                  aria-current={r.current}
                  className="row-hover"
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '100px minmax(0,1fr) 120px 112px',
                    gap: '0 14px',
                    padding: '10px 8px',
                    borderBottom: `1px solid ${C.rule2}`,
                    background: r.bg,
                    alignItems: 'start',
                  }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.ink2, paddingTop: 2 }}>{r.date}</span>
                  <span style={s.minW0}>
                    <span style={s.kicker}>{r.type}</span>
                    <span style={{ display: 'block', fontSize: 14, marginTop: 2, color: r.titleColor }}>{r.title}</span>
                    <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2 }}>{r.sub}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.rust, marginTop: 2 }}>{r.note}</span>
                    <span style={s.subBlock}>{r.snapTag}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 3 }}>
                    <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: r.s1 }} />
                      <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: r.s2 }} />
                      <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: r.s3 }} />
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: r.statusColor }}>{r.statusLabel}</span>
                  </span>
                  <span style={{ fontSize: 12, color: C.ink2, textAlign: 'right', paddingTop: 3 }}>{r.extracted}</span>
                </button>
              )}
            </Fragment>
          ))}{' '}
          {v.dNoDocuments && (
            <p style={{ margin: '24px 8px', fontSize: 14, color: C.ink2 }}>
              No documents yet.{' '}
              <button onClick={v.goImport} style={s.link13}>
                Go to Import
              </button>
            </p>
          )}
          {v.dEmpty && (
            <p style={{ fontSize: 14, color: C.ink2, padding: '16px 8px' }}>
              No documents match.{' '}
              <button onClick={v.dReset} style={{ fontSize: 14, borderBottom: `1px solid ${C.ink}` }}>
                Reset filters
              </button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function DocumentsScreen() {
  const store = useStore();
  const v: VM = { ...shellVM(store), ...documentsVM(store) };
  // Back from a document, focus returns to its row in the list.
  useEffect(() => document.querySelector<HTMLButtonElement>('section[aria-label="Document list"] button[aria-current="true"]')?.focus({ preventScroll: true }), []);
  return (
    <main style={{ maxWidth: 1480, margin: '0 auto', padding: '28px var(--gutter) 64px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: '12px 32px',
        }}
      >
        <h1
          style={{
            fontFamily: SERIF,
            fontWeight: 400,
            fontSize: 52,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          Documents
        </h1>
        <span style={s.body13}>{v.dCountText}</span>
      </div>
      <div
        role="group"
        aria-label="Filter by import status"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))',
          marginTop: 22,
          borderTop: `1px solid ${C.ink}`,
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        {v.dStatusList.map((x, i0) => (
          <button
            key={i0}
            role="checkbox"
            aria-checked={x.checked}
            onClick={x.onClick}
            className="row-hover"
            style={{
              padding: '14px 20px 14px 0',
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0,1fr) auto',
              gap: '4px 12px',
              alignItems: 'center',
              opacity: x.op,
              borderRight: `1px solid ${C.rule2}`,
            }}
          >
            <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: x.s1 }} />
              <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: x.s2 }} />
              <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: x.s3 }} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: x.color }}>{x.label}</span>
            <span style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1, fontVariantNumeric: 'lining-nums' }}>
              {x.count}
            </span>
            <span style={{ gridColumn: '2 / 4', fontSize: 12, color: C.ink2, lineHeight: 1.4 }}>{x.desc}</span>
            <span style={{ gridColumn: '2 / 4', fontSize: 11, color: C.ink3 }}>{x.state}</span>
          </button>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px 22px',
          alignItems: 'center',
          padding: '14px 0',
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        <label htmlFor="d-search" style={s.eyebrow}>
          Search
        </label>
        <input
          id="d-search"
          type="search"
          value={v.dQuery}
          onChange={v.onDQuery}
          placeholder="Title, provider, date, file name or test"
          style={{
            padding: '9px 10px',
            border: `1px solid ${C.ink}`,
            borderRadius: 0,
            background: C.field,
            fontFamily: SANS,
            fontSize: 14,
            color: C.ink,
            flex: '1 1 280px',
            maxWidth: 420,
          }}
        />
        <div role="group" aria-label="Document type" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
          {v.dTypeList.map((t, i1) => (
            <button
              key={i1}
              role="checkbox"
              aria-checked={t.checked}
              onClick={t.onClick}
              style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}
            >
              <span style={{ width: 12, height: 12, border: `1px solid ${C.ink}`, background: t.box }} />
              {t.label}
              <span style={s.monoNote}>{t.count}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
          <Checkbox
            checked={v.dSnapA}
            box={v.dSnapBg}
            onClick={v.toggleDSnap}
            boxStyle={{ width: 12, height: 12, border: `1px solid ${C.ink}` }}
            style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}
          >
            {v.dSnapLabel}
          </Checkbox>
          <button onClick={v.toggleDSort} style={s.link125}>
            Order: {v.dSortLabel}
          </button>
          <button onClick={v.dReset} style={s.link125}>
            Reset
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px 44px', marginTop: 20, alignItems: 'flex-start' }}>
        <DocumentList v={v} />
      </div>
      <Footer />
    </main>
  );
}
