/** Tiny DOM helpers. Not a framework — just the three lines every file repeated. */

type Attributes = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    if (key === "class") {
      node.className = String(value);
      continue;
    }
    if (key === "text") {
      node.textContent = String(value);
      continue;
    }
    /*
     * ARIA states are written out, and both halves of them are meaningful.
     *
     * A boolean here used to take the HTML route — `true` became `aria-pressed=""`
     * and `false` dropped the attribute entirely. Neither is what those
     * attributes mean: the empty string is not a valid ARIA value, so a screen
     * reader read `aria-pressed=""` as *not* pressed, and every decorative
     * `aria-hidden` on this site was announcing itself. Found on the clock dial,
     * where the selected hour was marked in ink and silent.
     */
    if (key.startsWith("aria-")) {
      node.setAttribute(key, String(value));
      continue;
    }
    if (value === false) continue;
    node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function query<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`missing element: ${selector}`);
  return found;
}

/**
 * Trailing debounce for keystroke-driven requests.
 *
 * Autocomplete on a phone keyboard fires per character; without this a
 * five-letter comune is five round trips over mobile data for four answers
 * nobody reads.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  let timer: number | undefined;
  return (...args: A) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delayMs);
  };
}
