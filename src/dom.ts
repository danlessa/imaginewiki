type Child = Node | string | number | null | undefined | false;

/** Creates an element. `on*` props become event listeners, `class` sets className, the rest become attributes. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child != null && child !== false) node.append(typeof child === 'number' ? String(child) : child);
  }
  return node;
}

export const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector(selector) as T;
