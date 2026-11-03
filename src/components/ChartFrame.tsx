import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Measures its own width and passes it to a chart, which draws at exact pixel size. */
export function ChartFrame({ style, children }: { style: CSSProperties; children: (width: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.floor(el.getBoundingClientRect().width);
      // A frame can measure 0 for a moment, as it does during a page capture. Removing the chart then leaves a blank.
      if (next > 0) setWidth(next);
    };
    // On a page's first paint, the observer's first report arrives after the text is on screen. Charts then draw
    // straight after it, in reserved space. Later screens measure at once, so their charts never appear late.
    if (typeof ResizeObserver === 'undefined' || performance.getEntriesByName('first-contentful-paint').length > 0) measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={style}>
      {width > 0 ? children(width) : null}
    </div>
  );
}
