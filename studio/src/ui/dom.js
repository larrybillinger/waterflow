/**
 * Small DOM helpers and control factories.
 *
 * No framework. The interface is a fixed set of panels built once, with values written
 * into existing nodes rather than re-rendered, so there is no diffing layer between a
 * slider and the number it controls. For a UI this size a framework would be more
 * machinery than the thing it manages.
 *
 * Every factory returns the outer element with the live input attached as `.input`, so
 * callers can read and write values without hunting through children.
 */

/**
 * Create an element.
 *
 * @param {string} tag
 * @param {object} [props] className, textContent, id, style, dataset, attrs, and
 *   on<Event> handlers
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;

    if (key === 'className') node.className = value;
    else if (key === 'textContent') node.textContent = value;
    else if (key === 'innerHTML') node.innerHTML = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'attrs') {
      for (const [name, attr] of Object.entries(value)) node.setAttribute(name, String(attr));
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node[key] = value;
    }
  }

  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

/**
 * A labelled slider with a live value readout.
 *
 * @param {object} params
 * @param {string} params.label
 * @param {number} params.min
 * @param {number} params.max
 * @param {number} params.step
 * @param {number} params.value
 * @param {(value: number) => string} [params.format] how to render the current value
 * @param {(value: number) => void} [params.onInput] fired while dragging
 * @param {(value: number) => void} [params.onChange] fired on release
 * @param {string} [params.hint]
 * @returns {HTMLElement & {input: HTMLInputElement, setValue: (v: number) => void}}
 */
export function slider({
  label,
  min,
  max,
  step,
  value,
  format = (v) => String(v),
  onInput,
  onChange,
  hint,
}) {
  const readout = el('span', { className: 'field-value', textContent: format(value) });

  const input = el('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  });

  input.addEventListener('input', () => {
    const current = Number(input.value);
    readout.textContent = format(current);
    if (onInput) onInput(current);
  });

  if (onChange) {
    input.addEventListener('change', () => onChange(Number(input.value)));
  }

  const field = el('div', { className: 'field' }, [
    el('div', { className: 'field-row' }, [
      el('span', { className: 'field-label', textContent: label }),
      readout,
    ]),
    input,
    hint ? el('div', { className: 'hint', textContent: hint }) : null,
  ]);

  field.input = input;
  field.setValue = (v) => {
    input.value = String(v);
    readout.textContent = format(v);
  };

  return field;
}

/**
 * A labelled select.
 *
 * @param {object} params
 * @param {string} params.label
 * @param {Array<{value: string, label: string}>|Map<string, Array<{value: string, label: string}>>}
 *   params.options flat list, or a Map for grouped options
 * @param {string} params.value
 * @param {(value: string) => void} [params.onChange]
 * @param {string} [params.hint]
 * @returns {HTMLElement & {input: HTMLSelectElement}}
 */
export function select({ label, options, value, onChange, hint }) {
  const input = el('select');

  const addOption = (parent, option) => {
    parent.append(
      el('option', { value: option.value, textContent: option.label, selected: option.value === value }),
    );
  };

  if (options instanceof Map) {
    for (const [groupName, groupOptions] of options) {
      const group = el('optgroup', { attrs: { label: groupName } });
      for (const option of groupOptions) addOption(group, option);
      input.append(group);
    }
  } else {
    for (const option of options) addOption(input, option);
  }

  input.value = value;

  if (onChange) {
    input.addEventListener('change', () => onChange(input.value));
  }

  const field = el('div', { className: 'field' }, [
    el('span', { className: 'field-label', textContent: label }),
    input,
    hint ? el('div', { className: 'hint', textContent: hint }) : null,
  ]);

  field.input = input;
  return field;
}

/**
 * A labelled number input.
 *
 * @param {object} params
 * @returns {HTMLElement & {input: HTMLInputElement}}
 */
export function numberField({ label, value, min, max, step, onChange, hint }) {
  const input = el('input', {
    type: 'number',
    value: String(value),
    min: min !== undefined ? String(min) : undefined,
    max: max !== undefined ? String(max) : undefined,
    step: step !== undefined ? String(step) : undefined,
  });

  if (onChange) {
    input.addEventListener('change', () => onChange(Number(input.value)));
  }

  const field = el('div', { className: 'field' }, [
    el('span', { className: 'field-label', textContent: label }),
    input,
    hint ? el('div', { className: 'hint', textContent: hint }) : null,
  ]);

  field.input = input;
  return field;
}

/**
 * A toggle switch.
 *
 * @param {object} params
 * @returns {HTMLElement & {input: HTMLInputElement}}
 */
export function toggle({ label, checked, onChange }) {
  const input = el('input', { type: 'checkbox', checked });

  if (onChange) {
    input.addEventListener('change', () => onChange(input.checked));
  }

  const field = el('label', { className: 'toggle' }, [input, el('span', { textContent: label })]);
  field.input = input;
  return field;
}

/**
 * A button.
 *
 * @param {string} label
 * @param {object} [options]
 * @param {() => void} [options.onClick]
 * @param {string} [options.variant] 'primary' | 'danger'
 * @param {string} [options.title]
 * @returns {HTMLButtonElement}
 */
export function button(label, { onClick, variant, title } = {}) {
  return el('button', {
    className: `btn${variant ? ` ${variant}` : ''}`,
    textContent: label,
    title,
    onClick,
    type: 'button',
  });
}

/**
 * A definition-list readout. Returns the element plus a `set` function keyed by the
 * entry keys, so values can be written without re-creating nodes.
 *
 * @param {Array<[string, string]>} entries key and initial value
 * @returns {HTMLElement & {set: (key: string, value: string) => void}}
 */
export function readout(entries) {
  const values = new Map();
  const list = el('dl', { className: 'readout' });

  for (const [key, initial] of entries) {
    const dd = el('dd', { textContent: initial });
    values.set(key, dd);
    list.append(el('dt', { textContent: key }), dd);
  }

  list.set = (key, value) => {
    const node = values.get(key);
    if (node) node.textContent = value;
  };

  return list;
}

/**
 * A titled group of controls.
 *
 * @param {string} title
 * @param {Array<Node|null>} children
 * @returns {HTMLElement}
 */
export function group(title, children) {
  return el('div', { className: 'group' }, [
    title ? el('div', { className: 'group-title', textContent: title }) : null,
    ...children,
  ]);
}

/**
 * An inline SVG icon.
 *
 * @param {string} path SVG path data on a 24x24 viewbox
 * @returns {SVGElement}
 */
export function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  node.setAttribute('d', path);
  svg.append(node);
  return svg;
}

export const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  reset: 'M12 5V2L7 7l5 5V9a5 5 0 1 1-5 5H5a7 7 0 1 0 7-9z',
  camera: 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z',
  step: 'M5 5h2v14H5zm4 7 9 7V5z',
};

/**
 * Format a number with thousands separators.
 *
 * @param {number} value
 * @param {number} [decimals=0]
 * @returns {string}
 */
export function formatNumber(value, decimals = 0) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a volume, switching to larger units so the number stays readable.
 *
 * @param {number} cubicMetres
 * @returns {string}
 */
export function formatVolume(cubicMetres) {
  if (!Number.isFinite(cubicMetres) || cubicMetres <= 0) return '—';
  if (cubicMetres >= 1e9) return `${(cubicMetres / 1e9).toFixed(2)} km³`;
  if (cubicMetres >= 1e6) return `${(cubicMetres / 1e6).toFixed(2)} Mm³`;
  return `${formatNumber(cubicMetres)} m³`;
}
