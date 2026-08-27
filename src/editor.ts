// Xyle editor shell — browser-side control layer.
// Drafts live only in memory; publish patches original static source server-side.

import {
  registerWebMcpTools,
  type ContentResult,
  type EditableContent,
  type TextUpdateResult,
} from "./webmcp.ts";

const editorStyles = `
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
  #xyle-editables[aria-pressed="true"] {
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
  .xyle-dialog-error {
    min-height: 1.1rem;
    margin: 0;
    color: var(--xyle-danger);
    font-size: 12px;
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
  .xyle-drawer-header strong {
    display: block;
    font-size: 16px;
    letter-spacing: -0.02em;
  }
  #xyle-media-drawer .xyle-icon-button,
  #xyle-changes-drawer .xyle-icon-button {
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
  #xyle-changes-drawer .xyle-icon-button:focus-visible {
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
  .xyle-change-row {
    display: grid;
    gap: 0.65rem;
    padding: 0.75rem 0;
    border: 0;
    border-bottom: 1px solid var(--xyle-line);
    background: transparent;
    cursor: pointer;
  }
  .xyle-change-row:hover,
  .xyle-change-row:focus-visible {
    outline: none;
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
  .xyle-change-row-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.25rem;
  }
  .xyle-change-comparison {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.35rem;
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
  #xyle-overlay-root .xyle-link-tools {
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

  #xyle-overlay-root .xyle-img-tools button,
  #xyle-overlay-root .xyle-link-tools button {
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
  #xyle-overlay-root .xyle-img-tools button:focus-visible,
  #xyle-overlay-root .xyle-link-tools button:focus-visible {
    background: #ffffff1f !important;
  }

  #xyle-overlay-root .xyle-img-tools button:focus-visible,
  #xyle-overlay-root .xyle-link-tools button:focus-visible {
    outline: 2px solid #a8bea5 !important;
    outline-offset: -1px !important;
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

  #xyle-editables[aria-pressed="true"] {
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

interface NodeMeta {
  id: string;
  pagePath: string;
  kind: "text" | "link" | "image";
  tag?: string;
  multiline?: boolean;
  textEditable?: boolean;
  segmentCount?: number;
}

interface PageData {
  pagePath: string;
  baseDigest: string;
  html: string;
  nodes: NodeMeta[];
}

type Op =
  | { type: "text"; nodeId: string; value: string }
  | { type: "href"; nodeId: string; value: string }
  | { type: "src"; nodeId: string; value: string; assetName?: string }
  | { type: "alt"; nodeId: string; value: string };

interface PageOps {
  pagePath: string;
  baseDigest: string;
  operations: Op[];
}

interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
  assetPaths: string[];
}

const MAX_HISTORY = 100;
let focusedChangeTarget: HTMLElement | null = null;

const state = {
  current: null as PageData | null,
  ops: [] as { pagePath: string; op: Op }[],
  history: [] as HistoryEntry[],
  historyIndex: 0,
  assets: new Map<string, { file: File; objectUrl: string }>(),
  publishedSnapshotDigest: "",
};
let unregisterWebMcp: (() => void) | null = null;

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T =>
  root.querySelector(sel) as T;

/** Test observability hook (read-only). */
function exposeTestHook(): void {
  // SAFETY: the test-only hook is intentionally attached to the browser global.
  (window as unknown as { __xyle: unknown }).__xyle = {
    get ops(): unknown[] {
      return state.ops.map((entry) => ({ pagePath: entry.pagePath, op: entry.op }));
    },
    get count(): number {
      return state.ops.length;
    },
    get mode(): string {
      return interactionMode;
    },
  };
}

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, init);
}

function flash(message: string): void {
  const el = $("#xyle-flash");
  el.textContent = message;
  el.classList.add("visible");
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el.classList.remove("visible"), 1800);
}
let flashTimer = 0;

async function boot(): Promise<void> {
  const session = await (await api("/__xyle/api/session")).json();
  if (!session.authenticated) {
    location.assign("/edit");
    return;
  }

  buildChrome();
  void detectMediaSupport();
  exposeTestHook();
  const params = new URLSearchParams(location.search);
  await loadPage(params.get("page") ?? "/index.html", { pushHistory: false });

  unregisterWebMcp = await registerWebMcpTools({
    listEditableContent,
    getContent,
    updateText,
  });

  window.addEventListener("beforeunload", (event) => {
    if (dirtyCount() > 0) {
      // preventDefault alone does not trigger the browser dialog
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function loadPage(pagePath: string, opts: { pushHistory: boolean }): Promise<void> {
  const res = await api(`/__xyle/api/page?path=${encodeURIComponent(pagePath)}`);
  if (!res.ok) {
    flash("That page could not be loaded.");
    return;
  }
  const data = (await res.json()) as PageData & { baseDigest: string };
  closeMediaDrawer(false);
  closeChangesDrawer(false);
  closeContextTools(false);
  hoveredCandidate = null;
  window.clearTimeout(hoverClearTimer);
  setInteractionMode("idle");
  selectedImage = null;
  mediaMutationGeneration += 1;
  state.current = data;
  cachedBaseDigest.set(data.pagePath, data.baseDigest);
  const pagePathLabel = $("#xyle-page-path");
  const pageNameLabel = $("#xyle-page-name");
  if (pagePathLabel) pagePathLabel.textContent = data.pagePath;
  if (pageNameLabel) {
    const fileName = data.pagePath.split("/").filter(Boolean).at(-1) ?? "home";
    pageNameLabel.textContent = fileName === "index.html" ? "Home page" : fileName;
  }
  state.publishedSnapshotDigest = state.publishedSnapshotDigest || (await snapshotDigest());

  renderPreview();
  if (opts.pushHistory) {
    try {
      const url = new URL(location.href);
      url.searchParams.set("page", data.pagePath);
      history.replaceState(null, "", url);
    } catch {
      // The browser location is normally valid; keep the current URL if it is not.
    }
  }
}

let iframe: HTMLIFrameElement;

function renderPreview(): void {
  const host = $("#xyle-preview-host");
  host.innerHTML = "";
  iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.title = "Editable website preview";
  iframe.id = "xyle-preview";
  iframe.style.cssText = "display:block;width:100%;height:100%;border:0;background:#fff";
  iframe.addEventListener("load", () => wirePreview(), { once: true });
  host.append(iframe);
  iframe.srcdoc = state.current!.html;
  let attempts = 0;
  const retryWire = (): void => {
    if (iframe.contentDocument?.querySelector("[data-xyle-node]")) wirePreview();
    if (!iframe.contentDocument?.body?.dataset.xyleWired && attempts++ < 40)
      window.setTimeout(retryWire, 50);
  };
  window.setTimeout(retryWire, 0);
}

function previewDoc(): Document | null {
  return iframe?.contentDocument ?? null;
}

function shellOverlay(): HTMLElement | null {
  return document.getElementById("xyle-overlay-root");
}

interface ViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function previewElementRect(el: HTMLElement): ViewportRect {
  const frameRect = iframe.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  return {
    left: frameRect.left + rect.left,
    top: frameRect.top + rect.top,
    right: frameRect.left + rect.right,
    bottom: frameRect.top + rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function wirePreview(): void {
  const doc = previewDoc();
  if (!doc || !state.current || !doc.querySelector("[data-xyle-node]")) return;
  if (doc.body.dataset.xyleWired === "true") return;
  doc.body.dataset.xyleWired = "true";
  doc.defaultView?.addEventListener("scroll", scheduleOverlayRefresh, { passive: true });
  doc.addEventListener(
    "pointerdown",
    () => {
      const menu = document.getElementById("xyle-menu");
      if (!menu || menu.style.display === "none") return;
      menu.style.display = "none";
      document.getElementById("xyle-menu-btn")?.setAttribute("aria-expanded", "false");
    },
    true,
  );
  const focusStyle = doc.createElement("style");
  focusStyle.id = "xyle-preview-focus-style";
  focusStyle.textContent =
    "[data-xyle-node]:focus, [data-xyle-node]:focus-visible { outline: 0 !important; }";
  doc.head.append(focusStyle);

  metaById.clear();
  for (const meta of state.current.nodes) metaById.set(meta.id, meta);

  for (const el of doc.querySelectorAll<HTMLElement>("[data-xyle-node]")) {
    const id = el.getAttribute("data-xyle-node")!;
    wireCandidate(el, metaById.get(id));
  }
  doc.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target as Node | null;
      if (session && target && !session.el.contains(target)) commitEdit();
      const targetElement =
        target?.nodeType === Node.ELEMENT_NODE
          ? (target as Element)
          : ((target as ChildNode | null)?.parentElement ?? null);
      const targetNode = targetElement?.closest?.("[data-xyle-node]") as HTMLElement | null;
      const targetNodeId = targetNode?.getAttribute("data-xyle-node");
      const activeNodeId = activeToolsTarget?.getAttribute("data-xyle-node");
      if (activeTools && targetNodeId !== activeNodeId) closeContextTools(false);
      if (selectedImage && targetElement !== selectedImage.el && targetNodeId !== activeNodeId) {
        hideImageTools(selectedImage.el);
        selectedImage = null;
      }
    },
    true,
  );

  // suppress all navigation inside the preview; route through the shell
  doc.body.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;
    event.preventDefault();
    if (anchor.hasAttribute("data-xyle-node")) return; // link editing handles it
    handlePreviewNavigation(anchor as HTMLAnchorElement);
  });
  doc.body.addEventListener("submit", (e) => e.preventDefault(), true);

  // global shortcuts must also fire while focus is inside the preview
  doc.body.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (!(keyboardEvent.ctrlKey || keyboardEvent.metaKey)) return;
    if (keyboardEvent.key !== "z" && keyboardEvent.key !== "Z" && keyboardEvent.key !== "y") {
      return;
    }
    if (keyboardEvent.key === "z" || keyboardEvent.key === "Z") {
      // inside an active field the browser's native undo wins
      if (!session) {
        event.preventDefault();
        if (keyboardEvent.shiftKey) redo();
        else undo();
      }
    } else if (!session) {
      event.preventDefault();
      redo();
    }
  });

  restoreOpsIntoDom();
  applyShowEditables();
  refreshEditabilityOverlay();
}

const metaById = new Map<string, NodeMeta>();
const controlledBreaks = new WeakSet<HTMLBRElement>();
let showEditables = false;

type InteractionMode = "idle" | "hover" | "editing" | "popover" | "drawer";

let interactionMode: InteractionMode = "idle";
let hoveredCandidate: HTMLElement | null = null;
let hoverClearTimer = 0;
let activeTools: HTMLElement | null = null;
let activeToolsTarget: HTMLElement | null = null;
let activeToolsReturnFocus: HTMLElement | null = null;
type ContextToolPlacement = "above" | "below" | "inside-bottom";
let activeToolsPlacement: ContextToolPlacement = "below";

function setInteractionMode(mode: InteractionMode): void {
  interactionMode = mode;
}

function beginCandidateHover(el: HTMLElement): void {
  window.clearTimeout(hoverClearTimer);
  if (hoveredCandidate && hoveredCandidate !== el) {
    hoveredCandidate.classList.remove("xyle-hover");
  }
  hoveredCandidate = el;
  el.classList.add("xyle-hover");
  if (!session && !activeTools) setInteractionMode("hover");
  refreshEditabilityOverlay();
}

function endCandidateHover(el: HTMLElement): void {
  window.clearTimeout(hoverClearTimer);
  hoverClearTimer = window.setTimeout(() => {
    if (hoveredCandidate !== el || activeToolsTarget === el || session?.el === el) return;
    el.classList.remove("xyle-hover");
    hoveredCandidate = null;
    if (!session && !activeTools) setInteractionMode("idle");
    refreshEditabilityOverlay();
  }, 140);
}

function closeContextTools(restoreFocus = true): void {
  if (activeTools) activeTools.remove();
  activeTools = null;
  const target = activeToolsReturnFocus ?? activeToolsTarget;
  activeToolsTarget = null;
  activeToolsReturnFocus = null;
  activeToolsPlacement = "below";
  if (!session) setInteractionMode("idle");
  refreshEditabilityOverlay();
  if (restoreFocus && target?.isConnected) target.focus();
}

function registerContextTools(
  tools: HTMLElement,
  target: HTMLElement,
  placement: ContextToolPlacement,
): void {
  closeContextTools(false);
  activeTools = tools;
  activeToolsTarget = target;
  activeToolsReturnFocus = target;
  activeToolsPlacement = placement;
  setInteractionMode("popover");
  tools.addEventListener("mouseenter", () => window.clearTimeout(hoverClearTimer));
  tools.addEventListener("mouseleave", () => scheduleContextToolsClose(target));
  tools.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (
        activeTools === tools &&
        !tools.matches(":focus-within") &&
        !tools.matches(":hover") &&
        !session
      ) {
        closeContextTools(false);
      }
    }, 0);
  });
  refreshEditabilityOverlay();
}

function scheduleContextToolsClose(target: HTMLElement): void {
  window.clearTimeout(hoverClearTimer);
  hoverClearTimer = window.setTimeout(() => {
    if (activeToolsTarget === target && !activeTools?.matches(":hover") && !session) {
      closeContextTools(false);
    }
  }, 180);
}

function handlePreviewNavigation(anchor: HTMLAnchorElement): void {
  const href = anchor.getAttribute("href") ?? "";
  if (/^(https?:)?\/\//i.test(href) || /^(mailto|tel):/i.test(href)) {
    flash("External links do not navigate in edit mode.");
    return;
  }
  try {
    const resolved = new URL(href, `${location.origin}${state.current!.pagePath}`);
    loadPage(resolved.pathname, { pushHistory: true }).then(() => {
      // re-apply pending text ops for this page after reload
      restoreOpsIntoDom();
    });
  } catch {
    flash("That link could not be followed.");
  }
}

/* ---------- candidate wiring ---------- */

function wireCandidate(el: HTMLElement, meta: NodeMeta | undefined): void {
  if (!meta) return;
  if (el.tabIndex < 0) el.tabIndex = 0;
  el.addEventListener("mouseenter", () => beginCandidateHover(el));
  el.addEventListener("mouseleave", () => endCandidateHover(el));
  el.addEventListener("focus", () => {
    if (!session && !activeTools) setInteractionMode("hover");
    refreshEditabilityOverlay();
  });
  el.addEventListener("blur", () => {
    if (!session && !activeTools) setInteractionMode("idle");
    refreshEditabilityOverlay();
  });

  if (meta.kind === "text" && meta.textEditable) wireText(el, meta);
  if (meta.kind === "link") wireLink(el, meta);
  if (meta.kind === "image") wireImage(el, meta);
}

let overlayRefreshFrame = 0;

function scheduleOverlayRefresh(): void {
  if (overlayRefreshFrame) return;
  overlayRefreshFrame = window.requestAnimationFrame(() => {
    overlayRefreshFrame = 0;
    refreshEditabilityOverlay();
    refreshMarkers();
    if (activeToolsTarget && activeTools?.isConnected) {
      positionContextTools(
        activeTools,
        previewElementRect(activeToolsTarget),
        activeToolsPlacement,
      );
    }
  });
}

function refreshEditabilityOverlay(): void {
  const doc = previewDoc();
  const overlay = shellOverlay();
  if (!doc || !overlay) return;

  overlay.querySelectorAll(".xyle-editable-outline").forEach((overlayItem) => {
    overlayItem.remove();
  });
  for (const el of doc.querySelectorAll<HTMLElement>("[data-xyle-node]")) {
    const isEditing = el.classList.contains("xyle-editing");
    const isHovered = el.classList.contains("xyle-hover");
    const isChangeFocused = focusedChangeTarget === el;
    const isSelected = isEditing || isChangeFocused || el.matches(":focus-visible");
    if (!showEditables && !isHovered && !isSelected) continue;

    const rect = previewElementRect(el);
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const left = Math.max(0, rect.left - 4);
    const top = Math.max(0, rect.top - 4);
    const right = Math.min(viewportWidth, rect.right + 4);
    const bottom = Math.min(viewportHeight, rect.bottom + 4);
    if (right <= left || bottom <= top) continue;
    const outline = document.createElement("span");
    outline.className = `xyle-editable-outline${isEditing ? " is-editing" : isSelected ? " is-active" : ""}`;
    outline.style.left = `${left}px`;
    outline.style.top = `${top}px`;
    outline.style.width = `${right - left}px`;
    outline.style.height = `${bottom - top}px`;
    overlay.append(outline);
  }
}

function applyShowEditables(): void {
  const doc = previewDoc();
  doc?.documentElement.classList.toggle("xyle-show-editables", showEditables);
  const button = $("#xyle-editables");
  const label = showEditables ? "Hide editables" : "Show editables";
  button?.setAttribute("aria-pressed", String(showEditables));
  button?.setAttribute("aria-label", label);
  button?.setAttribute("title", label);
  button?.setAttribute("data-tooltip", label);
  refreshEditabilityOverlay();
}

/* ---------- text editing ---------- */

function wireText(el: HTMLElement, meta: NodeMeta): void {
  el.addEventListener("pointerdown", () => {
    if (session?.el === el) return;
    startEdit(el, meta);
  });
  el.addEventListener("keydown", (event) => {
    if (session || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    startEdit(el, meta);
  });
}

interface EditSession {
  el: HTMLElement;
  meta: NodeMeta;
  baselineClone: DocumentFragment;
  /** Baseline segment values in server segment order (document order). */
  baselineValues: string[];
  /** Slot keys aligned with baselineValues. */
  baselineKeys: string[];
  baselineSkeleton: string;
  baselineAuthoredBreakCount: number;
}

let session: EditSession | null = null;

const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "code",
  "pre",
  "input",
  "textarea",
  "select",
  "option",
  "button",
]);

function authoredBreakCount(el: HTMLElement): number {
  return [...el.querySelectorAll("br")].filter((br) => !isControlledBreak(br)).length;
}

function isNestedCandidate(el: HTMLElement, root: HTMLElement): boolean {
  return el !== root && el.hasAttribute("data-xyle-node");
}

/**
 * Structural identity for one server-backed text segment. The element path
 * separates inline descendants; the local run separates direct text nodes on
 * either side of inline elements. Controlled <br> splits stay in the same run.
 */
function isControlledBreak(node: Node): node is HTMLBRElement {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).tagName === "BR" &&
    (controlledBreaks.has(node as HTMLBRElement) ||
      (node as HTMLElement).hasAttribute("data-xyle-controlled-break"))
  );
}

function markControlledBreak(br: HTMLBRElement): void {
  controlledBreaks.add(br);
  br.setAttribute("data-xyle-controlled-break", "");
}

function slotKeyOf(target: Node, root: Node): string {
  const parent = target.parentNode;
  if (!parent) return "";

  const chain: number[] = [];
  let element: Node | null = parent;
  while (element && element !== root && element.parentNode) {
    let index = 0;
    for (const sibling of element.parentNode.childNodes) {
      if (sibling === element) break;
      if (sibling.nodeType === Node.ELEMENT_NODE && (sibling as HTMLElement).tagName !== "BR") {
        index += 1;
      }
    }
    chain.unshift(index);
    element = element.parentNode;
  }

  let run = -1;
  let insideTextRun = false;
  for (const sibling of parent.childNodes) {
    if (sibling.nodeType === Node.TEXT_NODE) {
      if (!insideTextRun) run += 1;
      insideTextRun = true;
    } else if (!isControlledBreak(sibling)) {
      insideTextRun = false;
    }
    if (sibling === target) break;
  }
  return `${chain.join("/")}|${Math.max(run, 0)}`;
}

interface SegmentPair {
  key: string;
  /** Final text for this segment; "\n" marks controlled <br> positions. */
  value: string;
}

/** Mirrors the server's one-segment-per-source-text-node document order. */
function collectSegments(rootEl: HTMLElement): SegmentPair[] {
  const pairs: SegmentPair[] = [];
  const seen = new Map<string, string[]>();

  const walk = (element: HTMLElement): void => {
    let openKey: string | null = null;
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        openKey = slotKeyOf(child, rootEl);
        let parts = seen.get(openKey);
        if (!parts) {
          parts = [""];
          seen.set(openKey, parts);
          pairs.push({ key: openKey, value: "" });
        }
        parts[parts.length - 1] += child.textContent ?? "";
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        openKey = null;
        continue;
      }
      const childEl = child as HTMLElement;
      if (childEl.tagName === "BR") {
        if (openKey !== null && isControlledBreak(childEl)) seen.get(openKey)?.push("");
        else openKey = null;
        continue;
      }
      openKey = null;
      if (SKIP_TAGS.has(childEl.tagName.toLowerCase())) continue;
      if (isNestedCandidate(childEl, rootEl)) continue;
      walk(childEl);
    }
  };
  walk(rootEl);

  for (const pair of pairs) pair.value = (seen.get(pair.key) ?? []).join("\n");
  return pairs;
}

/** Structural skeleton used by post-input validation (elements only). */
function skeleton(el: HTMLElement): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.id === "xyle-overlay-root") return;
    out += `<${element.tagName}>`;
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  for (const child of Array.from(el.childNodes)) walk(child);
  return out;
}

function startEdit(el: HTMLElement, meta: NodeMeta): void {
  if (session) commitEdit();
  const doc = previewDoc()!;
  const baselineClone = doc.createDocumentFragment();
  for (const child of Array.from(el.childNodes)) baselineClone.append(child.cloneNode(true));

  const baselinePairs = collectSegments(el);
  if (meta.segmentCount !== undefined && baselinePairs.length !== meta.segmentCount) {
    flash("This text cannot be edited safely because its source mapping is ambiguous.");
    return;
  }
  session = {
    el,
    meta,
    baselineClone,
    baselineValues: baselinePairs.map((p) => p.value),
    baselineKeys: baselinePairs.map((p) => p.key),
    baselineSkeleton: skeleton(el),
    baselineAuthoredBreakCount: authoredBreakCount(el),
  };

  for (const [i, value] of session.baselineValues.entries()) {
    rememberOriginalSegment(meta.pagePath, `${meta.id}#${i}`, value);
  }

  const hasNoElementChildren = !Array.from(el.children).some((c) => c.tagName !== "BR");
  const plainOnly = meta.segmentCount === 1 && !meta.multiline && hasNoElementChildren;

  // SAFETY: contentEditable accepts the browser's plaintext-only extension.
  (el as unknown as { contentEditable: string }).contentEditable =
    plainOnly && supportsPlaintextOnly() ? "plaintext-only" : "true";
  el.classList.add("xyle-editing");
  setInteractionMode("editing");
  refreshEditabilityOverlay();
  el.focus({ preventScroll: true });

  el.addEventListener("beforeinput", onBeforeInput);
  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("paste", onPaste, true);
}

/** Plain-text-only paste; rich payloads are flattened or refused. */
function onPaste(event: ClipboardEvent): void {
  if (!session) return;
  const text = event.clipboardData?.getData("text/plain");
  const html = event.clipboardData?.getData("text/html");
  event.preventDefault();
  event.stopPropagation();
  if (!text) return;
  if (html && session.meta.segmentCount !== 1 && /<[a-z][\s\S]*>/i.test(html)) {
    flash("Formatted paste is not supported here.");
    return;
  }
  if (text.includes("\n") && !allowedMultiline()) {
    flash("Line breaks are not supported here.");
    return;
  }
  const win = iframe.contentWindow!;
  win.document.execCommand("insertText", false, text);
}

function supportsPlaintextOnly(): boolean {
  const probe = document.createElement("div");
  try {
    probe.contentEditable = "plaintext-only";
    return probe.contentEditable === "plaintext-only";
  } catch {
    return false;
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (!session) return;
  if (event.key === "Escape") {
    event.preventDefault();
    revertEdit();
  }
}

function allowedMultiline(): boolean {
  return session?.meta.multiline === true;
}

/** Selection lives in the preview window, not the shell. */
function previewSelection(): Selection | null {
  return iframe?.contentWindow?.getSelection() ?? null;
}

function selectionInsideEditable(): boolean {
  const selection = previewSelection();
  if (!selection || selection.rangeCount === 0 || !session) return false;
  return session.el.contains(selection.anchorNode) && session.el.contains(selection.focusNode);
}

function onBeforeInput(event: InputEvent): void {
  if (!session) return;
  switch (event.inputType) {
    case "insertParagraph":
    case "insertLineBreak": {
      event.preventDefault();
      if (!allowedMultiline() || !selectionInsideEditable()) {
        flash("Line breaks are not supported here.");
        return;
      }
      insertManualBr();
      dispatchSyntheticInput(session.el);
      return;
    }
    case "formatBold":
    case "formatItalic":
    case "formatUnderline":
    case "formatStrikeThrough":
    case "insertHorizontalRule":
    case "insertOrderedList":
    case "insertUnorderedList": {
      event.preventDefault();
      flash("Formatting commands are not available.");
      return;
    }
    case "insertFromPaste": {
      const htmlData = event.dataTransfer?.getData("text/html");
      if (htmlData && !(session.meta.segmentCount === 1)) {
        event.preventDefault();
        flash("Formatted paste is not supported here.");
        return;
      }
      // plain text paste flows through normal input path
      return;
    }
    default:
      return; // structural damage is caught by post-input validation
  }
}

function insertManualBr(): void {
  const selection = previewSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const doc = previewDoc()!;
  range.deleteContents();
  const br = doc.createElement("br");
  markControlledBreak(br);
  range.insertNode(br);
  range.setStartAfter(br);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function dispatchSyntheticInput(el: HTMLElement): void {
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "\n" }));
}

function onInput(_event: Event): void {
  if (!session) return;
  validateStructure();
}

/** Second guard: revert any developer-owned structure change. */
function validateStructure(): void {
  if (!session) return;
  if (!structureAllowed(skeleton(session.el), session.baselineSkeleton)) {
    flash("That change was reverted to protect your design.");
    restoreBaseline();
  }
}

/** Only text mutations plus multiline <br> changes may pass. */
function structureAllowed(current: string, baseline: string): boolean {
  if (current === baseline) return true;
  const strip = (s: string) => s.replaceAll("<BR>", "");
  const allowed = session?.meta.multiline === true && strip(current) === strip(baseline);
  return allowed;
}

function restoreBaseline(): void {
  if (!session) return;
  const { el, baselineClone } = session;
  el.innerHTML = "";
  for (const child of Array.from(baselineClone.childNodes)) el.append(child.cloneNode(true));
}

function revertEdit(): void {
  if (!session) return;
  restoreBaseline();
  endEdit(false);
}

function commitEdit(): void {
  if (!session) return;
  const currentPairs = collectSegments(session.el);
  const changed = currentPairs.some((pair, i) => pair.value !== session?.baselineValues[i]);
  endEdit(changed);
}

function endEdit(recordChanges: boolean): void {
  const s = session!;
  s.el.removeEventListener("beforeinput", onBeforeInput);
  s.el.removeEventListener("input", onInput);
  s.el.removeEventListener("keydown", onKeyDown);
  s.el.removeEventListener("paste", onPaste, true);
  s.el.classList.remove("xyle-editing");
  refreshEditabilityOverlay();
  // SAFETY: contentEditable is set explicitly when ending an edit session.
  (s.el as unknown as { contentEditable: string }).contentEditable = "false";

  if (recordChanges) {
    const currentPairs = collectSegments(s.el);
    const mappingChanged =
      currentPairs.length !== s.baselineValues.length ||
      authoredBreakCount(s.el) !== s.baselineAuthoredBreakCount;
    if (mappingChanged) {
      flash("That change was reverted because the browser changed the text structure.");
      restoreBaseline();
    } else {
      for (const [i, pair] of currentPairs.entries()) {
        if (pair.value !== s.baselineValues[i]) {
          applyOp(
            s.meta.pagePath,
            {
              type: "text",
              nodeId: `${s.meta.id}#${i}`,
              value: pair.value,
            },
            "Edit text",
          );
        }
      }
    }
  }
  session = null;
  setInteractionMode(activeTools ? "popover" : hoveredCandidate ? "hover" : "idle");
  updateDirtyUi();
}

/* ---------- link editing ---------- */

function wireLink(el: HTMLElement, meta: NodeMeta): void {
  const show = (event: Event): void => {
    if (session?.el === el) return;
    event.preventDefault();
    event.stopPropagation();
    showLinkTools(el as HTMLAnchorElement, meta, event.type === "keydown");
  };
  el.addEventListener("mouseenter", () => {
    if (!session) showLinkTools(el as HTMLAnchorElement, meta);
  });
  el.addEventListener("mouseleave", () => scheduleContextToolsClose(el));
  el.addEventListener("click", show);
  el.addEventListener("keydown", (event) => {
    if (!session && (event.key === "Enter" || event.key === " ")) show(event);
  });
}

function positionContextTools(
  tools: HTMLElement,
  targetRect: ViewportRect,
  placement: ContextToolPlacement,
): void {
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const toolRect = tools.getBoundingClientRect();
  const maxLeft = Math.max(8, viewportWidth - toolRect.width - 8);
  const left = Math.min(Math.max(targetRect.left, 8), maxLeft);
  const fitsComfortablyInside = targetRect.height >= toolRect.height * 2;
  let top = targetRect.bottom + 6;
  if (placement === "inside-bottom" && fitsComfortablyInside) {
    top = targetRect.bottom - toolRect.height - 6;
  } else if (placement === "above") {
    top = targetRect.top - toolRect.height - 6;
  }
  if (top < 8 && placement === "above") top = targetRect.bottom + 6;
  if (top + toolRect.height > viewportHeight - 8) top = targetRect.top - toolRect.height - 6;
  top = Math.min(Math.max(top, 8), Math.max(8, viewportHeight - toolRect.height - 8));
  // Context controls use viewport coordinates because they are fixed overlays.
  // Adding document scroll offsets would double-count scrolling inside srcdoc.
  tools.style.left = `${left}px`;
  tools.style.top = `${top}px`;
}

function showLinkTools(link: HTMLAnchorElement, meta: NodeMeta, focusFirst = false): void {
  const overlay = shellOverlay();
  if (!overlay) return;
  const tools = document.createElement("div");
  tools.className = "xyle-link-tools";
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", "Link actions");

  if (meta.textEditable) {
    const editText = document.createElement("button");
    editText.type = "button";
    editText.textContent = "Edit text";
    editText.addEventListener("click", (event) => {
      event.stopPropagation();
      closeContextTools(false);
      startEdit(link, meta);
    });
    tools.append(editText);
  }
  const editUrl = document.createElement("button");
  editUrl.type = "button";
  editUrl.textContent = "Edit URL";
  editUrl.addEventListener("click", (event) => {
    event.stopPropagation();
    closeContextTools(false);
    openHrefDialog(link, meta);
  });
  tools.append(editUrl);

  const target = resolveInternalPath(link.getAttribute("href") ?? "");
  if (target) {
    const follow = document.createElement("button");
    follow.type = "button";
    follow.textContent = "Follow";
    follow.addEventListener("click", (event) => {
      event.stopPropagation();
      closeContextTools(false);
      void loadPage(target, { pushHistory: true });
    });
    tools.append(follow);
  }
  tools.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeContextTools();
    }
  });
  registerContextTools(tools, link, "above");
  overlay.append(tools);
  positionContextTools(tools, previewElementRect(link), "above");
  if (focusFirst) tools.querySelector("button")?.focus();
}

function openHrefDialog(el: HTMLElement, meta: NodeMeta): void {
  const dialog = document.createElement("dialog");
  dialog.className = "xyle-dialog";
  dialog.setAttribute("data-xyle-editing-url", "1");
  dialog.setAttribute("aria-labelledby", "xyle-link-dialog-title");
  const currentHref = el.getAttribute("href") ?? "";
  rememberOriginalAttr(meta.pagePath, meta.id, "href", currentHref);
  const internalTarget = resolveInternalPath(currentHref);
  dialog.replaceChildren(
    document.createRange().createContextualFragment(`
    <form method="dialog" class="xyle-dialog-form">
      <div class="xyle-dialog-heading"><span class="xyle-dialog-kicker">Edit link</span><strong id="xyle-link-dialog-title">Link destination</strong></div>
      <label class="xyle-dialog-label">URL or path
        <input class="xyle-dialog-input" name="href" value="" autocomplete="off" aria-describedby="xyle-link-dialog-error">
      </label>
      <p id="xyle-link-dialog-error" class="xyle-dialog-error err" role="status" aria-live="polite"></p>
      <div class="xyle-dialog-actions">
        ${internalTarget ? `<button class="xyle-dialog-button" value="follow">Follow link</button>` : ""}
        <button class="xyle-dialog-button" value="cancel">Cancel</button>
        <button class="xyle-dialog-button xyle-dialog-button--primary" value="save">Save link</button>
      </div>
    </form>`),
  );
  const hrefInput = dialog.querySelector("input") as HTMLInputElement;
  hrefInput.value = currentHref;
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    const value = hrefInput.value;
    if (dialog.returnValue === "save") {
      if (isSafeUrl(value)) {
        applyOp(meta.pagePath, { type: "href", nodeId: meta.id, value }, "Edit link");
        el.setAttribute("href", value);
      } else {
        flash("That destination is not allowed.");
      }
    } else if (dialog.returnValue === "follow") {
      const target = resolveInternalPath(value) ?? internalTarget;
      if (target) {
        loadPage(target, { pushHistory: true }).then(() => restoreOpsIntoDom());
      } else {
        flash("Only internal pages can be followed in edit mode.");
      }
    }
    dialog.remove();
    el.focus();
  });
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    const input = dialog.querySelector("input") as HTMLInputElement;
    const action = ((event as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (action !== "cancel" && !isSafeUrl(input.value)) {
      event.preventDefault();
      (dialog.querySelector(".err") as HTMLElement).textContent =
        "Use a relative path, https:, http:, mailto: or tel:";
      input.setAttribute("aria-invalid", "true");
      input.focus();
    }
  });
  dialog.showModal();
  hrefInput.select();
}

/** Site-internal page path for a link, or null for external/asset targets. */
function resolveInternalPath(href: string): string | null {
  try {
    const url = new URL(href, location.origin + state.current!.pagePath);
    if (url.origin !== location.origin) return null;
    const path = url.pathname;
    if (/\.(html?)$/i.test(path) || path.endsWith("/")) return path;
    return null;
  } catch {
    return null;
  }
}

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  if (/^\s*(javascript|data|vbscript)\s*:/i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed, location.origin);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/* ---------- images & media ---------- */

let selectedImage: { el: HTMLImageElement; meta: NodeMeta } | null = null;
let mediaMutationGeneration = 0;

function wireImage(el: HTMLElement, meta: NodeMeta): void {
  const img = el as HTMLImageElement;
  const select = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    selectImage(img, meta);
    showImageTools(img, meta, event.type === "keydown");
  };
  img.addEventListener("mouseenter", () => {
    if (!session) showImageTools(img, meta);
  });
  img.addEventListener("mouseleave", () => scheduleContextToolsClose(img));
  img.addEventListener("click", select);
  img.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") select(event);
  });
}

function showImageTools(img: HTMLImageElement, meta: NodeMeta, focusFirst = false): void {
  const overlay = shellOverlay();
  if (!overlay) return;
  const tools = document.createElement("div");
  tools.className = "xyle-img-tools";
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", "Image actions");
  tools.dataset.forNode = meta.id;
  const replace = document.createElement("button");
  replace.type = "button";
  replace.textContent = "Replace";
  if (mediaManagementUnavailable) {
    replace.disabled = true;
    replace.title = "Media management is unavailable for this deployment";
  }
  replace.addEventListener("click", (event) => {
    event.stopPropagation();
    pickLocalFile(img, meta);
  });
  const media = document.createElement("button");
  media.type = "button";
  media.textContent = "Media";
  media.disabled = mediaManagementUnavailable;
  media.title = mediaManagementUnavailable
    ? "Media management is unavailable for this deployment"
    : "Choose from the media library";
  media.addEventListener("click", (event) => {
    event.stopPropagation();
    closeContextTools(false);
    selectImage(img, meta);
    void openMediaDrawer(img);
  });
  const alt = document.createElement("button");
  alt.type = "button";
  alt.textContent = "Alt";
  alt.addEventListener("click", (event) => {
    event.stopPropagation();
    closeContextTools(false);
    selectImage(img, meta);
    openAltEditor(img, meta);
  });
  tools.append(replace, media, alt);
  tools.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeContextTools();
      selectedImage = null;
    }
  });
  registerContextTools(tools, img, "above");
  overlay.append(tools);
  positionContextTools(tools, previewElementRect(img), "above");
  if (focusFirst) {
    window.setTimeout(() => {
      if (tools.isConnected) replace.focus();
    }, 0);
  }
}

function hideImageTools(img: HTMLImageElement): void {
  if (activeToolsTarget === img) closeContextTools(false);
  shellOverlay()
    ?.querySelectorAll(`.xyle-img-tools[data-for-node="${img.getAttribute("data-xyle-node")}"]`)
    .forEach((tools) => {
      tools.remove();
    });
}

function pickLocalFile(img: HTMLImageElement, meta: NodeMeta): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp,image/avif";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    await useFileForImage(img, meta, file);
  });
  input.click();
}

async function useFileForImage(img: HTMLImageElement, meta: NodeMeta, file: File): Promise<void> {
  if (mediaManagementUnavailable) {
    flash("Media management is unavailable for this deployment.");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    flash("Images must be 20 MB or smaller.");
    return;
  }
  const mutationGeneration = mediaMutationGeneration;
  const buffer = await file.arrayBuffer();
  if (mutationGeneration !== mediaMutationGeneration) return;
  const bytes = new Uint8Array(buffer);
  const detectedContentType = detectRasterContentType(bytes);
  if (!detectedContentType) {
    flash("Only JPEG, PNG, WebP and AVIF uploads are supported.");
    return;
  }
  rememberOriginalAttr(meta.pagePath, meta.id, "src", img.getAttribute("src") ?? "");
  const digestHex = await sha256Hex(bytes);
  if (mutationGeneration !== mediaMutationGeneration) return;
  const ext = extFor(detectedContentType);
  const assetPath = `/__media/${digestHex}.${ext}`;
  const existingAsset = state.assets.get(assetPath);
  const objectUrl = existingAsset?.objectUrl ?? URL.createObjectURL(file);
  if (!existingAsset) state.assets.set(assetPath, { file, objectUrl });
  img.addEventListener("load", scheduleOverlayRefresh, { once: true });
  img.src = objectUrl;
  scheduleOverlayRefresh();

  applyOp(
    meta.pagePath,
    { type: "src", nodeId: meta.id, value: assetPath, assetName: file.name },
    "Replace image",
  );
  updateDirtyUi();
}

function detectRasterContentType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  if (String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" && brand.startsWith("avif")) {
    return "image/avif";
  }
  return null;
}

function extFor(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    default:
      return "bin";
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

function selectImage(img: HTMLImageElement, meta: NodeMeta): void {
  selectedImage = { el: img, meta };
}

function openAltEditor(img: HTMLImageElement, meta: NodeMeta): void {
  const existing = img.getAttribute("alt") ?? "";
  rememberOriginalAttr(meta.pagePath, meta.id, "alt", existing);
  const dialog = document.createElement("dialog");
  dialog.className = "xyle-dialog";
  dialog.setAttribute("aria-labelledby", "xyle-alt-dialog-title");
  dialog.replaceChildren(
    document.createRange().createContextualFragment(`
    <form method="dialog" class="xyle-dialog-form">
      <div class="xyle-dialog-heading"><span class="xyle-dialog-kicker">Accessibility</span><strong id="xyle-alt-dialog-title">Image description</strong></div>
      <label class="xyle-dialog-label">Alt text
        <input class="xyle-dialog-input" name="alt" value="" autocomplete="off">
      </label>
      <div class="xyle-dialog-actions">
        <button class="xyle-dialog-button" value="cancel">Cancel</button>
        <button class="xyle-dialog-button xyle-dialog-button--primary" value="save">Save alt text</button>
      </div>
    </form>`),
  );
  const altInput = dialog.querySelector("input") as HTMLInputElement;
  altInput.value = existing;
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "save") {
      const value = altInput.value;
      applyOp(meta.pagePath, { type: "alt", nodeId: meta.id, value }, "Edit alt text");
      img.setAttribute("alt", value);
    }
    dialog.remove();
    img.focus();
  });
  dialog.showModal();
}

/* ---------- media drawer ---------- */

interface MediaItem {
  path: string;
  contentType: string;
  source: "site" | "xyle-upload";
  usedBySimpleImg: boolean;
}

let drawerOpen = false;
let mediaManagementUnavailable = false;
let mediaRequestGeneration = 0;
let mediaDrawerTrigger: HTMLElement | null = null;

async function detectMediaSupport(): Promise<void> {
  try {
    const res = await api("/__xyle/api/media");
    if (!res.ok) return;
    const body = (await res.json().catch(() => null)) as { available?: boolean } | null;
    mediaManagementUnavailable = body?.available === false;
  } catch {
    // The regular page load reports connection failures to the user.
  }
}

async function openMediaDrawer(trigger?: HTMLElement): Promise<void> {
  if (mediaManagementUnavailable) {
    flash("Media management is unavailable for this deployment.");
    return;
  }
  closeChangesDrawer(false);
  if (drawerOpen) return;
  drawerOpen = true;
  setInteractionMode("drawer");
  mediaDrawerTrigger = trigger ?? (previewDoc()?.activeElement as HTMLElement | null);
  const requestGeneration = ++mediaRequestGeneration;
  const res = await api("/__xyle/api/media");
  if (requestGeneration !== mediaRequestGeneration) return;
  if (!res.ok) {
    drawerOpen = false;
    flash(
      res.status === 501
        ? "Media management is unavailable for this deployment."
        : "Could not load media.",
    );
    return;
  }
  const body = (await res.json()) as MediaItem[] | { available?: boolean };
  if (!Array.isArray(body)) {
    drawerOpen = false;
    flash("Media management is unavailable for this deployment.");
    return;
  }
  renderMediaDrawer(body);
}

function focusPreviewElement(element: HTMLElement | null): void {
  if (!element?.isConnected) return;
  element.ownerDocument.defaultView?.focus();
  element.focus({ preventScroll: true });
}

function closeMediaDrawer(restoreFocus = true): void {
  const trigger = mediaDrawerTrigger;
  const selectedImageElement = selectedImage?.el;
  $("#xyle-media-drawer")?.remove();
  drawerOpen = false;
  mediaRequestGeneration += 1;
  if (!session && !activeTools) setInteractionMode(hoveredCandidate ? "hover" : "idle");
  mediaDrawerTrigger = null;
  if (restoreFocus) {
    window.setTimeout(() => {
      if (trigger?.isConnected) focusPreviewElement(trigger);
      else if (selectedImageElement?.isConnected) focusPreviewElement(selectedImageElement);
    }, 0);
  }
}

function renderMediaDrawer(items: MediaItem[]): void {
  const trigger = mediaDrawerTrigger;
  closeMediaDrawer(false);
  mediaDrawerTrigger = trigger;
  drawerOpen = true;
  setInteractionMode("drawer");
  const drawer = document.createElement("aside");
  drawer.id = "xyle-media-drawer";
  drawer.className = "xyle-drawer xyle-media-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-labelledby", "xyle-media-title");
  drawer.innerHTML = `
    <header class="xyle-drawer-header">
      <strong id="xyle-media-title"><svg class="xyle-drawer-title-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4-4 3 3 2-2 5 4"/></svg><span>Media</span></strong>
      <button id="xyle-media-close" class="xyle-icon-button" aria-label="Close media drawer">×</button>
    </header>
    <label class="xyle-sr-only" for="xyle-media-search">Search images</label>
    <input id="xyle-media-search" class="xyle-media-search" name="media-search" autocomplete="off" placeholder="Search images…">
    <nav id="xyle-media-tabs" class="xyle-media-tabs" aria-label="Filter media">
      <button data-tab="all" class="xyle-media-tab" aria-pressed="true">All</button>
      <button data-tab="used" class="xyle-media-tab" aria-pressed="false">Used</button>
      <button data-tab="uploads" class="xyle-media-tab" aria-pressed="false">Uploads</button>
    </nav>
    <div id="xyle-media-grid" class="xyle-media-grid"></div>
    <button id="xyle-media-upload" class="xyle-media-upload">Upload image</button>
  `;
  document.body.append(drawer);

  const grid = $<HTMLElement>("#xyle-media-grid", drawer);
  const search = $<HTMLInputElement>("#xyle-media-search", drawer);
  let tab = "all";
  drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMediaDrawer();
    }
  });

  const drawGrid = (): void => {
    const query = search.value.trim().toLowerCase();
    grid.innerHTML = "";
    for (const item of items) {
      if (tab === "used" && !item.usedBySimpleImg) continue;
      if (tab === "uploads" && item.source !== "xyle-upload") continue;
      if (query && !item.path.toLowerCase().includes(query)) continue;
      const cell = document.createElement("button");
      cell.className = "xyle-media-cell";
      cell.setAttribute("aria-label", `Choose ${item.path}`);
      const thumb = document.createElement("img");
      thumb.src = item.path;
      thumb.alt = item.path.split("/").pop() ?? "";
      thumb.loading = "lazy";
      thumb.className = "xyle-media-thumb";
      cell.append(thumb);
      cell.title = item.path;
      cell.addEventListener("click", () => chooseExistingMedia(item.path));
      grid.append(cell);
    }
  };
  search.addEventListener("input", drawGrid);
  for (const button of drawer.querySelectorAll<HTMLButtonElement>("#xyle-media-tabs button")) {
    button.addEventListener("click", () => {
      tab = button.dataset.tab ?? "all";
      for (const peer of drawer.querySelectorAll<HTMLButtonElement>(".xyle-media-tab")) {
        peer.setAttribute("aria-pressed", String(peer === button));
      }
      drawGrid();
    });
  }
  $("#xyle-media-close", drawer).addEventListener("click", () => closeMediaDrawer());
  $("#xyle-media-upload", drawer).addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/avif";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file || !selectedImage) {
        if (file) flash("Select an image in the page first.");
        return;
      }
      await useFileForImage(selectedImage.el, selectedImage.meta, file);
      flash("Image updated.");
    });
    input.click();
  });
  drawGrid();
  search.focus();
}

function chooseExistingMedia(path: string): void {
  if (!selectedImage) return;
  const { el, meta } = selectedImage;
  rememberOriginalAttr(meta.pagePath, meta.id, "src", el.getAttribute("src") ?? "");
  el.setAttribute("src", path);
  el.src = path;
  applyOp(meta.pagePath, { type: "src", nodeId: meta.id, value: path }, "Replace image");
  closeMediaDrawer();
  flash("Image updated.");
}

/* ---------- ChangeSet / history / chrome ---------- */

function assetPathsFor(...ops: Array<Op | undefined>): string[] {
  return [
    ...new Set(
      ops
        .filter((op): op is Extract<Op, { type: "src" }> => op?.type === "src")
        .map((op) => op.value)
        .filter((path) => state.assets.has(path)),
    ),
  ];
}

function cleanupUnreachableAssets(includeHistory = true): void {
  const reachable = new Set(state.ops.flatMap(({ op }) => (op.type === "src" ? [op.value] : [])));
  if (includeHistory) {
    for (const entry of state.history) {
      for (const path of entry.assetPaths) reachable.add(path);
    }
  }
  for (const [path, asset] of state.assets) {
    if (reachable.has(path)) continue;
    URL.revokeObjectURL(asset.objectUrl);
    state.assets.delete(path);
  }
}

function applyOp(pagePath: string, op: Op, label: string): void {
  const key = opKey(op);
  const previous = state.ops.find(
    (entry) => entry.pagePath === pagePath && opKey(entry.op) === key,
  );
  replacePendingOp(pagePath, key, op);

  const undo = (): void => {
    replacePendingOp(pagePath, key, previous?.op ?? null);
    if (previous) applyOpToDom(pagePath, previous.op);
    else revertOpInDom(pagePath, op);
    updateDirtyUi();
  };
  const redo = (): void => {
    replacePendingOp(pagePath, key, op);
    applyOpToDom(pagePath, op);
    updateDirtyUi();
  };
  pushHistory({ label, undo, redo, assetPaths: assetPathsFor(previous?.op, op) });
  updateDirtyUi();
}

function opKey(op: Op): string {
  const target = op.nodeId.includes("#") ? op.nodeId : `${op.nodeId}:${op.type}`;
  return `${op.type}@${target}`;
}
function removeOpsFor(pagePath: string, key: string): void {
  state.ops = state.ops.filter(
    (entry) => !(entry.pagePath === pagePath && opKey(entry.op) === key),
  );
}
function replacePendingOp(pagePath: string, key: string, op: Op | null): void {
  removeOpsFor(pagePath, key);
  if (op) state.ops.push({ pagePath, op });
}

function pushHistory(entry: HistoryEntry): void {
  state.history = state.history.slice(0, state.historyIndex);
  state.history.push(entry);
  if (state.history.length > MAX_HISTORY) state.history.shift();
  state.historyIndex = state.history.length;
  cleanupUnreachableAssets();
}

function dirtyCount(): number {
  return state.ops.length;
}

function listEditableContent(): EditableContent[] {
  const current = state.current;
  if (!current) return [];

  return current.nodes
    .filter(
      (meta): meta is NodeMeta & { kind: "text" | "link" } =>
        (meta.kind === "text" || meta.kind === "link") && meta.textEditable === true,
    )
    .map((meta) => ({
      id: meta.id,
      type: meta.kind,
      preview: currentNodeElement(meta.id)?.textContent ?? "",
    }));
}

function getContent(nodeId: string): ContentResult {
  const current = state.current;
  if (!current) throw new Error("No page is loaded");
  const meta = current.nodes.find((candidate) => candidate.id === nodeId);
  if (!meta || (meta.kind !== "text" && meta.kind !== "link") || !meta.textEditable) {
    throw new Error(`Unknown or non-text-editable Xyle node ${nodeId}`);
  }
  const element = currentNodeElement(nodeId);
  if (!element) throw new Error(`Xyle node ${nodeId} is not present in the preview`);
  return { id: nodeId, type: meta.kind, content: element.textContent ?? "" };
}

function updateText(nodeId: string, text: string): TextUpdateResult {
  if (session) commitEdit();
  const current = state.current;
  if (!current) throw new Error("No page is loaded");
  const meta = current.nodes.find((candidate) => candidate.id === nodeId);
  if (!meta || (meta.kind !== "text" && meta.kind !== "link") || !meta.textEditable) {
    throw new Error(`Unknown or non-text-editable Xyle node ${nodeId}`);
  }
  if (meta.segmentCount !== 1) {
    throw new Error(`Xyle node ${nodeId} has ambiguous text mapping`);
  }

  const element = currentNodeElement(nodeId);
  if (!element) throw new Error(`Xyle node ${nodeId} is not present in the preview`);
  const [pair] = collectSegments(element);
  if (!pair) throw new Error(`Xyle node ${nodeId} has no editable text`);

  const operation: Op = { type: "text", nodeId: `${nodeId}#0`, value: text };
  rememberOriginalSegment(current.pagePath, operation.nodeId, pair.value);
  applyOpToDom(current.pagePath, operation);
  applyOp(current.pagePath, operation, "Edit text");
  return { id: nodeId, pagePath: current.pagePath, text };
}

function currentNodeElement(nodeId: string): HTMLElement | null {
  const doc = previewDoc();
  if (!doc) return null;
  return (
    [...doc.querySelectorAll<HTMLElement>("[data-xyle-node]")].find(
      (element) => element.dataset.xyleNode === nodeId,
    ) ?? null
  );
}

function updateDirtyUi(): void {
  const count = dirtyCount();
  $("#xyle-dirty").style.display = count > 0 ? "" : "none";
  $("#xyle-count").textContent = String(count);
  $("#xyle-changes").setAttribute("aria-label", `Open ${count} change${count === 1 ? "" : "s"}`);
  const dock = $("#xyle-control-dock");
  const handle = $<HTMLButtonElement>("#xyle-dock-handle");
  dock.toggleAttribute("data-hidden", count === 0);
  handle?.setAttribute("aria-expanded", String(count > 0));
  handle?.setAttribute(
    "aria-label",
    count > 0 ? "Xyle controls pinned while changes are pending" : "Show Xyle controls",
  );
  const chevron = $("#xyle-dock-chevron", dock);
  if (chevron) chevron.textContent = count > 0 ? "⌄" : "⌃";
  refreshMarkers();
  if ($("#xyle-changes-drawer")) openChangesDrawer();
}

function snapshotDigest(): Promise<string> {
  return api("/__xyle/api/manifest")
    .then((r) => r.json())
    .then((m) => m.snapshotDigest);
}

function buildChrome(): void {
  const shell = new DOMParser().parseFromString(
    `
  <main id="xyle-shell">
    <div id="xyle-preview-host"></div>
  </main>
  <div id="xyle-overlay-root"></div>
  <div id="xyle-flash" role="status" aria-live="polite"></div>

  <div id="xyle-control-dock" data-hidden aria-label="Xyle editor controls">
    <button id="xyle-dock-handle" type="button" aria-label="Show Xyle controls" aria-expanded="false">Xyle <span id="xyle-dock-chevron" aria-hidden="true">⌃</span></button>
    <div id="xyle-control-hitbox" aria-hidden="true"></div>
    <div id="xyle-control-bar">
      <div id="xyle-bar-left">
        <div style="position:relative">
          <button id="xyle-menu-btn" class="xyle-icon-button" data-tooltip="Xyle menu" aria-haspopup="menu" aria-expanded="false" aria-label="Open Xyle menu" title="Xyle menu">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>
          </button>
          <div id="xyle-menu" role="menu" aria-label="Xyle menu">
            <button data-action="exit" class="xyle-menu-item" role="menuitem">Exit editor</button>
            <button data-action="live" class="xyle-menu-item" role="menuitem">View live site</button>
            <div class="xyle-menu-separator" role="separator"></div>
            <button data-action="logout" class="xyle-menu-item" role="menuitem">Log out</button>
          </div>
        </div>
        <button id="xyle-editables" class="xyle-icon-button" data-tooltip="Show editables" aria-label="Show editables" aria-pressed="false" title="Show editables">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M8 12h8"/></svg>
        </button>
      </div>
      <div id="xyle-dirty">
        <button id="xyle-changes" class="xyle-icon-button" data-tooltip="Changes" aria-label="Open changes" title="Open changes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h8M8 15h5"/></svg><span id="xyle-count" class="xyle-count-badge">0</span></button>
        <button id="xyle-publish" class="xyle-icon-button xyle-icon-button--publish" data-tooltip="Publish" aria-label="Publish changes" title="Publish changes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></svg><span id="xyle-publish-label" class="xyle-sr-only">Publish changes</span></button>
      </div>
    </div>
  </div>
  <div id="xyle-conflict" role="alert">
    <strong>The published site changed.</strong>
    <p>Your edits are still here, but publishing would overwrite newer content.</p>
    <button id="xyle-conflict-reload" class="xyle-conflict-action">Reload published site</button>
    <button id="xyle-conflict-dismiss" class="xyle-conflict-action xyle-conflict-action--quiet">Keep editing</button>
  </div>
`,
    "text/html",
  ).body;
  document.body.replaceChildren(...shell.childNodes);
  const shellStyles = document.createElement("style");
  shellStyles.id = "xyle-shell-styles";
  shellStyles.textContent = editorStyles;
  document.head.append(shellStyles);

  const dock = $("#xyle-control-dock");
  const dockHandle = $<HTMLButtonElement>("#xyle-dock-handle");
  let dockHideTimer = 0;
  const setDockHidden = (hidden: boolean): void => {
    dock.toggleAttribute("data-hidden", hidden);
    dockHandle.setAttribute("aria-expanded", String(!hidden));
    dockHandle.setAttribute("aria-label", hidden ? "Show Xyle controls" : "Hide Xyle controls");
    $("#xyle-dock-chevron", dock).textContent = hidden ? "⌃" : "⌄";
  };
  const showDock = (): void => {
    window.clearTimeout(dockHideTimer);
    setDockHidden(false);
  };
  const scheduleDockHide = (): void => {
    window.clearTimeout(dockHideTimer);
    if (dirtyCount() > 0) return;
    dockHideTimer = window.setTimeout(() => setDockHidden(true), 2000);
  };
  dockHandle.addEventListener("click", () => {
    if (dock.hasAttribute("data-hidden")) showDock();
    else if (dirtyCount() === 0) setDockHidden(true);
  });
  dock.addEventListener("mouseenter", showDock);
  dock.addEventListener("focusin", showDock);
  dock.addEventListener("mouseleave", scheduleDockHide);
  dock.addEventListener("focusout", scheduleDockHide);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape" && dirtyCount() === 0 && !dock.contains(document.activeElement)) {
      window.clearTimeout(dockHideTimer);
      setDockHidden(true);
    }
  });

  const menuBtn = $<HTMLButtonElement>("#xyle-menu-btn");
  const menu = $("#xyle-menu");
  const menuItems = [...menu.querySelectorAll<HTMLButtonElement>("button[data-action]")];
  const closeMenu = (restoreFocus = false): void => {
    menu.style.display = "none";
    menuBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) menuBtn.focus();
  };
  const openMenu = (): void => {
    menu.style.display = "block";
    menuBtn.setAttribute("aria-expanded", "true");
    menuItems[0]?.focus();
  };
  menuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menuBtn.getAttribute("aria-expanded") === "true") closeMenu(true);
    else openMenu();
  });
  menu.addEventListener("keydown", (event) => {
    const current = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1) % menuItems.length;
    else if (event.key === "ArrowUp") next = (current - 1 + menuItems.length) % menuItems.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = menuItems.length - 1;
    else return;
    event.preventDefault();
    menuItems[next]?.focus();
  });
  document.addEventListener("click", () => closeMenu());
  for (const button of menuItems) {
    button.addEventListener("click", () => {
      closeMenu(true);
      menuAction(button.dataset.action!);
    });
  }

  $("#xyle-editables").addEventListener("click", () => {
    showEditables = !showEditables;
    applyShowEditables();
  });
  $("#xyle-publish").addEventListener("click", () => void publish());
  $("#xyle-changes").addEventListener("click", openChangesDrawer);
  $("#xyle-conflict-reload").addEventListener("click", () => location.reload());
  $("#xyle-conflict-dismiss").addEventListener("click", () => {
    $("#xyle-conflict").style.display = "none";
  });

  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const inField = (document.activeElement as HTMLElement | null)?.isContentEditable === true;
    if (event.key === "z" || event.key === "Z") {
      if (inField) return; // browser-native field handling wins
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    if (event.key === "y" && !inField) {
      event.preventDefault();
      redo();
    }
  });

  // click outside finishes the active field edit
  document.addEventListener("mousedown", (event) => {
    if (!session) return;
    const doc = previewDoc();
    const target = event.target as Node;
    const inShellUi = (target as Element)?.closest?.(
      "#xyle-dirty,#xyle-bar-left,#xyle-media-drawer,dialog",
    );
    if (inShellUi) {
      commitEdit();
      return;
    }
    if (doc && doc.body.contains(target)) {
      const editableHost = (target as Element)?.closest?.("[data-xyle-node]");
      if (editableHost !== session.el) commitEdit();
    }
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!activeTools) return;
      const target = event.target as Node;
      if (activeTools.contains(target)) return;
      if (target === iframe) return;
      closeContextTools(false);
    },
    true,
  );
  window.addEventListener("resize", scheduleOverlayRefresh);
  window.addEventListener("scroll", scheduleOverlayRefresh, true);
}

function menuAction(action: string): void {
  if (action === "exit") exitEditor();
  if (action === "live") {
    try {
      const target = new URL(state.current?.pagePath ?? "/", location.origin);
      if (target.origin !== location.origin || target.protocol !== location.protocol) {
        flash("The live page could not be opened safely.");
        return;
      }
      const link = document.createElement("a");
      link.href = target.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    } catch {
      flash("The live page could not be opened safely.");
    }
  }
  if (action === "logout") logout();
}

function confirmDiscard(action: string): boolean {
  const count = dirtyCount();
  if (count === 0) return true;
  const noun = count === 1 ? "change" : "changes";
  return confirm(`Discard ${count} unpublished ${noun} and ${action}?`);
}

function discardAll(): void {
  mediaMutationGeneration += 1;
  closeMediaDrawer(false);
  closeChangesDrawer(false);
  selectedImage = null;
  previewDoc()
    ?.querySelectorAll(".xyle-img-tools,.xyle-link-tools")
    .forEach((tools) => {
      tools.remove();
    });
  for (const { objectUrl } of state.assets.values()) URL.revokeObjectURL(objectUrl);
  state.assets.clear();
  state.ops = [];
  state.history = [];
  state.historyIndex = 0;
  originalSegments.clear();
  originalAttrs.clear();
}

async function exitEditor(): Promise<void> {
  if (!confirmDiscard("exit")) return;
  unregisterWebMcp?.();
  unregisterWebMcp = null;
  discardAll();
  location.assign(state.current?.pagePath ?? "/");
}

async function logout(): Promise<void> {
  if (!confirmDiscard("log out")) return;
  try {
    const response = await api("/__xyle/api/logout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-xyle-request": "1",
      },
      body: "{}",
    });
    if (!response.ok) {
      flash("Could not log out. Your draft is still open.");
      return;
    }
    discardAll();
    location.assign("/edit");
  } catch {
    flash("Could not log out. Check your connection and try again.");
  }
}

/* ---------- editables toggle & markers ---------- */

function refreshMarkers(): void {
  const doc = previewDoc();
  const overlay = shellOverlay();
  if (!doc || !state.current || !overlay) return;
  overlay.querySelectorAll(".xyle-marker").forEach((marker) => {
    marker.remove();
  });
  const byPageOp = state.ops.filter((o) => o.pagePath === state.current!.pagePath);
  for (const { op } of byPageOp) {
    const baseId = op.nodeId.split("#")[0]!;
    const el = doc.querySelector(`[data-xyle-node="${baseId}"]`) as HTMLElement | null;
    if (!el) continue;
    const marker = document.createElement("span");
    marker.className = "xyle-marker";
    const rect = previewElementRect(el);
    const markerSize = 12;
    const gap = 4;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const preferredLeft = rect.right + gap;
    const viewportLeft =
      preferredLeft + markerSize <= viewportWidth
        ? preferredLeft
        : Math.max(0, rect.left - markerSize - gap);
    const viewportTop =
      rect.top >= 0 && rect.top <= viewportHeight
        ? Math.min(rect.top, Math.max(0, viewportHeight - markerSize))
        : rect.top;
    marker.style.left = `${viewportLeft}px`;
    marker.style.top = `${viewportTop}px`;
    overlay.append(marker);
  }
}

/* ---------- changes drawer & undo ---------- */

let changesDrawerTrigger: HTMLElement | null = null;

function closeChangesDrawer(restoreFocus = true): void {
  $("#xyle-changes-drawer")?.remove();
  if (restoreFocus) changesDrawerTrigger?.focus();
  changesDrawerTrigger = null;
  if (!session && !drawerOpen && !activeTools)
    setInteractionMode(hoveredCandidate ? "hover" : "idle");
}

let focusedChangeTimer = 0;
let focusedChangeKey = "";

function focusChange(pagePath: string, nodeId: string): void {
  const changeKey = `${pagePath}:${nodeId}`;
  const keepDrawerOpen = pagePath === state.current?.pagePath;
  if (!keepDrawerOpen) closeChangesDrawer(false);
  const reveal = (): void => {
    const baseId = nodeId.split("#", 1)[0];
    const target = previewDoc()?.querySelector<HTMLElement>(`[data-xyle-node="${baseId}"]`);
    if (!target) return;
    window.clearTimeout(focusedChangeTimer);
    focusedChangeKey = changeKey;
    document.querySelectorAll<HTMLElement>(".xyle-change-row").forEach((row) => {
      row.classList.toggle("is-located", row.dataset.changeKey === changeKey);
    });
    focusedChangeTarget = target;
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    refreshEditabilityOverlay();
    focusedChangeTimer = window.setTimeout(() => {
      if (focusedChangeTarget !== target) return;
      focusedChangeKey = "";
      focusedChangeTarget = null;
      document.querySelectorAll<HTMLElement>(".xyle-change-row").forEach((row) => {
        row.classList.remove("is-located");
      });
      refreshEditabilityOverlay();
    }, 2200);
  };
  if (keepDrawerOpen) reveal();
  else void loadPage(pagePath, { pushHistory: true }).then(reveal);
}

function opLabel(op: Op): string {
  switch (op.type) {
    case "text":
      return "Text";
    case "href":
      return "Link destination";
    case "src":
      return "Image";
    case "alt":
      return "Alt text";
  }
}

function originalValue(pagePath: string, op: Op): string {
  if (op.type === "text") {
    return originalSegments.get(segmentIdentity(pagePath, op.nodeId)) ?? "";
  }
  return originalAttrs.get(attrIdentity(pagePath, op.nodeId, op.type)) ?? "";
}

interface ChangePart {
  value: string;
  changed: boolean;
}

function changeParts(before: string, after: string): { before: ChangePart[]; after: ChangePart[] } {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const beforeEnd = before.length - suffix;
  const afterEnd = after.length - suffix;
  const beforeMiddle = before.slice(prefix, beforeEnd);
  const afterMiddle = after.slice(prefix, afterEnd);
  return {
    before: [
      { value: before.slice(0, prefix), changed: false },
      { value: beforeMiddle, changed: true },
      { value: before.slice(before.length - suffix), changed: false },
    ].filter((part) => part.value),
    after: [
      { value: after.slice(0, prefix), changed: false },
      { value: afterMiddle, changed: true },
      { value: after.slice(after.length - suffix), changed: false },
    ].filter((part) => part.value),
  };
}

function appendChangeValue(
  parent: HTMLElement,
  kind: "Before" | "After",
  value: string,
  parts: ChangePart[],
): void {
  const wrapper = document.createElement("div");
  wrapper.className = `xyle-change-value xyle-change-${kind.toLowerCase()}`;
  wrapper.setAttribute("aria-label", `${kind}: ${value || "Empty"}`);
  if (!value) wrapper.append(document.createTextNode("Empty"));
  for (const part of parts) {
    if (part.changed) {
      const highlight = document.createElement("mark");
      highlight.className = "xyle-change-highlight";
      highlight.textContent = part.value;
      wrapper.append(highlight);
    } else {
      wrapper.append(document.createTextNode(part.value));
    }
  }
  parent.append(wrapper);
}

function openChangesDrawer(): void {
  closeChangesDrawer(false);
  setInteractionMode("drawer");
  changesDrawerTrigger = document.activeElement as HTMLElement | null;
  const drawer = document.createElement("aside");
  drawer.id = "xyle-changes-drawer";
  drawer.className = "xyle-drawer xyle-changes-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-labelledby", "xyle-changes-title");
  drawer.append(
    document.createRange().createContextualFragment(`<header class="xyle-drawer-header">
    <strong id="xyle-changes-title"><svg class="xyle-drawer-title-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h5M8 15h8"/></svg><span>Changes</span><span id="xyle-changes-count" class="xyle-changes-count"></span></strong>
    <button id="xyle-changes-close" class="xyle-icon-button" aria-label="Close changes drawer">×</button>
  </header><div id="xyle-changes-list" class="xyle-changes-list"></div>
  <footer class="xyle-drawer-actions">
    <button id="xyle-drawer-publish" class="xyle-dialog-button xyle-dialog-button--primary"><svg class="xyle-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></svg><span>Publish</span></button>
    <button id="xyle-discard" class="xyle-dialog-button xyle-dialog-button--accent"><svg class="xyle-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg><span>Discard all changes</span></button>
  </footer>`),
  );
  $("#xyle-changes-count", drawer).textContent = String(state.ops.length);
  document.body.append(drawer);
  const closeButton = $("#xyle-changes-close", drawer);
  closeButton.addEventListener("click", () => closeChangesDrawer());
  drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeChangesDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...drawer.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  $("#xyle-discard", drawer).addEventListener("click", () => {
    if (!confirmDiscard("reload the published page")) return;
    if (session) revertEdit();
    discardAll();
    drawer.remove();
    updateDirtyUi();
    void loadPage(state.current?.pagePath ?? "/index.html", { pushHistory: false });
  });
  $("#xyle-drawer-publish", drawer).addEventListener(
    "click",
    () => void publish($("#xyle-drawer-publish", drawer)),
  );

  const list = $("#xyle-changes-list", drawer);
  if (state.ops.length === 0) {
    list.innerHTML = `<p class="xyle-empty-state">No pending changes. Your draft is clean.</p>`;
    closeButton.focus();
    return;
  }
  const operationsByPage = new Map<
    string,
    Array<{ index: number; entry: (typeof state.ops)[number] }>
  >();
  for (const [index, entry] of state.ops.entries()) {
    const pageEntries = operationsByPage.get(entry.pagePath) ?? [];
    pageEntries.push({ index, entry });
    operationsByPage.set(entry.pagePath, pageEntries);
  }
  let pageIndex = 0;
  let changeNumber = 0;
  for (const [pagePath, entries] of operationsByPage) {
    const group = document.createElement("section");
    group.className = "xyle-change-page-group";
    const pageLabel = document.createElement("h3");
    pageLabel.id = `xyle-change-page-${pageIndex++}`;
    pageLabel.className = "xyle-change-page";
    pageLabel.textContent = pagePath;
    group.setAttribute("aria-labelledby", pageLabel.id);
    group.append(pageLabel);
    for (const { index, entry } of entries) {
      const row = document.createElement("div");
      const changeKey = `${pagePath}:${entry.op.nodeId}`;
      row.className = "xyle-change-row";
      row.dataset.changeKey = changeKey;
      row.classList.toggle("is-located", focusedChangeKey === changeKey);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Locate ${opLabel(entry.op)} change on ${pagePath}`);
      row.addEventListener("click", () => focusChange(pagePath, entry.op.nodeId));
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        focusChange(pagePath, entry.op.nodeId);
      });
      const header = document.createElement("div");
      header.className = "xyle-change-row-header";
      const heading = document.createElement("div");
      heading.className = "xyle-change-heading";
      const number = document.createElement("span");
      number.className = "xyle-change-index";
      number.textContent = String(++changeNumber);
      number.setAttribute("aria-hidden", "true");
      heading.append(number);
      const rowActions = document.createElement("div");
      rowActions.className = "xyle-change-row-actions";
      const locateButton = document.createElement("button");
      locateButton.type = "button";
      locateButton.className = "xyle-locate-button";
      locateButton.innerHTML =
        '<svg class="xyle-action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Locate</span>';
      locateButton.setAttribute("aria-label", `Locate ${opLabel(entry.op)} change on ${pagePath}`);
      locateButton.addEventListener("click", (event) => {
        event.stopPropagation();
        focusChange(pagePath, entry.op.nodeId);
      });
      const undoButton = document.createElement("button");
      undoButton.type = "button";
      undoButton.innerHTML =
        '<svg class="xyle-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M4 12h9a7 7 0 0 1 7 7"/></svg><span>Undo</span>';
      undoButton.className = "xyle-undo-button";
      undoButton.setAttribute("aria-label", `Undo ${opLabel(entry.op)} change on ${pagePath}`);
      undoButton.addEventListener("click", (event) => {
        event.stopPropagation();
        undoOp(index);
      });
      rowActions.append(locateButton, undoButton);
      header.append(heading, rowActions);
      const comparison = document.createElement("div");
      comparison.className = "xyle-change-comparison";
      // User-authored values are appended as text nodes so the privileged shell
      // never interprets edited content as markup.
      const beforeValue = originalValue(pagePath, entry.op).trim();
      const afterValue = entry.op.value.trim();
      const diff = changeParts(beforeValue, afterValue);
      appendChangeValue(comparison, "Before", beforeValue, diff.before);
      const arrow = document.createElement("span");
      arrow.className = "xyle-change-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      comparison.append(arrow);
      appendChangeValue(comparison, "After", afterValue, diff.after);
      row.append(header, comparison);
      group.append(row);
    }
    list.append(group);
  }
  closeButton.focus();
}

/** Undo one specific op by index. */
function undoOp(index: number): void {
  const entry = state.ops[index];
  if (!entry) return;
  removeOpsFor(entry.pagePath, opKey(entry.op));
  revertOpInDom(entry.pagePath, entry.op);
  updateDirtyUi();
}

function applyOpToDom(pagePath: string, op: Op): void {
  if (pagePath !== state.current?.pagePath) return;
  const doc = previewDoc();
  if (!doc) return;
  if (op.type === "text") {
    const [baseId, segRaw] = op.nodeId.split("#");
    const el = doc.querySelector(`[data-xyle-node="${baseId}"]`) as HTMLElement | null;
    if (el) setSegmentValue(el, Number(segRaw), op.value);
    return;
  }
  const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
  if (!el) return;
  const asset = state.assets.get(op.value);
  const value = asset ? asset.objectUrl : op.value;
  el.setAttribute(op.type, value);
  if (op.type === "src" && el.tagName === "IMG") (el as HTMLImageElement).src = value;
}

function revertOpInDom(pagePath: string, op: Op): void {
  if (pagePath !== state.current?.pagePath) return;
  const doc = previewDoc();
  if (!doc) return;
  if (op.type === "text") {
    const [baseId, segRaw] = op.nodeId.split("#");
    const original = originalSegments.get(segmentIdentity(pagePath, op.nodeId));
    const el = doc.querySelector(`[data-xyle-node="${baseId}"]`);
    if (el && original !== undefined) {
      const runs = setSegmentValue(el as HTMLElement, Number(segRaw), original);
      void runs;
    }
  } else if (op.type === "href" || op.type === "src" || op.type === "alt") {
    const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
    const attr = op.type;
    if (el) {
      const original = originalAttrs.get(attrIdentity(pagePath, op.nodeId, attr));
      if (original !== undefined) el.setAttribute(attr, original);
    }
  }
  refreshMarkers();
}

const originalSegments = new Map<string, string>();
const originalAttrs = new Map<string, string>();

function segmentIdentity(pagePath: string, id: string): string {
  return `${pagePath}@${id}`;
}
function attrIdentity(pagePath: string, id: string, attr: string): string {
  return `${pagePath}@${id}:${attr}`;
}
function rememberOriginalSegment(pagePath: string, id: string, value: string): void {
  const key = segmentIdentity(pagePath, id);
  if (!originalSegments.has(key)) originalSegments.set(key, value);
}
function rememberOriginalAttr(pagePath: string, id: string, attr: string, value: string): void {
  const key = attrIdentity(pagePath, id, attr);
  if (!originalAttrs.has(key)) originalAttrs.set(key, value);
}

/** Overwrite one segment's text inside a container (used by undo/restore). */
function setSegmentValue(el: HTMLElement, segIndex: number, value: string): void {
  const pair = collectSegments(el)[segIndex];
  if (!pair) return;
  const nodes = textNodesForSlot(el, pair.key);
  const first = nodes[0];
  const parent = first?.parentNode;
  if (!first || !parent) return;

  for (const node of nodes.slice(1)) {
    const previous = node.previousSibling;
    if (previous && isControlledBreak(previous)) previous.remove();
    node.remove();
  }
  let next = first.nextSibling;
  while (next && isControlledBreak(next)) {
    const controlled = next;
    next = next.nextSibling;
    controlled.remove();
  }

  const pieces = value.split("\n");
  first.textContent = pieces[0] ?? "";
  let cursor: Node = first;
  const doc = el.ownerDocument;
  for (const piece of pieces.slice(1)) {
    const br = doc.createElement("br");
    markControlledBreak(br);
    const text = doc.createTextNode(piece);
    parent.insertBefore(br, cursor.nextSibling);
    parent.insertBefore(text, br.nextSibling);
    cursor = text;
  }
}

function textNodesForSlot(rootEl: HTMLElement, key: string): Text[] {
  const out: Text[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (slotKeyOf(node, rootEl) === key) out.push(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element !== rootEl && element.hasAttribute("data-xyle-node")) return;
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(rootEl);
  return out;
}

/** Reapply surviving ops into freshly rendered DOM (after navigation). */
function restoreOpsIntoDom(): void {
  const doc = previewDoc();
  if (!doc || !state.current) return;
  for (const { pagePath, op } of state.ops) {
    if (pagePath !== state.current.pagePath) continue;
    if (op.type === "text") {
      const [baseId, segRaw] = op.nodeId.split("#");
      const el = doc.querySelector(`[data-xyle-node="${baseId}"]`) as HTMLElement | null;
      if (el) setSegmentValue(el, Number(segRaw), op.value);
    } else {
      const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
      if (el) {
        rememberOriginalAttr(pagePath, op.nodeId, op.type, el.getAttribute(op.type) ?? "");
        const asset = state.assets.get(op.value);
        el.setAttribute(op.type, asset ? asset.objectUrl : op.value);
        if (el.tagName === "IMG") (el as HTMLImageElement).src = asset ? asset.objectUrl : op.value;
      }
    }
  }
  updateDirtyUi();
}

/* ---------- global undo/redo ---------- */

function undo(): void {
  if (state.historyIndex === 0) return;
  state.historyIndex -= 1;
  state.history[state.historyIndex]?.undo();
}
function redo(): void {
  if (state.historyIndex >= state.history.length) return;
  state.history[state.historyIndex]?.redo();
  state.historyIndex += 1;
}

/* ---------- publish ---------- */

async function publish(sourceButton?: HTMLButtonElement): Promise<void> {
  if (commitActiveEditsAndCollect()) return;
  mediaMutationGeneration += 1;
  const button = sourceButton ?? $<HTMLButtonElement>("#xyle-publish");
  const label = sourceButton ? $("span", sourceButton) : $("#xyle-publish-label");
  const idleLabel = sourceButton ? "Publish" : "Publish changes";
  button.disabled = true;
  label.textContent = "Publishing…";

  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      baseSnapshotDigest: state.publishedSnapshotDigest,
      pages: collectPageOps(),
    }),
  );
  const referencedAssets = new Set(
    state.ops.flatMap(({ op }) => (op.type === "src" ? [op.value] : [])),
  );
  for (const path of referencedAssets) {
    const asset = state.assets.get(path);
    if (asset) form.set(path, asset.file, `asset-${asset.file.name}`);
  }

  try {
    const res = await api("/__xyle/api/publish", {
      method: "POST",
      headers: { "x-xyle-request": "1" },
      body: form,
    });
    if (res.status === 409) {
      $("#xyle-conflict").style.display = "block";
      button.disabled = false;
      label.textContent = idleLabel;
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error?: string;
      };
      flash(`Couldn't publish: ${body.error ?? res.statusText}`);
      button.disabled = false;
      label.textContent = idleLabel;
      return;
    }
    const body = (await res.json()) as { snapshotDigest: string };
    state.publishedSnapshotDigest = body.snapshotDigest;
    for (const { objectUrl } of state.assets.values()) URL.revokeObjectURL(objectUrl);
    state.assets.clear();
    state.ops = [];
    state.history = [];
    state.historyIndex = 0;
    originalSegments.clear();
    originalAttrs.clear();
    selectedImage = null;
    label.textContent = "Published ✓";
    flash("Published.");
    setTimeout(() => {
      label.textContent = idleLabel;
      button.disabled = false;
    }, 1500);
    updateDirtyUi();
    await loadPage(state.current!.pagePath, { pushHistory: false });
  } catch {
    flash("Couldn't publish — check your connection and retry.");
    button.disabled = false;
    label.textContent = idleLabel;
  }
}

function commitActiveEditsAndCollect(): boolean {
  if (session) commitEdit();
  return false;
}

function collectPageOps(): PageOps[] {
  const byPage = new Map<string, Op[]>();
  for (const { pagePath, op } of state.ops) {
    const list = byPage.get(pagePath) ?? [];
    list.push(op);
    byPage.set(pagePath, list);
  }
  const pages: PageOps[] = [];
  for (const [pagePath, operations] of byPage) {
    const baseDigest =
      pagePath === state.current?.pagePath
        ? state.current.baseDigest
        : (cachedBaseDigest.get(pagePath) ?? state.current?.baseDigest ?? "");
    pages.push({ pagePath, baseDigest, operations });
  }
  return pages;
}

const cachedBaseDigest = new Map<string, string>();

boot().catch((error) => {
  console.error("xyle boot failed", error);
});
