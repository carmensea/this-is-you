import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OriginalFile } from '../components/OriginalFile';
import { openPdf } from '../services/pdfViewer';

const URL_ = '/api/documents/fictional/content';
const fake = (over = {}) => ({ pages: 3, ratio: () => 1.3, render: vi.fn(() => ({ done: Promise.resolve(), cancel: vi.fn() })), findRow: vi.fn(async () => null), close: vi.fn(), ...over });

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
    expect(openPdf).toHaveBeenCalledWith(URL_);
    await waitFor(() => expect(pdf.render).toHaveBeenCalledTimes(3));
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    expect(screen.getByText('Download original').getAttribute('href')).toBe(`${URL_}?download=true`);
  });

  it('asks for the file by its address, without the page', async () => {
    vi.mocked(openPdf).mockResolvedValue(fake());
    const { container } = render(<OriginalFile title="fictional.pdf" url={`${URL_}#page=2`} />);
    await screen.findByRole('button', { name: 'Open page 2 larger' });
    expect(openPdf).toHaveBeenCalledWith(URL_);
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
