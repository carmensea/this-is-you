import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom cannot draw a PDF. A fake with the same shape stands in, and originalFile.test.tsx covers the component.
vi.mock('../services/pdfViewer', () => ({
  openPdf: vi.fn(async () => ({
    pages: 2,
    ratio: () => 1.3,
    render: () => ({ done: Promise.resolve(), cancel: () => {} }),
    findRow: async () => ({ left: 0.1, top: 0.2, right: 0.9, bottom: 0.22, valueLeft: 0.5 }),
    close: () => {},
  })),
}));

window.scrollTo = () => {};
// jsdom has no layout. Give charts a width so they actually render.
Element.prototype.getBoundingClientRect = () => ({ x:0, y:0, top:0, left:0, right:1000, bottom:400, width:1000, height:400, toJSON() {} });
afterEach(cleanup);
