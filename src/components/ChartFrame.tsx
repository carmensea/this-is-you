import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Measures its own width and passes it to a chart, which draws at exact pixel size. */
export function ChartFrame({ style, children }: { style: CSSProperties; children: (width: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
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
