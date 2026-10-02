import { JSDOM } from 'jsdom';

/**
 * Install a browser-like DOM on the Node global scope so React DOM can render.
 * @returns the JSDOM instance owning the installed document.
 */
export function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true
  });
  return dom;
}

/**
 * Render one React element into a detached container using the installed DOM.
 * @param element - React element to render.
 * @returns the container plus act-wrapped update and unmount helpers.
 */
export async function mount(element) {
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    async update(next) {
      await act(async () => root.render(next));
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    }
  };
}

/**
 * Run one DOM interaction inside React's act boundary.
 * @param operation - synchronous interaction to perform.
 * @returns nothing.
 */
export async function interact(operation) {
  const { act } = await import('react');
  await act(async () => operation());
}

/**
 * Find the single control carrying an exact accessible name.
 *
 * Resolves an exact `aria-label` first, then a `<label for>` whose text matches —
 * which is how the native settings form labels its inputs.
 * @param container - rendered container to search.
 * @param label - exact accessible name.
 * @returns the matching control element.
 */
export function byLabel(container, label) {
  const direct = [...container.querySelectorAll(`[aria-label="${label}"]`)];
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) throw new Error(`expected exactly one [aria-label="${label}"], found ${direct.length}`);
  const controls = [...container.querySelectorAll('label')]
    .filter(node => node.textContent.trim() === label && node.htmlFor !== '')
    .map(node => container.querySelector(`[id="${node.htmlFor}"]`))
    .filter(node => node !== null);
  if (controls.length !== 1) throw new Error(`expected exactly one control labelled "${label}", found ${controls.length}`);
  return controls[0];
}

/**
 * Find the single button whose trimmed text is exactly `text`.
 * @param container - rendered container to search.
 * @param text - exact button text.
 * @returns the matching button element.
 */
export function button(container, text) {
  const found = [...container.querySelectorAll('button')].filter(node => node.textContent.trim() === text);
  if (found.length !== 1) throw new Error(`expected exactly one button "${text}", found ${found.length}`);
  return found[0];
}

/**
 * Set a text-like input value the way a user edit does, through the native setter.
 * @param element - input element to edit.
 * @param value - next raw value.
 * @returns nothing.
 */
export function type(element, value) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  descriptor.set.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}
