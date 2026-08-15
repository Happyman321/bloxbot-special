import { type RefCallback, useCallback, useRef } from "react";

export function useCompanionSafeOffset(variableName: string): RefCallback<HTMLDivElement> {
  const observerRef = useRef<ResizeObserver | null>(null);

  return useCallback(
    (element: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;

      if (!element) {
        document.documentElement.style.removeProperty(variableName);
        return;
      }

      const updateOffset = () => {
        const height = element.getBoundingClientRect().height || 96;
        document.documentElement.style.setProperty(variableName, `${height + 12}px`);
      };
      updateOffset();

      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(updateOffset);
        observer.observe(element);
        observerRef.current = observer;
      }
    },
    [variableName],
  );
}
