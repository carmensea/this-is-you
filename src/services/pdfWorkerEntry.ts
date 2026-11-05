import 'pdfjs-dist/build/pdf.worker.min.mjs';

// The browser frees this lock the moment this thread ends, however busy it was, so the page can tell dead from slow.
void navigator.locks?.request(self.name, () => {
  self.postMessage('pdf-worker-lock-held');
  return new Promise(() => {});
});
