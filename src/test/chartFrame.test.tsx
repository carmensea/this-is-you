import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartFrame } from '../components/ChartFrame';

describe('ChartFrame', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the chart when the frame measures 0 for a moment', () => {
    let resized = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    let width = 800;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width }) as DOMRect);
    render(<ChartFrame style={{}}>{(w) => <p>chart at {w}</p>}</ChartFrame>);
    act(() => resized());
    screen.getByText('chart at 800');

    width = 0;
    act(() => resized());
    screen.getByText('chart at 800');

    width = 640;
    act(() => resized());
    expect(screen.getByText('chart at 640')).toBeTruthy();
    rect.mockRestore();
  });
});
