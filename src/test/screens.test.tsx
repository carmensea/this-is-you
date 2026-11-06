import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../App';
import { syntheticArchive } from '../data/syntheticArchive';
import { AppStore, VIEW_LABELS, VIEWS, type AppState } from '../state/store';
import { StoreContext } from '../state/useStore';

function mount(state: Partial<AppState> = {}) {
  window.location.hash = '';
  const store = new AppStore(syntheticArchive, state);
  const ui = render(<StoreContext.Provider value={store}><App /></StoreContext.Provider>);
  return { store, ...ui };
}
const primaryNav = () => within(screen.getByRole('navigation', { name:'Primary' }));

describe('every screen', () => {
  it.each(VIEWS)('%s renders from the primary navigation', view => {
    const { store, container } = mount();
    fireEvent.click(primaryNav().getByText(VIEW_LABELS[view]));
    expect(store.state.view).toBe(view);
    expect(container.querySelector('main')).not.toBeNull();
  });
  it.each(VIEWS)('%s labels its data as fictional and has no em dashes', view => {
    const { container } = mount({ view });
    expect(container.textContent).toContain('DEMONSTRATION DATA');
    expect(container.textContent).not.toContain('—');
  });
  it('draws charts on the screens that have them', () => {
    expect(mount({ view:'overview' }).container.querySelectorAll('svg').length).toBe(3);
    expect(mount({ view:'compare' }).container.querySelectorAll('svg').length).toBe(3);
  });
});

describe('display preferences', () => {
  it('shows weight in pounds when set', () => {
    const { container } = mount({ units:'lb', cur:'2024-06-01' });
    expect(container.textContent).toMatch(/Last reading before this date: [\d.]+ lb/);
    expect(mount({ view:'compare', units:'lb' }).container.textContent).toMatch(/[\d.]+ lb/);
  });
  it('removes results after the snapshot from the chart when future is hidden', () => {
    const count = (future: 'faded' | 'hidden') => mount({ future, cur:'2012-01-01' }).container.querySelectorAll('section[aria-label="Biomarker trend"] circle[fill="transparent"]').length;
    expect(count('hidden')).toBeLessThan(count('faded'));
  });
});

describe('interactions', () => {
  it('filters biomarkers by search', () => {
    mount({ view:'biomarkers' });
    fireEvent.change(screen.getByLabelText('Find a measure'), { target:{ value:'zzz' } });
    expect(screen.getByText('No measures match this search.')).toBeTruthy();
  });
  it('searches documents by test name', () => {
    const { container } = mount({ view:'documents' });
    fireEvent.change(screen.getByLabelText('Search'), { target:{ value:'ferritin' } });
    expect(container.textContent).toMatch(/Showing [1-9]\d*\./);
    expect(container.textContent).not.toContain('Smart scale export');
  });
  it('switches the snapshot mode from the shared bar', () => {
    const { store } = mount({ view:'history' });
    fireEvent.click(screen.getByRole('button', { name:'As understood now' }));
    expect(store.snapshotMode).toBe('now');
  });
  it('steps the timeline with the keyboard', () => {
    const { store } = mount();
    fireEvent.keyDown(screen.getByRole('slider'), { key:'ArrowRight', shiftKey:true });
    expect(store.state.cur).toBe('2019-05-08');
    fireEvent.keyDown(screen.getByRole('slider'), { key:'End' });
    expect(store.state.cur).toBe(syntheticArchive.today);
  });
  it('opens Connected sources from Settings, and the demo archive has none', () => {
    const { store, container } = mount();
    fireEvent.click(screen.getByRole('button', { name:'Settings' }));
    expect(store.state.view).toBe('sources');
    expect(screen.getByRole('heading', { name:'Connected sources' })).toBeTruthy();
    expect(container.textContent).toContain('The demo archive is fictional and has none.');
    expect(container.textContent).not.toContain('—');
  });
  it('states that import is simulated', () => {
    const { container } = mount({ view:'import' });
    expect(container.textContent).toContain('processing on this page is simulated');
  });
  it('follows the address bar', () => {
    const { store } = mount();
    window.location.hash = '/compare';
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(store.state.view).toBe('compare');
  });
});
