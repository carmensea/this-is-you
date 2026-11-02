import { describe, expect, it } from 'vitest';
import { syntheticArchive as a } from '../data/syntheticArchive';
import { AppStore } from '../state/store';
import { compareVM } from '../viewmodels/compare';
import { documentsVM } from '../viewmodels/documents';
import { historyVM } from '../viewmodels/history';
import { overviewVM } from '../viewmodels/overview';

const addendum = a.events.find(e => e.title === 'MRI lumbar spine, addendum to report')!;

describe('as known then, as understood now', () => {
  it('hides a record documented after the snapshot only in "known" mode', () => {
    const store = new AppStore(a, { cur:'2018-05-08' });
    expect(addendum.date <= '2018-05-08' && addendum.documented > '2018-05-08').toBe(true);
    expect(store.isVisible(addendum)).toBe(false);
    store.setState({ mode:'now' });
    expect(store.isVisible(addendum)).toBe(true);
  });
  it('tells the reader how many records are hidden', () => {
    const v = overviewVM(new AppStore(a, { cur:'2018-05-08' }));
    expect(v.hasLater).toBe(true);
    expect(v.laterText).toMatch(/documented after this date and are hidden/);
  });
  it('leaves out a retrospective diagnosis until it was documented', () => {
    const names = (cur: string, mode: 'known' | 'now') => overviewVM(new AppStore(a, { cur, mode })).dxRows.map(d => d.name);
    expect(names('2020-01-01', 'known')).not.toContain('Essential hypertension');
    expect(names('2020-01-01', 'now')).toContain('Essential hypertension');
    expect(names('2021-08-05', 'known')).toContain('Essential hypertension');
  });
  it('shares one snapshot date across screens', () => {
    const store = new AppStore(a, { cur:'2018-05-08' });
    store.setCur('2024-06-01');
    expect(overviewVM(store).curLong).toBe('1 June 2024');
    expect(historyVM(store).hxCountText).toContain('1 Jun 2024');
    expect(documentsVM(store).dCountText).toContain('1 Jun 2024');
    expect(compareVM(store).cA.date).toBe('1 June 2024');
  });
  it('keeps the snapshot inside the archive', () => {
    const store = new AppStore(a);
    store.setCur('1990-01-01');
    expect(store.state.cur).toBe(a.start);
    store.setCur('2099-01-01');
    expect(store.state.cur).toBe(a.today);
  });
});

describe('compare', () => {
  const row = (store: AppStore, name: string) => compareVM(store).cGroups.flatMap(g => g.rows).find(r => r.name === name)!;
  it('subtracts B minus A', () => {
    const r = row(new AppStore(a, { cA:'2010-01-01', cB:'2026-11-01' }), 'LDL cholesterol');
    expect(r.change).toBe('−26 mg/dL');
  });
  it('refuses to subtract across units', () => {
    const r = row(new AppStore(a, { cA:'2012-12-01', cB:'2026-11-01' }), 'Creatinine');
    expect(r.change).toBe('');
    expect(r.note).toMatch(/units differ/);
  });
  it('refuses to subtract across a method change', () => {
    const r = row(new AppStore(a, { cA:'2021-01-01', cB:'2026-11-01' }), 'Estimated glomerular filtration rate');
    expect(r.change).toBe('');
    expect(r.note).toMatch(/method changed/);
  });
  it('keeps dates in order when A is moved past B', () => {
    const v = compareVM(new AppStore(a, { cA:'2024-01-01', cB:'2020-01-01' }));
    expect(v.cAShort).toBe('1 Jan 2020');
    expect(v.cBShort).toBe('1 Jan 2024');
  });
});
