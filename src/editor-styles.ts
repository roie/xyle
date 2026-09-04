export const editorStyles = `
@layer xyle.tokens {
  :root {
    color-scheme: dark;
    --xyle-ink: #f2f3ef;
    --xyle-muted: #a5a8a0;
    --xyle-surface: #1c1d1b;
    --xyle-raised: #252724;
    --xyle-line: #3a3c38;
    --xyle-accent: #667a61;
    --xyle-accent-hover: #7f9378;
    --xyle-accent-soft: #667a6126;
    --xyle-success: #6da77a;
    --xyle-danger: #d26d6d;
    --xyle-focus: #d9ded7;
    --xyle-font-ui:
      ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --xyle-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --xyle-radius-sm: 6px;
    --xyle-radius-md: 8px;
    --xyle-space-1: 4px;
    --xyle-space-2: 8px;
    --xyle-space-3: 12px;
    --xyle-space-4: 16px;
    --xyle-space-6: 24px;
    --xyle-space-8: 32px;
  }
}

@layer xyle.reset, xyle.components;

@layer xyle.reset {
  #xyle-shell,
  #xyle-overlay-root,
  #xyle-demo-notice,
  #xyle-flash,
  #xyle-conflict,
  #xyle-control-dock,
  .xyle-drawer,
  dialog.xyle-dialog {
    --xyle-font-ui:
      ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --xyle-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-family: var(--xyle-font-ui) !important;
  }

  #xyle-shell,
  #xyle-shell *,
  #xyle-shell *::before,
  #xyle-shell *::after,
  #xyle-demo-notice,
  #xyle-demo-notice *,
  #xyle-flash,
  #xyle-flash *,
  #xyle-conflict,
  #xyle-conflict *,
  #xyle-control-dock,
  #xyle-control-dock *,
  .xyle-drawer,
  .xyle-drawer *,
  dialog.xyle-dialog,
  dialog.xyle-dialog * {
    box-sizing: border-box;
  }
}

@layer xyle.components {
  #xyle-shell {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: transparent;
    color: var(--xyle-ink);
    font-family: var(--xyle-font-ui);
  }

  #xyle-demo-notice {
    position: fixed;
    top: 0;
    right: 0;
    left: 0;
    z-index: 2147483646;
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    padding: 0.45rem 1rem;
    border-bottom: 1px solid #b8c5b3;
    background: #e5ebdf;
    color: #243025;
    font: 600 12px / 1.35 var(--xyle-font-ui);
    text-align: center;
  }
  #xyle-demo-notice + #xyle-shell {
    top: 2.75rem;
  }

  #xyle-preview-host {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 0;
  }
  #xyle-preview {
    position: relative;
    z-index: 1;
    border: 0 !important;
    border-radius: 0;
    background: #fff !important;
  }
  #xyle-flash,
  #xyle-conflict,
  #xyle-control-dock {
    font-family: var(--xyle-font-ui);
  }
  #xyle-flash {
    position: fixed;
    top: 5.2rem;
    left: 50%;
    z-index: 2147483647;
    max-width: calc(100vw - 2rem);
    padding: 0.65rem 0.9rem;
    transform: translateX(-50%);
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-md);
    background: #1c1d1bf5;
    color: var(--xyle-ink);
    font-size: 13px;
    font-weight: 500;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }
  #xyle-flash.visible {
    opacity: 1;
  }

  #xyle-control-dock {
    all: initial;
    position: fixed;
    bottom: max(0.5rem, env(safe-area-inset-bottom));
    left: 50%;
    z-index: 2147483647;
    display: flex;
    width: max-content;
    flex-direction: column;
    align-items: center;
    gap: var(--xyle-space-1);
    transform: translateX(-50%);
    isolation: isolate;
    pointer-events: none;
    transition: transform 0.35s cubic-bezier(0.485, -0.05, 0.285, 1.505);
  }
  #xyle-control-dock[data-hidden] {
    transform: translate(-50%, calc(100% - 28px));
  }
  html[data-xyle-media-adjusting] #xyle-control-dock {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }
  #xyle-control-dock[data-hidden] #xyle-control-bar .xyle-icon-button {
    opacity: 0.35;
  }
  #xyle-control-hitbox {
    position: absolute;
    inset: -42px 0 auto;
    height: 42px;
    pointer-events: auto;
  }
  #xyle-dock-handle {
    display: flex;
    min-width: 4.5rem;
    height: 22px;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0 0.55rem;
    border: 1px solid var(--xyle-line);
    border-radius: 999px;
    background: #1c1d1bf5;
    color: var(--xyle-ink);
    font: 600 11px / 1 var(--xyle-font-ui);
    cursor: pointer;
    pointer-events: auto;
    touch-action: manipulation;
  }
  #xyle-dock-handle .xyle-brand-logo {
    display: block;
    width: 14px;
    height: 14px;
    object-fit: contain;
  }
  #xyle-dock-handle:hover,
  #xyle-dock-handle:focus-visible {
    background: #30322f;
    outline: 2px solid var(--xyle-accent);
    outline-offset: 2px;
  }
  #xyle-control-dock:not([data-hidden]) #xyle-dock-handle {
    opacity: 0.72;
  }
  #xyle-control-bar {
    display: flex;
    height: 38px;
    align-items: center;
    overflow: visible;
    padding: 0 2px;
    border: 1px solid var(--xyle-line);
    border-radius: 999px;
    background: #1c1d1bf5;
    pointer-events: auto;
    touch-action: manipulation;
  }
  #xyle-bar-left,
  #xyle-dirty {
    position: static;
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0;
    border: 0;
    background: transparent;
  }
  .xyle-dock-separator {
    width: 1px;
    height: 20px;
    margin: 0 2px;
    background: var(--xyle-line);
  }
  .xyle-icon-button {
    position: relative;
    display: grid;
    width: 40px;
    height: 36px;
    place-items: center;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--xyle-radius-sm);
    background: transparent;
    color: #fff;
    font: 400 1rem / 1.2 var(--xyle-font-ui);
    cursor: pointer;
    transition:
      background 0.1s ease,
      opacity 0.15s ease;
  }
  .xyle-icon-button:hover,
  .xyle-icon-button:focus-visible {
    background: #ffffff1a;
  }
  .xyle-icon-button:disabled {
    cursor: wait;
    opacity: 0.38;
  }
  .xyle-icon-button svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }
  .xyle-icon-button[data-tooltip]::after {
    position: absolute;
    bottom: calc(100% + 7px);
    left: 50%;
    padding: 4px 7px;
    transform: translateX(-50%);
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-sm);
    background: var(--xyle-raised);
    color: var(--xyle-ink);
    content: attr(data-tooltip);
    font: 500 12px / 1.2 var(--xyle-font-ui);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease 0.12s;
    white-space: nowrap;
  }
  .xyle-icon-button[data-tooltip]:hover::after,
  .xyle-icon-button[data-tooltip]:focus-visible::after {
    opacity: 1;
  }
  .xyle-icon-button--publish {
    color: #fff;
  }
  #xyle-editables[aria-pressed="true"],
  .xyle-icon-button[aria-expanded="true"] {
    background: var(--xyle-accent-soft);
    color: #dce5d9;
  }
  .xyle-count-badge {
    position: absolute;
    top: 2px;
    right: 1px;
    display: grid;
    min-width: 15px;
    height: 15px;
    place-items: center;
    padding: 0 3px;
    border: 2px solid #1c1d1b;
    border-radius: 999px;
    background: #d9ded7;
    color: #1c1d1b;
    font: 700 9px / 1 var(--xyle-font-ui);
    font-variant-numeric: tabular-nums;
  }
  .xyle-control:focus-visible,
  .xyle-icon-button:focus-visible,
  .xyle-menu-item:focus-visible,
  #xyle-media-drawer button:focus-visible,
  #xyle-media-drawer input:focus-visible,
  dialog button:focus-visible,
  dialog input:focus-visible {
    outline: 2px solid var(--xyle-focus);
    outline-offset: 2px;
  }

  dialog.xyle-dialog {
    width: min(31rem, calc(100vw - 2rem));
    padding: 0;
    border: 1px solid var(--xyle-line);
    border-radius: 10px;
    background: var(--xyle-surface);
    color: var(--xyle-ink);
  }
  dialog.xyle-dialog::backdrop {
    background: #00000099;
    backdrop-filter: blur(2px);
  }
  #xyle-overlay-root .xyle-inline-media-editor {
    all: initial;
    position: fixed !important;
    z-index: 20 !important;
    inset: 0 !important;
    display: block !important;
    color: #eef3ec !important;
    font: 500 13px / 1.4 var(--xyle-font-ui) !important;
    pointer-events: none !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-media-editor-panel {
    position: fixed !important;
    top: var(--xyle-media-panel-top, 0.5rem) !important;
    left: var(--xyle-media-panel-left, 0.5rem) !important;
    display: grid !important;
    width: min(19rem, calc(100vw - 1rem)) !important;
    grid-template-rows: auto auto auto auto auto 1fr !important;
    gap: 0.7rem !important;
    box-sizing: border-box !important;
    min-width: 0 !important;
    max-height: calc(100vh - 1rem) !important;
    padding: 0.85rem !important;
    overflow: auto !important;
    border: 1px solid var(--xyle-line) !important;
    border-radius: var(--xyle-radius-md) !important;
    background: var(--xyle-surface) !important;
    box-shadow: none !important;
    pointer-events: auto !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-heading {
    display: grid !important;
    gap: 0.2rem !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-label {
    display: grid !important;
    grid-template-columns: 1fr auto !important;
    gap: 0.4rem !important;
    color: #aab6aa !important;
    font-size: 11px !important;
    font-weight: 600 !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-label > :last-child {
    grid-column: 1 / -1 !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-input {
    width: 100% !important;
    box-sizing: border-box !important;
    padding: 0.6rem !important;
    border: 1px solid #435047 !important;
    border-radius: 6px !important;
    background: #10130f !important;
    color: #eef3ec !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-actions {
    position: sticky !important;
    bottom: -0.85rem !important;
    z-index: 2 !important;
    align-self: end !important;
    display: flex !important;
    justify-content: flex-end !important;
    gap: 0.4rem !important;
    padding: 0.35rem 0 0.85rem !important;
    border-top: 1px solid #303830 !important;
    background: #151815 !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-actions-spacer {
    flex: 1 !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-button {
    min-height: 2.25rem !important;
    padding: 0 0.7rem !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-button--quiet {
    color: #aab6aa !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-crop-stage {
    position: fixed !important;
    top: var(--xyle-crop-top, 0) !important;
    left: var(--xyle-crop-left, 0) !important;
    width: var(--xyle-crop-width, 1px) !important;
    box-sizing: border-box !important;
    min-width: 0 !important;
    min-height: 0 !important;
    height: var(--xyle-crop-height, 1px) !important;
    border-top: var(--xyle-image-border-top, 0) !important;
    border-right: var(--xyle-image-border-right, 0) !important;
    border-bottom: var(--xyle-image-border-bottom, 0) !important;
    border-left: var(--xyle-image-border-left, 0) !important;
    border-radius: var(--xyle-image-border-radius, 0) !important;
    outline: 0 !important;
    aspect-ratio: var(--xyle-crop-aspect, 16 / 9) !important;
    background: var(--xyle-image-background, transparent) !important;
    box-shadow: var(--xyle-image-box-shadow, none) !important;
    pointer-events: auto !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-crop-stage img {
    height: 100% !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-crop-guide {
    border: 0 !important;
    box-shadow: none !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focal-target {
    box-shadow: none !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-presets {
    display: grid !important;
    grid-template-columns: 1fr auto !important;
    align-items: center !important;
    gap: 0.65rem !important;
    color: #aab6aa !important;
    font-size: 11px !important;
    font-weight: 600 !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-preset-grid {
    display: grid !important;
    grid-template-columns: repeat(3, 1.7rem) !important;
    gap: 0.2rem !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-preset-grid button {
    all: initial !important;
    position: relative !important;
    box-sizing: border-box !important;
    width: 1.7rem !important;
    height: 1.7rem !important;
    border: 0 !important;
    border-radius: 3px !important;
    background: var(--xyle-raised) !important;
    cursor: pointer !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-preset-grid button::after {
    position: absolute !important;
    top: 50% !important;
    left: 50% !important;
    width: 0.3rem !important;
    height: 0.3rem !important;
    border-radius: 50% !important;
    background: #a8bea5 !important;
    content: "" !important;
    transform: translate(-50%, -50%) !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-preset-grid button:hover,
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-preset-grid button:focus-visible,
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-preset-grid button[aria-pressed="true"] {
    background: var(--xyle-accent-soft) !important;
    outline: 1px solid var(--xyle-accent-hover) !important;
    outline-offset: 0 !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-preset-grid button[aria-pressed="true"]::after {
    width: 0.5rem !important;
    height: 0.5rem !important;
    background: #eef3ec !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-fine-tune {
    padding-top: 0.1rem !important;
    border-top: 1px solid #303830 !important;
    color: #aab6aa !important;
    font-size: 11px !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-fine-tune summary {
    padding: 0.35rem 0 !important;
    color: #c7d0c6 !important;
    font-weight: 600 !important;
    cursor: pointer !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-fine-tune[open] {
    display: grid !important;
    gap: 0.7rem !important;
  }
  @media (hover: none), (pointer: coarse) {
    #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-preset-grid {
      grid-template-columns: repeat(3, 2.75rem) !important;
    }
    #xyle-overlay-root .xyle-inline-media-editor .xyle-focus-preset-grid button {
      width: 2.75rem !important;
      height: 2.75rem !important;
    }
  }
  #xyle-overlay-root
    .xyle-inline-media-editor[data-xyle-placement="bottom-sheet"]
    .xyle-media-editor-panel {
    top: auto !important;
    right: 0.5rem !important;
    bottom: 0.5rem !important;
    left: 0.5rem !important;
    width: auto !important;
    max-height: min(46vh, 28rem) !important;
  }
  @media (max-width: 759px) {
    #xyle-overlay-root .xyle-inline-media-editor .xyle-media-editor-panel {
      top: auto !important;
      right: 0.5rem !important;
      bottom: 0.5rem !important;
      left: 0.5rem !important;
      width: auto !important;
      max-height: min(46vh, 28rem) !important;
    }
  }
  .xyle-dialog-form {
    display: grid;
    gap: 0.75rem;
    padding: 1.25rem;
    font: 500 13px / 1.4 var(--xyle-font-ui);
  }
  .xyle-dialog-heading {
    display: grid;
    gap: 0.22rem;
    margin-bottom: 0.15rem;
  }
  .xyle-dialog-kicker {
    color: #a1b69a;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .xyle-dialog-heading strong {
    font-size: 16px;
    letter-spacing: -0.015em;
  }
  .xyle-dialog-label {
    display: grid;
    gap: 0.4rem;
    color: var(--xyle-muted);
    font-size: 12px;
    font-weight: 600;
  }
  .xyle-dialog-input {
    width: 100%;
    min-width: 0;
    padding: 0.65rem 0.7rem;
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-sm);
    background: #141513;
    color: var(--xyle-ink);
    font: 500 13px / 1.3 var(--xyle-font-ui);
  }
  .xyle-dialog-input:focus {
    border-color: #a1b69a;
    outline: 2px solid var(--xyle-accent-soft);
    outline-offset: 1px;
  }
  .xyle-crop-stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 15rem;
    overflow: hidden;
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-sm);
    background: #0b0e0c;
    cursor: grab;
    touch-action: none;
  }
  .xyle-crop-stage:active {
    cursor: grabbing;
  }
  .xyle-crop-stage img {
    position: relative;
    z-index: 0;
  }
  .xyle-crop-guide {
    position: absolute;
    z-index: 1;
    inset: 0;
    border: 1px solid #fff;
    box-shadow: 0 0 0 999px #05070580, 0 0 0 1px #101310;
    pointer-events: none;
  }
  .xyle-crop-guide::before,
  .xyle-crop-guide::after {
    position: absolute;
    inset: 0;
    content: "";
    pointer-events: none;
  }
  .xyle-crop-guide::before {
    background: linear-gradient(90deg, transparent 33.2%, #fff8 33.2%, #fff8 33.7%, transparent 33.7%, transparent 66.3%, #fff8 66.3%, #fff8 66.8%, transparent 66.8%);
  }
  .xyle-crop-guide::after {
    background: linear-gradient(0deg, transparent 33.2%, #fff8 33.2%, #fff8 33.7%, transparent 33.7%, transparent 66.3%, #fff8 66.3%, #fff8 66.8%, transparent 66.8%);
  }
  .xyle-crop-stage[data-mode="focus"] .xyle-crop-guide {
    border-color: #a1b69a99;
    box-shadow: none;
  }
  .xyle-crop-stage[data-mode="focus"] .xyle-crop-guide::before,
  .xyle-crop-stage[data-mode="focus"] .xyle-crop-guide::after {
    display: none;
  }
  .xyle-crop-hint {
    margin: -0.2rem 0 0;
    color: #849184;
    font-size: 11px;
  }
  .xyle-crop-stage img {
    display: block;
    width: 100%;
    height: 15rem;
    object-fit: cover;
    transform-origin: center;
    user-select: none;
    pointer-events: none;
  }
  .xyle-crop-stage[data-preview-crop] img {
    position: absolute !important;
    left: var(--xyle-preview-left);
    top: var(--xyle-preview-top);
    width: var(--xyle-preview-width) !important;
    height: var(--xyle-preview-height) !important;
    max-width: none !important;
    object-fit: fill !important;
    transform: none !important;
  }
  .xyle-focal-target {
    position: absolute;
    z-index: 2;
    width: 1.25rem;
    height: 1.25rem;
    padding: 0;
    border: 2px solid #fff;
    border-radius: 50%;
    background: #a1b69a66;
    box-shadow: 0 0 0 1px #121512, 0 2px 8px #0009;
    transform: translate(-50%, -50%);
    cursor: grab;
  }
  .xyle-focal-target:active {
    cursor: grabbing;
  }
  .xyle-range-value {
    color: var(--xyle-ink);
    font-variant-numeric: tabular-nums;
  }
  .xyle-dialog-range {
    width: 100%;
    accent-color: #a1b69a;
  }
  .xyle-dialog-error {
    min-height: 1.1rem;
    margin: 0;
    color: var(--xyle-danger);
    font-size: 12px;
  }
  .xyle-dialog-check {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--xyle-muted);
    font-size: 12px;
  }
  .xyle-dialog-check input {
    accent-color: #a1b69a;
  }
  dialog.xyle-alt-popover::backdrop {
    background: transparent;
  }
  .xyle-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.2rem;
  }
  .xyle-dialog-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-height: 2.25rem;
    padding: 0 0.8rem;
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-sm);
    background: transparent;
    color: var(--xyle-ink);
    font: 600 12px / 1 var(--xyle-font-ui);
    cursor: pointer;
  }
  .xyle-dialog-button:hover {
    background: var(--xyle-accent-soft);
    border-color: #5b6058;
  }
  .xyle-dialog-button--primary {
    border-color: var(--xyle-accent);
    background: var(--xyle-accent);
    color: #fff;
  }
  .xyle-dialog-button--primary:hover {
    background: var(--xyle-accent-hover);
    border-color: var(--xyle-accent-hover);
  }
  .xyle-dialog-button--accent {
    border-color: #d26d6d66;
    background: #d26d6d14;
    color: #e38a8a;
  }
  .xyle-dialog-button--accent:hover {
    background: #d26d6d24;
    border-color: var(--xyle-danger);
  }

  #xyle-menu {
    position: fixed;
    bottom: 50px;
    left: 50%;
    z-index: 2147483648;
    display: none;
    min-width: 13rem;
    transform: translateX(-50%);
    overflow: hidden;
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-md);
    background: var(--xyle-raised);
  }
  #xyle-conflict {
    position: fixed;
    top: 5.25rem;
    left: 50%;
    z-index: 2147483647;
    display: none;
    width: min(34rem, calc(100vw - 2rem));
    transform: translateX(-50%);
    padding: 1rem 1.1rem;
    border: 1px solid #b8954a66;
    border-radius: 10px;
    background: #29271ff5;
    color: var(--xyle-ink);
  }
  #xyle-conflict strong {
    font-size: 15px;
  }
  #xyle-conflict p {
    margin: 0.4rem 0 0.9rem;
    color: #c7c0a9;
    font-size: 13px;
    line-height: 1.45;
  }
  .xyle-conflict-action {
    min-height: 2.25rem;
    padding: 0 0.75rem;
    border: 1px solid #b8954a;
    border-radius: var(--xyle-radius-sm);
    background: #b8954a;
    color: #201d14;
    font: 600 12px var(--xyle-font-ui);
    cursor: pointer;
  }
  .xyle-conflict-action--quiet {
    margin-left: 0.4rem;
    border-color: var(--xyle-line);
    background: transparent;
    color: var(--xyle-ink);
  }

  .xyle-drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 2147483647;
    display: flex;
    width: min(25rem, 100vw);
    max-width: 100vw;
    flex-direction: column;
    padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
      max(1rem, env(safe-area-inset-bottom)) 1rem;
    overflow: hidden;
    border-left: 1px solid var(--xyle-line);
    background: #1c1d1b;
    color: var(--xyle-ink);
    overscroll-behavior: contain;
  }
  .xyle-drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .xyle-structure-list {
    display: grid;
    flex: 1;
    align-content: start;
    gap: 0.35rem;
    min-height: 0;
    overflow: auto;
    padding: 0 2px 0.75rem 0;
  }
  .xyle-structure-row {
    display: grid;
    gap: 0.35rem;
    padding: 0.5rem;
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-sm);
    background: #141815;
  }
  .xyle-structure-row[data-selected] {
    border-color: #667a61;
    background: var(--xyle-accent-soft);
    box-shadow: inset 3px 0 0 #81977b;
  }
  .xyle-structure-row-header {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.4rem;
  }
  .xyle-structure-select {
    display: grid;
    min-width: 0;
    flex: 1;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0.3rem;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--xyle-ink);
    text-align: left;
    cursor: pointer;
  }
  .xyle-structure-select:hover,
  .xyle-structure-select:focus-visible {
    background: #ffffff0a;
    outline: 2px solid var(--xyle-focus);
    outline-offset: 1px;
  }
  .xyle-structure-position {
    color: var(--xyle-accent-hover);
    font: 700 10px / 1 var(--xyle-font-mono);
    font-variant-numeric: tabular-nums;
  }
  .xyle-structure-title {
    min-width: 0;
    overflow: hidden;
    font: 650 12px / 1.25 var(--xyle-font-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .xyle-structure-status {
    padding: 0.15rem 0.35rem;
    border: 1px solid var(--xyle-line);
    border-radius: 999px;
    color: var(--xyle-muted);
    font: 650 9px / 1 var(--xyle-font-ui);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .xyle-structure-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.2rem;
    padding-top: 0.35rem;
    border-top: 1px solid #ffffff0c;
  }
  .xyle-structure-button {
    min-width: 0;
    min-height: 2rem;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-sm);
    background: transparent;
    color: var(--xyle-muted);
    font: 600 10px / 1.15 var(--xyle-font-ui);
    cursor: pointer;
  }
  .xyle-structure-icon-button {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    padding: 0;
  }
  .xyle-structure-icon-button svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }
  .xyle-structure-button:hover,
  .xyle-structure-button:focus-visible,
  .xyle-structure-button[aria-pressed="true"] {
    border-color: var(--xyle-accent-hover);
    background: var(--xyle-accent-soft);
    color: var(--xyle-ink);
  }
  .xyle-structure-button:focus-visible {
    outline: 2px solid var(--xyle-focus);
    outline-offset: 1px;
  }
  .xyle-structure-button:disabled {
    cursor: not-allowed;
    opacity: 0.35;
  }
  .xyle-structure-inspector {
    display: grid;
    flex: none;
    gap: 0.75rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--xyle-line);
  }
  .xyle-structure-inspector > header {
    display: grid;
    gap: 0.2rem;
  }
  .xyle-structure-inspector > header span,
  .xyle-structure-layout > strong {
    color: var(--xyle-muted);
    font: 700 9px / 1 var(--xyle-font-ui);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .xyle-structure-inspector > header strong {
    overflow: hidden;
    color: var(--xyle-ink);
    font: 650 13px / 1.3 var(--xyle-font-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .xyle-structure-unavailable {
    display: grid;
    gap: 0.2rem;
    padding: 0.5rem 0.6rem;
    border-left: 2px solid #667a61;
    background: #667a6114;
  }
  .xyle-structure-unavailable strong {
    color: var(--xyle-muted);
    font: 700 9px / 1 var(--xyle-font-ui);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .xyle-structure-unavailable p {
    margin: 0;
    color: var(--xyle-muted);
    font: 500 10px / 1.35 var(--xyle-font-ui);
  }
  .xyle-structure-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }
  .xyle-structure-layout > strong {
    grid-column: 1 / -1;
    padding-bottom: 0.1rem;
  }
  .xyle-structure-layout > .xyle-structure-button:last-child {
    grid-column: 1 / -1;
  }
  .xyle-structure-reason {
    margin: 0;
    color: var(--xyle-muted);
    font: 500 10px / 1.4 var(--xyle-font-ui);
  }
  .xyle-drawer-header strong {
    display: block;
    font-size: 16px;
    letter-spacing: -0.02em;
  }
  #xyle-media-drawer .xyle-icon-button,
  #xyle-changes-drawer .xyle-icon-button,
  #xyle-seo-drawer .xyle-icon-button,
  #xyle-structure-drawer .xyle-icon-button {
    width: 2.25rem;
    height: 2.25rem;
    border: 0;
    border-radius: var(--xyle-radius-sm);
    background: transparent;
    color: var(--xyle-ink);
    font-size: 1.25rem;
  }
  #xyle-media-drawer .xyle-icon-button:hover,
  #xyle-media-drawer .xyle-icon-button:focus-visible,
  #xyle-changes-drawer .xyle-icon-button:hover,
  #xyle-changes-drawer .xyle-icon-button:focus-visible,
  #xyle-seo-drawer .xyle-icon-button:hover,
  #xyle-seo-drawer .xyle-icon-button:focus-visible,
  #xyle-structure-drawer .xyle-icon-button:hover,
  #xyle-structure-drawer .xyle-icon-button:focus-visible {
    background: var(--xyle-accent-soft);
    color: var(--xyle-accent-hover);
  }
  .xyle-changes-list {
    display: grid;
    flex: 1;
    align-content: start;
    gap: 1rem;
    overflow: auto;
  }
  .xyle-change-page-group {
    display: grid;
    gap: 0.5rem;
  }
  .xyle-change-page {
    margin: 0;
    color: var(--xyle-muted);
    font: 600 11px / 1.4 var(--xyle-font-ui);
    overflow-wrap: anywhere;
  }
  .xyle-change-set {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--xyle-line);
  }
  .xyle-change-set-label {
    min-width: 0;
    color: var(--xyle-ink);
    font: 600 12px / 1.35 var(--xyle-font-ui);
    overflow-wrap: anywhere;
  }
  .xyle-change-set-label::before {
    margin-right: 0.4rem;
    color: var(--xyle-accent-hover);
    content: "Task";
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .xyle-change-set-undo {
    flex: none;
  }
  .xyle-change-row {
    display: grid;
    gap: 0.65rem;
    padding: 0.75rem 0;
    border: 0;
    border-bottom: 1px solid var(--xyle-line);
    background: transparent;
    cursor: pointer;
  }
  .xyle-change-row:focus-visible {
    border-radius: var(--xyle-radius-sm);
    outline: 2px solid var(--xyle-accent);
    outline-offset: 2px;
  }
  .xyle-change-row.is-located {
    background: #1d2a1f;
  }
  .xyle-change-row-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .xyle-change-heading {
    display: flex;
    min-width: 0;
    align-items: center;
  }
  .xyle-change-index {
    color: var(--xyle-ink);
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
  }
  .xyle-change-type {
    margin-left: 0.55rem;
    color: var(--xyle-ink);
    font-size: 12px;
    font-weight: 650;
  }
  .xyle-change-row-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.25rem;
  }
  .xyle-change-comparison {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1px;
    overflow: hidden;
    border: 1px solid #ffffff12;
    border-radius: 4px;
  }
  .xyle-change-value {
    position: relative;
    min-width: 0;
    padding: 0.2rem 0.6rem 0.2rem 1.65rem;
    color: var(--xyle-muted);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .xyle-change-value::before {
    position: absolute;
    top: 0.3rem;
    left: 0.6rem;
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
  }
  .xyle-change-before::before {
    color: #e38a8a;
    content: "−";
  }
  .xyle-change-after {
    color: var(--xyle-ink);
  }
  .xyle-change-after::before {
    color: #8fca99;
    content: "+";
  }
  .xyle-change-highlight {
    padding: 0 0.1em;
    border-radius: 2px;
  }
  .xyle-change-before .xyle-change-highlight {
    background: #d26d6d45;
    color: #f0b1b1;
  }
  .xyle-change-after .xyle-change-highlight {
    background: #6da77a45;
    color: #b9e2bd;
  }
  .xyle-change-arrow {
    display: none;
  }
  .xyle-locate-button,
  .xyle-undo-button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex: none;
    min-height: 2rem;
    padding: 0 0.6rem;
    border: 1px solid transparent;
    border-radius: var(--xyle-radius-sm);
    background: transparent;
    color: var(--xyle-muted);
    font: 600 12px var(--xyle-font-ui);
    cursor: pointer;
  }
  .xyle-locate-button:hover,
  .xyle-locate-button:focus-visible,
  .xyle-undo-button:hover,
  .xyle-undo-button:focus-visible {
    border-color: transparent;
    background: var(--xyle-accent-soft);
    color: #a1b69a;
  }
  .xyle-action-icon {
    width: 14px;
    height: 14px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }
  .xyle-empty-state {
    margin: 1rem 0;
    padding: 1rem;
    border: 1px dashed var(--xyle-line);
    border-radius: var(--xyle-radius-md);
    color: var(--xyle-muted);
    font-size: 13px;
    line-height: 1.45;
  }
  .xyle-inline-confirmation {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 2147483647;
    display: grid;
    gap: 0.6rem;
    width: min(24rem, calc(100vw - 2rem));
    box-sizing: border-box;
    padding: 0.85rem;
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-md);
    background: var(--xyle-surface);
    box-shadow: none;
    color: var(--xyle-ink);
    font-size: 12px;
  }
  .xyle-inline-confirmation p {
    margin: 0;
  }
  .xyle-inline-confirmation-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .xyle-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .xyle-media-search {
    width: 100%;
    margin-bottom: 0.75rem;
    padding: 0.65rem 0.7rem;
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-sm);
    background: #141513;
    color: var(--xyle-ink);
    font: 500 13px var(--xyle-font-ui);
  }
  .xyle-media-search::placeholder {
    color: #777b73;
  }
  .xyle-media-tabs {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.8rem;
  }
  .xyle-media-help {
    margin: -0.2rem 0 0.8rem;
    color: var(--xyle-muted);
    font-size: 11px;
    line-height: 1.4;
  }
  .xyle-media-tab {
    flex: 1;
    min-height: 2rem;
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-sm);
    background: transparent;
    color: var(--xyle-muted);
    font: 600 12px var(--xyle-font-ui);
    cursor: pointer;
  }
  .xyle-media-tab:hover,
  .xyle-media-tab[aria-pressed="true"] {
    border-color: var(--xyle-accent);
    background: var(--xyle-accent-soft);
    color: #a1b69a;
  }
  .xyle-media-grid {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
    align-content: start;
    gap: 0.55rem;
    overflow: auto;
  }
  .xyle-media-cell {
    position: relative;
    min-width: 0;
    padding: 0.28rem;
    border: 1px solid var(--xyle-line);
    border-radius: var(--xyle-radius-sm);
    background: var(--xyle-raised);
    cursor: pointer;
  }
  .xyle-media-cell:hover {
    border-color: var(--xyle-accent);
    background: var(--xyle-accent-soft);
  }
  .xyle-media-cell.is-current {
    border-color: #a8bea5;
    box-shadow: 0 0 0 1px #a8bea5;
  }
  .xyle-media-current {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    padding: 0.18rem 0.38rem;
    border-radius: 999px;
    background: #17201be8;
    color: #eef3ec;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }
  .xyle-media-thumb {
    display: block;
    width: 100%;
    height: 4.7rem;
    border-radius: 4px;
    object-fit: cover;
  }
  .xyle-media-upload {
    min-height: 2.45rem;
    margin-top: 0.8rem;
    border: 1px solid var(--xyle-accent);
    border-radius: var(--xyle-radius-sm);
    background: var(--xyle-accent);
    color: #fff;
    font: 600 12px var(--xyle-font-ui);
    cursor: pointer;
  }
  .xyle-media-upload:hover {
    background: var(--xyle-accent-hover);
  }
  .xyle-menu-item {
    display: block;
    width: 100%;
    padding: 0.65rem 0.8rem;
    border: 0;
    background: transparent;
    color: var(--xyle-ink);
    text-align: left;
    font: 500 12px / 1.2 var(--xyle-font-ui);
    cursor: pointer;
  }
  .xyle-menu-item:hover {
    background: var(--xyle-accent-soft);
    color: #a1b69a;
  }
  .xyle-menu-separator {
    height: 1px;
    margin: 0.2rem 0;
    background: var(--xyle-line);
  }

  @media (hover: none), (pointer: coarse) {
    #xyle-control-dock[data-hidden] {
      transform: translateX(-50%);
    }
    #xyle-control-hitbox {
      pointer-events: none;
    }
    #xyle-dock-handle {
      min-width: 88px;
      min-height: 44px;
    }
    #xyle-dock-handle .xyle-brand-logo {
      width: 18px;
      height: 18px;
    }
    .xyle-icon-button,
    #xyle-media-drawer .xyle-icon-button,
    #xyle-changes-drawer .xyle-icon-button,
    #xyle-seo-drawer .xyle-icon-button,
    #xyle-structure-drawer .xyle-icon-button {
      width: 44px;
      height: 44px;
    }
    .xyle-menu-item,
    .xyle-dialog-button,
    .xyle-undo-button,
    .xyle-media-tab,
    .xyle-media-cell,
    .xyle-media-upload,
    .xyle-structure-button,
    .xyle-structure-locate,
    #xyle-overlay-root button {
      min-width: 44px;
      min-height: 44px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    #xyle-flash,
    #xyle-control-dock,
    .xyle-icon-button {
      transition: none;
    }
  }
}

@layer xyle.overlay {
  #xyle-overlay-root {
    all: initial !important;
    color: var(--xyle-ink) !important;
    font-family: var(--xyle-font-ui) !important;
    font-size: 14px !important;
    line-height: 1.3 !important;
    position: fixed !important;
    inset: 0 !important;
    display: block !important;
    pointer-events: none !important;
    z-index: 2147483646 !important;
    isolation: isolate !important;
  }

  [data-xyle-node] {
    outline: 0 !important;
    cursor: text;
  }
  img[data-xyle-node] {
    cursor: pointer;
  }

  #xyle-overlay-root .xyle-editable-outline {
    all: initial;
    position: absolute !important;
    display: block !important;
    box-sizing: border-box !important;
    pointer-events: none !important;
    border: 2px dashed #a1b69a !important;
    border-radius: 8px !important;
    background: transparent !important;
    opacity: 1 !important;
  }

  #xyle-overlay-root .xyle-editable-outline.is-active,
  #xyle-overlay-root .xyle-editable-outline.is-editing {
    border: 2px solid #667a61 !important;
  }

  #xyle-overlay-root .xyle-img-tools,
  #xyle-overlay-root .xyle-link-tools,
  #xyle-overlay-root .xyle-format-tools,
  #xyle-overlay-root .xyle-section-tools {
    all: initial;
    position: fixed !important;
    display: flex !important;
    gap: 2px !important;
    padding: 3px !important;
    border: 1px solid #ffffff2e !important;
    border-radius: 9px !important;
    background: #17201bf2 !important;
    pointer-events: auto !important;
    isolation: isolate !important;
  }
  #xyle-overlay-root .xyle-format-tools {
    align-items: center !important;
  }
  #xyle-overlay-root .xyle-section-tools {
    align-items: center !important;
    justify-content: center !important;
    flex-wrap: wrap !important;
    max-width: min(36rem, calc(100vw - 16px)) !important;
  }
  #xyle-overlay-root .xyle-layout-tools,
  #xyle-overlay-root .xyle-section-action-tools {
    display: flex !important;
    align-items: center !important;
    gap: 2px !important;
  }
  #xyle-overlay-root .xyle-section-action-tools {
    padding-left: 5px !important;
    border-left: 1px solid #ffffff2e !important;
  }
  #xyle-overlay-root .xyle-tool-group-label {
    padding: 0 6px !important;
    color: #aab6aa !important;
    font: 700 9px / 1 var(--xyle-font-ui) !important;
    letter-spacing: 0.08em !important;
    text-transform: uppercase !important;
  }
  #xyle-overlay-root .xyle-section-tools button[data-state="on"] {
    background: #a8bea5 !important;
    color: #142018 !important;
  }
  #xyle-overlay-root .xyle-format-tools [role="separator"] {
    width: 1px !important;
    height: 20px !important;
    margin: 0 2px !important;
    background: #ffffff2e !important;
  }
  #xyle-overlay-root .xyle-format-tools select {
    all: initial !important;
    appearance: none !important;
    min-height: 28px !important;
    box-sizing: border-box !important;
    padding: 0 24px 0 9px !important;
    border: 0 !important;
    border-radius: 6px !important;
    background-color: transparent !important;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='m1 1 4 4 4-4' fill='none' stroke='%23aab6aa' stroke-width='1.5'/%3E%3C/svg%3E") !important;
    background-repeat: no-repeat !important;
    background-position: right 8px center !important;
    background-size: 8px 5px !important;
    color: #eef3ec !important;
    font: 600 11px / 26px var(--xyle-font-ui) !important;
    cursor: pointer !important;
  }
  #xyle-overlay-root .xyle-format-tools select:hover,
  #xyle-overlay-root .xyle-format-tools select:focus-visible {
    background-color: #ffffff1f !important;
  }
  #xyle-overlay-root .xyle-format-tools option {
    background: #17201b !important;
    color: #eef3ec !important;
  }

  #xyle-overlay-root .xyle-inline-tool-form {
    display: grid !important;
    grid-template-columns: minmax(10rem, 1fr) auto;
    align-items: center;
    gap: 0.35rem 0.4rem;
    min-width: min(20rem, calc(100vw - 1rem));
    padding: 0.25rem;
    color: #eef3ec;
    font: 500 11px / 1.2 var(--xyle-font-ui);
  }
  #xyle-overlay-root .xyle-inline-tool-label {
    display: grid;
    gap: 0.25rem;
    color: #aab6aa;
    font-size: 10px;
    font-weight: 600;
  }
  #xyle-overlay-root .xyle-inline-tool-input {
    width: 100%;
    min-width: 0;
    min-height: 28px;
    box-sizing: border-box;
    padding: 0.35rem 0.55rem;
    border: 1px solid #435047;
    border-radius: 5px;
    background: #10130f;
    color: #eef3ec;
    font: 500 11px / 1.2 var(--xyle-font-ui);
  }
  #xyle-overlay-root .xyle-inline-tool-input:focus {
    border-color: #a1b69a;
    outline: 2px solid var(--xyle-accent-soft);
    outline-offset: 1px;
  }
  #xyle-overlay-root .xyle-inline-tool-check {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 28px;
    color: #aab6aa;
    white-space: nowrap;
  }
  #xyle-overlay-root .xyle-inline-tool-help {
    grid-column: 1 / -1;
    margin: 0;
    color: #aab6aa;
    font-size: 10px;
    line-height: 1.35;
  }
  #xyle-overlay-root .xyle-alt-form .xyle-inline-tool-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
  #xyle-overlay-root .xyle-inline-tool-error {
    display: block;
    grid-column: 1 / -1;
    margin: 0;
    color: #ffb0a8;
    font-size: 10px;
  }
  #xyle-overlay-root .xyle-inline-tool-error:empty {
    display: none;
  }
  #xyle-overlay-root .xyle-inline-tool-actions {
    display: flex;
    gap: 4px;
  }
  #xyle-overlay-root .xyle-inline-tool-actions button {
    min-width: 56px !important;
    justify-content: center !important;
    text-align: center !important;
  }
  #xyle-overlay-root .xyle-img-tools button,
  #xyle-overlay-root .xyle-link-tools button,
  #xyle-overlay-root .xyle-format-tools button,
  #xyle-overlay-root .xyle-section-tools button {
    all: initial !important;
    min-height: 28px !important;
    padding: 0 9px !important;
    border: 0 !important;
    border-radius: 6px !important;
    background: transparent !important;
    color: #eef3ec !important;
    font:
      600 11px / 1.2 var(--xyle-font-ui) !important;
    cursor: pointer !important;
    touch-action: manipulation !important;
  }

  #xyle-overlay-root .xyle-img-tools button:hover,
  #xyle-overlay-root .xyle-link-tools button:hover,
  #xyle-overlay-root .xyle-format-tools button:hover,
  #xyle-overlay-root .xyle-section-tools button:hover,
  #xyle-overlay-root .xyle-img-tools button:focus-visible,
  #xyle-overlay-root .xyle-link-tools button:focus-visible,
  #xyle-overlay-root .xyle-format-tools button:focus-visible,
  #xyle-overlay-root .xyle-section-tools button:focus-visible {
    background: #ffffff1f !important;
  }

  #xyle-overlay-root .xyle-img-tools button:focus-visible,
  #xyle-overlay-root .xyle-link-tools button:focus-visible,
  #xyle-overlay-root .xyle-format-tools button:focus-visible,
  #xyle-overlay-root .xyle-format-tools select:focus-visible {
    outline: 2px solid #a8bea5 !important;
    outline-offset: -1px !important;
  }
  #xyle-overlay-root .xyle-format-tools button[data-state="on"] {
    background: #a8bea5 !important;
    color: #142018 !important;
  }
  #xyle-overlay-root .xyle-format-tools button[data-state="mixed"] {
    background: #ffffff38 !important;
    box-shadow: inset 0 -2px 0 #a8bea5 !important;
  }

  @media (hover: none), (pointer: coarse) {
    #xyle-overlay-root .xyle-img-tools button,
    #xyle-overlay-root .xyle-link-tools button,
    #xyle-overlay-root .xyle-format-tools button,
    #xyle-overlay-root .xyle-section-tools button {
      min-width: 44px !important;
      min-height: 44px !important;
    }
  }

  #xyle-overlay-root .xyle-marker {
    position: absolute !important;
    display: block !important;
    width: 7px !important;
    height: 7px !important;
    border: 1px solid #fff !important;
    border-radius: 999px !important;
    background: #667a61 !important;
  }

  @media (prefers-reduced-motion: reduce) {
    #xyle-overlay-root .xyle-editable-outline {
      transition: none !important;
    }
  }
}

@layer xyle.diffs {
  :root {
    --xyle-ink: #e7ebe8;
    --xyle-muted: #8f9992;
    --xyle-surface: #101311;
    --xyle-raised: #171b18;
    --xyle-line: #2b342e;
    --xyle-accent: #667a61;
    --xyle-accent-hover: #81977b;
    --xyle-accent-soft: #667a6126;
  }

  #xyle-flash {
    background: #101311f5;
    font-size: 12px;
  }

  #xyle-dock-handle {
    border-color: var(--xyle-line);
    background: #171b18f5;
    color: var(--xyle-muted);
    font: 600 10px / 1 var(--xyle-font-ui);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  #xyle-dock-handle:hover,
  #xyle-dock-handle:focus-visible {
    background: #202820;
    color: var(--xyle-ink);
  }

  #xyle-control-bar {
    background: #101311f5;
  }

  .xyle-icon-button {
    color: var(--xyle-muted);
  }

  .xyle-icon-button:hover,
  .xyle-icon-button:focus-visible {
    background: #ffffff0d;
    color: var(--xyle-ink);
  }

  #xyle-editables[aria-pressed="true"],
  .xyle-icon-button[aria-expanded="true"] {
    background: var(--xyle-accent-soft);
    color: #b5c8b0;
  }

  .xyle-count-badge {
    border-color: #101311;
    background: var(--xyle-accent);
    color: #f3f7f2;
  }

  .xyle-icon-button[data-tooltip]::after {
    background: #202620;
    font-size: 11px;
  }

  #xyle-menu {
    background: #171b18;
  }

  .xyle-menu-item {
    color: var(--xyle-muted);
    font-size: 11px;
  }

  .xyle-menu-item:hover,
  .xyle-menu-item:focus-visible {
    background: var(--xyle-accent-soft);
    color: var(--xyle-ink);
  }

  .xyle-drawer {
    border-left-color: var(--xyle-line);
    background: #101311;
    font-family: var(--xyle-font-ui) !important;
  }

  .xyle-drawer * {
    font-family: inherit !important;
  }

  .xyle-drawer-header {
    border-bottom: 1px solid var(--xyle-line);
  }
  .xyle-seo-drawer .xyle-dialog-form {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0;
    overflow: auto;
  }
  .xyle-seo-drawer .xyle-drawer-actions {
    margin-top: auto;
  }

  .xyle-drawer-header strong,
  .xyle-change-label,
  .xyle-dialog-heading strong {
    letter-spacing: 0;
  }

  .xyle-drawer-header strong {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .xyle-drawer-title-icon {
    width: 16px;
    height: 16px;
    flex: none;
    fill: none;
    stroke: var(--xyle-accent-hover);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.6;
  }

  .xyle-changes-count {
    color: var(--xyle-muted);
    font-size: 11px;
    font-weight: 500;
  }

  .xyle-drawer-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .xyle-media-cell,
  .xyle-empty-state {
    background: #171b18;
  }
  .xyle-media-grid .xyle-empty-state {
    grid-column: 1 / -1;
  }

  .xyle-change-row {
    cursor: pointer;
  }

  .xyle-change-row.is-located {
    background: #1d2a1f;
  }

  .xyle-change-value {
    font-family: var(--xyle-font-mono);
    font-size: 11px;
  }

  .xyle-change-before {
    background: #2a1c1d;
  }

  .xyle-change-after {
    background: #17251a;
  }

  dialog.xyle-dialog {
    background: #101311;
  }

  .xyle-dialog-input,
  .xyle-media-search {
    background: #0b0e0c;
  }

  .xyle-drawer-actions .xyle-dialog-button {
    width: 100%;
    margin: 0;
  }

  .xyle-drawer-actions #xyle-discard {
    grid-column: 1;
    grid-row: 1;
  }

  .xyle-drawer-actions #xyle-drawer-publish {
    grid-column: 2;
    grid-row: 1;
  }

  #xyle-overlay-root .xyle-img-tools,
  #xyle-overlay-root .xyle-link-tools {
    background: #101311f5 !important;
  }

  #xyle-overlay-root .xyle-img-tools button,
  #xyle-overlay-root .xyle-link-tools button {
    color: var(--xyle-muted) !important;
    font-family: var(--xyle-font-ui) !important;
    font-size: 10px !important;
    letter-spacing: 0.02em;
  }

  #xyle-overlay-root .xyle-img-tools button:hover,
  #xyle-overlay-root .xyle-link-tools button:hover,
  #xyle-overlay-root .xyle-img-tools button:focus-visible,
  #xyle-overlay-root .xyle-link-tools button:focus-visible {
    background: var(--xyle-accent-soft) !important;
    color: var(--xyle-ink) !important;
  }
}
`;
