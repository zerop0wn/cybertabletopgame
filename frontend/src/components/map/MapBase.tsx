import React, { useLayoutEffect, useRef, useState } from "react";

type Props = {
  src: string;              // background image (2:1)
  className?: string;
  onSize?: (w: number, h: number) => void; // notify overlay of rendered size
};

export default function MapBase({ src, className = "", onSize }: Props) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (onSize && el.complete) onSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onSize]);

  return (
    <div className={`relative w-full ${className}`}>
      {/* Maintain 2:1 aspect ratio box */}
      <div className="w-full" style={{ paddingTop: "50%" }} />
      <img
        ref={ref}
        src={src}
        alt="Global cyber command map"
        className="absolute inset-0 w-full h-full object-cover rounded-2xl border border-slate-700/60 shadow-lg"
        onLoad={(e) => {
          setLoaded(true);
          const el = e.currentTarget;
          onSize?.(el.clientWidth, el.clientHeight);
        }}
        decoding="async"
        loading="eager"
      />
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center text-slate-400 text-sm">
          Loading map…
        </div>
      )}
    </div>
  );
}

