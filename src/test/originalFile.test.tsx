import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OriginalFile } from '../components/OriginalFile';
import { openPdf, stopPdfWorker } from '../services/pdfViewer';
import { WorkerLost } from '../services/pdfWorker';

const URL_ = '/api/documents/fictional/content';
const fake = (over = {}) => ({ pages: 3, ratio: () => 1.3, render: vi.fn(() => ({ done: Promise.resolve(), cancel: vi.fn() })), findRow: vi.fn(async () => null), lost: new Promise<void>(() => {}), close: vi.fn(), ...over });

beforeEach(() => {
  vi.mocked(openPdf).mockReset();
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
});

describe('the original file', () => {
  it('draws every page, and offers no new tab', async () => {
    const pdf = fake();
    vi.mocked(openPdf).mockResolvedValue(pdf);
    const { container } = render(<OriginalFile title="fictional.pdf" url={URL_} />);
    expect(await screen.findByRole('img', { name: 'Page 3 of 3, fictional.pdf' })).toBeTruthy();
    expect(openPdf).toHaveBeenCalledWith(URL_, expect.any(AbortSignal));
    await waitFor(() => expect(pdf.render).toHaveBeenCalledTimes(3));
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    expect(screen.getByText('Download original').getAttribute('href')).toBe(`${URL_}?download=true`);
  });

  it('asks for the file by its address, without the page', async () => {
    vi.mocked(openPdf).mockResolvedValue(fake());
    const { container } = render(<OriginalFile title="fictional.pdf" url={`${URL_}#page=2`} />);
    await screen.findByRole('button', { name: 'Open page 2 larger' });
    expect(openPdf).toHaveBeenCalledWith(URL_, expect.any(AbortSignal));
    expect(container.querySelector('[data-page="2"]')).not.toBeNull();
  });

  it('enlarges the clicked page in this tab, and closes again', async () => {
    const pdf = fake();
    vi.mocked(openPdf).mockResolvedValue(pdf);
    const opened = vi.spyOn(window, 'open');
    const { container } = render(<OriginalFile title="fictional.pdf" url={URL_} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open page 2 larger' }));
    const dialog = container.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(opened).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Close'));
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('closes when the area around the enlarged page is clicked', async () => {
    vi.mocked(openPdf).mockResolvedValue(fake());
    const { container } = render(<OriginalFile title="fictional.pdf" url={URL_} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open page 1 larger' }));
    fireEvent.click(container.querySelector('dialog')!);
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('falls back to the browser viewer when the file cannot be opened', async () => {
    vi.mocked(openPdf).mockRejectedValue(new Error('fictional failure'));
    const { container } = render(<OriginalFile title="fictional.pdf" url={`${URL_}#page=2`} />);
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('src')).toBe(`${URL_}#page=2`));
    expect(screen.getByText('Download original')).toBeTruthy();
  });

  it('falls back when a page cannot be drawn', async () => {
    vi.mocked(openPdf).mockResolvedValue(fake({ render: () => ({ done: Promise.reject(new Error('fictional failure')), cancel: vi.fn() }) }));
    const { container } = render(<OriginalFile title="fictional.pdf" url={URL_} />);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
  });

  it('loads nothing until it is near the screen', async () => {
    let tell: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof tell) { tell = callback; }
      observe() {}
      disconnect() {}
    });
    vi.mocked(openPdf).mockResolvedValue(fake());
    render(<OriginalFile title="fictional.pdf" url={URL_} />);
    expect(openPdf).not.toHaveBeenCalled();
    tell([{ isIntersecting: true }]);
    await waitFor(() => expect(openPdf).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });
});

describe('switching between originals', () => {
  const OTHER = '/api/documents/other/content';
  const later = () => {
    let resolve = (_: ReturnType<typeof fake>) => {};
    let reject = (_: Error) => {};
    const promise = new Promise<ReturnType<typeof fake>>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  const signalOf = (call: number) => vi.mocked(openPdf).mock.calls[call][1]!;

  it('never shows the previous file under the new name, not even for one render', async () => {
    vi.mocked(openPdf).mockResolvedValueOnce(fake());
    const { rerender } = render(<OriginalFile title="first.pdf" url={URL_} />);
    await screen.findByRole('img', { name: 'Page 1 of 3, first.pdf' });
    vi.mocked(openPdf).mockReturnValueOnce(new Promise(() => {}));
    rerender(<OriginalFile title="second.pdf" url={OTHER} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Loading the original.')).toBeTruthy();
  });

  it('cancels the file being opened, and ignores it if it arrives anyway', async () => {
    const slow = later();
    vi.mocked(openPdf).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(fake({ pages: 2 }));
    const { rerender } = render(<OriginalFile title="first.pdf" url={URL_} />);
    rerender(<OriginalFile title="second.pdf" url={OTHER} />);
    expect(signalOf(0).aborted).toBe(true);
    await screen.findByRole('img', { name: 'Page 1 of 2, second.pdf' });
    const stale = fake();
    slow.resolve(stale);
    await waitFor(() => expect(stale.close).toHaveBeenCalledTimes(1));
    expect(stale.render).not.toHaveBeenCalled();
    expect(screen.queryByRole('img', { name: /first/ })).toBeNull();
  });

  it('a late failure from the previous file does not fail the new one', async () => {
    const slow = later();
    vi.mocked(openPdf).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(fake());
    const { container, rerender } = render(<OriginalFile title="first.pdf" url={URL_} />);
    rerender(<OriginalFile title="second.pdf" url={OTHER} />);
    await screen.findByRole('img', { name: 'Page 1 of 3, second.pdf' });
    slow.reject(new Error('fictional failure'));
    await new Promise((r) => setTimeout(r));
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('rapid switching leaves only the last file open', async () => {
    const opened = Array.from({ length: 20 }, () => fake());
    const waits = opened.map(() => later());
    waits.forEach((w) => vi.mocked(openPdf).mockReturnValueOnce(w.promise));
    const { rerender } = render(<OriginalFile title="file-0.pdf" url="/file-0" />);
    for (let i = 1; i < 20; i++) rerender(<OriginalFile title={`file-${i}.pdf`} url={`/file-${i}`} />);
    // They arrive in the worst order: the wanted one first.
    for (let i = 19; i >= 0; i--) waits[i].resolve(opened[i]);
    await screen.findByRole('img', { name: 'Page 1 of 3, file-19.pdf' });
    await waitFor(() => opened.slice(0, 19).forEach((o) => expect(o.close).toHaveBeenCalledTimes(1)));
    expect(opened[19].close).not.toHaveBeenCalled();
    opened.slice(0, 19).forEach((o) => expect(o.render).not.toHaveBeenCalled());
  });

  it('going back and forth opens each visit fresh and closes each once', async () => {
    const visits = Array.from({ length: 6 }, () => fake());
    visits.forEach((v) => vi.mocked(openPdf).mockResolvedValueOnce(v));
    const { rerender } = render(<OriginalFile title="a.pdf" url="/a" />);
    for (let i = 0; i < 6; i++) {
      const name = i % 2 ? 'b' : 'a';
      if (i) rerender(<OriginalFile title={`${name}.pdf`} url={`/${name}`} />);
      await screen.findByRole('img', { name: `Page 1 of 3, ${name}.pdf` });
    }
    visits.slice(0, 5).forEach((v) => expect(v.close).toHaveBeenCalledTimes(1));
    expect(visits[5].close).not.toHaveBeenCalled();
  });

  it('closes the file on leaving, and cancels one still opening', async () => {
    const pdf = fake();
    vi.mocked(openPdf).mockResolvedValueOnce(pdf);
    const shown = render(<OriginalFile title="a.pdf" url="/a" />);
    await screen.findByRole('img', { name: 'Page 1 of 3, a.pdf' });
    shown.unmount();
    expect(pdf.close).toHaveBeenCalledTimes(1);
    vi.mocked(openPdf).mockReturnValueOnce(new Promise(() => {}));
    render(<OriginalFile title="b.pdf" url="/b" />).unmount();
    expect(signalOf(1).aborted).toBe(true);
  });

  it('opens the file again after losing the worker, without falling back', async () => {
    let lose = () => {};
    const first = fake({ lost: new Promise<void>((r) => { lose = r; }) });
    const second = fake({ pages: 2 });
    vi.mocked(openPdf).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { container } = render(<OriginalFile title="a.pdf" url="/a" />);
    await screen.findByRole('img', { name: 'Page 1 of 3, a.pdf' });
    lose();
    await screen.findByRole('img', { name: 'Page 1 of 2, a.pdf' });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('a file that keeps losing the worker goes to the browser viewer, and stops trying', async () => {
    const loses: (() => void)[] = [];
    const again = () => fake({ lost: new Promise<void>((r) => { loses.push(r); }) });
    vi.mocked(openPdf).mockResolvedValueOnce(again()).mockResolvedValueOnce(again());
    const { container } = render(<OriginalFile title="a.pdf" url="/a" />);
    await screen.findByRole('img', { name: 'Page 1 of 3, a.pdf' });
    loses[0]();
    await waitFor(() => expect(loses).toHaveLength(2));
    await waitFor(() => expect(openPdf).toHaveBeenCalledTimes(2));
    await screen.findByRole('img', { name: 'Page 1 of 3, a.pdf' });
    loses[1]();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    expect(openPdf).toHaveBeenCalledTimes(2);
  });

  it('retries once when the worker is lost while opening', async () => {
    vi.mocked(openPdf).mockRejectedValueOnce(new WorkerLost()).mockResolvedValueOnce(fake());
    const { container } = render(<OriginalFile title="a.pdf" url="/a" />);
    await screen.findByRole('img', { name: 'Page 1 of 3, a.pdf' });
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('a page cut off by a lost worker does not fall back', async () => {
    let lose = () => {};
    const first = fake({ lost: new Promise<void>((r) => { lose = r; }), render: () => ({ done: Promise.reject(new WorkerLost()), cancel: vi.fn() }) });
    vi.mocked(openPdf).mockResolvedValueOnce(first).mockResolvedValueOnce(fake());
    const { container } = render(<OriginalFile title="a.pdf" url="/a" />);
    await screen.findByRole('img', { name: 'Page 1 of 3, a.pdf' });
    await new Promise((r) => setTimeout(r));
    expect(container.querySelector('iframe')).toBeNull();
    lose();
    await waitFor(() => expect(openPdf).toHaveBeenCalledTimes(2));
  });

  it('a failed file does not stay failed for the next one, or on coming back', async () => {
    vi.mocked(openPdf).mockRejectedValueOnce(new Error('fictional failure')).mockResolvedValueOnce(fake()).mockResolvedValueOnce(fake());
    const { container, rerender } = render(<OriginalFile title="a.pdf" url="/a" />);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    rerender(<OriginalFile title="b.pdf" url="/b" />);
    await screen.findByRole('img', { name: 'Page 1 of 3, b.pdf' });
    expect(container.querySelector('iframe')).toBeNull();
    rerender(<OriginalFile title="a.pdf" url="/a" />);
    await screen.findByRole('img', { name: 'Page 1 of 3, a.pdf' });
    expect(container.querySelector('iframe')).toBeNull();
  });
});

describe('a file that takes a long time', () => {
  const SLOW = 15_000;
  const pass = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const note = () => screen.queryByRole('status');
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(stopPdfWorker).mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('says so while it opens, and is never cancelled by waiting', async () => {
    vi.mocked(openPdf).mockReturnValue(new Promise(() => {}));
    render(<OriginalFile title="slow.pdf" url={URL_} />);
    await pass(SLOW - 1);
    expect(note()).toBeNull();
    await pass(1);
    expect(note()?.textContent).toContain('Still working on this file.');
    await pass(30 * 60_000);
    expect(vi.mocked(openPdf).mock.calls[0][1]!.aborted).toBe(false);
    expect(stopPdfWorker).not.toHaveBeenCalled();
    expect(openPdf).toHaveBeenCalledTimes(1);
  });

  it('says so while a page draws, and stops saying so when it has', async () => {
    let finish = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(openPdf).mockResolvedValue(fake({ pages: 1, render: vi.fn(() => ({ done, cancel: vi.fn() })) }));
    render(<OriginalFile title="slow.pdf" url={URL_} />);
    await pass(0);
    await pass(SLOW);
    expect(note()).not.toBeNull();
    finish();
    await pass(0);
    expect(note()).toBeNull();
  });

  it('a file that draws in time says nothing', async () => {
    vi.mocked(openPdf).mockResolvedValue(fake());
    render(<OriginalFile title="quick.pdf" url={URL_} />);
    await pass(SLOW * 2);
    expect(note()).toBeNull();
  });

  it('Stop ends the worker, shows the browser viewer and does not reopen the file', async () => {
    let lose = () => {};
    const lost = new Promise<void>((resolve) => { lose = resolve; });
    const close = vi.fn();
    vi.mocked(openPdf).mockResolvedValue(fake({ pages: 1, lost, close, render: vi.fn(() => ({ done: new Promise(() => {}), cancel: vi.fn() })) }));
    const { container } = render(<OriginalFile title="stuck.pdf" url={URL_} />);
    await pass(0);
    await pass(SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await pass(0);
    expect(stopPdfWorker).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(URL_);
    lose();
    await pass(SLOW);
    expect(openPdf).toHaveBeenCalledTimes(1);
    expect(note()).toBeNull();
  });

  it('switching file starts the wait again, and Stop on one does not stick to the next', async () => {
    vi.mocked(openPdf).mockReturnValue(new Promise(() => {}));
    const { rerender, container } = render(<OriginalFile title="stuck.pdf" url={URL_} />);
    await pass(SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await pass(0);
    rerender(<OriginalFile title="next.pdf" url="/api/documents/other/content" />);
    await pass(0);
    expect(container.querySelector('iframe')).toBeNull();
    expect(note()).toBeNull();
    expect(screen.getByText('Loading the original.')).toBeTruthy();
    await pass(SLOW);
    expect(note()).not.toBeNull();
  });

  it('says when a lost worker has the file opening again', async () => {
    let lose = () => {};
    const lost = new Promise<void>((resolve) => { lose = resolve; });
    vi.mocked(openPdf).mockResolvedValueOnce(fake({ pages: 1, lost })).mockReturnValueOnce(new Promise(() => {}));
    render(<OriginalFile title="fictional.pdf" url={URL_} />);
    await pass(0);
    lose();
    await pass(0);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('The viewer stopped, so this file is opening again.')).toBeTruthy();
  });
});
