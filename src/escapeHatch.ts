export function renderEscapeHatch(
  container: HTMLElement,
  escapeHatchClicked: boolean,
  atLimit: boolean
): void {
  if (escapeHatchClicked) {
    container.innerHTML = `
      <div style="display: flex; gap: 6px;">
        <button class="escape-btn" data-act="escape-tab" title="${
          atLimit ? "Open a new tab outside the limit" : "Open a new tab"
        }">+ Tab</button>
        <button class="escape-btn" data-act="escape-window" title="${
          atLimit ? "Open a new window outside the limit" : "Open a new window"
        }">+ Window</button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button class="link" data-act="click-escape-hatch" title="Click to show escape actions" style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); cursor: pointer; padding: 0;">Escape Hatch</button>
    `;
  }
}
