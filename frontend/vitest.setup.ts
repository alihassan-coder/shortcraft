import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom lacks these browser APIs; Radix and the editor layout use them.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Radix Slider / Select call these on pointer interaction.
for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"] as const) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, { value: () => false, configurable: true, writable: true });
  }
}
