// Xyle editor shell — browser-side control layer.
// Drafts live only in memory; publish patches original static source server-side.

import {
  registerWebMcpTools,
  type AssetUpdateResult,
  type ChangeInfo,
  type ChangeSetOperation,
  type ChangeSetResult,
  type ChangeSetUndoResult,
  type ContentResult,
  type Formatting,
  type FormattingUpdateResult,
  type EditableContent,
  type LinkUpdateResult,
  type ListFormattingUpdateResult,
  type TextUpdateResult,
  type UndoResult,
  type MediaPatchInput,
  type MediaUpdateResult,
  type SeoUpdateResult,
} from "./webmcp.ts";
import { cleanInlineHtml, inlineFormatState, toggleInlineFormat } from "./formatting.ts";
import { stableIdentity } from "./identity.ts";
import {
  STRUCTURAL_ID_REFERENCE_ATTRIBUTES,
  createdNodeIdentity,
  duplicateGroupHtmlId,
  duplicateHtmlId,
  replayGroupOrder,
  rewriteIdTokens,
  type GroupOrderOperation,
} from "./structural.ts";
import { cropRectForFrame } from "./media-crop.ts";
import {
  LAYOUT_ATTRIBUTE,
  LAYOUT_CSS,
  LAYOUT_REGION_ATTRIBUTE,
  layoutAttributeValue,
  layoutPresetFromAttribute,
} from "./layout.ts";
import {
  clampUnit,
  mediaSourcePath,
  mediaStatesEqual,
  normalizeMediaState,
} from "./media-state.ts";
import type {
  MediaCapabilities,
  MediaState,
  Point,
  CropRect,
  SeoField,
  SeoState,
  AssetReference,
  DuplicateGroupItemOperation,
  GroupDescriptor,
  GroupItemDescriptor,
  GroupMoveCapability,
  LayoutPreset,
  LayoutTargetDescriptor,
  RegionOrder,
  MoveGroupItemOperation,
  SetLayoutPresetOperation,
  SetRegionOrderOperation,
  SnapshotOperation,
} from "./types.ts";

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
  #xyle-demo-label {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    padding: 0 10px;
    border-inline: 1px solid var(--xyle-line);
    color: #d7e5d2;
    font: 650 10px / 1 var(--xyle-font-ui);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  #xyle-demo-label strong {
    color: #fff;
    font-weight: 750;
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
  #xyle-overlay-root .xyle-inline-media-editor {
    all: initial;
    position: fixed !important;
    z-index: 20 !important;
    display: grid !important;
    gap: 0.65rem !important;
    box-sizing: border-box !important;
    color: #eef3ec !important;
    font: 500 13px / 1.4 var(--xyle-font-ui) !important;
    pointer-events: none !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor.xyle-on-canvas {
    max-width: none !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-media-editor-panel {
    display: grid !important;
    gap: 0.65rem !important;
    box-sizing: border-box !important;
    max-width: calc(100vw - 1.5rem) !important;
    max-height: calc(100vh - 1.5rem) !important;
    padding: 0.8rem !important;
    overflow: auto !important;
    border: 1px solid #a1b69a !important;
    border-radius: 10px !important;
    background: #151815 !important;
    box-shadow: 0 14px 36px #000b !important;
    pointer-events: auto !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-heading {
    display: grid !important;
    gap: 0.2rem !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-label {
    display: grid !important;
    gap: 0.35rem !important;
    color: #aab6aa !important;
    font-size: 11px !important;
    font-weight: 600 !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-input {
    width: 100% !important;
    box-sizing: border-box !important;
    padding: 0.45rem !important;
    border: 1px solid #435047 !important;
    border-radius: 5px !important;
    background: #10130f !important;
    color: #eef3ec !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-actions {
    display: flex !important;
    justify-content: flex-end !important;
    gap: 0.4rem !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-dialog-button {
    min-height: 2rem !important;
    padding: 0 0.65rem !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-crop-stage {
    min-height: 0 !important;
    height: var(--xyle-crop-height, 15rem) !important;
    aspect-ratio: var(--xyle-crop-aspect, 16 / 9) !important;
    pointer-events: auto !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor.xyle-on-canvas .xyle-crop-stage {
    background: transparent !important;
  }
  #xyle-overlay-root .xyle-inline-media-editor .xyle-crop-stage img {
    height: 100% !important;
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
  .xyle-drawer-header strong {
    display: block;
    font-size: 16px;
    letter-spacing: -0.02em;
  }
  #xyle-media-drawer .xyle-icon-button,
  #xyle-changes-drawer .xyle-icon-button,
  #xyle-seo-drawer .xyle-icon-button,
  #xyle-sections-drawer .xyle-icon-button {
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
  #xyle-sections-drawer .xyle-icon-button:hover,
  #xyle-sections-drawer .xyle-icon-button:focus-visible {
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
  .xyle-inline-confirmation {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 2147483647;
    display: grid;
    gap: 0.6rem;
    width: min(24rem, calc(100vw - 2rem));
    padding: 0.85rem;
    border: 1px solid #d26d6d66;
    border-radius: var(--xyle-radius-md);
    background: #171b18f5;
    box-shadow: 0 14px 36px #000b;
    color: var(--xyle-ink);
    font-size: 12px;
  }
  .xyle-inline-confirmation p {
    margin: 0;
  }
  .xyle-inline-confirmation-actions {
    display: flex;
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
    .xyle-icon-button,
    #xyle-media-drawer .xyle-icon-button,
    #xyle-changes-drawer .xyle-icon-button,
    #xyle-seo-drawer .xyle-icon-button,
    #xyle-sections-drawer .xyle-icon-button {
      width: 44px;
      height: 44px;
    }
    .xyle-menu-item,
    .xyle-dialog-button,
    .xyle-undo-button,
    .xyle-media-tab,
    .xyle-media-cell,
    .xyle-media-upload,
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
  #xyle-overlay-root .xyle-format-tools [role="separator"] {
    width: 1px !important;
    height: 20px !important;
    margin: 0 2px !important;
    background: #ffffff2e !important;
  }
  #xyle-overlay-root .xyle-format-tools select {
    all: initial !important;
    min-height: 28px !important;
    padding: 0 22px 0 8px !important;
    border: 0 !important;
    border-radius: 6px !important;
    background: transparent !important;
    color: #eef3ec !important;
    font: 600 11px / 1.2 var(--xyle-font-ui) !important;
    cursor: pointer !important;
  }
  #xyle-overlay-root .xyle-format-tools select:hover,
  #xyle-overlay-root .xyle-format-tools select:focus-visible {
    background: #ffffff1f !important;
  }
  #xyle-overlay-root .xyle-format-tools option {
    background: #17201b !important;
    color: #eef3ec !important;
  }

  #xyle-overlay-root .xyle-inline-tool-form {
    display: grid !important;
    grid-template-columns: minmax(9rem, 1fr) auto auto;
    align-items: end;
    gap: 0.35rem 0.5rem;
    min-width: min(18rem, calc(100vw - 1rem));
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
    box-sizing: border-box;
    padding: 0.4rem 0.5rem;
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
    gap: 2px;
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

interface NodeSegmentMeta {
  sourceStart: number;
  sourceEnd: number;
  textLength: number;
}

interface NodeMeta {
  id: string;
  pagePath: string;
  kind: "text" | "link" | "image" | "section";
  segments?: NodeSegmentMeta[];
  sourceStart?: number;
  sourceEnd?: number;
  elementStart?: number;
  elementEnd?: number;
  contentStart?: number;
  stableTargetId?: string;
  tag?: string;
  multiline?: boolean;
  textEditable?: boolean;
  segmentCount?: number;
  mediaCapabilities?: MediaCapabilities;
}

interface PageData {
  pagePath: string;
  baseDigest: string;
  html: string;
  nodes: NodeMeta[];
  groups: GroupDescriptor[];
  layouts: LayoutTargetDescriptor[];
}

type Op =
  | { type: "text"; nodeId: string; value: string }
  | {
      type: "format";
      nodeId: string;
      value: "bold" | "italic" | "underline";
      start?: number;
      end?: number;
      sourceStart?: number;
      sourceEnd?: number;
    }
  | { type: "formatBlock"; nodeId: string; value: BlockTag }
  | {
      type: "toggleList";
      nodeId: string;
      nodeIds: string[];
      value: "ul" | "ol";
      before: "plain" | "ul" | "ol";
      after: "plain" | "ul" | "ol";
    }
  | { type: "html"; nodeId: string; value: string }
  | { type: "media"; nodeId: string; value: MediaState }
  | { type: "seo"; nodeId: string; field: SeoField; value: string }
  | { type: "href"; nodeId: string; value: string }
  | { type: "src"; nodeId: string; value: string; assetName?: string }
  | { type: "alt"; nodeId: string; value: string }
  | { type: "sectionVisibility"; nodeId: string; visible: boolean; before: boolean }
  | {
      type: "moveSection";
      nodeId: string;
      targetId: string;
      before: boolean;
      originalIndex: number;
      sequence?: number;
    }
  | {
      type: "duplicateSection";
      sourceId: string;
      createdId: string;
      sequence: number;
      insert: "after";
      snapshotOperations: SnapshotOperation[];
      nodeMap: Record<string, string>;
      createdOperations?: SnapshotOperation[];
      previewHtml?: string;
      idMap: Record<string, string>;
      assetRefs: AssetReference[];
    }
  | (DuplicateGroupItemOperation & { assetRefs: AssetReference[] })
  | MoveGroupItemOperation
  | SetLayoutPresetOperation
  | SetRegionOrderOperation;

interface PageOps {
  pagePath: string;
  baseDigest: string;
  operations: Op[];
}

interface PendingOp {
  pagePath: string;
  op: Op;
  changeSetId?: string;
  changeSetLabel?: string;
}

interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
  assetPaths: string[];
  changeSetId?: string;
}

interface ChangeSetRecord {
  id: string;
  label: string;
  entries: HistoryEntry[];
  history?: HistoryEntry;
  undone: boolean;
}

interface RichContentMember {
  nodeId: string;
  targetId: string;
  elementStart: number;
  elementEnd: number;
}

interface RichContentRegion {
  id: string;
  pagePath: string;
  anchorId: string;
  targetIds: string[];
  nodeIds: string[];
  members: RichContentMember[];
  originalHtml: string;
  currentHtml: string;
}

interface RichContentRegionAlias {
  pagePath: string;
  targetIds: string[];
  regionId: string;
}

interface UserChange {
  info: ChangeInfo;
  pagePath: string;
  opIndex?: number;
  opIndexes?: number[];
  region?: RichContentRegion;
  label: string;
}

const MAX_HISTORY = 100;
let focusedChangeTarget: HTMLElement | null = null;

const state = {
  current: null as PageData | null,
  ops: [] as PendingOp[],
  history: [] as HistoryEntry[],
  historyIndex: 0,
  changeSetSequence: 0,
  changeSets: new Map<string, ChangeSetRecord>(),
  assets: new Map<string, { file: File; objectUrl: string }>(),
  publishedSnapshotDigest: "",
};
let activeChangeSet: ChangeSetRecord | null = null;
let unregisterWebMcp: (() => void) | null = null;
interface DemoBootstrapConfig {
  initialPage: string;
  pages: Record<string, string>;
  publicBaseUrl: string;
}
const rawDemoConfig = (window as typeof window & { __XYLE_BROWSER_DEMO__?: unknown })
  .__XYLE_BROWSER_DEMO__;
const demoConfig: DemoBootstrapConfig | null =
  rawDemoConfig &&
  typeof rawDemoConfig === "object" &&
  typeof (rawDemoConfig as DemoBootstrapConfig).initialPage === "string" &&
  typeof (rawDemoConfig as DemoBootstrapConfig).publicBaseUrl === "string" &&
  typeof (rawDemoConfig as DemoBootstrapConfig).pages === "object"
    ? (rawDemoConfig as DemoBootstrapConfig)
    : null;
let demoTransport: { request(path: string, init?: RequestInit): Promise<Response> } | null = null;

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
  return demoTransport ? demoTransport.request(path, init) : fetch(path, init);
}

function flash(message: string): void {
  const el = $("#xyle-flash");
  el.textContent = message;
  el.classList.add("visible");
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el.classList.remove("visible"), 1800);
}
let flashTimer = 0;

const DIALOG_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const dialogBackgroundStates = new WeakMap<HTMLElement, Array<[HTMLElement, boolean]>>();

function inertDialogBackground(dialog: HTMLElement): void {
  const states: Array<[HTMLElement, boolean]> = [];
  let current: HTMLElement = dialog;
  while (current.parentElement) {
    const parent = current.parentElement;
    for (const sibling of parent.children) {
      if (!(sibling instanceof HTMLElement) || sibling === current || sibling.id === "xyle-flash")
        continue;
      states.push([sibling, sibling.hasAttribute("inert")]);
      sibling.setAttribute("inert", "");
    }
    if (parent === document.body) break;
    current = parent;
  }
  dialogBackgroundStates.set(dialog, states);
}

function releaseDialogFocus(dialog: HTMLElement | null): void {
  if (!dialog) return;
  for (const [element, wasInert] of dialogBackgroundStates.get(dialog) ?? []) {
    element.toggleAttribute("inert", wasInert);
  }
  dialogBackgroundStates.delete(dialog);
}

function removeTrappedDialog(dialog: HTMLElement | null): void {
  if (!dialog) return;
  releaseDialogFocus(dialog);
  dialog.remove();
}

function trapDialogFocus(dialog: HTMLElement, close: () => void): void {
  inertDialogBackground(dialog);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)].filter(
      (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
    );
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
}

async function boot(): Promise<void> {
  if (demoConfig) {
    const { createBrowserDemoTransport } = await import("./browser-demo.ts");
    demoTransport = createBrowserDemoTransport(demoConfig);
  }
  const session = await (await api("/__xyle/api/session")).json();
  if (!session.authenticated) {
    location.assign("/edit");
    return;
  }

  buildChrome();
  void detectMediaSupport();
  exposeTestHook();
  const params = new URLSearchParams(location.search);
  await loadPage(params.get("page") ?? demoConfig?.initialPage ?? "/index.html", {
    pushHistory: false,
  });

  unregisterWebMcp = await registerWebMcpTools({
    listEditableContent,
    listGroups,

    getContent,
    listChanges,
    revertChange,
    applyChangeSet,
    undoChangeSet,
    replaceAsset,
    updateMedia,
    getSeo,
    updateSeo,
    updateFormatting,
    updateList: toggleListFormatting,
    updateSectionVisibility,
    moveSection,
    duplicateSection,
    duplicateGroupItem,
    moveGroupItem,
    listLayoutOptions,
    setLayoutPreset,
    setRegionOrder,
    updateText,
    updateLink,
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
  activeMediaEditor?.();
  const res = await api(`/__xyle/api/page?path=${encodeURIComponent(pagePath)}`);
  if (!res.ok) {
    flash("That page could not be loaded.");
    return;
  }
  const data = (await res.json()) as PageData & { baseDigest: string };
  closeMediaDrawer(false);
  closeChangesDrawer(false);
  closeSectionDrawer(false);
  closeContextTools(false);
  hoveredCandidate = null;
  window.clearTimeout(hoverClearTimer);
  setInteractionMode("idle");
  selectedImage = null;
  mediaMutationGeneration += 1;
  state.current = { ...data, groups: data.groups ?? [], layouts: data.layouts ?? [] };
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
  doc.addEventListener("selectionchange", () => {
    rememberNonCollapsedSelection();
    scheduleFormatTools();
  });
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
  for (const group of doc.querySelectorAll<HTMLElement>("[data-xyle-group]")) {
    wireGroupMarker(group);
  }
  for (const item of doc.querySelectorAll<HTMLElement>("[data-xyle-group-item]")) {
    wireGroupItemMarker(item);
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
      if (activeTools && targetNodeId !== activeNodeId && !toolbarIsInline()) {
        closeContextTools(false);
      }
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
  reconcileRichContent(state.current.pagePath);
  applyShowEditables();
  refreshEditabilityOverlay();
}

const metaById = new Map<string, NodeMeta>();
const richContentRegions = new Map<string, RichContentRegion>();
const richContentRegionAliases = new Map<string, RichContentRegionAlias>();
const stableTargetIds = new Map<string, string>();
const changeIdAliases = new Map<string, string>();
const controlledBreaks = new WeakSet<HTMLBRElement>();
let showEditables = false;

type InteractionMode = "idle" | "hover" | "editing" | "popover" | "drawer";
type ToolbarPhase = "idle" | "hovered" | "selected" | "active" | "inline";

let interactionMode: InteractionMode = "idle";
let toolbarPhase: ToolbarPhase = "idle";
let toolbarGeneration = 0;
let toolbarActionInProgress = false;
let hoveredCandidate: HTMLElement | null = null;
let hoverClearTimer = 0;
let contextToolsCloseTimer = 0;
let activeTools: HTMLElement | null = null;
let activeToolsTarget: HTMLElement | null = null;
let activeToolsReturnFocus: HTMLElement | null = null;
type ContextToolPlacement = "above" | "below" | "inside-bottom";
let activeToolsPlacement: ContextToolPlacement = "below";
let formatToolsFrame = 0;
let savedFormatSelection: FormatSelection | null = null;

function toolbarOwnsInteraction(): boolean {
  return (
    toolbarPhase === "active" ||
    toolbarPhase === "inline" ||
    Boolean(activeTools?.matches("[data-xyle-editing-alt], [data-xyle-editing-url]"))
  );
}

function toolbarIsInline(): boolean {
  return (
    toolbarPhase === "inline" ||
    Boolean(activeTools?.matches("[data-xyle-editing-alt], [data-xyle-editing-url]"))
  );
}

function setInteractionMode(mode: InteractionMode): void {
  interactionMode = mode;
}

function beginCandidateHover(el: HTMLElement): void {
  window.clearTimeout(hoverClearTimer);
  // A toolbar or inline editor owns the interaction until it explicitly closes.
  // Do not let a nested candidate steal that ownership while the pointer moves.
  if (toolbarActionInProgress || toolbarOwnsInteraction()) return;
  if (activeToolsTarget && activeToolsTarget !== el) closeContextTools(false);
  if (hoveredCandidate && hoveredCandidate !== el) {
    hoveredCandidate.classList.remove("xyle-hover");
  }
  hoveredCandidate = el;
  el.classList.add("xyle-hover");
  el.setAttribute("data-xyle-generated-hover", "");
  toolbarPhase = "hovered";
  if (!session && !activeTools) setInteractionMode("hover");
  refreshEditabilityOverlay();
}

function endCandidateHover(el: HTMLElement): void {
  window.clearTimeout(hoverClearTimer);
  if (activeToolsTarget === el || toolbarOwnsInteraction()) return;
  hoverClearTimer = window.setTimeout(() => {
    if (hoveredCandidate !== el || activeToolsTarget === el || session?.el === el) return;
    el.classList.remove("xyle-hover");
    el.removeAttribute("data-xyle-generated-hover");
    hoveredCandidate = null;
    if (!session && !activeTools) {
      toolbarPhase = "idle";
      setInteractionMode("idle");
    }
    refreshEditabilityOverlay();
  }, 140);
}

function closeContextTools(restoreFocus = true): void {
  window.cancelAnimationFrame(formatToolsFrame);
  window.clearTimeout(contextToolsCloseTimer);
  formatToolsFrame = 0;
  toolbarGeneration += 1;
  if (activeTools) activeTools.remove();
  activeTools = null;
  const target = activeToolsReturnFocus ?? activeToolsTarget;
  activeToolsTarget = null;
  activeToolsReturnFocus = null;
  activeToolsPlacement = "below";
  toolbarPhase = "idle";
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
  toolbarPhase = "selected";
  setInteractionMode("popover");
  const generation = toolbarGeneration;
  tools.addEventListener("mouseenter", () => {
    if (activeTools !== tools || toolbarGeneration !== generation) return;
    toolbarPhase = toolbarIsInline() ? "inline" : "active";
    window.clearTimeout(hoverClearTimer);
    window.clearTimeout(contextToolsCloseTimer);
  });
  tools.addEventListener("focusin", () => {
    if (activeTools !== tools || toolbarGeneration !== generation) return;
    toolbarPhase = toolbarIsInline() ? "inline" : "active";
    window.clearTimeout(hoverClearTimer);
    window.clearTimeout(contextToolsCloseTimer);
  });
  tools.addEventListener("mouseleave", () => scheduleContextToolsClose(target, generation));
  tools.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (
        activeTools === tools &&
        toolbarGeneration === generation &&
        !tools.matches(":focus-within") &&
        !tools.matches(":hover") &&
        !toolbarIsInline() &&
        !session
      ) {
        closeContextTools(false);
      }
    }, 0);
  });
  refreshEditabilityOverlay();
}

function scheduleContextToolsClose(target: HTMLElement, generation = toolbarGeneration): void {
  if (toolbarIsInline()) return;
  window.clearTimeout(contextToolsCloseTimer);
  contextToolsCloseTimer = window.setTimeout(() => {
    if (
      toolbarGeneration === generation &&
      activeToolsTarget === target &&
      !toolbarIsInline() &&
      !activeTools?.matches(":hover") &&
      !activeTools?.matches(":focus-within") &&
      !session
    ) {
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

function groupForId(id: string): GroupDescriptor | undefined {
  return state.current?.groups.find((group) => group.id === id);
}

function groupItemForId(
  groupId: string,
  itemId: string,
): GroupDescriptor["items"][number] | undefined {
  return groupForId(groupId)?.items.find((item) => item.id === itemId);
}

function groupItemsInDom(groupId: string): GroupItemDescriptor[] {
  const group = groupForId(groupId);
  const container = previewDoc()?.querySelector<HTMLElement>(
    `[data-xyle-group="${CSS.escape(groupId)}"]`,
  );
  if (!group || !container) return [];
  const byId = new Map(group.items.map((candidate) => [candidate.id, candidate]));
  return [...container.children]
    .map((element) => byId.get(element.getAttribute("data-xyle-group-item") ?? ""))
    .filter((candidate): candidate is GroupItemDescriptor => !!candidate);
}

function moveGroupItem(
  groupId: string,
  itemId: string,
  targetItemId: string,
  position: "before" | "after",
): { id: string; targetItemId: string; position: "before" | "after" } {
  const current = state.current;
  const group = current?.groups.find((candidate) => candidate.id === groupId);
  const item = group?.items.find((candidate) => candidate.id === itemId);
  const target = group?.items.find((candidate) => candidate.id === targetItemId);
  if (!current || !group || !item || !target || item === target) {
    throw new Error("Group moves require distinct source-backed items");
  }
  const capability = groupMoveCapability(group);
  if (!capability.supported) throw new Error(capability.reason ?? "Group movement is unavailable");
  const order = groupItemsInDom(groupId).map((candidate) => candidate.id);
  if (
    order.length !== group.items.length ||
    !order.includes(itemId) ||
    !order.includes(targetItemId)
  ) {
    throw new Error("Group item order is unavailable");
  }
  const sourceIndex = order.indexOf(itemId);
  const targetIndex = order.indexOf(targetItemId);
  const nextIndex =
    targetIndex + (position === "after" ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0);
  if (nextIndex === sourceIndex) throw new Error("Group item is already in that position");
  const operation: Op = {
    type: "moveGroupItem",
    groupId,
    itemId,
    targetItemId,
    position,
    sequence: allocateStructuralSequence(),
    groupSignature: group.signature,
    itemSignature: item.signature,
  };
  applyGroupOrderToDom(groupId, operation);
  applyOp(
    current.pagePath,
    operation,
    position === "before" ? "Move Group item before" : "Move Group item after",
  );
  return { id: itemId, targetItemId, position };
}

function showGroupItemTools(item: HTMLElement, itemDescriptor: GroupItemDescriptor): void {
  if (session || (toolbarIsInline() && activeToolsTarget !== item)) return;
  if (selectedImage && selectedImage.el !== item) {
    hideImageTools(selectedImage.el);
    selectedImage = null;
  }
  const overlay = shellOverlay();
  if (!overlay) return;
  const groupId = item.closest<HTMLElement>("[data-xyle-group]")?.dataset.xyleGroup;
  if (!groupId) return;
  const group = groupForId(groupId);
  if (!group) return;
  const tools = document.createElement("div");
  tools.className = "xyle-link-tools xyle-group-item-tools";
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "Group item actions");
  const capability = groupMoveCapability(group);
  const order = groupItemsInDom(groupId);
  const index = order.findIndex((candidate) => candidate.id === itemDescriptor.id);
  const addMove = (
    label: string,
    target: GroupItemDescriptor | undefined,
    position: "before" | "after",
  ): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (!capability.supported || !target) {
      button.disabled = true;
      if (!capability.supported)
        button.title = capability.reason ?? "Group movement is unavailable";
    } else {
      button.addEventListener("click", () => {
        moveGroupItem(groupId, itemDescriptor.id, target.id, position);
        closeContextTools(false);
      });
    }
    tools.append(button);
  };
  addMove("Move earlier", order[index - 1], "before");
  addMove("Move later", order[index + 1], "after");
  const duplicate = document.createElement("button");
  duplicate.type = "button";
  duplicate.textContent = "Duplicate item";
  duplicate.addEventListener("click", () => {
    duplicateGroupItem(groupId, itemDescriptor.id);
    closeContextTools(false);
  });
  tools.append(duplicate);
  registerContextTools(tools, item, "above");
  overlay.append(tools);
  positionContextTools(tools, previewElementRect(item), "above");
}

function editablePreviewTargets(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>("[data-xyle-keyboard-target]")].filter(
    (target) => !target.closest("[hidden]") && target.getClientRects().length > 0,
  );
}

function addGeneratedPreviewAttribute(
  el: HTMLElement,
  attribute: string,
  value: string,
  marker: string,
): void {
  if (el.hasAttribute(attribute)) return;
  el.setAttribute(attribute, value);
  el.setAttribute(marker, "");
}

function previewArrowDirection(key: string): -1 | 0 | 1 {
  if (key === "ArrowDown" || key === "ArrowRight") return 1;
  if (key === "ArrowUp" || key === "ArrowLeft") return -1;
  return 0;
}

function makePreviewTargetKeyboardAccessible(el: HTMLElement, description: string): void {
  el.setAttribute("data-xyle-keyboard-target", "");
  if (!el.hasAttribute("tabindex")) {
    const hasCurrentTarget = Boolean(
      el.ownerDocument.querySelector('[data-xyle-generated-tabindex][tabindex="0"]'),
    );
    el.tabIndex = hasCurrentTarget ? -1 : 0;
    el.setAttribute("data-xyle-generated-tabindex", "");
  }
  addGeneratedPreviewAttribute(
    el,
    "aria-description",
    description,
    "data-xyle-generated-aria-description",
  );
  addGeneratedPreviewAttribute(
    el,
    "aria-keyshortcuts",
    "Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight",
    "data-xyle-generated-aria-keyshortcuts",
  );
  el.addEventListener("focus", () => {
    if (!el.hasAttribute("data-xyle-generated-tabindex")) return;
    for (const target of editablePreviewTargets(el.ownerDocument)) {
      if (target.hasAttribute("data-xyle-generated-tabindex"))
        target.tabIndex = target === el ? 0 : -1;
    }
  });
  el.addEventListener("keydown", (event) => {
    if (session || event.altKey || event.ctrlKey || event.metaKey) return;
    const direction = previewArrowDirection(event.key);
    if (direction === 0) return;
    const targets = editablePreviewTargets(el.ownerDocument);
    const currentIndex = targets.indexOf(el);
    if (currentIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    targets[(currentIndex + direction + targets.length) % targets.length]?.focus();
  });
}

function wireGroupMarker(el: HTMLElement): void {
  el.addEventListener("mouseenter", () => beginCandidateHover(el));
  el.addEventListener("mouseleave", () => endCandidateHover(el));
  el.addEventListener("focus", () => refreshEditabilityOverlay());
  el.addEventListener("blur", () => refreshEditabilityOverlay());
}

function wireGroupItemMarker(el: HTMLElement): void {
  wireGroupMarker(el);
  makePreviewTargetKeyboardAccessible(
    el,
    "Editable group item. Press Enter or Space to open item actions. Use arrow keys to move between editable items.",
  );
  const showTools = (): void => {
    const groupId = el.closest<HTMLElement>("[data-xyle-group]")?.dataset.xyleGroup;
    const itemId = el.dataset.xyleGroupItem;
    const item = groupId && itemId ? groupItemForId(groupId, itemId) : undefined;
    if (groupId && item && !toolbarOwnsInteraction()) showGroupItemTools(el, item);
  };
  el.addEventListener("pointerdown", (event) => {
    const target = event.target as Element | null;
    if (target?.closest("[data-xyle-node]")) return;
    showTools();
  });
  el.addEventListener("focus", showTools);
  el.addEventListener("keydown", (event) => {
    if (session || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    showTools();
  });
}

function wireCandidate(el: HTMLElement, meta: NodeMeta | undefined): void {
  if (!meta) return;
  const targetName =
    meta.kind === "text"
      ? "text"
      : meta.kind === "link"
        ? "link"
        : meta.kind === "image"
          ? "image"
          : "section";
  makePreviewTargetKeyboardAccessible(
    el,
    `Editable ${targetName}. Press Enter or Space to edit. Use arrow keys to move between editable items.`,
  );
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
  if (meta.kind === "section") wireSection(el, meta);
}

function wireSection(el: HTMLElement, meta: NodeMeta): void {
  el.addEventListener("pointerdown", (event) => {
    if (event.target === el) showSectionTools(el, meta);
  });
  el.addEventListener("keydown", (event) => {
    if (session || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    showSectionTools(el, meta, true);
  });
}

interface LayoutCapability {
  supported: boolean;
  reason?: string;
  baseline?: LayoutPreset;
  current?: LayoutPreset;
}

const LAYOUT_PREVIEW_STYLE_ID = "xyle-layout-preview-rules";

function layoutTargetForId(id: string): LayoutTargetDescriptor | undefined {
  return state.current?.layouts.find((target) => target.id === id);
}

function ensureLayoutPreviewStyle(doc: Document): void {
  if (
    doc.getElementById(LAYOUT_PREVIEW_STYLE_ID) ||
    doc.documentElement.dataset.xyleLayoutPreviewSheet === "true"
  )
    return;
  try {
    const Sheet = doc.defaultView?.CSSStyleSheet;
    if (!Sheet) throw new Error("constructed stylesheets are unavailable");
    const sheet = new Sheet();
    sheet.replaceSync(LAYOUT_CSS);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    doc.documentElement.dataset.xyleLayoutPreviewSheet = "true";
    return;
  } catch {
    const style = doc.createElement("style");
    style.id = LAYOUT_PREVIEW_STYLE_ID;
    style.textContent = LAYOUT_CSS;
    doc.head.append(style);
  }
}

function layoutRegions(section: HTMLElement): HTMLElement[] {
  return [...section.children].filter(
    (child): child is HTMLElement => !child.hasAttribute("data-xyle-group-item"),
  );
}

function classifyLayout(section: HTMLElement, regions: HTMLElement[]): LayoutPreset | null {
  const view = section.ownerDocument.defaultView;
  if (!view || regions.length !== 2) return null;
  const style = view.getComputedStyle(section);
  const rects = regions.map((region) => region.getBoundingClientRect());
  if (rects.some((rect) => rect.width <= 0 || rect.height <= 0)) return null;
  if (style.display === "flex" && style.flexDirection === "row" && style.flexWrap === "nowrap") {
    return rects[1]!.left >= rects[0]!.right - 0.5 ? "two-column" : null;
  }
  if (style.display === "grid" && !style.gridAutoFlow.includes("dense")) {
    return rects[1]!.left > rects[0]!.left + 0.5 &&
      Math.abs(rects[1]!.top - rects[0]!.top) < Math.max(rects[0]!.height, rects[1]!.height) * 0.25
      ? "two-column"
      : rects[1]!.top >= rects[0]!.bottom - 0.5
        ? "stacked"
        : null;
  }
  return rects[1]!.top >= rects[0]!.bottom - 0.5 ? "stacked" : null;
}

function verifyLayoutPreset(
  section: HTMLElement,
  regions: HTMLElement[],
  preset: LayoutPreset,
): boolean {
  const view = section.ownerDocument.defaultView;
  if (!view || regions.length !== 2) return false;
  const computed = view.getComputedStyle(section);
  if (computed.display !== "grid") return false;
  const rects = regions.map((region) => region.getBoundingClientRect());
  if (rects.some((rect) => rect.width <= 0 || rect.height <= 0)) return false;
  if (preset === "stacked" || view.matchMedia("(max-width: 48rem)").matches) {
    return rects[1]!.top >= rects[0]!.bottom - 0.5;
  }
  return (
    rects[1]!.left >= rects[0]!.right - 0.5 &&
    Math.abs(rects[1]!.top - rects[0]!.top) < Math.max(rects[0]!.height, rects[1]!.height) * 0.25
  );
}

function layoutCapability(target: LayoutTargetDescriptor): LayoutCapability {
  const doc = previewDoc();
  const section = doc?.querySelector<HTMLElement>(`[data-xyle-node="${CSS.escape(target.id)}"]`);
  if (!doc || !section) return { supported: false, reason: "Layout target is unavailable" };
  ensureLayoutPreviewStyle(doc);
  const regions = layoutRegions(section);
  if (
    regions.length !== 2 ||
    regions.some(
      (region) =>
        region.hasAttribute("data-xyle-group") ||
        region.querySelector("section,form,iframe,video,canvas,script") !== null,
    )
  ) {
    return { supported: false, reason: "Layout requires two safe direct regions" };
  }
  const view = doc.defaultView;
  if (!view) return { supported: false, reason: "Layout capability is unavailable" };
  const targetStyle = view.getComputedStyle(section);
  const regionStyles = regions.map((region) => view.getComputedStyle(region));
  if (
    targetStyle.direction !== "ltr" ||
    targetStyle.writingMode !== "horizontal-tb" ||
    targetStyle.position === "absolute" ||
    targetStyle.position === "fixed" ||
    targetStyle.position === "sticky" ||
    targetStyle.transform !== "none" ||
    targetStyle.columnCount !== "auto" ||
    regionStyles.some(
      (style) =>
        style.display === "contents" ||
        style.direction !== "ltr" ||
        style.writingMode !== "horizontal-tb" ||
        style.position !== "static" ||
        style.float !== "none" ||
        style.transform !== "none" ||
        style.order !== "0",
    )
  ) {
    return { supported: false, reason: "Layout uses unsupported positioning or writing mode" };
  }
  const authoredAttribute = section.getAttribute(LAYOUT_ATTRIBUTE);
  const authoredManaged = layoutPresetFromAttribute(authoredAttribute);
  if (authoredAttribute !== null && !authoredManaged) {
    return { supported: false, reason: "Layout metadata is not recognised" };
  }
  section.removeAttribute(LAYOUT_ATTRIBUTE);
  const baseline = classifyLayout(section, regions);
  if (authoredManaged)
    section.setAttribute(LAYOUT_ATTRIBUTE, layoutAttributeValue(authoredManaged));
  else section.removeAttribute(LAYOUT_ATTRIBUTE);
  if (!baseline) return { supported: false, reason: "Authored layout is ambiguous" };
  const current = authoredManaged ?? baseline;
  for (const preset of ["stacked", "two-column"] as const) {
    section.setAttribute(LAYOUT_ATTRIBUTE, layoutAttributeValue(preset));
    if (!verifyLayoutPreset(section, regions, preset)) {
      if (authoredManaged)
        section.setAttribute(LAYOUT_ATTRIBUTE, layoutAttributeValue(authoredManaged));
      else section.removeAttribute(LAYOUT_ATTRIBUTE);
      return {
        supported: false,
        reason: `${preset === "stacked" ? "Stack" : "Split"} is defeated by authored CSS`,
      };
    }
  }
  if (authoredManaged)
    section.setAttribute(LAYOUT_ATTRIBUTE, layoutAttributeValue(authoredManaged));
  else section.removeAttribute(LAYOUT_ATTRIBUTE);
  target.baseline = baseline;
  return { supported: true, baseline, current };
}

function regionElements(target: LayoutTargetDescriptor): [HTMLElement, HTMLElement] | null {
  const section = previewDoc()?.querySelector<HTMLElement>(
    `[data-xyle-node="${CSS.escape(target.id)}"]`,
  );
  if (!section) return null;
  const regions = target.regions.map((region) =>
    section.querySelector<HTMLElement>(`[${LAYOUT_REGION_ATTRIBUTE}="${CSS.escape(region.id)}"]`),
  );
  if (
    regions.length !== 2 ||
    !regions[0] ||
    !regions[1] ||
    regions[0].parentElement !== section ||
    regions[1].parentElement !== section ||
    regions[0] === regions[1]
  )
    return null;
  return [regions[0], regions[1]];
}

function regionOrderInDom(target: LayoutTargetDescriptor): RegionOrder | null {
  const regions = regionElements(target);
  if (!regions) return null;
  const children = [...regions[0].parentElement!.children];
  const first = children.indexOf(regions[0]);
  const second = children.indexOf(regions[1]);
  if (first < 0 || second < 0 || first === second) return null;
  return first < second ? "original" : "swapped";
}

function applyRegionOrderToDom(target: LayoutTargetDescriptor, order: RegionOrder): boolean {
  const regions = regionElements(target);
  if (!regions) return false;
  const [first, second] = regions;
  if (order === "original") first.parentElement!.insertBefore(first, second);
  else first.parentElement!.insertBefore(second, first);
  return true;
}

function verifyRegionOrder(target: LayoutTargetDescriptor, order: RegionOrder): boolean {
  const regions = regionElements(target);
  if (!regions) return false;
  const [first, second] = regions;
  if (regionOrderInDom(target) !== order) return false;
  const view = first.ownerDocument.defaultView;
  if (!view) return false;
  const sectionStyle = view.getComputedStyle(first.parentElement!);
  const styles = regions.map((region) => view.getComputedStyle(region));
  if (
    sectionStyle.position === "absolute" ||
    sectionStyle.position === "fixed" ||
    sectionStyle.position === "sticky" ||
    sectionStyle.transform !== "none" ||
    sectionStyle.direction !== "ltr" ||
    sectionStyle.writingMode !== "horizontal-tb" ||
    (sectionStyle.display === "flex" &&
      (sectionStyle.flexDirection.endsWith("-reverse") || sectionStyle.flexWrap !== "nowrap")) ||
    (sectionStyle.display === "grid" &&
      (sectionStyle.gridAutoFlow.includes("dense") ||
        styles.some(
          (style) =>
            style.gridColumnStart !== "auto" ||
            style.gridColumnEnd !== "auto" ||
            style.gridRowStart !== "auto" ||
            style.gridRowEnd !== "auto",
        ))) ||
    styles.some(
      (style) =>
        style.order !== "0" ||
        style.position !== "static" ||
        style.transform !== "none" ||
        style.float !== "none",
    )
  )
    return false;
  const ordered = order === "original" ? [first, second] : [second, first];
  const firstRect = ordered[0]!.getBoundingClientRect();
  const secondRect = ordered[1]!.getBoundingClientRect();
  if (
    firstRect.width <= 0 ||
    firstRect.height <= 0 ||
    secondRect.width <= 0 ||
    secondRect.height <= 0
  )
    return false;
  const overlapX =
    Math.min(firstRect.right, secondRect.right) - Math.max(firstRect.left, secondRect.left);
  const overlapY =
    Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top);
  if (overlapX > 0.5 && overlapY > 0.5) return false;
  const follows =
    secondRect.top >= firstRect.bottom - 0.5 ||
    (secondRect.left >= firstRect.right - 0.5 &&
      Math.abs(secondRect.top - firstRect.top) <
        Math.max(firstRect.height, secondRect.height) * 0.25);
  return follows;
}

function canSetRegionOrder(target: LayoutTargetDescriptor, order: RegionOrder): boolean {
  const current = regionOrderInDom(target);
  const regions = regionElements(target);
  if (!current || !regions || current === order) return true;
  applyRegionOrderToDom(target, order);
  try {
    const section = regions[0].parentElement;
    if (section) void section.offsetHeight;
    return verifyRegionOrder(target, order);
  } finally {
    applyRegionOrderToDom(target, current);
  }
}

function setRegionOrder(targetId: string, order: RegionOrder): { id: string; order: RegionOrder } {
  const current = state.current;
  const target = current?.layouts.find((candidate) => candidate.id === targetId);
  if (!current || !target) throw new Error("Region order target is unavailable");
  const layout = layoutCapability(target);
  if (!layout.supported) throw new Error(layout.reason ?? "Region order is unavailable");
  if (session) commitEdit();
  reconcileRichContent(current.pagePath);
  const previous = state.ops.find(
    (entry) =>
      entry.pagePath === current.pagePath && opKey(entry.op) === `setRegionOrder@${targetId}`,
  );
  const currentOrder = regionOrderInDom(target);
  if (!currentOrder) throw new Error("Region order is unavailable");
  if (order === currentOrder && !previous) return { id: targetId, order };
  if (!canSetRegionOrder(target, order)) throw new Error("Region order is not supported");
  const operation: SetRegionOrderOperation = {
    type: "setRegionOrder",
    targetId,
    firstRegionId: target.regions[0]!.id,
    secondRegionId: target.regions[1]!.id,
    order,
    targetSignature: target.signature,
    regionSignatures: [target.regions[0]!.signature, target.regions[1]!.signature],
    sequence: allocateStructuralSequence(),
  };
  applyRegionOrderToDom(target, order);
  applyOp(current.pagePath, operation, "Swap order", order === "original" ? null : operation);
  return { id: targetId, order };
}

function setLayoutPreset(
  targetId: string,
  preset: LayoutPreset,
): { id: string; preset: LayoutPreset } {
  const current = state.current;
  const target = current?.layouts.find((candidate) => candidate.id === targetId);
  if (!current || !target) throw new Error("Layout target is unavailable");
  const capability = layoutCapability(target);
  if (!capability.supported || !capability.baseline)
    throw new Error(capability.reason ?? "Layout is unavailable");
  const key = opKey({
    type: "setLayoutPreset",
    nodeId: targetId,
    preset,
    baseline: target.baseline,
    targetSignature: target.signature,
    regionSignatures: target.regions.map((region) => region.signature) as [string, string],
  });
  const previous = state.ops.find(
    (entry) => entry.pagePath === current.pagePath && opKey(entry.op) === key,
  );
  if (preset === capability.current && !previous) return { id: targetId, preset };
  const sourceManaged = target.managedPreset;
  const operation: SetLayoutPresetOperation = {
    type: "setLayoutPreset",
    nodeId: targetId,
    preset,
    baseline: capability.baseline,
    targetSignature: target.signature,
    regionSignatures: target.regions.map((region) => region.signature) as [string, string],
  };
  const pending = preset === (sourceManaged ?? capability.baseline) ? null : operation;
  if (pending) applyLayoutToDom(current.pagePath, operation);
  applyOp(
    current.pagePath,
    operation,
    preset === "stacked" ? "Set layout to Stack" : "Set layout to Split",
    pending,
  );
  if (!pending) restoreLayoutToDom(current.pagePath, target);
  return { id: targetId, preset };
}

function listLayoutOptions(targetId: string): {
  id: string;
  current: LayoutPreset;
  baseline: LayoutPreset;
  options: LayoutPreset[];
} {
  const target = layoutTargetForId(targetId);
  if (!target) throw new Error("Layout target is unavailable");
  const capability = layoutCapability(target);
  if (!capability.supported || !capability.baseline || !capability.current)
    throw new Error(capability.reason ?? "Layout is unavailable");
  return {
    id: targetId,
    current: capability.current,
    baseline: capability.baseline,
    options: ["stacked", "two-column"],
  };
}

function applyLayoutToDom(pagePath: string, op: SetLayoutPresetOperation): void {
  if (pagePath !== state.current?.pagePath) return;
  const target = layoutTargetForId(op.nodeId);
  const section = target
    ? previewDoc()?.querySelector<HTMLElement>(`[data-xyle-node="${CSS.escape(target.id)}"]`)
    : null;
  if (section) {
    if (op.preset === op.baseline) section.removeAttribute(LAYOUT_ATTRIBUTE);
    else section.setAttribute(LAYOUT_ATTRIBUTE, layoutAttributeValue(op.preset));
  }
}

function restoreLayoutToDom(pagePath: string, target: LayoutTargetDescriptor): void {
  if (pagePath !== state.current?.pagePath) return;
  const section = previewDoc()?.querySelector<HTMLElement>(
    `[data-xyle-node="${CSS.escape(target.id)}"]`,
  );
  if (!section) return;
  if (target.managedPreset)
    section.setAttribute(LAYOUT_ATTRIBUTE, layoutAttributeValue(target.managedPreset));
  else section.removeAttribute(LAYOUT_ATTRIBUTE);
}

function showSectionTools(section: HTMLElement, meta: NodeMeta, focusFirst = false): void {
  if (!session && (!toolbarIsInline() || activeToolsTarget === section)) {
    const overlay = shellOverlay();
    if (!overlay) return;
    const tools = document.createElement("div");
    tools.className = "xyle-link-tools xyle-section-tools";
    tools.setAttribute("role", "toolbar");
    tools.setAttribute("aria-label", "Section actions");

    const layoutTarget = layoutTargetForId(meta.id);
    if (layoutTarget) {
      const capability = layoutCapability(layoutTarget);
      const layoutTools = document.createElement("div");
      layoutTools.className = "xyle-layout-tools";
      const label = document.createElement("strong");
      label.textContent = "Layout";
      layoutTools.append(label);
      for (const [preset, text] of [
        ["stacked", "Stack"],
        ["two-column", "Split"],
      ] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.disabled = !capability.supported;
        if (!capability.supported) button.title = capability.reason ?? "Layout is unavailable";
        else
          button.addEventListener("click", () => {
            setLayoutPreset(meta.id, preset);
            closeContextTools(false);
          });
        layoutTools.append(button);
      }
      tools.append(layoutTools);
      const currentOrder = regionOrderInDom(layoutTarget);
      const orderTools = document.createElement("div");
      orderTools.className = "xyle-layout-tools";
      const orderLabel = document.createElement("strong");
      orderLabel.textContent = "Order";
      const orderButton = document.createElement("button");
      orderButton.type = "button";
      orderButton.textContent = "Swap order";
      const nextOrder: RegionOrder = currentOrder === "swapped" ? "original" : "swapped";
      const orderSupported = capability.supported && canSetRegionOrder(layoutTarget, nextOrder);
      orderButton.disabled = !orderSupported;
      if (!orderSupported) orderButton.title = capability.reason ?? "Region order is unavailable";
      else
        orderButton.addEventListener("click", () => {
          setRegionOrder(meta.id, nextOrder);
          closeContextTools(false);
        });
      orderTools.append(orderLabel, orderButton);
      tools.append(orderTools);
    }

    const parent = section.parentElement;
    const siblings = parent ? sectionChildren(parent) : [];
    const structuralIntegrity = !!parent && siblings.length === parent.children.length;
    const structuralReason = "Section actions require supported sibling sections";
    const duplicate = document.createElement("button");
    duplicate.type = "button";
    duplicate.textContent = "Duplicate section";
    duplicate.disabled = !structuralIntegrity;
    if (!structuralIntegrity) duplicate.title = structuralReason;
    else
      duplicate.addEventListener("click", () => {
        duplicateSection(meta.id);
        closeContextTools(false);
      });
    tools.append(duplicate);

    const visibility = document.createElement("button");
    visibility.type = "button";
    visibility.textContent = section.hidden ? "Show section" : "Hide section";
    visibility.addEventListener("click", () => {
      updateSectionVisibility(meta.id, Boolean(section.hidden));
      closeContextTools(false);
    });
    tools.append(visibility);

    const index = siblings.indexOf(section);
    const addMove = (label: string, target: HTMLElement | undefined, before: boolean): void => {
      if (!target) return;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = !structuralIntegrity;
      if (!structuralIntegrity) button.title = structuralReason;
      else
        button.addEventListener("click", () => {
          moveSection(meta.id, target.getAttribute("data-xyle-node")!, before);
          closeContextTools(false);
        });
      tools.append(button);
    };
    addMove("Move up", siblings[index - 1], true);
    addMove("Move down", siblings[index + 1], false);
    registerContextTools(tools, section, "above");
    overlay.append(tools);
    positionContextTools(tools, previewElementRect(section), "above");
    if (focusFirst) tools.querySelector("button")?.focus();
  }
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
  for (const el of doc.querySelectorAll<HTMLElement>(
    "[data-xyle-node], [data-xyle-group], [data-xyle-group-item]",
  )) {
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
    if (session?.el === el) {
      if (!el.isContentEditable) {
        startEdit(el, meta);
      } else if (previewDoc()?.activeElement !== el) {
        el.focus({ preventScroll: true });
      }
      return;
    }
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
  baselineHtml: string;
  baselineSkeleton: string;
  baselineAuthoredBreakCount: number;
  baselineStartsWithNbsp: boolean;
  baselineEndsWithNbsp: boolean;
  authoredContentEditable: string | null;
}

let session: EditSession | null = null;
let pendingKeyboardSelection: Range | null = null;
let lastNonCollapsedSelection: Range | null = null;
let blockSelectionCapture = false;

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
 * Structural identity for one server-backed text segment. Editor-owned format
 * wrappers are transparent; authored breaks and source inline elements remain
 * boundaries between source text nodes.
 */
function isControlledBreak(node: Node): node is HTMLBRElement {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).tagName === "BR" &&
    (controlledBreaks.has(node as HTMLBRElement) ||
      (node as HTMLElement).hasAttribute("data-xyle-controlled-break"))
  );
}

function isFormatWrapper(node: Node): node is HTMLElement {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const marker = (node as HTMLElement).getAttribute("data-xyle-format");
  return marker === "bold" || marker === "italic" || marker === "underline";
}

function slotKeyOf(target: Node, root: HTMLElement): string {
  let nextKey = 0;
  let currentKey: string | null = null;
  let foundKey = "";

  const visit = (node: Node, isRoot = false): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? "") && currentKey === null) currentKey = `s${nextKey++}`;
      if (node === target) {
        foundKey = currentKey ?? "";
        return true;
      }
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const element = node as HTMLElement;
    if (!isRoot && isNestedCandidate(element, root)) {
      currentKey = null;
      return false;
    }
    if (!isRoot && SKIP_TAGS.has(element.tagName.toLowerCase())) {
      currentKey = null;
      return false;
    }
    if (element.tagName === "BR") {
      if (!isControlledBreak(element)) currentKey = null;
      return false;
    }

    const transparent = !isRoot && isFormatWrapper(element);
    if (!transparent) currentKey = null;
    for (const child of element.childNodes) {
      if (visit(child)) return true;
    }
    if (!transparent) currentKey = null;
    return false;
  };

  visit(root, true);
  return foundKey;
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
  let openKey: string | null = null;

  const walk = (node: Node, isRoot = false): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      if (!value) return;
      openKey = slotKeyOf(node, rootEl);
      let parts = seen.get(openKey);
      if (!parts) {
        parts = [""];
        seen.set(openKey, parts);
        pairs.push({ key: openKey, value: "" });
      }
      parts[parts.length - 1] += value;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      openKey = null;
      return;
    }
    const element = node as HTMLElement;
    if (!isRoot && isNestedCandidate(element, rootEl)) {
      openKey = null;
      return;
    }
    if (element.tagName === "BR") {
      if (openKey !== null && isControlledBreak(element)) seen.get(openKey)?.push("");
      else openKey = null;
      return;
    }
    if (!isRoot && SKIP_TAGS.has(element.tagName.toLowerCase())) {
      openKey = null;
      return;
    }
    const transparent = !isRoot && isFormatWrapper(element);
    if (!transparent) openKey = null;
    for (const child of element.childNodes) walk(child);
    if (!transparent) openKey = null;
  };
  walk(rootEl, true);

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
  savedFormatSelection = null;
  const baselineHtml = cleanInlineHtml(el);
  if (!originalMarkups.has(segmentIdentity(meta.pagePath, meta.id))) {
    originalMarkups.set(segmentIdentity(meta.pagePath, meta.id), baselineHtml);
  }
  session = {
    el,
    meta,
    baselineClone,
    baselineValues: baselinePairs.map((p) => p.value),
    baselineKeys: baselinePairs.map((p) => p.key),
    baselineHtml,
    baselineSkeleton: skeleton(el),
    baselineAuthoredBreakCount: authoredBreakCount(el),
    baselineStartsWithNbsp: (el.textContent ?? "").startsWith("\u00a0"),
    baselineEndsWithNbsp: (el.textContent ?? "").endsWith("\u00a0"),
    authoredContentEditable: el.getAttribute("contenteditable"),
  };
  const activeSession = session;

  for (const [i, value] of activeSession.baselineValues.entries()) {
    rememberOriginalSegment(meta.pagePath, `${meta.id}#${i}`, value);
  }

  // SAFETY: contentEditable is a standard HTMLElement property, but the local
  // DOM type omits the editor's writable assignment.
  (el as unknown as { contentEditable: string }).contentEditable = "true";
  el.classList.add("xyle-editing");
  el.setAttribute("data-xyle-generated-editing", "");
  setInteractionMode("editing");
  refreshEditabilityOverlay();
  el.focus({ preventScroll: true });

  el.addEventListener("beforeinput", onBeforeInput);
  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("keyup", onKeyUp);
  el.addEventListener("mouseup", scheduleFormatTools);
  el.addEventListener("paste", onPaste, true);
  scheduleFormatTools();
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
  if (text.includes("\n")) {
    flash("Line-break editing is deferred.");
    return;
  }
  const win = iframe.contentWindow!;
  win.document.execCommand("insertText", false, text);
}

function onKeyDown(event: KeyboardEvent): void {
  if (!session) return;
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    rememberNonCollapsedSelection();
    pendingKeyboardSelection = lastNonCollapsedSelection?.cloneRange() ?? null;
    if (pendingKeyboardSelection) {
      lastNonCollapsedSelection = null;
      blockSelectionCapture = true;
    }
  }
  if (event.key === "Escape") {
    event.preventDefault();
    revertEdit();
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    // Native contenteditable handling turns boundary spaces into NBSP and
    // anchor/ancestor handlers may consume the key. Insert the literal space
    // through the same plain-text path used by paste instead.
    insertKeyboardText(" ");
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    flash("Line-break editing is deferred.");
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    if (!event.altKey && /^[bBuUiI]$/.test(event.key)) {
      event.preventDefault();
      const format =
        event.key.toLowerCase() === "b"
          ? "bold"
          : event.key.toLowerCase() === "i"
            ? "italic"
            : "underline";
      const selected = getFormatSelection();
      if (!selected) {
        flash("Select text to format it.");
        return;
      }
      updateFormatting(session.meta.id, format, selected);
      scheduleFormatTools();
      return;
    }
    if (event.altKey && /^[1-6]$/.test(event.key)) {
      event.preventDefault();
      updateFormatting(session.meta.id, `heading-${event.key}` as BlockFormatting);
    }
  }
}

/** Selection lives in the preview window, not the shell. */
function previewSelection(): Selection | null {
  return iframe?.contentWindow?.getSelection() ?? null;
}

interface FormatSelection {
  /** Visible text offsets used to replay the operation in the preview. */
  start: number;
  end: number;
  /** Exact source offsets used by the byte-preserving HTML patcher when unchanged. */
  sourceStart?: number;
  sourceEnd?: number;
  range: Range;
  rect: ViewportRect;
}

function formattingTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function visibleOffsetForBoundary(
  root: HTMLElement,
  container: Node,
  offset: number,
): number | null {
  if (!root.contains(container) || offset < 0) return null;
  const before = root.ownerDocument.createRange();
  try {
    before.setStart(root, 0);
    before.setEnd(container, offset);
  } catch {
    return null;
  }
  return before.toString().length;
}

function getFormatSelection(): FormatSelection | null {
  const selection = previewSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !session) return null;
  const range = selection.getRangeAt(0);
  if (!session.el.contains(range.startContainer) || !session.el.contains(range.endContainer)) {
    return null;
  }
  const start = visibleOffsetForBoundary(session.el, range.startContainer, range.startOffset);
  const end = visibleOffsetForBoundary(session.el, range.endContainer, range.endOffset);
  if (start === null || end === null || start >= end) return null;

  const frameRect = iframe.getBoundingClientRect();
  const selectionRect = range.getBoundingClientRect();
  return {
    start,
    end,
    range: range.cloneRange(),
    rect: {
      left: frameRect.left + selectionRect.left,
      top: frameRect.top + selectionRect.top,
      right: frameRect.left + selectionRect.right,
      bottom: frameRect.top + selectionRect.bottom,
      width: selectionRect.width,
      height: selectionRect.height,
    },
  };
}

function updateFormatToolState(tools: HTMLElement, target: HTMLElement, range: Range): void {
  for (const button of tools.querySelectorAll<HTMLButtonElement>("[data-inline-format]")) {
    const format = button.dataset.inlineFormat as "bold" | "italic" | "underline";
    const state = inlineFormatState(target, range, format);
    button.dataset.state = state;
    button.setAttribute("aria-pressed", state === "on" ? "true" : "false");
  }
}

function getSelectedListGroup(): { ids: string[]; range: Range; rect: ViewportRect } | null {
  const selection = previewSelection();
  const current = state.current;
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !current) return null;
  const range = selection.getRangeAt(0);
  const blockFor = (node: Node): HTMLElement | null => {
    let element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
    while (element) {
      const id = element.dataset.xyleNode;
      const meta = id ? current.nodes.find((candidate) => candidate.id === id) : undefined;
      if (meta?.kind === "text" && meta.textEditable && (isBlockTag(meta.tag) || meta.tag === "li"))
        return element;
      element = element.parentElement;
    }
    return null;
  };
  const first = blockFor(range.startContainer);
  const last = blockFor(range.endContainer);
  const parent = first?.parentElement;
  if (!first || !last || !parent || last.parentElement !== parent || first === last) return null;
  const children = [...parent.children];
  const start = children.indexOf(first);
  const end = children.indexOf(last);
  if (start < 0 || end < start) return null;
  const elements = children.slice(start, end + 1);
  const ids: string[] = [];
  for (const element of elements) {
    const id = (element as HTMLElement).dataset.xyleNode;
    const meta = id ? current.nodes.find((candidate) => candidate.id === id) : undefined;
    if (
      !id ||
      !meta ||
      meta.kind !== "text" ||
      !meta.textEditable ||
      (meta.tag !== "p" && meta.tag !== "li") ||
      meta.segmentCount === 0
    )
      return null;
    ids.push(id);
  }
  const frameRect = iframe.getBoundingClientRect();
  const selectionRect = range.getBoundingClientRect();
  return {
    ids,
    range: range.cloneRange(),
    rect: {
      left: frameRect.left + selectionRect.left,
      top: frameRect.top + selectionRect.top,
      right: frameRect.left + selectionRect.right,
      bottom: frameRect.top + selectionRect.bottom,
      width: selectionRect.width,
      height: selectionRect.height,
    },
  };
}

function listBlockRun(element: HTMLElement): string[] {
  const current = state.current;
  const parent = element.parentElement;
  if (!current || !parent) return [];
  const children = [...parent.children];
  const index = children.indexOf(element);
  if (index < 0) return [];
  const isEligible = (candidate: Element): string | null => {
    const id = (candidate as HTMLElement).dataset.xyleNode;
    const meta = id ? current.nodes.find((entry) => entry.id === id) : undefined;
    return id &&
      meta?.kind === "text" &&
      meta.textEditable &&
      (meta.tag === "p" || meta.tag === "li") &&
      (meta.segmentCount ?? 0) > 0
      ? id
      : null;
  };
  if (!isEligible(element)) return [];
  let start = index;
  let end = index;
  while (start > 0 && isEligible(children[start - 1]!)) start -= 1;
  while (end + 1 < children.length && isEligible(children[end + 1]!)) end += 1;
  return children.slice(start, end + 1).map((child) => isEligible(child)!);
}

function showFormatTools(): void {
  if (!session) return;
  const target = session.el;
  const currentSelection = getFormatSelection();
  const listGroup = getSelectedListGroup();
  if (currentSelection) savedFormatSelection = currentSelection;
  const selected = currentSelection ?? listGroup;
  if (
    !selected ||
    (currentSelection && savedFormatSelection?.start === savedFormatSelection?.end)
  ) {
    if (activeTools?.classList.contains("xyle-format-tools")) closeContextTools(false);
    return;
  }
  if (activeTools?.classList.contains("xyle-format-tools")) {
    if (currentSelection) updateFormatToolState(activeTools, target, currentSelection.range);
    positionContextTools(activeTools, selected.rect, "above", previewElementRect(target));
    return;
  }
  const overlay = shellOverlay();
  if (!overlay) return;
  const tools = document.createElement("div");
  tools.className = "xyle-format-tools";
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "Text formatting");
  const currentSelectionForInline = currentSelection;
  const blockRunIds = listBlockRun(target);

  const addInlineButton = (format: "bold" | "italic" | "underline", label: string): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.dataset.inlineFormat = format;
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      if (!session) return;
      const currentSelection = getFormatSelection() ?? currentSelectionForInline;
      if (!currentSelection) return;
      updateFormatting(session.meta.id, format, currentSelection);
      scheduleFormatTools();
    });
    tools.append(button);
  };
  if (currentSelection) {
    addInlineButton("bold", "Bold");
    addInlineButton("italic", "Italic");
    addInlineButton("underline", "Underline");
    updateFormatToolState(tools, target, currentSelection.range);

    const separator = document.createElement("span");
    separator.setAttribute("role", "separator");
    tools.append(separator);
  }

  if (listGroup) {
    for (const [format, label] of [
      ["unordered-list", "Bulleted list"],
      ["ordered-list", "Numbered list"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        toggleListFormatting(listGroup.ids, format);
        closeContextTools(false);
      });
      tools.append(button);
    }
    registerContextTools(tools, target, "above");
    overlay.append(tools);
    positionContextTools(tools, selected.rect, "above", previewElementRect(target));
    return;
  }

  const block = document.createElement("select");
  block.setAttribute("aria-label", "Block style");
  block.setAttribute("title", "Block style");
  for (const [value, label] of [
    ["paragraph", "Paragraph"],
    ["heading-1", "Heading 1"],
    ["heading-2", "Heading 2"],
    ["heading-3", "Heading 3"],
    ["heading-4", "Heading 4"],
    ["heading-5", "Heading 5"],
    ["heading-6", "Heading 6"],
    ["unordered-list", "Bulleted list"],
    ["ordered-list", "Numbered list"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    block.append(option);
  }
  const currentBlockTag = session.el.tagName.toLowerCase();
  const currentListTag =
    currentBlockTag === "li" && session.el.parentElement
      ? session.el.parentElement.tagName.toLowerCase()
      : "";
  block.value = isBlockTag(currentBlockTag)
    ? blockFormattingFor(currentBlockTag)
    : isListTag(currentBlockTag)
      ? blockFormattingFor(currentBlockTag)
      : isListTag(currentListTag)
        ? blockFormattingFor(currentListTag)
        : "paragraph";
  block.disabled = !isBlockTag(session.meta.tag) && session.meta.tag !== "li";
  block.addEventListener("pointerdown", (event) => event.preventDefault());
  block.addEventListener("change", () => {
    if (!session) return;
    const format = block.value as Formatting;
    if (format === "unordered-list" || format === "ordered-list") {
      const ids = getSelectedListGroup()?.ids ?? blockRunIds;
      toggleListFormatting(ids.length > 0 ? ids : [session.meta.id], format);
    } else {
      updateFormatting(session.meta.id, format);
    }
    closeContextTools(false);
  });
  tools.append(block);
  registerContextTools(tools, target, "above");
  overlay.append(tools);
  positionContextTools(tools, selected.rect, "above", previewElementRect(target));
}

function scheduleFormatTools(): void {
  window.cancelAnimationFrame(formatToolsFrame);
  formatToolsFrame = window.requestAnimationFrame(() => {
    formatToolsFrame = 0;
    showFormatTools();
  });
}

function normalizeInsertedBoundarySpaces(activeSession: EditSession): void {
  const text = activeSession.el.textContent ?? "";
  const nodes = formattingTextNodes(activeSession.el).filter((node) => node.length > 0);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) return;
  if (!activeSession.baselineStartsWithNbsp && text.startsWith("\u00a0")) {
    first.data = first.data.replace(/^\u00a0/, " ");
  }
  if (!activeSession.baselineEndsWithNbsp && text.endsWith("\u00a0")) {
    last.data = last.data.replace(/\u00a0$/, " ");
  }
}

function rememberNonCollapsedSelection(): void {
  if (blockSelectionCapture) return;
  if (!session) {
    lastNonCollapsedSelection = null;
    return;
  }
  const selection = previewSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (session.el.contains(range.startContainer) && session.el.contains(range.endContainer)) {
    lastNonCollapsedSelection = range.cloneRange();
  }
}

function restorePendingKeyboardSelection(): void {
  if (!pendingKeyboardSelection) return;
  const selection = previewSelection();
  if (selection && session) {
    session.el.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(pendingKeyboardSelection);
  }
  pendingKeyboardSelection = null;
}

function insertKeyboardText(value: string): void {
  if (!pendingKeyboardSelection) {
    iframe.contentWindow?.document.execCommand("insertText", false, value);
    return;
  }
  restorePendingKeyboardSelection();
  insertPlainTextAtSelection(value);
}

function insertPlainTextAtSelection(value: string): void {
  const selection = previewSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const doc = range.startContainer.ownerDocument;
  if (!doc) return;
  const text = doc.createTextNode(value);
  range.deleteContents();
  range.insertNode(text);
  selection.removeAllRanges();
  selection.collapse(text, text.length);
  validateStructure();
}

function onBeforeInput(event: InputEvent): void {
  if (!session) return;
  if (event.inputType === "insertText" && event.data && !event.isComposing) {
    event.preventDefault();
    insertKeyboardText(event.data);
    return;
  }
  switch (event.inputType) {
    case "insertParagraph":
    case "insertLineBreak":
      event.preventDefault();
      flash("Line-break editing is deferred.");
      return;
    case "formatBold":
    case "formatItalic":
    case "formatUnderline": {
      event.preventDefault();
      if (!session) {
        flash("Formatting is not supported outside an edit session.");
        return;
      }
      const format =
        event.inputType === "formatBold"
          ? "bold"
          : event.inputType === "formatItalic"
            ? "italic"
            : "underline";
      const selected = getFormatSelection();
      if (!selected) {
        flash("Select text to format it.");
        return;
      }
      updateFormatting(session.meta.id, format, selected);
      scheduleFormatTools();
      return;
    }
    case "formatBlock": {
      event.preventDefault();
      const rawFormat = event.data?.replace(/[<>]/g, "").toLowerCase();
      const format =
        rawFormat === "p"
          ? "paragraph"
          : rawFormat && /^h[1-6]$/.test(rawFormat)
            ? `heading-${rawFormat.slice(1)}`
            : null;
      if (!session || !format) {
        flash("That heading level is not supported.");
        return;
      }
      updateFormatting(session.meta.id, format as BlockFormatting);
      return;
    }
    case "formatStrikeThrough":
    case "insertHorizontalRule": {
      event.preventDefault();
      flash("That formatting command is not supported.");
      return;
    }
    case "insertOrderedList":
    case "insertUnorderedList": {
      event.preventDefault();
      const selected = getSelectedListGroup();
      const ids = selected?.ids ?? (session ? [session.meta.id] : []);
      if (!ids.length) {
        flash("Select one or more text blocks to create a list.");
        return;
      }
      toggleListFormatting(
        ids,
        event.inputType === "insertOrderedList" ? "ordered-list" : "unordered-list",
      );
      scheduleFormatTools();
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

function onKeyUp(): void {
  blockSelectionCapture = false;
  scheduleFormatTools();
}

function onInput(_event: Event): void {
  pendingKeyboardSelection = null;
  lastNonCollapsedSelection = null;
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

/** Only text mutations that preserve the existing inline structure may pass. */
function structureAllowed(current: string, baseline: string): boolean {
  return current === baseline;
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
  normalizeInsertedBoundarySpaces(session);
  const currentPairs = collectSegments(session.el);
  const changed = currentPairs.some((pair, i) => pair.value !== session?.baselineValues[i]);
  endEdit(changed);
}

function endEdit(recordChanges: boolean): void {
  const s = session!;
  s.el.removeEventListener("beforeinput", onBeforeInput);
  s.el.removeEventListener("input", onInput);
  s.el.removeEventListener("keydown", onKeyDown);
  s.el.removeEventListener("keyup", onKeyUp);
  s.el.removeEventListener("mouseup", scheduleFormatTools);
  s.el.removeEventListener("paste", onPaste, true);
  if (activeTools?.classList.contains("xyle-format-tools")) closeContextTools(false);
  s.el.classList.remove("xyle-editing");
  s.el.removeAttribute("data-xyle-generated-editing");
  refreshEditabilityOverlay();
  // Restore authored contenteditable state; do not leave editor instrumentation
  // in the preview for later structural snapshots.
  if (s.authoredContentEditable === null) s.el.removeAttribute("contenteditable");
  else s.el.setAttribute("contenteditable", s.authoredContentEditable);

  if (recordChanges && !structureAllowed(skeleton(s.el), s.baselineSkeleton)) {
    flash("That change was reverted to protect your page structure.");
    restoreBaseline();
    recordChanges = false;
  }
  if (recordChanges) {
    const currentHtml = cleanInlineHtml(s.el);
    const hasInlineMarkup =
      /<(?:a|b|strong|em|i|u)\b/i.test(s.baselineHtml) ||
      /<(?:a|b|strong|em|i|u)\b/i.test(currentHtml);
    if (hasInlineMarkup) {
      const originalHtml =
        originalMarkups.get(segmentIdentity(s.meta.pagePath, s.meta.id)) ?? s.baselineHtml;
      reconcileInlineHtml(s.meta.pagePath, s.meta.id, originalHtml, currentHtml);
    } else {
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
  }
  session = null;
  pendingKeyboardSelection = null;
  lastNonCollapsedSelection = null;
  blockSelectionCapture = false;
  savedFormatSelection = null;
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
    if (!session && !toolbarOwnsInteraction()) showLinkTools(el as HTMLAnchorElement, meta);
  });
  el.addEventListener("mouseleave", () => scheduleContextToolsClose(el));
  el.addEventListener("click", show);
  el.addEventListener("keydown", (event) => {
    if (!session && (event.key === "Enter" || event.key === " ")) show(event);
  });
}

function toolbarExclusionRects(): ViewportRect[] {
  const dock = document.getElementById("xyle-control-dock");
  if (!dock) return [];
  const rect = dock.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [];
  const padding = 8;
  return [
    {
      left: Math.max(0, rect.left - padding),
      top: Math.max(0, rect.top - padding),
      right: Math.min(document.documentElement.clientWidth, rect.right + padding),
      bottom: Math.min(document.documentElement.clientHeight, rect.bottom + padding),
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    },
  ];
}

function rectanglesOverlap(left: ViewportRect, right: ViewportRect): boolean {
  return (
    left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top
  );
}

function positionContextTools(
  tools: HTMLElement,
  targetRect: ViewportRect,
  placement: ContextToolPlacement,
  avoidRect?: ViewportRect,
): void {
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const toolRect = tools.getBoundingClientRect();
  const margin = 8;
  const width = toolRect.width;
  const height = toolRect.height;
  const centeredLeft = targetRect.left + (targetRect.width - width) / 2;
  const centeredTop = targetRect.top + (targetRect.height - height) / 2;
  const candidates: Array<{ left: number; top: number }> = [];
  const inside = targetRect.bottom - height - 6;
  const above = targetRect.top - height - 6;
  const below = targetRect.bottom + 6;
  const right = targetRect.right + 8;
  const left = targetRect.left - width - 8;
  if (placement === "inside-bottom" && targetRect.height >= height * 2) {
    candidates.push({ left: centeredLeft, top: inside });
  }
  const preferred = placement === "below" ? [below, above] : [above, below];
  for (const top of preferred) candidates.push({ left: centeredLeft, top });
  candidates.push({ left: right, top: centeredTop }, { left, top: centeredTop });

  const obstacles = [...(avoidRect ? [avoidRect] : []), ...toolbarExclusionRects()];
  const inViewport = (candidate: { left: number; top: number }): boolean =>
    candidate.left >= margin &&
    candidate.top >= margin &&
    candidate.left + width <= viewportWidth - margin &&
    candidate.top + height <= viewportHeight - margin;
  const toRect = (candidate: { left: number; top: number }): ViewportRect => ({
    ...candidate,
    right: candidate.left + width,
    bottom: candidate.top + height,
    width,
    height,
  });
  const usable = candidates.find(
    (candidate) =>
      inViewport(candidate) &&
      !obstacles.some((obstacle) => rectanglesOverlap(toRect(candidate), obstacle)),
  );
  let chosen = usable ?? candidates[0] ?? { left: centeredLeft, top: below };
  if (!usable) {
    const clamped = candidates.map((candidate) => ({
      left: Math.min(
        Math.max(candidate.left, margin),
        Math.max(margin, viewportWidth - width - margin),
      ),
      top: Math.min(
        Math.max(candidate.top, margin),
        Math.max(margin, viewportHeight - height - margin),
      ),
    }));
    chosen =
      clamped
        .map((candidate) => ({
          candidate,
          overlap: obstacles.reduce(
            (total, obstacle) => total + (rectanglesOverlap(toRect(candidate), obstacle) ? 1 : 0),
            0,
          ),
        }))
        .sort((a, b) => a.overlap - b.overlap)[0]?.candidate ?? chosen;
  }
  // Context controls use viewport coordinates because they are fixed overlays.
  // Adding document scroll offsets would double-count scrolling inside srcdoc.
  tools.style.left = `${Math.min(Math.max(chosen.left, margin), Math.max(margin, viewportWidth - width - margin))}px`;
  tools.style.top = `${Math.min(Math.max(chosen.top, margin), Math.max(margin, viewportHeight - height - margin))}px`;
}

function positionInlineToolEditor(
  tools: HTMLElement,
  target: HTMLElement,
  fallback: ContextToolPlacement,
): void {
  const targetRect = previewElementRect(target);
  const toolRect = tools.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const sideLeft = targetRect.right + 8;
  const side = {
    left: sideLeft,
    top: Math.min(Math.max(targetRect.top, 8), Math.max(8, viewportHeight - toolRect.height - 8)),
  };
  const sideRect: ViewportRect = {
    ...side,
    right: side.left + toolRect.width,
    bottom: side.top + toolRect.height,
    width: toolRect.width,
    height: toolRect.height,
  };
  if (
    sideLeft + toolRect.width <= viewportWidth - 8 &&
    !toolbarExclusionRects().some((obstacle) => rectanglesOverlap(sideRect, obstacle))
  ) {
    tools.style.left = `${side.left}px`;
    tools.style.top = `${side.top}px`;
    return;
  }
  positionContextTools(tools, targetRect, fallback);
}

function showLinkTools(
  link: HTMLAnchorElement,
  meta: NodeMeta,
  focusFirst = false,
  focusAction?: "url",
): void {
  if (toolbarIsInline() && activeToolsTarget !== link) return;
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
    openHrefEditor(link, meta, tools);
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
  if (focusFirst) {
    (focusAction === "url" ? editUrl : tools.querySelector("button"))?.focus();
  }
}

let seoDrawerTrigger: HTMLElement | null = null;

function closeSeoDrawer(restoreFocus = true): void {
  const trigger = seoDrawerTrigger;
  removeTrappedDialog(document.getElementById("xyle-seo-drawer"));
  seoDrawerTrigger = null;
  if (restoreFocus && trigger?.isConnected) trigger.focus();
  if (!session && !drawerOpen && !activeTools && !$("#xyle-changes-drawer"))
    setInteractionMode(hoveredCandidate ? "hover" : "idle");
}

function openSeoEditor(): void {
  closeSeoDrawer(false);
  closeMediaDrawer(false);
  closeChangesDrawer(false);
  closeSectionDrawer(false);
  seoDrawerTrigger = document.activeElement as HTMLElement | null;
  setInteractionMode("drawer");
  const drawer = document.createElement("aside");
  drawer.id = "xyle-seo-drawer";
  drawer.className = "xyle-drawer xyle-seo-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-labelledby", "xyle-seo-title");
  drawer.innerHTML = `
    <header class="xyle-drawer-header">
      <strong id="xyle-seo-title"><svg class="xyle-drawer-title-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"/><circle cx="17" cy="15" r="3"/><path d="m19.2 17.2 1.8 1.8"/></svg><span>SEO metadata</span></strong>
      <button class="xyle-icon-button" type="button" data-close aria-label="Close SEO metadata">×</button>
    </header>
    <form class="xyle-dialog-form" novalidate>
      <label class="xyle-dialog-label">Page title
        <input class="xyle-dialog-input" name="title" autocomplete="off">
      </label>
      <label class="xyle-dialog-label">Description
        <textarea class="xyle-dialog-input" name="description" rows="2"></textarea>
      </label>
      <label class="xyle-dialog-label">Canonical URL
        <input class="xyle-dialog-input" name="canonical" autocomplete="off">
      </label>
      <label class="xyle-dialog-label">Social title
        <input class="xyle-dialog-input" name="ogTitle" autocomplete="off">
      </label>
      <label class="xyle-dialog-label">Social description
        <textarea class="xyle-dialog-input" name="ogDescription" rows="2"></textarea>
      </label>
      <label class="xyle-dialog-label">Social image URL
        <input class="xyle-dialog-input" name="ogImage" autocomplete="off">
      </label>
      <div class="xyle-drawer-actions">
        <button class="xyle-dialog-button" type="button" data-cancel>Cancel</button>
        <button class="xyle-dialog-button xyle-dialog-button--primary" type="submit">Save metadata</button>
      </div>
    </form>`;
  const values = getSeo();
  for (const field of SEO_FIELDS) {
    const input = drawer.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${field}"]`);
    if (input) input.value = values[field];
  }
  const close = (): void => closeSeoDrawer();
  drawer.querySelector<HTMLButtonElement>("[data-close]")?.addEventListener("click", close);
  drawer.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", close);
  drawer.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const updates = SEO_FIELDS.map((field) => ({
      field,
      value:
        drawer.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${field}"]`)?.value ??
        "",
    }));
    try {
      for (const update of updates) validateSeoValue(update.field, update.value);
      for (const update of updates) updateSeo(update.field, update.value);
      close();
    } catch (error) {
      flash(error instanceof Error ? error.message : "SEO metadata could not be updated.");
    }
  });
  document.body.append(drawer);
  trapDialogFocus(drawer, close);
  drawer.querySelector<HTMLInputElement>("[name=title]")?.focus();
}

function returnToSelectedToolbar(target: HTMLElement, reopen: () => void): void {
  toolbarActionInProgress = true;
  try {
    closeContextTools(false);
    target.focus({ preventScroll: true });
    reopen();
  } finally {
    toolbarActionInProgress = false;
  }
}

function openHrefEditor(el: HTMLElement, meta: NodeMeta, tools: HTMLElement): void {
  const currentHref = el.getAttribute("href") ?? "";
  rememberOriginalAttr(meta.pagePath, meta.id, "href", currentHref);
  const internalTarget = resolveInternalPath(currentHref);
  tools.dataset.xyleEditingUrl = "1";
  toolbarActionInProgress = true;
  toolbarPhase = "inline";
  tools.replaceChildren(
    document.createRange().createContextualFragment(`
    <form class="xyle-inline-tool-form" novalidate>
      <label class="xyle-inline-tool-label">URL or path
        <input class="xyle-inline-tool-input" name="href" value="" autocomplete="off" aria-describedby="xyle-link-edit-error">
      </label>
      <p id="xyle-link-edit-error" class="xyle-inline-tool-error" role="status" aria-live="polite"></p>
      <div class="xyle-inline-tool-actions">
        ${internalTarget ? `<button type="submit" value="follow">Follow</button>` : ""}
        <button type="button" data-cancel>Cancel</button>
        <button type="submit" value="save">Save</button>
      </div>
    </form>`),
  );
  const hrefInput = tools.querySelector("input") as HTMLInputElement;
  hrefInput.value = currentHref;
  const restore = (): void => {
    delete tools.dataset.xyleEditingUrl;
    toolbarActionInProgress = false;
    returnToSelectedToolbar(el, () => showLinkTools(el as HTMLAnchorElement, meta, true, "url"));
  };
  tools.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", restore);
  tools.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const action = ((event as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    const value = hrefInput.value;
    if (action === "save") {
      if (!isSafeUrl(value)) {
        tools.querySelector<HTMLElement>(".xyle-inline-tool-error")!.textContent =
          "Use a relative path, https:, http:, mailto: or tel:";
        hrefInput.setAttribute("aria-invalid", "true");
        hrefInput.focus();
        return;
      }
      applyOp(meta.pagePath, { type: "href", nodeId: meta.id, value }, "Edit link");
      el.setAttribute("href", value);
      restore();
    } else if (action === "follow") {
      const target = resolveInternalPath(value) ?? internalTarget;
      if (target) {
        restore();
        loadPage(target, { pushHistory: true }).then(() => restoreOpsIntoDom());
      } else {
        flash("Only internal pages can be followed in edit mode.");
      }
    }
  });
  tools.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && tools.dataset.xyleEditingUrl) {
      event.preventDefault();
      restore();
    }
  });
  hrefInput.focus();
  hrefInput.select();
  window.requestAnimationFrame(() => {
    if (tools.isConnected && tools.dataset.xyleEditingUrl)
      positionInlineToolEditor(tools, el, "above");
  });
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
let activeMediaEditor: (() => void) | null = null;
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
    if (!session && !toolbarOwnsInteraction()) showImageTools(img, meta);
  });
  img.addEventListener("mouseleave", () => scheduleContextToolsClose(img));
  img.addEventListener("click", select);
  img.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") select(event);
  });
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function mediaStateFromImage(img: HTMLImageElement): MediaState {
  const objectFit = img.style.objectFit;
  const objectPosition = img.style.objectPosition;
  const position = [...objectPosition.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((match) =>
    Number(match[1]),
  );
  return normalizeMediaState({
    source: { kind: "existing", src: img.getAttribute("src") ?? "" },
    alt: { present: img.hasAttribute("alt"), value: img.getAttribute("alt") ?? "" },
    crop: null,
    focus:
      position.length >= 2
        ? { x: clampUnit((position[0] ?? 50) / 100), y: clampUnit((position[1] ?? 50) / 100) }
        : null,
    ...(objectFit === "cover" || objectFit === "contain" ? { framing: { fit: objectFit } } : {}),
  });
}

function rememberOriginalMedia(
  pagePath: string,
  nodeId: string,
  img: HTMLImageElement,
): MediaState {
  const key = segmentIdentity(pagePath, nodeId);
  const existing = originalMedia.get(key);
  if (existing) return existing;
  const created = createdMedia.get(key);
  const state = created ?? mediaStateFromImage(img);
  originalMedia.set(key, state);
  return state;
}

function currentMediaState(pagePath: string, nodeId: string, img: HTMLImageElement): MediaState {
  rememberOriginalMedia(pagePath, nodeId, img);
  const pending = state.ops.find(
    (entry) =>
      entry.pagePath === pagePath && entry.op.type === "media" && entry.op.nodeId === nodeId,
  );
  return pending?.op.type === "media" ? pending.op.value : mediaStateFromImage(img);
}

interface MediaPatch {
  source?: MediaState["source"];
  alt?: MediaState["alt"];
  crop?: CropRect | null;
  focus?: Point | null;
  framing?: MediaState["framing"] | null;
}

function applyMediaPatch(
  pagePath: string,
  nodeId: string,
  img: HTMLImageElement,
  patch: MediaPatch,
  label: string,
): void {
  const original = rememberOriginalMedia(pagePath, nodeId, img);
  const current = currentMediaState(pagePath, nodeId, img);
  const next = normalizeMediaState({
    source: patch.source ?? current.source,
    alt: patch.alt ?? current.alt,
    crop: patch.crop === undefined ? current.crop : patch.crop,
    focus: patch.focus === undefined ? current.focus : patch.focus,
    ...(patch.framing === undefined
      ? current.framing
        ? { framing: current.framing }
        : {}
      : patch.framing
        ? { framing: patch.framing }
        : {}),
  });
  if (!isSafeUrl(mediaSourcePath(next.source))) throw new Error("Unsafe media source rejected");
  const previousEntry = state.ops.find(
    (entry) =>
      entry.pagePath === pagePath && entry.op.type === "media" && entry.op.nodeId === nodeId,
  );
  const previous = previousEntry?.op;
  const changeSet = activeChangeSet
    ? { id: activeChangeSet.id, label: activeChangeSet.label }
    : undefined;
  const previousChangeSet = previousEntry?.changeSetId
    ? { id: previousEntry.changeSetId, label: previousEntry.changeSetLabel ?? "" }
    : undefined;
  const op: Op = { type: "media", nodeId, value: next };
  const key = opKey(op);
  replacePendingOp(pagePath, key, mediaStatesEqual(next, original) ? null : op, changeSet);
  applyMediaStateToDom(img, mediaStatesEqual(next, original) ? original : next);
  const entry: HistoryEntry = {
    label,
    assetPaths: assetPathsFor(previous, op),
    ...(changeSet ? { changeSetId: changeSet.id, changeSetLabel: changeSet.label } : {}),
    undo: () => {
      replacePendingOp(pagePath, key, previous ?? null, previousChangeSet);
      applyMediaStateToDom(img, previous?.type === "media" ? previous.value : original);
      updateDirtyUi();
    },
    redo: () => {
      replacePendingOp(pagePath, key, mediaStatesEqual(next, original) ? null : op, changeSet);
      applyMediaStateToDom(img, mediaStatesEqual(next, original) ? original : next);
      updateDirtyUi();
    },
  };
  if (activeChangeSet) activeChangeSet.entries.push(entry);
  else pushHistory(entry);
  updateDirtyUi();
}

function openImageCropEditor(
  img: HTMLImageElement,
  meta: NodeMeta,
  mode: "crop" | "focus" = "crop",
): void {
  activeMediaEditor?.();
  const original = rememberOriginalMedia(meta.pagePath, meta.id, img);
  const media = currentMediaState(meta.pagePath, meta.id, img);
  const computed = img.ownerDocument.defaultView?.getComputedStyle(img);
  const currentFit =
    media.framing?.fit ?? (computed?.objectFit === "contain" ? "contain" : "cover");
  const currentFocus =
    media.focus ??
    (media.crop
      ? { x: media.crop.x + media.crop.width / 2, y: media.crop.y + media.crop.height / 2 }
      : { x: 0.5, y: 0.5 });
  const imageRect = previewElementRect(img);
  const isSmall = imageRect.width < 180 || imageRect.height < 140;
  const aspect =
    imageRect.width > 0 && imageRect.height > 0 ? imageRect.width / imageRect.height : 1;
  const inline = !isSmall;
  const width = inline ? imageRect.width : Math.min(420, window.innerWidth - 24);
  const height = inline
    ? imageRect.height
    : Math.min(width / aspect, window.innerHeight * (mode === "focus" ? 0.5 : 0.32));
  const originalImageStyles = {
    height: img.style.height,
    objectFit: img.style.objectFit,
    objectPosition: img.style.objectPosition,
    transform: img.style.transform,
    transformOrigin: img.style.transformOrigin,
    clipPath: img.style.clipPath,
    visibility: img.style.visibility,
    width: img.style.width,
  };
  const editor = document.createElement("div");
  editor.className = `xyle-inline-media-editor${inline ? " xyle-on-canvas" : ""}`;
  editor.setAttribute("role", "dialog");
  editor.setAttribute("aria-modal", "true");
  editor.setAttribute("aria-labelledby", "xyle-crop-dialog-title");
  editor.style.left = `${inline ? imageRect.left : Math.max(12, Math.min(window.innerWidth - width - 12, imageRect.left))}px`;
  const maximumTop = Math.max(12, window.innerHeight - height - (mode === "focus" ? 220 : 390));
  editor.style.top = `${inline ? imageRect.top : Math.max(12, Math.min(maximumTop, imageRect.top))}px`;
  editor.style.width = `${Math.max(180, width)}px`;
  editor.style.setProperty("--xyle-crop-aspect", String(aspect));
  editor.style.setProperty("--xyle-crop-height", `${height}px`);
  editor.replaceChildren(
    document.createRange().createContextualFragment(`
    <div class="xyle-crop-stage" role="group" aria-label="Image crop preview">
      <img alt="" src="">
      <div class="xyle-crop-guide" aria-hidden="true"></div>
      <button type="button" class="xyle-focal-target" aria-label="Focal point. Use arrow keys to move."></button>
    </div>
    <div class="xyle-media-editor-panel">
      <div class="xyle-dialog-heading"><span class="xyle-dialog-kicker">${mode === "focus" ? "Image focus" : "Image framing"}</span><strong id="xyle-crop-dialog-title">${mode === "focus" ? "Focus point" : "Crop & focal point"}</strong></div>
      <p class="xyle-crop-hint">${mode === "focus" ? "Click or drag to place the focus point." : "Drag to reposition · scroll or use the slider to zoom."}</p>
      <label class="xyle-dialog-label" data-frame-control>Frame
        <select class="xyle-dialog-input" name="fit">
          <option value="cover">Crop to fill</option>
          <option value="contain">Show full image</option>
        </select>
      </label>
      <label class="xyle-dialog-label" data-zoom-control>Zoom <output class="xyle-range-value" for="xyle-zoom"></output>
        <input id="xyle-zoom" class="xyle-dialog-range" type="range" min="1" max="3" step="0.01" value="1">
      </label>
      <label class="xyle-dialog-label">Horizontal focus <output class="xyle-range-value" for="xyle-focal-x"></output>
        <input id="xyle-focal-x" class="xyle-dialog-range" type="range" min="0" max="100" step="1" value="50">
      </label>
      <label class="xyle-dialog-label">Vertical focus <output class="xyle-range-value" for="xyle-focal-y"></output>
        <input id="xyle-focal-y" class="xyle-dialog-range" type="range" min="0" max="100" step="1" value="50">
      </label>
      <div class="xyle-dialog-actions">
        <button class="xyle-dialog-button" type="button" data-reset>Reset</button>
        <button class="xyle-dialog-button" type="button" data-cancel>Cancel</button>
        <button class="xyle-dialog-button xyle-dialog-button--primary" type="button" data-done>Done</button>
      </div>
    </div>`),
  );
  const stage = editor.querySelector(".xyle-crop-stage") as HTMLElement;
  stage.dataset.mode = mode;
  const preview = stage.querySelector("img") as HTMLImageElement;
  const target = stage.querySelector(".xyle-focal-target") as HTMLButtonElement;
  const fit = editor.querySelector("select[name=fit]") as HTMLSelectElement;
  const zoomInput = editor.querySelector("#xyle-zoom") as HTMLInputElement;
  const xInput = editor.querySelector("#xyle-focal-x") as HTMLInputElement;
  const yInput = editor.querySelector("#xyle-focal-y") as HTMLInputElement;
  const zoomOutput = editor.querySelector("output[for=xyle-zoom]") as HTMLOutputElement;
  if (mode === "focus") {
    editor.querySelector<HTMLElement>("[data-frame-control]")?.setAttribute("hidden", "");
    editor.querySelector<HTMLElement>("[data-zoom-control]")?.setAttribute("hidden", "");
  }
  const xOutput = editor.querySelector("output[for=xyle-focal-x]") as HTMLOutputElement;
  const yOutput = editor.querySelector("output[for=xyle-focal-y]") as HTMLOutputElement;
  preview.src =
    media.source.kind === "staged" ? media.source.previewUrl : img.currentSrc || img.src;
  if (inline) img.style.visibility = "hidden";
  fit.value = currentFit;
  xInput.value = String(Math.round(currentFocus.x * 100));
  yInput.value = String(Math.round(currentFocus.y * 100));
  const setFocus = (x: number, y: number): void => {
    xInput.value = String(clampPercent(x * 100));
    yInput.value = String(clampPercent(y * 100));
    updatePreview();
  };
  const updatePreview = (): void => {
    const x = clampUnit(clampPercent(Number(xInput.value)) / 100);
    const y = clampUnit(clampPercent(Number(yInput.value)) / 100);
    const zoom = Math.max(1, Number(zoomInput.value));
    const objectFit = fit.value as "cover" | "contain";
    const crop = cropRectForFrame(
      img.naturalWidth,
      img.naturalHeight,
      stage.clientWidth,
      stage.clientHeight,
      zoom,
      { x, y },
    );
    stage.dataset.cropRect = [crop.x, crop.y, crop.width, crop.height]
      .map((value) => value.toFixed(6))
      .join(",");
    if (objectFit === "cover") {
      stage.dataset.previewCrop = "true";
      stage.style.setProperty("--xyle-preview-left", `${(-crop.x / crop.width) * 100}%`);
      stage.style.setProperty("--xyle-preview-top", `${(-crop.y / crop.height) * 100}%`);
      stage.style.setProperty("--xyle-preview-width", `${(1 / crop.width) * 100}%`);
      stage.style.setProperty("--xyle-preview-height", `${(1 / crop.height) * 100}%`);
      preview.style.objectFit = "fill";
      preview.style.objectPosition = "0 0";
      preview.style.transform = "none";
    } else {
      delete stage.dataset.previewCrop;
      preview.style.removeProperty("position");
      preview.style.removeProperty("left");
      preview.style.removeProperty("top");
      preview.style.removeProperty("width");
      preview.style.removeProperty("height");
      preview.style.removeProperty("objectFit");
      preview.style.removeProperty("objectPosition");
      preview.style.removeProperty("transform");
    }
    target.style.left = `${x * 100}%`;
    target.style.top = `${y * 100}%`;
    zoomOutput.value = `${zoom.toFixed(2)}×`;
    xOutput.value = `${Math.round(x * 100)}%`;
    yOutput.value = `${Math.round(y * 100)}%`;
  };
  let fitChanged = false;
  let resetToAuthored = false;
  let editorClosed = false;
  const restoreImageStyles = (): void => {
    img.style.height = originalImageStyles.height;
    img.style.objectFit = originalImageStyles.objectFit;
    img.style.objectPosition = originalImageStyles.objectPosition;
    img.style.transform = originalImageStyles.transform;
    img.style.transformOrigin = originalImageStyles.transformOrigin;
    img.style.clipPath = originalImageStyles.clipPath;
    img.style.visibility = originalImageStyles.visibility;
    img.style.width = originalImageStyles.width;
  };
  const close = (save: boolean): void => {
    if (editorClosed) return;
    editorClosed = true;
    if (activeMediaEditor === close) activeMediaEditor = null;
    if (save) {
      // Do not let the temporary preview styles become the current authored state.
      restoreImageStyles();
      const focus = {
        x: clampUnit(clampPercent(Number(xInput.value)) / 100),
        y: clampUnit(clampPercent(Number(yInput.value)) / 100),
      };
      const crop =
        mode === "crop"
          ? fit.value === "cover"
            ? cropRectForFrame(
                img.naturalWidth,
                img.naturalHeight,
                stage.clientWidth,
                stage.clientHeight,
                Number(zoomInput.value),
                focus,
              )
            : null
          : media.crop;
      applyMediaPatch(
        meta.pagePath,
        meta.id,
        img,
        resetToAuthored
          ? {
              crop: original.crop,
              focus: original.focus,
              framing: original.framing ?? null,
            }
          : mode === "focus"
            ? { focus }
            : {
                crop,
                focus,
                ...(fitChanged || media.framing
                  ? { framing: { fit: fit.value as "cover" | "contain" } }
                  : {}),
              },
        resetToAuthored
          ? "Reset image framing"
          : mode === "focus"
            ? "Adjust image focus"
            : "Adjust image framing",
      );
    }
    if (!save) restoreImageStyles();
    removeTrappedDialog(editor);
    focusPreviewElement(img);
  };
  const updateChangedPreview = (): void => {
    resetToAuthored = false;
    updatePreview();
  };
  fit.addEventListener("input", () => {
    fitChanged = true;
    updateChangedPreview();
  });
  zoomInput.addEventListener("input", updateChangedPreview);
  xInput.addEventListener("input", updateChangedPreview);
  yInput.addEventListener("input", updateChangedPreview);
  editor.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => {
    fitChanged = true;
    fit.value = original.framing?.fit ?? currentFit;
    zoomInput.value = "1";
    const originalFocus =
      original.focus ??
      (original.crop
        ? {
            x: original.crop.x + original.crop.width / 2,
            y: original.crop.y + original.crop.height / 2,
          }
        : { x: 0.5, y: 0.5 });
    setFocus(originalFocus.x, originalFocus.y);
    resetToAuthored = true;
  });
  editor
    .querySelector<HTMLButtonElement>("[data-cancel]")
    ?.addEventListener("click", () => close(false));
  editor
    .querySelector<HTMLButtonElement>("[data-done]")
    ?.addEventListener("click", () => close(true));
  target.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const x = clampUnit(
      Number(xInput.value) / 100 +
        (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
    );
    const y = clampUnit(
      Number(yInput.value) / 100 +
        (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
    );
    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      resetToAuthored = false;
      setFocus(x, y);
    }
  });
  let dragging = false;
  stage.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    resetToAuthored = false;
    dragging = true;
    stage.setPointerCapture(event.pointerId);
    setFocusFromPointer(event);
  });
  stage.addEventListener("pointermove", (event) => {
    if (dragging) setFocusFromPointer(event);
  });
  stage.addEventListener("pointerup", () => {
    dragging = false;
  });
  stage.addEventListener("pointercancel", () => {
    dragging = false;
  });
  stage.addEventListener(
    "wheel",
    (event) => {
      if (mode === "focus") return;
      event.preventDefault();
      resetToAuthored = false;
      const currentZoom = Number(zoomInput.value);
      const nextZoom = Math.min(3, Math.max(1, currentZoom - event.deltaY * 0.002));
      zoomInput.value = nextZoom.toFixed(2);
      updatePreview();
    },
    { passive: false },
  );
  function setFocusFromPointer(event: PointerEvent): void {
    const rect = stage.getBoundingClientRect();
    setFocus((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }
  closeContextTools(false);
  activeMediaEditor = () => close(false);
  if (!inline) img.style.visibility = "hidden";
  shellOverlay()?.append(editor);
  trapDialogFocus(editor, () => close(false));
  if (inline) {
    const panel = editor.querySelector<HTMLElement>(".xyle-media-editor-panel");
    if (panel) {
      panel.style.position = "fixed";
      panel.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, imageRect.left))}px`;
      panel.style.width = `${Math.min(width, window.innerWidth - 24)}px`;
      const panelHeight = panel.getBoundingClientRect().height;
      const below = imageRect.bottom + 8;
      panel.style.top = `${below + panelHeight <= window.innerHeight - 12 ? below : Math.max(12, imageRect.top - panelHeight - 8)}px`;
    }
  }
  updatePreview();
  target.focus();
}

function showImageTools(img: HTMLImageElement, meta: NodeMeta, focusFirst = false): void {
  if (toolbarIsInline() && activeToolsTarget !== img) return;
  const overlay = shellOverlay();
  if (!overlay) return;
  const tools = document.createElement("div");
  tools.className = "xyle-img-tools";
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", "Image actions");
  tools.dataset.forNode = meta.id;
  const capabilities = meta.mediaCapabilities ?? {
    replace: true,
    alt: true,
    crop: true,
    focus: true,
  };
  const replace = document.createElement("button");
  replace.type = "button";
  replace.textContent = "Replace";
  if (mediaManagementUnavailable || !capabilities.replace) {
    replace.disabled = true;
    replace.title = mediaManagementUnavailable
      ? "Media management is unavailable for this deployment"
      : "Responsive image replacement is not supported yet";
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
  const crop = document.createElement("button");
  crop.type = "button";
  crop.textContent = "Crop";
  crop.disabled = !capabilities.crop;
  crop.title = capabilities.crop
    ? "Adjust crop and focal point"
    : (capabilities.cropReason ?? "Cropping is not supported for this image");
  crop.addEventListener("click", (event) => {
    event.stopPropagation();
    closeContextTools(false);
    selectImage(img, meta);
    openImageCropEditor(img, meta);
  });
  const focus = document.createElement("button");
  focus.type = "button";
  focus.textContent = "Focus";
  focus.disabled = !capabilities.focus;
  focus.title = capabilities.focus
    ? "Choose the important area to keep visible"
    : (capabilities.focusReason ?? "Focal positioning is not supported for this image");
  focus.addEventListener("click", (event) => {
    event.stopPropagation();
    closeContextTools(false);
    selectImage(img, meta);
    openImageCropEditor(img, meta, "focus");
  });
  const alt = document.createElement("button");
  alt.type = "button";
  alt.textContent = "Alt";
  alt.addEventListener("click", (event) => {
    event.stopPropagation();
    selectImage(img, meta);
    openAltEditor(img, meta, tools);
  });
  tools.append(replace, media, crop, focus, alt);
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

interface StagedMedia {
  path: string;
  objectUrl: string;
  contentType: string;
  width: number;
  height: number;
}

async function stageMediaFile(file: File): Promise<StagedMedia | null> {
  if (mediaManagementUnavailable) {
    flash("Media management is unavailable for this deployment.");
    return null;
  }
  if (file.size > 20 * 1024 * 1024) {
    flash("Images must be 20 MB or smaller.");
    return null;
  }
  const mutationGeneration = mediaMutationGeneration;
  const buffer = await file.arrayBuffer();
  if (mutationGeneration !== mediaMutationGeneration) return null;
  const bytes = new Uint8Array(buffer);
  const detectedContentType = detectRasterContentType(bytes);
  if (!detectedContentType) {
    flash("Only JPEG, PNG, WebP and AVIF uploads are supported.");
    return null;
  }
  const digestHex = await sha256Hex(bytes);
  if (mutationGeneration !== mediaMutationGeneration) return null;
  const path = `/__media/${digestHex}.${extFor(detectedContentType)}`;
  const existingAsset = state.assets.get(path);
  const objectUrl = existingAsset?.objectUrl ?? URL.createObjectURL(file);
  if (!existingAsset) state.assets.set(path, { file, objectUrl });
  let width = 1;
  let height = 1;
  try {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    // The image element will still validate and display the staged asset.
  }
  return { path, objectUrl, contentType: detectedContentType, width, height };
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
  const staged = await stageMediaFile(file);
  if (!staged) return;
  applyMediaPatch(
    meta.pagePath,
    meta.id,
    img,
    {
      source: {
        kind: "staged",
        assetId: staged.path,
        previewUrl: staged.objectUrl,
        mime: staged.contentType,
        width: staged.width || img.naturalWidth || 1,
        height: staged.height || img.naturalHeight || 1,
      },
      crop: null,
      focus: null,
    },
    "Replace image",
  );
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

function mediaStateDescription(state: MediaState): string {
  const source = mediaSourcePath(state.source);
  const alt = state.alt.present ? `; alt ${state.alt.value}` : "; alt missing";
  const framing = state.framing ? `; ${state.framing.fit}` : "";
  const focus = state.focus
    ? `; focus ${Math.round(state.focus.x * 100)}% ${Math.round(state.focus.y * 100)}%`
    : "";
  const crop = state.crop
    ? `; crop ${Math.round(state.crop.x * 100)}% ${Math.round(state.crop.y * 100)}% ${Math.round(state.crop.width * 100)}% ${Math.round(state.crop.height * 100)}%`
    : "";
  return `${source}${alt}${framing}${focus}${crop}`;
}

function applyMediaStateToDom(img: HTMLImageElement, media: MediaState): void {
  const source = mediaSourcePath(media.source);
  const asset = state.assets.get(source);
  const previewSource = asset?.objectUrl ?? source;
  img.setAttribute("src", previewSource);
  img.src = previewSource;
  if (media.alt.present) img.setAttribute("alt", media.alt.value);
  else img.removeAttribute("alt");
  if (media.framing) img.style.objectFit = media.framing.fit;
  else img.style.removeProperty("object-fit");
  if (media.focus) {
    img.style.objectPosition = `${media.focus.x * 100}% ${media.focus.y * 100}%`;
  } else {
    img.style.removeProperty("object-position");
  }
}

function selectImage(img: HTMLImageElement, meta: NodeMeta): void {
  selectedImage = { el: img, meta };
}

function openAltEditor(img: HTMLImageElement, meta: NodeMeta, tools: HTMLElement): void {
  activeMediaEditor?.();
  const existing = img.getAttribute("alt") ?? "";
  tools.dataset.xyleEditingAlt = "1";
  toolbarActionInProgress = true;
  toolbarPhase = "inline";
  tools.replaceChildren(
    document.createRange().createContextualFragment(`
    <form class="xyle-inline-tool-form" novalidate>
      <label class="xyle-inline-tool-label">Alt text
        <input class="xyle-inline-tool-input" name="alt" value="" autocomplete="off">
      </label>
      <label class="xyle-inline-tool-check"><input type="checkbox" name="decorative"> Decorative</label>
      <div class="xyle-inline-tool-actions">
        <button type="button" data-cancel>Cancel</button>
        <button type="submit">Save</button>
      </div>
    </form>`),
  );
  const altInput = tools.querySelector("input[name=alt]") as HTMLInputElement;
  const decorative = tools.querySelector("input[name=decorative]") as HTMLInputElement;
  altInput.value = existing;
  const restore = (save: boolean): void => {
    if (save) {
      applyMediaPatch(
        meta.pagePath,
        meta.id,
        img,
        { alt: { present: true, value: decorative.checked ? "" : altInput.value } },
        "Edit alt text",
      );
    }
    if (activeMediaEditor === cancel) activeMediaEditor = null;
    delete tools.dataset.xyleEditingAlt;
    toolbarActionInProgress = false;
    returnToSelectedToolbar(img, () => showImageTools(img, meta, true));
  };
  const cancel = (): void => restore(false);
  activeMediaEditor = cancel;
  tools.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", cancel);
  tools.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    restore(true);
  });
  tools.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && tools.dataset.xyleEditingAlt) {
      event.preventDefault();
      cancel();
    }
  });
  altInput.focus();
  altInput.select();
  window.requestAnimationFrame(() => {
    if (tools.isConnected && tools.dataset.xyleEditingAlt)
      positionInlineToolEditor(tools, img, "above");
  });
}

/* ---------- media drawer ---------- */

interface MediaItem {
  path: string;
  contentType: string;
  source: "site" | "xyle-upload";
  usedBySimpleImg: boolean;
  previewUrl?: string;
  width?: number;
  height?: number;
}

let drawerOpen = false;
let sectionDrawerTrigger: HTMLElement | null = null;

function closeSectionDrawer(restoreFocus = true): void {
  removeTrappedDialog(document.getElementById("xyle-sections-drawer"));
  const trigger = sectionDrawerTrigger;
  sectionDrawerTrigger = null;
  drawerOpen = false;
  if (restoreFocus && trigger?.isConnected) trigger.focus();
  if (!session && !activeTools) setInteractionMode(hoveredCandidate ? "hover" : "idle");
}

function openSectionDrawer(): void {
  const trigger = sectionDrawerTrigger ?? (document.activeElement as HTMLElement | null);
  closeSectionDrawer(false);
  closeMediaDrawer(false);
  closeChangesDrawer(false);
  closeSeoDrawer(false);
  closeContextTools(false);
  sectionDrawerTrigger = trigger;
  drawerOpen = true;
  setInteractionMode("drawer");
  const drawer = document.createElement("aside");
  drawer.id = "xyle-sections-drawer";
  drawer.className = "xyle-drawer xyle-sections-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-labelledby", "xyle-sections-title");
  drawer.innerHTML = `<header class="xyle-drawer-header">
    <strong id="xyle-sections-title"><span>Sections</span></strong>
    <button class="xyle-icon-button" type="button" data-close aria-label="Close sections">×</button>
  </header>
  <p class="xyle-media-help">Hide or reorder safe sibling sections. Xyle refuses ambiguous structures.</p>
  <div class="xyle-changes-list" data-section-list></div>`;
  const closeButton = drawer.querySelector<HTMLButtonElement>("[data-close]")!;
  closeButton.addEventListener("click", () => closeSectionDrawer());
  const list = drawer.querySelector<HTMLElement>("[data-section-list]")!;
  const sections = state.current?.nodes.filter((node) => node.kind === "section") ?? [];
  if (sections.length === 0) {
    list.innerHTML = `<p class="xyle-empty-state">No safe sections found.</p>`;
  }
  for (const meta of sections) {
    const element = currentNodeElement(meta.id);
    if (!element) continue;
    const row = document.createElement("div");
    row.className = "xyle-change-row";
    const heading = document.createElement("strong");
    heading.className = "xyle-change-label";
    heading.textContent = sectionPreview(element);
    const actions = document.createElement("div");
    actions.className = "xyle-change-row-actions";
    const visibility = document.createElement("button");
    visibility.type = "button";
    visibility.className = "xyle-undo-button";
    visibility.textContent = element.hidden ? "Show" : "Hide";
    visibility.addEventListener("click", () => {
      updateSectionVisibility(meta.id, Boolean(element.hidden));
      openSectionDrawer();
    });
    actions.append(visibility);
    const siblings = sectionChildren(element.parentElement!);
    const index = siblings.indexOf(element);
    const addMove = (label: string, target: HTMLElement | undefined, before: boolean): void => {
      if (!target) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "xyle-undo-button";
      button.textContent = label;
      button.addEventListener("click", () => {
        moveSection(meta.id, target.getAttribute("data-xyle-node")!, before);
        openSectionDrawer();
      });
      actions.append(button);
    };
    addMove("Up", siblings[index - 1], true);
    addMove("Down", siblings[index + 1], false);
    row.append(heading, actions);
    list.append(row);
  }
  document.body.append(drawer);
  trapDialogFocus(drawer, () => closeSectionDrawer());
  closeButton.focus();
}

function sectionPreview(element: HTMLElement): string {
  const heading = element.querySelector("h1,h2,h3,h4,h5,h6");
  return heading?.textContent?.trim() || element.getAttribute("aria-label") || "Section";
}

let mediaManagementUnavailable = false;
let mediaRequestGeneration = 0;
let mediaDrawerTrigger: HTMLElement | null = null;
const stagedMediaLibrary = new Map<string, MediaItem>();

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

type MediaDrawerState = "loading" | "ready" | "error" | "unavailable";

async function openMediaDrawer(trigger?: HTMLElement): Promise<void> {
  closeSeoDrawer(false);
  closeChangesDrawer(false);
  closeSectionDrawer(false);
  if (drawerOpen) return;
  mediaDrawerTrigger = trigger ?? (document.activeElement as HTMLElement | null);
  if (mediaManagementUnavailable) {
    renderMediaDrawer([], "unavailable");
    return;
  }
  renderMediaDrawer([], "loading");
  const requestGeneration = ++mediaRequestGeneration;
  try {
    const res = await api("/__xyle/api/media");
    if (requestGeneration !== mediaRequestGeneration) return;
    if (!res.ok) {
      if (res.status === 501) mediaManagementUnavailable = true;
      renderMediaDrawer([], res.status === 501 ? "unavailable" : "error");
      if (res.status !== 501) flash("Could not load media.");
      return;
    }
    const body = (await res.json()) as MediaItem[] | { available?: boolean };
    if (requestGeneration !== mediaRequestGeneration) return;
    if (!Array.isArray(body)) {
      mediaManagementUnavailable = true;
      renderMediaDrawer([], "unavailable");
      return;
    }
    renderMediaDrawer(
      [
        ...stagedMediaLibrary.values(),
        ...body.filter((item) => !stagedMediaLibrary.has(item.path)),
      ],
      "ready",
    );
  } catch {
    if (requestGeneration !== mediaRequestGeneration) return;
    renderMediaDrawer([], "error");
    flash("Could not load media.");
  }
}

function focusPreviewElement(element: HTMLElement | null): void {
  if (!element?.isConnected) return;
  element.ownerDocument.defaultView?.focus();
  element.focus({ preventScroll: true });
}

function closeMediaDrawer(restoreFocus = true): void {
  const trigger = mediaDrawerTrigger;
  const selectedImageElement = selectedImage?.el;
  removeTrappedDialog(document.getElementById("xyle-media-drawer"));
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

function renderMediaDrawer(items: MediaItem[], drawerState: MediaDrawerState = "ready"): void {
  const trigger = mediaDrawerTrigger;
  closeMediaDrawer(false);
  mediaDrawerTrigger = trigger;
  drawerOpen = true;
  setInteractionMode("drawer");
  const drawer = document.createElement("aside");
  drawer.id = "xyle-media-drawer";
  drawer.className = "xyle-drawer xyle-media-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-labelledby", "xyle-media-title");
  if (drawerState === "loading") drawer.setAttribute("aria-busy", "true");
  const statusMessage =
    drawerState === "loading"
      ? "Loading media…"
      : drawerState === "unavailable"
        ? "Media management is unavailable for this deployment."
        : "Could not load media. Try again.";
  const drawerContent =
    drawerState === "ready"
      ? `<label class="xyle-sr-only" for="xyle-media-search">Search images</label>
        <input id="xyle-media-search" class="xyle-media-search" name="media-search" autocomplete="off" placeholder="Search images…">
        <nav id="xyle-media-tabs" class="xyle-media-tabs" aria-label="Filter media">
          <button data-tab="all" class="xyle-media-tab" aria-pressed="true">All</button>
          <button data-tab="used" class="xyle-media-tab" aria-pressed="false">Used</button>
          <button data-tab="uploads" class="xyle-media-tab" aria-pressed="false">Uploads</button>
        </nav>
        <p class="xyle-media-help">${selectedImage ? "Choose a thumbnail to use it on the selected image." : "Upload images here. Select an image on the page to use one."}</p>
        <div id="xyle-media-grid" class="xyle-media-grid"></div>
        <button id="xyle-media-upload" class="xyle-media-upload">Upload to library</button>`
      : `<p class="xyle-empty-state" role="status" aria-live="polite">${statusMessage}</p>`;
  drawer.replaceChildren(
    document.createRange().createContextualFragment(`
    <header class="xyle-drawer-header">
      <strong id="xyle-media-title"><svg class="xyle-drawer-title-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4-4 3 3 2-2 5 4"/></svg><span>Media</span></strong>
      <button id="xyle-media-close" class="xyle-icon-button" aria-label="Close media drawer">×</button>
    </header>
    ${drawerContent}
  `),
  );
  document.body.append(drawer);
  const closeButton = $<HTMLButtonElement>("#xyle-media-close", drawer);
  closeButton.addEventListener("click", () => closeMediaDrawer());
  trapDialogFocus(drawer, () => closeMediaDrawer());
  if (drawerState !== "ready") {
    closeButton.focus();
    return;
  }

  const grid = $<HTMLElement>("#xyle-media-grid", drawer);
  const search = $<HTMLInputElement>("#xyle-media-search", drawer);
  let tab = "all";

  const drawGrid = (): void => {
    const query = search.value.trim().toLowerCase();
    grid.innerHTML = "";
    let visibleItems = 0;
    for (const item of items) {
      if (tab === "used" && !item.usedBySimpleImg) continue;
      if (tab === "uploads" && item.source !== "xyle-upload") continue;
      if (query && !item.path.toLowerCase().includes(query)) continue;
      visibleItems += 1;
      const cell = document.createElement("button");
      cell.className = "xyle-media-cell";
      cell.setAttribute("aria-label", `Choose ${item.path}`);
      const thumb = document.createElement("img");
      thumb.src = item.previewUrl ?? item.path;
      thumb.alt = item.path.split("/").pop() ?? "";
      thumb.loading = "lazy";
      thumb.className = "xyle-media-thumb";
      cell.append(thumb);
      cell.title = item.path;
      cell.addEventListener("click", () => chooseMedia(item));
      grid.append(cell);
    }
    if (visibleItems === 0) {
      const empty = document.createElement("p");
      empty.className = "xyle-empty-state";
      empty.setAttribute("role", "status");
      empty.textContent = query
        ? "No images match this search."
        : tab === "used"
          ? "No images are used on this site."
          : tab === "uploads"
            ? "No uploaded images yet."
            : "No images found. Upload one to get started.";
      grid.append(empty);
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
  $("#xyle-media-upload", drawer).addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/avif";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const staged = await stageMediaFile(file);
      if (!staged) return;
      const item: MediaItem = {
        path: staged.path,
        contentType: staged.contentType,
        source: "xyle-upload",
        usedBySimpleImg: false,
        previewUrl: staged.objectUrl,
        width: staged.width,
        height: staged.height,
      };
      stagedMediaLibrary.set(item.path, item);
      const existingIndex = items.findIndex((candidate) => candidate.path === item.path);
      if (existingIndex >= 0) items.splice(existingIndex, 1);
      items.unshift(item);
      tab = "uploads";
      for (const peer of drawer.querySelectorAll<HTMLButtonElement>(".xyle-media-tab")) {
        peer.setAttribute("aria-pressed", String(peer.dataset.tab === tab));
      }
      drawGrid();
      flash("Uploaded to the library. Choose the thumbnail to use it.");
    });
    input.click();
  });
  drawGrid();
  search.focus();
}

function chooseMedia(item: MediaItem): void {
  if (!selectedImage) {
    flash("Select an image on the page first, then choose it from the library.");
    return;
  }
  const { el, meta } = selectedImage;
  if (item.source === "xyle-upload") item.usedBySimpleImg = true;
  const source =
    item.source === "xyle-upload" && item.previewUrl
      ? {
          kind: "staged" as const,
          assetId: item.path,
          previewUrl: item.previewUrl,
          mime: item.contentType,
          width: item.width ?? 1,
          height: item.height ?? 1,
        }
      : { kind: "existing" as const, src: item.path };
  applyMediaPatch(meta.pagePath, meta.id, el, { source, crop: null, focus: null }, "Replace image");
  closeMediaDrawer();
  flash("Image updated.");
}

/* ---------- ChangeSet / history / chrome ---------- */

function assetPathsFor(...ops: Array<Op | undefined>): string[] {
  return [
    ...new Set(
      ops
        .flatMap((op) => {
          if (op?.type === "duplicateSection" || op?.type === "duplicateGroupItem")
            return op.assetRefs.map((asset) => asset.assetId);
          if (op?.type === "src") return [op.value];
          if (op?.type === "media") return [mediaSourcePath(op.value.source)];
          return [];
        })
        .filter((path) => state.assets.has(path)),
    ),
  ];
}

function cleanupUnreachableAssets(includeHistory = true): void {
  const reachable = new Set([
    ...state.ops.flatMap(({ op }) => {
      if (op.type === "src") return [op.value];
      if (op.type === "media" && op.value.source.kind === "staged")
        return [op.value.source.assetId];
      if (op.type === "duplicateSection" || op.type === "duplicateGroupItem")
        return op.assetRefs.map((asset) => asset.assetId);
      return [];
    }),
    ...stagedMediaLibrary.keys(),
  ]);
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

function operationMatchesAuthoredBaseline(pagePath: string, op: Op): boolean {
  if (isRichContentOp(op)) {
    const region =
      regionForNode(pagePath, richNodeIds(op)[0]!) ?? ensureRichContentRegion(pagePath, op);
    const doc = pagePath === state.current?.pagePath ? previewDoc() : null;
    const currentHtml = doc ? serializeRichRegion(doc, region.nodeIds) : "";
    return Boolean(currentHtml) && currentHtml === region.originalHtml;
  }
  if (op.type === "media") {
    const original = originalMedia.get(segmentIdentity(pagePath, op.nodeId));
    return !!original && mediaStatesEqual(op.value, original);
  }
  if (op.type === "seo") {
    return originalSeo.get(seoIdentity(pagePath, op.field)) === op.value;
  }
  if (op.type === "sectionVisibility") return op.visible === op.before;
  if (op.type === "setLayoutPreset") return op.preset === op.baseline;
  if (op.type === "setRegionOrder") return op.order === "original";
  if (op.type === "moveSection") {
    const element = currentNodeElement(op.nodeId);
    const parent = element?.parentElement;
    return !!element && !!parent && sectionChildren(parent).indexOf(element) === op.originalIndex;
  }
  if (op.type === "moveGroupItem") {
    const group = groupForId(op.groupId);
    const currentOrder = groupItemsInDom(op.groupId).map((item) => item.id);
    return !!group && currentOrder.join("\0") === group.items.map((item) => item.id).join("\0");
  }
  if (op.type === "duplicateSection" || op.type === "duplicateGroupItem") return false;
  if (op.type === "href" || op.type === "src" || op.type === "alt") {
    return originalAttrs.get(attrIdentity(pagePath, op.nodeId, op.type)) === op.value;
  }
  return false;
}

function applyOp(pagePath: string, op: Op, label: string, pendingOp: Op | null = op): HistoryEntry {
  const effectivePendingOp =
    pendingOp && !operationMatchesAuthoredBaseline(pagePath, op) ? pendingOp : null;
  const key = opKey(op);
  const previous = state.ops.find(
    (entry) => entry.pagePath === pagePath && opKey(entry.op) === key,
  );
  const previousChangeSet = previous?.changeSetId
    ? { id: previous.changeSetId, label: previous.changeSetLabel ?? "" }
    : undefined;
  const changeSet = activeChangeSet
    ? { id: activeChangeSet.id, label: activeChangeSet.label }
    : undefined;
  const revision = ++nextOpRevision;
  opRevisions.set(op, revision);
  pendingRevisions.set(key, revision);
  replacePendingOp(pagePath, key, effectivePendingOp, changeSet);

  const isCurrent = (): boolean =>
    pendingRevisions.get(key) === revision &&
    (effectivePendingOp
      ? state.ops.some((entry) => entry.pagePath === pagePath && entry.op === effectivePendingOp)
      : !state.ops.some((entry) => entry.pagePath === pagePath && opKey(entry.op) === key));
  const undo = (): void => {
    if (!isCurrent()) return;
    replacePendingOp(pagePath, key, previous?.op ?? null, previousChangeSet);
    pendingRevisions.set(key, previous ? (opRevisions.get(previous.op) ?? revision) : revision);
    if (previous) applyOpToDom(pagePath, previous.op);
    else revertOpInDom(pagePath, op);
    reconcileRichContent(pagePath);
    updateDirtyUi();
  };
  const redo = (): void => {
    if (
      pendingRevisions.get(key) === revision &&
      (effectivePendingOp
        ? state.ops.some((entry) => entry.pagePath === pagePath && entry.op === effectivePendingOp)
        : !state.ops.some((entry) => entry.pagePath === pagePath && opKey(entry.op) === key))
    )
      return;
    replacePendingOp(pagePath, key, effectivePendingOp, changeSet);
    pendingRevisions.set(key, revision);
    applyOpToDom(pagePath, op);
    if (isRichContentOp(op)) {
      ensureRichContentRegion(pagePath, op);
      reconcileRichContent(pagePath);
    }
    updateDirtyUi();
  };
  const entry: HistoryEntry = {
    label,
    undo,
    redo,
    assetPaths: assetPathsFor(previous?.op, op),
    ...(changeSet ? { changeSetId: changeSet.id } : {}),
  };
  if (activeChangeSet) activeChangeSet.entries.push(entry);
  else pushHistory(entry);
  if (isRichContentOp(op)) {
    ensureRichContentRegion(pagePath, op);
    reconcileRichContent(pagePath);
  }
  updateDirtyUi();
  return entry;
}

function isRichContentOp(
  op: Op,
): op is Extract<Op, { type: "text" | "format" | "formatBlock" | "toggleList" | "html" }> {
  return (
    op.type === "text" ||
    op.type === "format" ||
    op.type === "formatBlock" ||
    op.type === "toggleList" ||
    op.type === "html"
  );
}

function richNodeIds(
  op: Extract<Op, { type: "text" | "format" | "formatBlock" | "toggleList" | "html" }>,
): string[] {
  return op.type === "toggleList"
    ? op.nodeIds.map((id) => id.split("#")[0]!)
    : [op.nodeId.split("#")[0]!];
}

function stableTargetIdForNode(pagePath: string, nodeId: string): string {
  const key = `${pagePath}@${nodeId}`;
  const known = stableTargetIds.get(key);
  if (known) return known;
  const meta = state.current?.nodes.find((node) => node.id === nodeId);
  const stableTargetId =
    meta?.stableTargetId ??
    stableIdentity([
      "target",
      pagePath,
      meta?.kind ?? "unknown",
      meta?.tag ?? "unknown",
      String(meta?.sourceStart ?? -1),
      String(meta?.sourceEnd ?? -1),
    ]);
  stableTargetIds.set(key, stableTargetId);
  return stableTargetId;
}

function stableChangeId(pagePath: string, domain: string, targetId: string): string {
  return `change:${stableIdentity([pagePath, domain, targetId])}`;
}

function richRegionKey(pagePath: string, targetIds: string[]): string {
  return `region:${stableIdentity(["rich", pagePath, ...[...targetIds].sort()])}`;
}

function resolveRichRegionId(id: string): string {
  let resolved = id;
  const seen = new Set<string>();
  while (!seen.has(resolved)) {
    seen.add(resolved);
    const alias = richContentRegionAliases.get(resolved);
    if (!alias) break;
    resolved = alias.regionId;
  }
  return resolved;
}

function richRegionById(id: string): RichContentRegion | undefined {
  return richContentRegions.get(resolveRichRegionId(id));
}

function stripPreviewInstrumentation(
  root: Element,
  options: { keepNodeMarkers?: boolean } = {},
): void {
  const elements = [root, ...root.querySelectorAll("*")];
  for (const element of elements) {
    const generatedTabIndex = element.hasAttribute("data-xyle-generated-tabindex");
    const generatedHover = element.hasAttribute("data-xyle-generated-hover");
    const generatedEditing = element.hasAttribute("data-xyle-generated-editing");
    if (generatedTabIndex) element.removeAttribute("tabindex");
    if (element.hasAttribute("data-xyle-generated-aria-description"))
      element.removeAttribute("aria-description");
    if (element.hasAttribute("data-xyle-generated-aria-keyshortcuts"))
      element.removeAttribute("aria-keyshortcuts");
    if (generatedHover) element.classList.remove("xyle-hover");
    if (generatedEditing) {
      element.classList.remove("xyle-editing");
      element.removeAttribute("contenteditable");
    }
    for (const attribute of [
      ...(options.keepNodeMarkers ? [] : ["data-xyle-node"]),
      "data-xyle-format",
      "data-xyle-controlled-break",
      "data-xyle-generated-tabindex",
      "data-xyle-generated-hover",
      "data-xyle-generated-editing",
      "data-xyle-generated-aria-description",
      "data-xyle-generated-aria-keyshortcuts",
      "data-xyle-keyboard-target",
      "data-xyle-group",
      "data-xyle-group-item",
      "data-xyle-layout-region",
    ]) {
      element.removeAttribute(attribute);
    }
  }
}

function stripEditorMarkup(root: Element): void {
  stripPreviewInstrumentation(root);
}

function cleanRichFragment(elements: Element[]): string {
  const wrapper = document.createElement("div");
  for (const element of elements) {
    const clone = element.cloneNode(true) as Element;
    stripEditorMarkup(clone);
    wrapper.append(clone);
  }
  return cleanInlineHtml(wrapper);
}

function serializeSelectedList(list: Element, nodeIds: string[]): string {
  const selected = new Set(nodeIds);
  const clone = list.cloneNode(true) as Element;
  for (const child of [...clone.children]) {
    if (!selected.has(child.getAttribute("data-xyle-node") ?? "")) child.remove();
  }
  stripEditorMarkup(clone);
  return clone.outerHTML;
}

function serializeRichRegion(doc: Document, nodeIds: string[]): string {
  const elements = nodeIds
    .map((id) => doc.querySelector<HTMLElement>(`[data-xyle-node="${id}"]`))
    .filter((element): element is HTMLElement => !!element);
  if (elements.length === 0) return "";
  const parent = elements[0]!.parentElement;
  if (parent && elements.every((element) => element.parentElement === parent)) {
    if (isListTag(parent.tagName.toLowerCase())) return serializeSelectedList(parent, nodeIds);
    return cleanRichFragment(
      [...elements].sort((left, right) => {
        const children = [...parent.children];
        return children.indexOf(left) - children.indexOf(right);
      }),
    );
  }
  // Region membership is authoritative. Never serialize an unrelated ancestor
  // merely because a transformation temporarily split the member nodes.
  return cleanRichFragment(elements);
}

function sourceRichRegionHtml(pagePath: string, nodeIds: string[]): string {
  const current = state.current;
  if (!current || current.pagePath !== pagePath) return "";
  const createdId = nodeIds
    .map((nodeId) =>
      state.ops.find(
        ({ op }) =>
          op.type === "duplicateSection" &&
          (op.createdId === nodeId || Object.values(op.nodeMap).includes(nodeId)),
      ),
    )
    .find(
      (entry): entry is PendingOp & { op: Extract<Op, { type: "duplicateSection" }> } => !!entry,
    )?.op.createdId;
  if (createdId) {
    const duplicate = state.ops.find(
      ({ op }) => op.type === "duplicateSection" && op.createdId === createdId,
    )?.op;
    if (duplicate?.type === "duplicateSection" && duplicate.previewHtml) {
      const snapshot = new DOMParser().parseFromString(duplicate.previewHtml, "text/html");
      return serializeRichRegion(snapshot, nodeIds);
    }
  }
  const base = new DOMParser().parseFromString(current.html, "text/html");
  return serializeRichRegion(base, nodeIds);
}

function regionAnchor(nodeIds: string[]): string {
  const order = new Map((state.current?.nodes ?? []).map((node, index) => [node.id, index]));
  return [...nodeIds].sort(
    (left, right) => (order.get(left) ?? Infinity) - (order.get(right) ?? Infinity),
  )[0]!;
}

function regionForNode(pagePath: string, nodeId: string): RichContentRegion | undefined {
  const normalized = nodeId.split("#")[0]!;
  return [...richContentRegions.values()].find(
    (region) => region.pagePath === pagePath && region.nodeIds.includes(normalized),
  );
}

function ensureRichContentRegion(
  pagePath: string,
  op: Extract<Op, { type: "text" | "format" | "formatBlock" | "toggleList" | "html" }>,
): RichContentRegion {
  const ids = [...new Set(richNodeIds(op))];
  const matches = [...richContentRegions.values()].filter(
    (region) => region.pagePath === pagePath && ids.some((id) => region.nodeIds.includes(id)),
  );
  const nodeIds = [...new Set(matches.flatMap((region) => region.nodeIds).concat(ids))];
  const anchorId = regionAnchor(nodeIds);
  const targetIds = nodeIds.map((id) => stableTargetIdForNode(pagePath, id));
  const members = nodeIds.map((nodeId, index) => {
    const meta = state.current?.nodes.find((node) => node.id === nodeId);
    return {
      nodeId,
      targetId: targetIds[index]!,
      elementStart: meta?.elementStart ?? meta?.sourceStart ?? -1,
      elementEnd: meta?.elementEnd ?? meta?.sourceEnd ?? -1,
    };
  });
  const regionId = richRegionKey(pagePath, targetIds);
  const region: RichContentRegion = {
    id: regionId,
    pagePath,
    anchorId,
    targetIds,
    nodeIds,
    members,
    originalHtml: sourceRichRegionHtml(pagePath, nodeIds),
    currentHtml: "",
  };
  for (const match of matches) {
    richContentRegions.delete(match.id);
    richContentRegionAliases.set(match.id, {
      pagePath,
      targetIds: match.targetIds,
      regionId,
    });
    changeIdAliases.set(
      stableChangeId(pagePath, "rich", match.id),
      stableChangeId(pagePath, "rich", regionId),
    );
  }
  richContentRegions.set(region.id, region);
  return region;
}

function regionHasPendingOps(region: RichContentRegion): boolean {
  return state.ops.some(
    (entry) =>
      entry.pagePath === region.pagePath &&
      isRichContentOp(entry.op) &&
      richNodeIds(entry.op).some((id) => region.nodeIds.includes(id)),
  );
}

function reconcileRichContent(pagePath?: string): void {
  for (const region of [...richContentRegions.values()]) {
    if (pagePath && region.pagePath !== pagePath) continue;
    if (!regionHasPendingOps(region)) {
      richContentRegions.delete(region.id);
      continue;
    }
    if (state.current?.pagePath === region.pagePath) {
      const doc = previewDoc();
      if (!doc) continue;
      const currentHtml = serializeRichRegion(doc, region.nodeIds);
      if (currentHtml) region.currentHtml = currentHtml;
      if (region.currentHtml === region.originalHtml) richContentRegions.delete(region.id);
    }
  }
}

function opKey(op: Op): string {
  if (op.type === "duplicateSection" || op.type === "duplicateGroupItem") {
    return `${op.type}@${op.createdId}`;
  }
  if (op.type === "moveGroupItem") {
    return `${op.type}@${op.groupId}:${op.itemId}:${op.targetItemId}:${op.position}:${op.sequence}`;
  }
  if (op.type === "setLayoutPreset") return `${op.type}@${op.nodeId}`;
  if (op.type === "setRegionOrder") return `${op.type}@${op.targetId}`;
  const target = op.type === "text" ? op.nodeId : `${op.nodeId}:${op.type}`;
  if (op.type === "format" && op.start !== undefined && op.end !== undefined) {
    return `${op.type}@${target}:${op.start}-${op.end}`;
  }
  return `${op.type}@${target}`;
}
function removeOpsFor(pagePath: string, key: string): void {
  state.ops = state.ops.filter(
    (entry) => !(entry.pagePath === pagePath && opKey(entry.op) === key),
  );
}
function replacePendingOp(
  pagePath: string,
  key: string,
  op: Op | null,
  changeSet?: { id: string; label: string },
): void {
  removeOpsFor(pagePath, key);
  if (op) {
    state.ops.push({
      pagePath,
      op,
      ...(changeSet ? { changeSetId: changeSet.id, changeSetLabel: changeSet.label } : {}),
    });
  }
}

function pushHistory(entry: HistoryEntry): void {
  state.history = state.history.slice(0, state.historyIndex);
  state.history.push(entry);
  if (state.history.length > MAX_HISTORY) state.history.shift();
  state.historyIndex = state.history.length;
  cleanupUnreachableAssets();
}

function dirtyCount(): number {
  return buildUserChanges().length;
}

const SEO_FIELDS: SeoField[] = [
  "title",
  "description",
  "canonical",
  "ogTitle",
  "ogDescription",
  "ogImage",
];

function seoIdentity(pagePath: string, field: SeoField): string {
  return `${pagePath}:seo:${field}`;
}

function readSeoState(): SeoState {
  const doc = previewDoc();
  const meta = (selector: string): string =>
    doc?.querySelector<HTMLMetaElement>(selector)?.content ?? "";
  return {
    title: doc?.title ?? "",
    description: meta('meta[name="description"]'),
    canonical:
      doc?.querySelector<HTMLLinkElement>('link[rel~="canonical"]')?.getAttribute("href") ?? "",
    ogTitle: meta('meta[property="og:title"]'),
    ogDescription: meta('meta[property="og:description"]'),
    ogImage: meta('meta[property="og:image"]'),
  };
}

function applySeoToDom(field: SeoField, value: string): void {
  const doc = previewDoc();
  if (!doc) return;
  if (field === "title") {
    if (doc.title !== value) doc.title = value;
    return;
  }
  const selector =
    field === "description"
      ? 'meta[name="description"]'
      : field === "canonical"
        ? 'link[rel~="canonical"]'
        : `meta[property="${field === "ogTitle" ? "og:title" : field === "ogDescription" ? "og:description" : "og:image"}"]`;
  let element = doc.head.querySelector<HTMLElement>(selector);
  if (!value) {
    element?.remove();
    return;
  }
  if (!element) {
    element = doc.createElement(field === "canonical" ? "link" : "meta");
    if (field === "canonical") element.setAttribute("rel", "canonical");
    else if (field === "description") element.setAttribute("name", "description");
    else
      element.setAttribute(
        "property",
        field === "ogTitle"
          ? "og:title"
          : field === "ogDescription"
            ? "og:description"
            : "og:image",
      );
    doc.head.append(element);
  }
  element.setAttribute(field === "canonical" ? "href" : "content", value);
}

function getSeo(): SeoState {
  return readSeoState();
}

function validateSeoValue(field: SeoField, value: string): void {
  if (value.length > (field === "description" ? 300 : 200)) {
    throw new Error(`SEO ${field} is too long`);
  }
  if (field === "title" && !value.trim()) throw new Error("SEO title cannot be empty");
  if ((field === "canonical" || field === "ogImage") && value && !isSafeUrl(value)) {
    throw new Error(`Unsafe SEO URL rejected for ${field}`);
  }
}

function updateSeo(field: SeoField, value: string): SeoUpdateResult {
  const current = state.current;
  if (!current || !SEO_FIELDS.includes(field)) throw new Error("Unsupported SEO field");
  validateSeoValue(field, value);
  const before = readSeoState()[field];
  const identity = seoIdentity(current.pagePath, field);
  if (!originalSeo.has(identity)) originalSeo.set(identity, before);
  if (before === value) return { field, pagePath: current.pagePath, value };
  const nodeId = `seo:${field}`;
  const operation: Op = { type: "seo", nodeId, field, value };
  const key = opKey(operation);
  const previousEntry = state.ops.find(
    (entry) =>
      entry.pagePath === current.pagePath && entry.op.type === "seo" && entry.op.field === field,
  );
  const changeSet = activeChangeSet
    ? { id: activeChangeSet.id, label: activeChangeSet.label }
    : undefined;
  replacePendingOp(
    current.pagePath,
    key,
    value === originalSeo.get(identity) ? null : operation,
    changeSet,
  );
  applySeoToDom(field, value);
  const entry: HistoryEntry = {
    label: "Update SEO metadata",
    assetPaths: [],
    ...(changeSet ? { changeSetId: changeSet.id, changeSetLabel: changeSet.label } : {}),
    undo: () => {
      replacePendingOp(current.pagePath, key, previousEntry?.op ?? null);
      applySeoToDom(
        field,
        previousEntry?.op.type === "seo"
          ? previousEntry.op.value
          : (originalSeo.get(identity) ?? ""),
      );
      updateDirtyUi();
    },
    redo: () => {
      replacePendingOp(
        current.pagePath,
        key,
        value === originalSeo.get(identity) ? null : operation,
        changeSet,
      );
      applySeoToDom(field, value);
      updateDirtyUi();
    },
  };
  if (activeChangeSet) activeChangeSet.entries.push(entry);
  else pushHistory(entry);
  updateDirtyUi();
  return { field, pagePath: current.pagePath, value };
}

function sectionMeta(nodeId: string): NodeMeta | undefined {
  return state.current?.nodes.find(
    (candidate) => candidate.id === nodeId && candidate.kind === "section",
  );
}

function sectionChildren(parent: Element): HTMLElement[] {
  const current = state.current;
  if (!current) return [];
  return [...parent.children].filter((child): child is HTMLElement => {
    const id = child.getAttribute("data-xyle-node");
    return (
      !!id && current.nodes.some((candidate) => candidate.id === id && candidate.kind === "section")
    );
  });
}

function updateSectionVisibility(
  nodeId: string,
  visible: boolean,
): { id: string; visible: boolean } {
  const current = state.current;
  const element = currentNodeElement(nodeId);
  if (!current || !element || !sectionMeta(nodeId))
    throw new Error(`Unknown Xyle section ${nodeId}`);
  if (typeof visible !== "boolean") throw new Error("Section visibility must be boolean");
  const previous = state.ops.find(
    (entry) =>
      entry.pagePath === current.pagePath &&
      entry.op.type === "sectionVisibility" &&
      entry.op.nodeId === nodeId,
  );
  const before = previous?.op.type === "sectionVisibility" ? previous.op.before : !element.hidden;
  const operation: Op = { type: "sectionVisibility", nodeId, visible, before };
  applyOpToDom(current.pagePath, operation);
  applyOp(current.pagePath, operation, visible ? "Show section" : "Hide section");
  return { id: nodeId, visible };
}

function moveSection(
  nodeId: string,
  targetId: string,
  before: boolean,
): { id: string; targetId: string; before: boolean } {
  const current = state.current;
  const source = currentNodeElement(nodeId);
  const target = currentNodeElement(targetId);
  if (
    !current ||
    !source ||
    !target ||
    !sectionMeta(nodeId) ||
    !sectionMeta(targetId) ||
    source === target ||
    source.parentElement !== target.parentElement
  ) {
    throw new Error("Sections must be safe siblings in one parent");
  }
  const siblings = sectionChildren(source.parentElement!);
  if (siblings.length !== source.parentElement!.children.length) {
    throw new Error("Section parent contains unsupported sibling content");
  }
  const currentIndex = siblings.indexOf(source);
  if (currentIndex < 0 || !siblings.includes(target))
    throw new Error("Section order is unavailable");
  const previous = state.ops.find(
    (entry) =>
      entry.pagePath === current.pagePath &&
      entry.op.type === "moveSection" &&
      entry.op.nodeId === nodeId,
  );
  const originalIndex =
    previous?.op.type === "moveSection" ? previous.op.originalIndex : currentIndex;
  const operation: Op = {
    type: "moveSection",
    nodeId,
    targetId,
    before,
    originalIndex,
    sequence: allocateStructuralSequence(),
  };
  applyOpToDom(current.pagePath, operation);
  applyOp(current.pagePath, operation, before ? "Move section before" : "Move section after");
  return { id: nodeId, targetId, before };
}

function duplicateSection(nodeId: string): { id: string; sourceId: string } {
  const current = state.current;
  const source = currentNodeElement(nodeId);
  if (!current || !source || source.tagName !== "SECTION" || !sectionMeta(nodeId))
    throw new Error("Only safe sections can be duplicated");
  if (state.ops.some(({ op }) => op.type === "duplicateSection" && op.createdId === nodeId))
    throw new Error("Created sections cannot be duplicated yet");
  if (source.querySelector("section, script, form, iframe, video, canvas"))
    throw new Error("Only safe sections can be duplicated");
  const parent = source.parentElement;
  if (!parent || sectionChildren(parent).length !== parent.children.length)
    throw new Error("Section parent contains unsupported sibling content");
  const createdId = stableIdentity([
    "created-section",
    current.pagePath,
    nodeId,
    crypto.randomUUID(),
  ]);
  duplicateSourceLabels.set(createdId, displayNameForElement(source));
  const clone = source.cloneNode(true) as HTMLElement;
  stripPreviewInstrumentation(clone, { keepNodeMarkers: true });
  const sourceIdValues = [
    ...(source.id ? [source.id] : []),
    ...[...source.querySelectorAll<HTMLElement>("[id]")]
      .map((element) => element.id)
      .filter(Boolean),
  ];
  if (new Set(sourceIdValues).size !== sourceIdValues.length)
    throw new Error("Duplicate section contains duplicate HTML ids");
  const sourceIds = new Set(sourceIdValues);
  const idMap = new Map<string, string>();
  const documentIds = new Set(
    [...source.ownerDocument.querySelectorAll<HTMLElement>("[id]")]
      .map((element) => element.id)
      .filter(Boolean),
  );
  for (const id of sourceIds) {
    const cloneId = duplicateHtmlId(createdId, id);
    if (documentIds.has(cloneId))
      throw new Error("Duplicate section generated an HTML id collision");
    idMap.set(id, cloneId);
  }
  const sourceNodeIds = new Map<string, string>();
  source.querySelectorAll<HTMLElement>("[data-xyle-node]").forEach((element) => {
    const originalId = element.dataset.xyleNode;
    if (!originalId) return;
    const meta = current.nodes.find((candidate) => candidate.id === originalId);
    const logicalKey = meta?.stableTargetId ?? originalId;
    sourceNodeIds.set(originalId, createdNodeIdentity(createdId, logicalKey));
  });
  const rewrite = (element: HTMLElement): void => {
    if (element.id && idMap.has(element.id)) element.id = idMap.get(element.id)!;
    const nodeId = element.dataset.xyleNode;
    if (nodeId && sourceNodeIds.has(nodeId)) element.dataset.xyleNode = sourceNodeIds.get(nodeId)!;
    for (const attribute of STRUCTURAL_ID_REFERENCE_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value)
        element.setAttribute(
          attribute,
          value
            .split(/\s+/)
            .map((token) => idMap.get(token) ?? token)
            .join(" "),
        );
    }
    const href = element.getAttribute("href");
    if (href?.startsWith("#") && idMap.has(href.slice(1)))
      element.setAttribute("href", `#${idMap.get(href.slice(1))}`);
    for (const child of [...element.children] as HTMLElement[]) rewrite(child);
  };
  rewrite(clone);
  clone.dataset.xyleNode = createdId;
  source.after(clone);
  const sourceMeta = current.nodes.find((candidate) => candidate.id === nodeId)!;
  registerCreatedSectionNodes(current, sourceMeta, clone, nodeId, createdId, sourceNodeIds);

  const snapshotOperations = state.ops
    .filter(
      ({ pagePath, op }) =>
        pagePath === current.pagePath &&
        op.type !== "duplicateSection" &&
        op.type !== "duplicateGroupItem" &&
        op.type !== "moveGroupItem" &&
        opTargetsElement(op, source),
    )
    .map(({ op }) => structuredClone(op) as SnapshotOperation);
  registerCreatedMediaStates(current.pagePath, clone, sourceNodeIds, snapshotOperations);
  const operation: Op = {
    type: "duplicateSection",
    sourceId: nodeId,
    createdId,
    sequence: allocateStructuralSequence(),
    insert: "after",
    snapshotOperations,
    nodeMap: { [nodeId]: createdId, ...Object.fromEntries(sourceNodeIds) },
    previewHtml: new XMLSerializer().serializeToString(clone),
    idMap: Object.fromEntries(idMap),
    assetRefs: [
      ...new Set(
        snapshotOperations.flatMap((snapshot) =>
          snapshot.type === "media" && snapshot.value.source.kind === "staged"
            ? [snapshot.value.source.assetId]
            : [],
        ),
      ),
    ].map((assetId) => ({ assetId })),
  };
  applyOp(current.pagePath, operation, "Duplicate section");
  return { id: createdId, sourceId: nodeId };
}

function duplicateGroupItem(
  groupId: string,
  itemId: string,
): { id: string; groupId: string; sourceItemId: string } {
  const current = state.current;
  const doc = previewDoc();
  const group = current?.groups.find((candidate) => candidate.id === groupId);
  const item = group?.items.find((candidate) => candidate.id === itemId);
  const source = item
    ? doc?.querySelector<HTMLElement>(`[data-xyle-group-item="${CSS.escape(item.id)}"]`)
    : null;
  const container = group
    ? doc?.querySelector<HTMLElement>(`[data-xyle-group="${CSS.escape(group.id)}"]`)
    : null;
  if (
    !current ||
    !group ||
    !item ||
    !source ||
    !container ||
    source.parentElement !== container ||
    source.tagName.toLowerCase() !== item.tag
  ) {
    throw new Error("Only source-backed Group items can be duplicated");
  }
  if (state.ops.some(({ op }) => op.type === "duplicateGroupItem" && op.createdId === item.id)) {
    throw new Error("Created Group items cannot be duplicated yet");
  }
  const siblings = [...container.children].filter((child) =>
    child.hasAttribute("data-xyle-group-item"),
  );
  if (
    siblings.length !== group.items.length ||
    siblings[item.index] !== source ||
    siblings.some(
      (sibling, index) => sibling.getAttribute("data-xyle-group-item") !== group.items[index]!.id,
    )
  ) {
    throw new Error("Group item order is unavailable");
  }
  const createdId = stableIdentity([
    "created-group-item",
    current.pagePath,
    groupId,
    itemId,
    crypto.randomUUID(),
  ]);
  duplicateSourceLabels.set(createdId, displayNameForElement(source));
  const clone = source.cloneNode(true) as HTMLElement;
  stripPreviewInstrumentation(clone, { keepNodeMarkers: true });
  const sourceIdValues = [
    ...(source.id ? [source.id] : []),
    ...[...source.querySelectorAll<HTMLElement>("[id]")]
      .map((element) => element.id)
      .filter(Boolean),
  ];
  if (new Set(sourceIdValues).size !== sourceIdValues.length)
    throw new Error("Group item contains duplicate HTML ids");
  const snapshotOperations = state.ops
    .filter(
      ({ pagePath, op }) =>
        pagePath === current.pagePath &&
        op.type !== "duplicateSection" &&
        op.type !== "duplicateGroupItem" &&
        opTargetsElement(op, source),
    )
    .map(({ op }) => structuredClone(op) as SnapshotOperation);
  const documentIds = new Set(
    [...source.ownerDocument.querySelectorAll<HTMLElement>("[id]")]
      .map((element) => element.id)
      .filter(Boolean),
  );
  const idMap = new Map<string, string>();
  for (const id of sourceIdValues) {
    const cloneId = duplicateGroupHtmlId(createdId, id);
    if (documentIds.has(cloneId)) throw new Error("Group item generated an HTML id collision");
    idMap.set(id, cloneId);
  }
  const sourceNodeIds = new Map<string, string>();
  source.querySelectorAll<HTMLElement>("[data-xyle-node]").forEach((element) => {
    const originalId = element.dataset.xyleNode;
    if (!originalId) return;
    const meta = current.nodes.find((candidate) => candidate.id === originalId);
    const logicalKey = meta?.stableTargetId ?? originalId;
    sourceNodeIds.set(originalId, createdNodeIdentity(createdId, logicalKey));
  });
  const rewrite = (element: HTMLElement): void => {
    if (element.id && idMap.has(element.id)) element.id = idMap.get(element.id)!;
    const nodeId = element.dataset.xyleNode;
    if (nodeId && sourceNodeIds.has(nodeId)) element.dataset.xyleNode = sourceNodeIds.get(nodeId)!;
    for (const attribute of STRUCTURAL_ID_REFERENCE_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, rewriteIdTokens(value, idMap));
    }
    const href = element.getAttribute("href");
    if (href?.startsWith("#") && idMap.has(href.slice(1)))
      element.setAttribute("href", `#${idMap.get(href.slice(1))}`);
    for (const child of [...element.children] as HTMLElement[]) rewrite(child);
  };
  rewrite(clone);
  clone.dataset.xyleGroupItem = createdId;
  const previousDuplicates = state.ops
    .flatMap(({ pagePath, op }) =>
      pagePath === current.pagePath &&
      op.type === "duplicateGroupItem" &&
      op.groupId === groupId &&
      op.sourceItemId === itemId
        ? [op]
        : [],
    )
    .sort((left, right) => left.sequence - right.sequence);
  const anchor = previousDuplicates.length
    ? (doc?.querySelector<HTMLElement>(
        `[data-xyle-group-item="${CSS.escape(previousDuplicates.at(-1)!.createdId)}"]`,
      ) ?? source)
    : source;
  anchor.after(clone);
  registerCreatedSubtreeNodes(current, clone, sourceNodeIds);
  registerCreatedMediaStates(current.pagePath, clone, sourceNodeIds, snapshotOperations);
  const operation: Op = {
    type: "duplicateGroupItem",
    groupId,
    sourceItemId: itemId,
    sourceItemIndex: item.index,
    groupSignature: group.signature,
    itemSignature: item.signature,
    createdId,
    sequence: allocateStructuralSequence(),
    insert: "after",
    snapshotOperations,
    nodeMap: { [itemId]: createdId, ...Object.fromEntries(sourceNodeIds) },
    previewHtml: new XMLSerializer().serializeToString(clone),
    idMap: Object.fromEntries(idMap),
    assetRefs: [
      ...new Set(
        snapshotOperations.flatMap((op) =>
          op.type === "media" && op.value.source.kind === "staged" ? [op.value.source.assetId] : [],
        ),
      ),
    ].map((assetId) => ({ assetId })),
  };
  applyOp(current.pagePath, operation, "Duplicate Group item");
  return { id: createdId, groupId, sourceItemId: itemId };
}

function applyGroupItemDuplicateToDom(
  pagePath: string,
  op: Extract<Op, { type: "duplicateGroupItem" }>,
): void {
  const current = state.current;
  const doc = previewDoc();
  const source = doc?.querySelector<HTMLElement>(
    `[data-xyle-group-item="${CSS.escape(op.sourceItemId)}"]`,
  );
  if (pagePath !== current?.pagePath || !current || !doc || !source || !op.previewHtml) return;
  const parsed = new DOMParser().parseFromString(op.previewHtml, "text/html");
  const parsedClone = parsed.body.firstElementChild;
  if (!(parsedClone instanceof HTMLElement)) return;
  const clone = document.importNode(parsedClone, true) as HTMLElement;
  const previous = state.ops
    .flatMap(({ pagePath: entryPage, op: entryOp }) =>
      entryPage === pagePath &&
      entryOp.type === "duplicateGroupItem" &&
      entryOp.groupId === op.groupId &&
      entryOp.sourceItemId === op.sourceItemId &&
      entryOp.sequence < op.sequence
        ? [entryOp]
        : [],
    )
    .sort((left, right) => left.sequence - right.sequence);
  const anchor = previous.length
    ? (doc.querySelector<HTMLElement>(
        `[data-xyle-group-item="${CSS.escape(previous.at(-1)!.createdId)}"]`,
      ) ?? source)
    : source;
  anchor.after(clone);
  const sourceNodeMap = new Map(
    Object.entries(op.nodeMap).map(([originalId, createdNodeId]) => [originalId, createdNodeId]),
  );
  registerCreatedSubtreeNodes(current, clone, sourceNodeMap);
  registerCreatedMediaStates(pagePath, clone, sourceNodeMap, op.snapshotOperations);
}

interface CreatedRootRegistration {
  sourceId: string;
  createdId: string;
  sourceMeta: NodeMeta;
}

function registerCreatedSubtreeNodes(
  current: PageData,
  clone: HTMLElement,
  sourceNodeIds: ReadonlyMap<string, string>,
  root?: CreatedRootRegistration,
): void {
  const createdToSource = new Map(
    [...sourceNodeIds.entries()].map(([originalId, createdNodeId]) => [createdNodeId, originalId]),
  );
  const elements = [clone, ...clone.querySelectorAll<HTMLElement>("[data-xyle-node]")];
  const createdNodes: NodeMeta[] = [];
  for (const element of elements) {
    const id = element.dataset.xyleNode;
    if (!id) continue;
    const originalId = id === root?.createdId ? root.sourceId : createdToSource.get(id);
    const original =
      root && originalId === root.sourceId
        ? root.sourceMeta
        : originalId
          ? current.nodes.find((candidate) => candidate.id === originalId)
          : undefined;
    if (!original) continue;
    const {
      sourceStart: _sourceStart,
      sourceEnd: _sourceEnd,
      elementStart: _elementStart,
      elementEnd: _elementEnd,
      contentStart: _contentStart,
      segments: _segments,
      ...createdMeta
    } = original;
    void _sourceStart;
    void _sourceEnd;
    void _elementStart;
    void _elementEnd;
    void _contentStart;
    void _segments;
    createdNodes.push({
      ...createdMeta,
      id,
      pagePath: current.pagePath,
      stableTargetId: id,
      ...(original.segments
        ? { segmentCount: original.segmentCount ?? original.segments.length }
        : {}),
    });
  }
  const createdIds = new Set(createdNodes.map((node) => node.id));
  current.nodes = current.nodes.filter((node) => !createdIds.has(node.id));
  current.nodes.push(...createdNodes);
  for (const node of createdNodes) {
    const element = clone.ownerDocument.querySelector<HTMLElement>(
      `[data-xyle-node="${CSS.escape(node.id)}"]`,
    );
    if (element) wireCandidate(element, node);
  }
}

function registerCreatedSectionNodes(
  current: PageData,
  sourceMeta: NodeMeta,
  clone: HTMLElement,
  sourceId: string,
  createdId: string,
  sourceNodeIds: ReadonlyMap<string, string>,
): void {
  registerCreatedSubtreeNodes(current, clone, sourceNodeIds, { sourceMeta, sourceId, createdId });
}

function registerCreatedMediaStates(
  pagePath: string,
  clone: HTMLElement,
  sourceNodeIds: ReadonlyMap<string, string>,
  sourceOperations: readonly SnapshotOperation[] = [],
): void {
  const sourceToCreated = new Map(sourceNodeIds);
  for (const operation of sourceOperations) {
    if (operation.type !== "media") continue;
    const createdNodeId = sourceToCreated.get(operation.nodeId);
    if (!createdNodeId) continue;
    const image = clone.querySelector<HTMLImageElement>(
      `[data-xyle-node="${CSS.escape(createdNodeId)}"]`,
    );
    if (!image || image.tagName !== "IMG") continue;
    const media = normalizeMediaState(operation.value);
    createdMedia.set(segmentIdentity(pagePath, createdNodeId), media);
    applyMediaStateToDom(image, media);
  }
}

function removeCreatedSubtreeState(current: PageData, createdIds: ReadonlySet<string>): void {
  current.nodes = current.nodes.filter((node) => !createdIds.has(node.id));
  for (const id of createdIds) {
    createdMedia.delete(segmentIdentity(current.pagePath, id));
    originalMedia.delete(segmentIdentity(current.pagePath, id));
  }
}

function removeCreatedSectionState(
  current: PageData,
  op: Extract<Op, { type: "duplicateSection" }>,
): void {
  removeCreatedSubtreeState(current, new Set([op.createdId, ...Object.values(op.nodeMap)]));
}

function opTargetsElement(op: Op, root: HTMLElement): boolean {
  const ids =
    op.type === "toggleList"
      ? op.nodeIds
      : op.type === "duplicateSection"
        ? [op.sourceId]
        : op.type === "setRegionOrder"
          ? [op.targetId]
          : "nodeId" in op
            ? [op.nodeId]
            : [];
  return ids.some((id) => {
    const baseId = id.split("#")[0]!;
    return (
      root.dataset.xyleNode === baseId ||
      Boolean(root.querySelector(`[data-xyle-node="${CSS.escape(baseId)}"]`))
    );
  });
}

function groupMoveCapability(group: GroupDescriptor): GroupMoveCapability {
  const doc = previewDoc();
  const container = doc?.querySelector<HTMLElement>(`[data-xyle-group="${CSS.escape(group.id)}"]`);
  if (!doc || !container) return { supported: false, reason: "Group layout is unavailable" };
  const items = [...container.children].filter((child): child is HTMLElement =>
    child.hasAttribute("data-xyle-group-item"),
  );
  const sourceIds = new Set(group.items.map((item) => item.id));
  if (
    items.length !== group.items.length ||
    items.some((item) => !sourceIds.has(item.dataset.xyleGroupItem ?? ""))
  ) {
    return { supported: false, reason: "Move is disabled while the Group has unpublished items" };
  }
  const view = doc.defaultView;
  if (!view) return { supported: false, reason: "Group layout is unavailable" };
  const containerStyle = view.getComputedStyle(container);
  if (
    containerStyle.direction !== "ltr" ||
    containerStyle.writingMode !== "horizontal-tb" ||
    containerStyle.position === "absolute" ||
    containerStyle.position === "fixed" ||
    containerStyle.position === "sticky" ||
    containerStyle.transform !== "none" ||
    containerStyle.perspective !== "none"
  ) {
    return { supported: false, reason: "Group uses an ambiguous writing mode or transform" };
  }
  const styles = items.map((item) => view.getComputedStyle(item));
  if (
    styles.some(
      (style) =>
        style.display === "contents" ||
        style.direction !== "ltr" ||
        style.writingMode !== "horizontal-tb" ||
        style.position !== "static" ||
        style.float !== "none" ||
        style.transform !== "none" ||
        style.perspective !== "none" ||
        style.order !== "0",
    )
  ) {
    return { supported: false, reason: "Group items use unsupported positioning or order" };
  }
  const rects = items.map((item) => item.getBoundingClientRect());
  if (rects.some((rect) => rect.width <= 0 || rect.height <= 0)) {
    return { supported: false, reason: "Group items do not have reliable layout rectangles" };
  }
  for (let left = 0; left < rects.length; left += 1) {
    for (let right = left + 1; right < rects.length; right += 1) {
      const overlapWidth =
        Math.min(rects[left]!.right, rects[right]!.right) -
        Math.max(rects[left]!.left, rects[right]!.left);
      const overlapHeight =
        Math.min(rects[left]!.bottom, rects[right]!.bottom) -
        Math.max(rects[left]!.top, rects[right]!.top);
      if (overlapWidth > 0.5 && overlapHeight > 0.5) {
        return { supported: false, reason: "Group items overlap" };
      }
    }
  }
  const display = containerStyle.display;
  if (display === "flex" || display === "inline-flex") {
    if (
      !["row", "column"].includes(containerStyle.flexDirection) ||
      containerStyle.flexWrap !== "nowrap"
    ) {
      return { supported: false, reason: "Group flex layout is ambiguous" };
    }
    const horizontal = containerStyle.flexDirection === "row";
    const inOrder = rects.every((rect, index) => {
      const previous = rects[index - 1];
      return !previous || (horizontal ? rect.left >= previous.left : rect.top >= previous.top);
    });
    return inOrder
      ? { supported: true }
      : { supported: false, reason: "Group visual order does not follow document order" };
  }
  if (display === "grid" || display === "inline-grid") {
    if (
      containerStyle.gridAutoFlow.includes("dense") ||
      containerStyle.gridTemplateAreas !== "none" ||
      !["row", "column"].includes(containerStyle.gridAutoFlow)
    ) {
      return { supported: false, reason: "Group grid placement is ambiguous" };
    }
    if (
      styles.some(
        (style) =>
          style.gridRowStart !== "auto" ||
          style.gridRowEnd !== "auto" ||
          style.gridColumnStart !== "auto" ||
          style.gridColumnEnd !== "auto",
      )
    ) {
      return { supported: false, reason: "Group uses explicit grid placement" };
    }
    const columnFlow = containerStyle.gridAutoFlow === "column";
    const sorted = items
      .map((item, index) => ({ item, rect: rects[index]! }))
      .sort((left, right) =>
        columnFlow
          ? left.rect.left - right.rect.left || left.rect.top - right.rect.top
          : left.rect.top - right.rect.top || left.rect.left - right.rect.left,
      );
    return sorted.every(({ item }, index) => item === items[index])
      ? { supported: true }
      : { supported: false, reason: "Group visual order does not follow document order" };
  }
  if (["block", "flow-root", "inline-block"].includes(display)) {
    if (containerStyle.columnCount !== "auto" && containerStyle.columnCount !== "1") {
      return { supported: false, reason: "Group uses unsupported CSS columns" };
    }
    const inOrder = rects.every((rect, index) => {
      const previous = rects[index - 1];
      return !previous || rect.top >= previous.bottom - 0.5;
    });
    return inOrder
      ? { supported: true }
      : { supported: false, reason: "Group visual order does not follow document order" };
  }
  return { supported: false, reason: "Group layout is not supported" };
}

function listGroups(): GroupDescriptor[] {
  return (state.current?.groups ?? []).map((group) => ({
    ...group,
    move: groupMoveCapability(group),
  }));
}

function listEditableContent(): EditableContent[] {
  const current = state.current;
  if (!current) return [];

  return current.nodes
    .filter(
      (meta) =>
        meta.kind === "image" ||
        meta.kind === "section" ||
        ((meta.kind === "text" || meta.kind === "link") && meta.textEditable === true),
    )
    .map((meta) => {
      const element = currentNodeElement(meta.id);
      if (meta.kind === "image") {
        return {
          id: meta.id,
          type: meta.kind,
          preview: element?.getAttribute("alt") || element?.getAttribute("src") || "",
          ...(meta.mediaCapabilities ? { capabilities: meta.mediaCapabilities } : {}),
        };
      }
      if (meta.kind === "section") {
        const heading = element?.querySelector("h1,h2,h3,h4,h5,h6");
        return {
          id: meta.id,
          type: meta.kind,
          preview: heading?.textContent?.trim() || element?.getAttribute("aria-label") || "Section",
        };
      }
      return { id: meta.id, type: meta.kind, preview: element?.textContent ?? "" };
    });
}

function changeInfoForOp(changeId: string, pagePath: string, op: Op, entry: PendingOp): ChangeInfo {
  if (op.type === "duplicateSection") {
    return {
      changeId: changeId || stableChangeId(pagePath, "section-duplicate", op.createdId),
      elementId: op.createdId,
      type: op.type,
      before: "",
      after: `Duplicated “${duplicateSourceLabels.get(op.createdId) ?? displayNameForNode(pagePath, op.sourceId)}”`,
      ...(entry.changeSetId
        ? { changeSetId: entry.changeSetId, changeSetLabel: entry.changeSetLabel }
        : {}),
    };
  }
  if (op.type === "duplicateGroupItem") {
    return {
      changeId: changeId || stableChangeId(pagePath, "group-item-duplicate", op.createdId),
      elementId: op.createdId,
      type: op.type,
      before: "",
      after: `Duplicated “${duplicateSourceLabels.get(op.createdId) ?? displayNameForGroupItem(pagePath, op.groupId, op.sourceItemId)}”`,
      ...(entry.changeSetId
        ? { changeSetId: entry.changeSetId, changeSetLabel: entry.changeSetLabel }
        : {}),
    };
  }
  if (op.type === "moveGroupItem") {
    return {
      changeId: changeId || stableChangeId(pagePath, "group-item-order", op.itemId),
      elementId: op.itemId,
      type: op.type,
      before: "",
      after: `Moved “${displayNameForGroupItem(pagePath, op.groupId, op.itemId)}” ${
        op.position === "before" ? "earlier" : "later"
      }`,
      ...(entry.changeSetId
        ? { changeSetId: entry.changeSetId, changeSetLabel: entry.changeSetLabel }
        : {}),
    };
  }
  if (op.type === "setLayoutPreset") {
    const target = layoutTargetForId(op.nodeId);
    const baseline = target?.baseline ?? "stacked";
    return {
      changeId: changeId || stableChangeId(pagePath, "layout", op.nodeId),
      elementId: op.nodeId,
      type: op.type,
      before: baseline,
      after: op.preset,
      ...(entry.changeSetId
        ? { changeSetId: entry.changeSetId, changeSetLabel: entry.changeSetLabel }
        : {}),
    };
  }
  if (op.type === "setRegionOrder") {
    return {
      changeId: changeId || stableChangeId(pagePath, "region-order", op.targetId),
      elementId: op.targetId,
      type: op.type,
      before: "original",
      after: op.order,
      ...(entry.changeSetId
        ? { changeSetId: entry.changeSetId, changeSetLabel: entry.changeSetLabel }
        : {}),
    };
  }
  const [elementId] = op.nodeId.split("#");
  if (!elementId) throw new Error("Change target is missing");
  const domain =
    op.type === "sectionVisibility"
      ? "section-visibility"
      : op.type === "moveSection"
        ? "section-order"
        : op.type === "media" || op.type === "src" || op.type === "alt"
          ? "media"
          : op.type;
  const resolvedChangeId =
    changeId || stableChangeId(pagePath, domain, stableTargetIdForNode(pagePath, elementId));
  return {
    changeId: resolvedChangeId,
    elementId,
    type: op.type,
    before: originalValue(pagePath, op),
    after:
      op.type === "formatBlock"
        ? blockFormattingFor(op.value)
        : op.type === "toggleList"
          ? op.after === "plain"
            ? "paragraphs"
            : op.after
          : op.type === "media"
            ? mediaStateDescription(op.value)
            : op.type === "sectionVisibility"
              ? op.visible
                ? "visible"
                : "hidden"
              : op.type === "moveSection"
                ? `Moved “${displayNameForNode(pagePath, op.nodeId)}” ${sectionMoveDirection(op)}`
                : op.value,
    ...(entry.changeSetId
      ? {
          changeSetId: entry.changeSetId,
          changeSetLabel: entry.changeSetLabel,
        }
      : {}),
  };
}

function groupMoveChanges(): Array<UserChange & { order: number }> {
  const current = state.current;
  if (!current) return [];
  const changes: Array<UserChange & { order: number }> = [];
  for (const group of current.groups) {
    const entries = state.ops
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          entry.pagePath === current.pagePath &&
          ((entry.op.type === "moveGroupItem" && entry.op.groupId === group.id) ||
            (entry.op.type === "duplicateGroupItem" && entry.op.groupId === group.id)),
      );
    const orderOperations: GroupOrderOperation[] = [];
    for (const { entry } of entries) {
      if (entry.op.type === "moveGroupItem") {
        orderOperations.push({
          type: "moveGroupItem",
          itemId: entry.op.itemId,
          targetItemId: entry.op.targetItemId,
          position: entry.op.position,
          sequence: entry.op.sequence,
        });
      } else if (entry.op.type === "duplicateGroupItem") {
        orderOperations.push({
          type: "duplicateGroupItem",
          sourceItemId: entry.op.sourceItemId,
          createdId: entry.op.createdId,
          sequence: entry.op.sequence,
        });
      }
    }
    const finalSourceOrder = replayGroupOrder(
      group.items.map((item) => item.id),
      orderOperations,
    ).filter((id) => group.items.some((item) => item.id === id));
    for (const item of group.items) {
      const moves = entries.filter(
        ({ entry }) => entry.op.type === "moveGroupItem" && entry.op.itemId === item.id,
      );
      if (moves.length === 0) continue;
      const withoutItemMoves = orderOperations.filter(
        (operation) => operation.type !== "moveGroupItem" || operation.itemId !== item.id,
      );
      const baselineSourceOrder = replayGroupOrder(
        group.items.map((candidate) => candidate.id),
        withoutItemMoves,
      ).filter((id) => group.items.some((candidate) => candidate.id === id));
      const before = baselineSourceOrder.indexOf(item.id);
      const after = finalSourceOrder.indexOf(item.id);
      if (before < 0 || after < 0 || before === after) continue;
      const first = moves[0]!;
      changes.push({
        order: first.index,
        pagePath: current.pagePath,
        opIndexes: moves.map(({ index }) => index),
        label: "Group item order",
        info: {
          changeId: stableChangeId(current.pagePath, "group-item-order", item.id),
          elementId: item.id,
          type: "moveGroupItem",
          before: `position ${before + 1}`,
          after: `Moved “${displayNameForGroupItem(current.pagePath, group.id, item.id)}” ${
            after < before ? "earlier" : "later"
          }`,
          ...(first.entry.changeSetId
            ? {
                changeSetId: first.entry.changeSetId,
                changeSetLabel: first.entry.changeSetLabel,
              }
            : {}),
        },
      });
    }
  }
  return changes;
}

function buildUserChanges(): UserChange[] {
  reconcileRichContent();
  const changes: Array<UserChange & { order: number }> = [];
  for (const region of richContentRegions.values()) {
    const relevant = state.ops
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          entry.pagePath === region.pagePath &&
          isRichContentOp(entry.op) &&
          richNodeIds(entry.op).some((id) => region.nodeIds.includes(id)),
      );
    if (!relevant.length || !region.currentHtml || region.currentHtml === region.originalHtml)
      continue;
    const first = relevant[0]!;
    const richType = relevant.every(({ entry }) => entry.op.type === "text") ? "text" : "html";
    changes.push({
      order: first.index,
      pagePath: region.pagePath,
      region,
      label: "Rich content",
      info: {
        changeId: stableChangeId(region.pagePath, "rich", region.id),
        elementId: region.anchorId,
        type: richType,
        before: region.originalHtml,
        after: region.currentHtml,
        ...(first.entry.changeSetId
          ? {
              changeSetId: first.entry.changeSetId,
              changeSetLabel: first.entry.changeSetLabel,
            }
          : {}),
      },
    });
  }
  changes.push(...groupMoveChanges());
  for (const [index, entry] of state.ops.entries()) {
    if (isRichContentOp(entry.op) || entry.op.type === "moveGroupItem") continue;
    changes.push({
      order: index,
      pagePath: entry.pagePath,
      opIndex: index,
      label: opLabel(entry.op),
      info: changeInfoForOp("", entry.pagePath, entry.op, entry),
    });
  }
  changes.sort((left, right) => left.order - right.order);
  return changes;
}

function listChanges(): ChangeInfo[] {
  return buildUserChanges().map(({ info }) => info);
}

function revertRichContentRegion(region: RichContentRegion): void {
  const activeRegion = richRegionById(region.id) ?? region;
  const affected = state.ops
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        entry.pagePath === activeRegion.pagePath &&
        isRichContentOp(entry.op) &&
        richNodeIds(entry.op).some((id) => activeRegion.nodeIds.includes(id)),
    );
  if (affected.length === 0) return;

  const snapshot = {
    ...activeRegion,
    targetIds: [...activeRegion.targetIds],
    nodeIds: [...activeRegion.nodeIds],
    members: activeRegion.members.map((member) => ({ ...member })),
  };
  const removeAffected = (): void => {
    for (const { entry } of affected) removeOpsFor(entry.pagePath, opKey(entry.op));
    richContentRegions.delete(activeRegion.id);
    if (state.current?.pagePath === activeRegion.pagePath) renderPreview();
    updateDirtyUi();
  };
  const restoreAffected = (): void => {
    const restored = state.ops.slice();
    for (const { entry, index } of affected) {
      if (
        restored.some(
          (candidate) =>
            candidate.pagePath === entry.pagePath && opKey(candidate.op) === opKey(entry.op),
        )
      )
        continue;
      restored.splice(Math.min(index, restored.length), 0, entry);
    }
    state.ops = restored;
    richContentRegions.set(snapshot.id, snapshot);
    if (state.current?.pagePath === snapshot.pagePath) renderPreview();
    updateDirtyUi();
  };
  removeAffected();
  pushHistory({
    label: "Revert rich content",
    assetPaths: [],
    undo: restoreAffected,
    redo: removeAffected,
  });
  updateDirtyUi();
}

function revertPendingOperation(index: number): void {
  const entry = state.ops[index];
  if (!entry) return;
  const duplicate =
    entry.op.type === "duplicateSection" || entry.op.type === "duplicateGroupItem"
      ? entry.op
      : null;
  const dependent = duplicate
    ? state.ops.filter(({ pagePath, op }) => {
        if (
          pagePath !== entry.pagePath ||
          op.type === "duplicateSection" ||
          op.type === "duplicateGroupItem"
        )
          return false;
        const createdIds = new Set([duplicate.createdId, ...Object.values(duplicate.nodeMap)]);
        const ids = op.type === "toggleList" ? op.nodeIds : "nodeId" in op ? [op.nodeId] : [];
        return ids.some((id) => createdIds.has(id.split("#")[0]!));
      })
    : [];
  const removed = [entry, ...dependent];
  const restore = (): void => {
    for (const candidate of removed) {
      if (
        !state.ops.some(
          (active) =>
            active.pagePath === candidate.pagePath && opKey(active.op) === opKey(candidate.op),
        )
      ) {
        state.ops.push(candidate);
      }
    }
    applyOpToDom(entry.pagePath, entry.op);
    for (const candidate of dependent) applyOpToDom(candidate.pagePath, candidate.op);
    updateDirtyUi();
  };
  const remove = (): void => {
    for (const candidate of removed) removeOpsFor(candidate.pagePath, opKey(candidate.op));
    revertOpInDom(entry.pagePath, entry.op);
    updateDirtyUi();
  };
  remove();
  pushHistory({
    label: `Revert ${opLabel(entry.op)}`,
    assetPaths: [],
    undo: restore,
    redo: remove,
  });
  updateDirtyUi();
}

function refreshChangesDrawerIfOpen(): void {
  if (document.getElementById("xyle-changes-drawer")) openChangesDrawer();
}

function revertChange(changeId: string): UndoResult {
  const resolvedChangeId = changeIdAliases.get(changeId) ?? changeId;
  const change = buildUserChanges().find(
    (candidate) => candidate.info.changeId === resolvedChangeId,
  );
  if (!change) {
    throw new Error(`Unknown Xyle change ${changeId}`);
  }
  const region = change.region ?? regionForNode(change.pagePath, change.info.elementId);
  if (region) revertRichContentRegion(region);
  else if (change.opIndexes?.length) {
    const removed = change.opIndexes
      .map((index) => state.ops[index])
      .filter((entry): entry is PendingOp => !!entry);
    const restore = (): void => {
      state.ops = [...state.ops, ...removed.filter((entry) => !state.ops.includes(entry))];
      if (state.current?.pagePath === change.pagePath) renderPreview();
      updateDirtyUi();
    };
    const remove = (): void => {
      for (const entry of removed) removeOpsFor(entry.pagePath, opKey(entry.op));
      if (state.current?.pagePath === change.pagePath) renderPreview();
      updateDirtyUi();
    };
    remove();
    pushHistory({ label: "Revert Group item order", assetPaths: [], undo: restore, redo: remove });
  } else if (change.opIndex !== undefined) revertPendingOperation(change.opIndex);
  refreshChangesDrawerIfOpen();
  return { changeId, undone: true };
}

function applyChangeSet(label: string, changes: ChangeSetOperation[]): ChangeSetResult {
  if (activeChangeSet) throw new Error("Cannot start a nested Xyle change set");
  if (!state.current) throw new Error("No page is loaded");
  if (!label.trim() || label.length > 100) {
    throw new Error("Change-set label must be 1 to 100 characters");
  }
  if (changes.length === 0 || changes.length > 20) {
    throw new Error("Change set must contain 1 to 20 changes");
  }
  if (session) commitEdit();

  const current = state.current;
  const seenIds = new Set<string>();
  for (const change of changes) {
    if (!change.id || seenIds.has(change.id)) {
      throw new Error(`Duplicate or missing change target ${change.id}`);
    }
    seenIds.add(change.id);
    const meta = current.nodes.find((candidate) => candidate.id === change.id);
    const element = currentNodeElement(change.id);
    if (!meta || !element) throw new Error(`Unknown or unavailable Xyle node ${change.id}`);
    if (change.type === "text") {
      if ((meta.kind !== "text" && meta.kind !== "link") || !meta.textEditable) {
        throw new Error(`Unknown or non-text-editable Xyle node ${change.id}`);
      }
      if (meta.segmentCount !== 1 || !collectSegments(element)[0]) {
        throw new Error(`Xyle node ${change.id} has ambiguous text mapping`);
      }
      continue;
    }
    if (change.type === "asset") {
      if (meta.kind !== "image") throw new Error(`Xyle node ${change.id} is not an image`);
      if (!isSafeUrl(change.src)) throw new Error("Unsafe media source rejected");
      continue;
    }
    if (change.type === "sectionVisibility") {
      if (meta.kind !== "section") throw new Error(`Xyle node ${change.id} is not a section`);
      if (typeof change.visible !== "boolean")
        throw new Error("Section visibility must be boolean");
      continue;
    }
    if (change.type === "moveSection") {
      const target = currentNodeElement(change.targetId);
      const targetMeta = current.nodes.find((candidate) => candidate.id === change.targetId);
      if (
        meta.kind !== "section" ||
        !target ||
        targetMeta?.kind !== "section" ||
        element.parentElement !== target.parentElement
      ) {
        throw new Error("Sections must be safe siblings in one parent");
      }
      const siblings = sectionChildren(element.parentElement!);
      if (
        siblings.length !== element.parentElement!.children.length ||
        !siblings.includes(target)
      ) {
        throw new Error("Section parent contains unsupported sibling content");
      }
      if (typeof change.before !== "boolean") throw new Error("Section move must include before");
      continue;
    }
    if (change.type === "formatting") {
      if (isBlockFormatting(change.format)) {
        if (meta.kind !== "text" || !meta.textEditable || !isBlockTag(meta.tag)) {
          throw new Error(`Xyle node ${change.id} does not support block formatting`);
        }
        if (
          meta.segmentCount !== 1 &&
          change.format !== "unordered-list" &&
          change.format !== "ordered-list"
        ) {
          throw new Error(`Xyle node ${change.id} has ambiguous text mapping`);
        }
      } else if ((meta.kind !== "text" && meta.kind !== "link") || !meta.textEditable) {
        throw new Error(`Xyle node ${change.id} does not support formatting`);
      }
      if (!collectSegments(element)[0]) {
        throw new Error(`Xyle node ${change.id} has ambiguous text mapping`);
      }
      continue;
    }
    if (change.type !== "link" || meta.kind !== "link") {
      throw new Error(`Xyle node ${change.id} is not a link`);
    }
    if (change.text !== undefined && (!meta.textEditable || meta.segmentCount !== 1)) {
      throw new Error(`Xyle link ${change.id} has ambiguous text mapping`);
    }
    if (change.href !== undefined && !isSafeUrl(change.href)) {
      throw new Error("Unsafe link destination rejected");
    }
    if (change.text === undefined && change.href === undefined) {
      throw new Error("Link changes require text or href");
    }
  }

  const record: ChangeSetRecord = {
    id: `changeset-${++state.changeSetSequence}`,
    label: label.trim(),
    entries: [],
    undone: false,
  };
  state.changeSets.set(record.id, record);
  activeChangeSet = record;
  try {
    for (const change of changes) {
      if (change.type === "text") updateText(change.id, change.text);
      else if (change.type === "link") updateLink(change.id, change.text, change.href);
      else if (change.type === "asset") replaceAsset(change.id, change.src, change.alt);
      else if (change.type === "sectionVisibility")
        updateSectionVisibility(change.id, change.visible);
      else if (change.type === "moveSection")
        moveSection(change.id, change.targetId, change.before);
      else updateFormatting(change.id, change.format);
    }
  } catch (error) {
    for (const entry of [...record.entries].reverse()) entry.undo();
    state.changeSets.delete(record.id);
    throw error;
  } finally {
    activeChangeSet = null;
  }

  const history: HistoryEntry = {
    label: record.label,
    changeSetId: record.id,
    assetPaths: [...new Set(record.entries.flatMap((entry) => entry.assetPaths))],
    undo: () => {
      for (const entry of [...record.entries].reverse()) entry.undo();
      record.undone = true;
      updateDirtyUi();
    },
    redo: () => {
      for (const entry of record.entries) entry.redo();
      record.undone = false;
      updateDirtyUi();
    },
  };
  record.history = history;
  pushHistory(history);
  return {
    changeSetId: record.id,
    label: record.label,
    changes: listChanges().filter((change) => change.changeSetId === record.id),
  };
}

function undoChangeSet(changeSetId: string): ChangeSetUndoResult {
  const record = state.changeSets.get(changeSetId);
  if (!record?.history || record.undone) {
    throw new Error(`Unknown or already undone Xyle change set ${changeSetId}`);
  }
  record.history.undo();
  return { changeSetId, undone: true };
}

function getContent(nodeId: string): ContentResult {
  const current = state.current;
  if (!current) throw new Error("No page is loaded");
  const meta = current.nodes.find((candidate) => candidate.id === nodeId);
  const element = currentNodeElement(nodeId);
  if (!meta || !element) throw new Error(`Unknown or unavailable Xyle node ${nodeId}`);
  if (meta.kind === "image") {
    return {
      id: nodeId,
      type: meta.kind,
      content: element.getAttribute("src") ?? "",
      alt: element.getAttribute("alt") ?? "",
    };
  }
  if (meta.kind === "section") {
    return {
      id: nodeId,
      type: meta.kind,
      content: element.textContent?.trim() ?? "",
    };
  }
  if ((meta.kind !== "text" && meta.kind !== "link") || !meta.textEditable) {
    throw new Error(`Unknown or non-text-editable Xyle node ${nodeId}`);
  }
  return { id: nodeId, type: meta.kind, content: element.textContent ?? "" };
}

function updateMedia(nodeId: string, patch: MediaPatchInput): MediaUpdateResult {
  if (session) commitEdit();
  const current = state.current;
  if (!current) throw new Error("No page is loaded");
  const meta = current.nodes.find((candidate) => candidate.id === nodeId);
  if (!meta || meta.kind !== "image") throw new Error(`Unknown Xyle image ${nodeId}`);
  if (patch.src !== undefined && meta.mediaCapabilities?.replace === false) {
    throw new Error("Responsive image replacement is not supported yet");
  }
  if (
    (patch.crop !== undefined || patch.focus !== undefined || patch.fit !== undefined) &&
    meta.mediaCapabilities &&
    (!meta.mediaCapabilities.crop || !meta.mediaCapabilities.focus)
  ) {
    throw new Error(meta.mediaCapabilities.cropReason ?? "Image framing is not supported");
  }
  const element = currentNodeElement(nodeId) as HTMLImageElement | null;
  if (!element) throw new Error(`Xyle image ${nodeId} is not present in the preview`);
  const mediaPatch: MediaPatch = {
    ...(patch.src !== undefined ? { source: { kind: "existing", src: patch.src } } : {}),
    ...(patch.alt !== undefined ? { alt: { present: true, value: patch.alt } } : {}),
    ...(patch.crop !== undefined ? { crop: patch.crop } : {}),
    ...(patch.focus !== undefined ? { focus: patch.focus } : {}),
    ...(patch.fit !== undefined ? { framing: { fit: patch.fit } } : {}),
  };
  applyMediaPatch(current.pagePath, nodeId, element, mediaPatch, "Update image");
  return {
    id: nodeId,
    pagePath: current.pagePath,
    src: element.getAttribute("src") ?? "",
    alt: element.getAttribute("alt") ?? "",
  };
}

function replaceAsset(nodeId: string, src: string, alt?: string): AssetUpdateResult {
  if (session) commitEdit();
  const current = state.current;
  if (!current) throw new Error("No page is loaded");
  const meta = current.nodes.find((candidate) => candidate.id === nodeId);
  if (!meta || meta.kind !== "image") throw new Error(`Unknown Xyle image ${nodeId}`);
  if (!isSafeUrl(src)) throw new Error("Unsafe media source rejected");
  const element = currentNodeElement(nodeId) as HTMLImageElement | null;
  if (!element) throw new Error(`Xyle image ${nodeId} is not present in the preview`);

  updateMedia(nodeId, { src, ...(alt !== undefined ? { alt } : {}) });
  return {
    id: nodeId,
    pagePath: current.pagePath,
    src: element.getAttribute("src") ?? "",
    alt: element.getAttribute("alt") ?? "",
  };
}

type BlockFormatting =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "unordered-list"
  | "ordered-list";
type BlockTag = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "ul" | "ol";

function isBlockFormatting(format: Formatting): format is BlockFormatting {
  return (
    format === "paragraph" ||
    format === "heading-1" ||
    format === "heading-2" ||
    format === "heading-3" ||
    format === "heading-4" ||
    format === "heading-5" ||
    format === "heading-6" ||
    format === "unordered-list" ||
    format === "ordered-list"
  );
}
function blockTagFor(format: BlockFormatting): BlockTag {
  if (format === "paragraph") return "p";
  if (format === "unordered-list") return "ul";
  if (format === "ordered-list") return "ol";
  const tag = `h${format.slice(-1)}`;
  if (!isBlockTag(tag)) throw new Error("unsupported block format");
  return tag;
}
function blockFormattingFor(tag: BlockTag): BlockFormatting {
  if (tag === "p") return "paragraph";
  if (tag === "ul") return "unordered-list";
  if (tag === "ol") return "ordered-list";
  return `heading-${tag.slice(1)}` as BlockFormatting;
}
function isBlockTag(tag: string | undefined): tag is BlockTag {
  return tag === "p" || /^h[1-6]$/.test(tag ?? "");
}
function isListTag(tag: string | undefined): tag is "ul" | "ol" {
  return tag === "ul" || tag === "ol";
}

function reconcileInlineHtml(
  pagePath: string,
  nodeId: string,
  before: string,
  after: string,
): void {
  const existing = state.ops.find(
    (entry) =>
      entry.pagePath === pagePath && entry.op.type === "html" && entry.op.nodeId === nodeId,
  );
  if (before === after) {
    if (!existing) {
      updateDirtyUi();
      return;
    }
    const previous = existing.op;
    const key = opKey(previous);
    removeOpsFor(pagePath, key);
    const history: HistoryEntry = {
      label: "Format text",
      assetPaths: [],
      undo: () => {
        if (state.ops.some((entry) => entry.pagePath === pagePath && opKey(entry.op) === key)) {
          return;
        }
        replacePendingOp(pagePath, key, previous);
        applyOpToDom(pagePath, previous);
        reconcileRichContent(pagePath);
        updateDirtyUi();
      },
      redo: () => {
        if (state.ops.some((entry) => entry.pagePath === pagePath && opKey(entry.op) === key)) {
          return;
        }
        replacePendingOp(pagePath, key, null);
        revertOpInDom(pagePath, previous);
        reconcileRichContent(pagePath);
        updateDirtyUi();
      },
    };
    if (activeChangeSet) activeChangeSet.entries.push(history);
    else pushHistory(history);
    reconcileRichContent(pagePath);
    updateDirtyUi();
    return;
  }
  applyOp(pagePath, { type: "html", nodeId, value: after }, "Format text");
}

function updateFormatting(
  nodeId: string,
  format: Formatting,
  selection?: FormatSelection,
): FormattingUpdateResult {
  if (isBlockFormatting(format)) return updateBlockFormatting(nodeId, format);
  if (selection && (!session || session.meta.id !== nodeId)) {
    throw new Error("Formatting selection is no longer active");
  }
  if (!selection && session) commitEdit();
  const current = state.current;
  if (!current) throw new Error("No page is loaded");
  const meta = current.nodes.find((candidate) => candidate.id === nodeId);
  if (!meta || (meta.kind !== "text" && meta.kind !== "link") || !meta.textEditable) {
    throw new Error(`Unknown or non-text-editable Xyle node ${nodeId}`);
  }
  const element = currentNodeElement(nodeId);
  if (!element) throw new Error(`Xyle node ${nodeId} is not present in the preview`);
  const inlineFormat = format as "bold" | "italic" | "underline";
  if (!(inlineFormat === "bold" || inlineFormat === "italic" || inlineFormat === "underline")) {
    throw new Error("That inline format is not supported");
  }

  const identity = segmentIdentity(current.pagePath, nodeId);
  if (!originalMarkups.has(identity)) originalMarkups.set(identity, cleanInlineHtml(element));
  const win = previewDoc()?.defaultView;
  const activeSelection = win?.getSelection();
  if (!activeSelection) throw new Error("The preview selection is unavailable");
  activeSelection.removeAllRanges();
  if (selection) activeSelection.addRange(selection.range.cloneRange());
  else {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    activeSelection.addRange(range);
  }
  if (!toggleInlineFormat(element, activeSelection, inlineFormat)) {
    throw new Error("That selection cannot be formatted safely");
  }
  const html = cleanInlineHtml(element);
  const original = originalMarkups.get(identity) ?? "";
  reconcileInlineHtml(current.pagePath, nodeId, original, html);
  if (session) {
    const baselineClone = previewDoc()!.createDocumentFragment();
    for (const child of Array.from(element.childNodes)) baselineClone.append(child.cloneNode(true));
    session.baselineClone = baselineClone;
    session.baselineValues = collectSegments(element).map((pair) => pair.value);
    session.baselineKeys = collectSegments(element).map((pair) => pair.key);
    session.baselineSkeleton = skeleton(element);
    session.baselineAuthoredBreakCount = authoredBreakCount(element);
  }
  scheduleFormatTools();
  return { id: nodeId, pagePath: current.pagePath, format };
}

interface SelectionBookmark {
  root: HTMLElement;
  anchorTextOffset: number;
  focusTextOffset: number;
  direction: "forward" | "backward";
}

function textOffsetAt(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node) && node !== root) return null;
  const range = root.ownerDocument.createRange();
  try {
    range.setStart(root, 0);
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return range.toString().length;
}

function textBoundaryAt(root: HTMLElement, offset: number): { node: Text; offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node: Text | null;
  for (;;) {
    node = walker.nextNode() as Text | null;
    if (!node) break;
    if (remaining <= node.length) return { node, offset: remaining };
    remaining -= node.length;
  }
  const last = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let final: Text | null = null;
  for (;;) {
    node = last.nextNode() as Text | null;
    if (!node) break;
    final = node;
  }
  return final ? { node: final, offset: final.length } : null;
}

function captureSelectionBookmark(root: HTMLElement): SelectionBookmark | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const anchorTextOffset = textOffsetAt(root, selection.anchorNode!, selection.anchorOffset);
  const focusTextOffset = textOffsetAt(root, selection.focusNode!, selection.focusOffset);
  if (anchorTextOffset === null || focusTextOffset === null) return null;
  const direction =
    range.startContainer === selection.anchorNode && range.startOffset === selection.anchorOffset
      ? "forward"
      : "backward";
  return { root, anchorTextOffset, focusTextOffset, direction };
}

function restoreSelectionBookmark(bookmark: SelectionBookmark | null): void {
  if (!bookmark) return;
  const anchor = textBoundaryAt(bookmark.root, bookmark.anchorTextOffset);
  const focus = textBoundaryAt(bookmark.root, bookmark.focusTextOffset);
  if (!anchor || !focus) return;
  const selection = bookmark.root.ownerDocument.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  const range = bookmark.root.ownerDocument.createRange();
  if (bookmark.direction === "forward") {
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
    selection.addRange(range);
  } else {
    range.setStart(focus.node, focus.offset);
    range.setEnd(anchor.node, anchor.offset);
    selection.addRange(range);
    if (selection.extend) {
      selection.collapse(anchor.node, anchor.offset);
      selection.extend(focus.node, focus.offset);
    }
  }
}

function toggleListFormatting(
  nodeIds: string[],
  format: "unordered-list" | "ordered-list",
): ListFormattingUpdateResult {
  if (session) commitEdit();
  const current = state.current;
  if (!current) throw new Error("No page is loaded");
  if (nodeIds.length < 1 || nodeIds.length > 20 || new Set(nodeIds).size !== nodeIds.length) {
    throw new Error("A list group requires 1 to 20 unique text blocks");
  }
  const elements = nodeIds.map((nodeId) => {
    const meta = current.nodes.find((candidate) => candidate.id === nodeId);
    const element = currentNodeElement(nodeId);
    if (
      !meta ||
      meta.kind !== "text" ||
      !meta.textEditable ||
      (meta.tag !== "p" && meta.tag !== "li")
    ) {
      throw new Error(`Xyle node ${nodeId} is not a safe list block`);
    }
    if ((meta.segmentCount ?? 0) === 0 || !element) {
      throw new Error(`Xyle node ${nodeId} has ambiguous text mapping`);
    }
    return { meta, element };
  });
  const parent = elements[0]!.element.parentElement;
  if (!parent || elements.some(({ element }) => element.parentElement !== parent)) {
    throw new Error("List blocks must be siblings");
  }
  const children = [...parent.children];
  elements.sort(({ element: left }, { element: right }) => {
    const leftIndex = children.indexOf(left);
    const rightIndex = children.indexOf(right);
    return leftIndex - rightIndex;
  });
  const indexes = elements.map(({ element }) => children.indexOf(element));
  if (
    indexes.some((index) => index < 0) ||
    indexes.some((index, position) => index !== indexes[0]! + position)
  ) {
    throw new Error("List blocks must be contiguous siblings");
  }
  const firstTag = elements[0]!.element.tagName.toLowerCase();
  const parentTag = parent.tagName.toLowerCase();
  const before: "plain" | "ul" | "ol" =
    firstTag === "li" && (parentTag === "ul" || parentTag === "ol") ? parentTag : "plain";
  if (
    elements.some(
      ({ element }) => (element.tagName.toLowerCase() === "li") !== (before !== "plain"),
    )
  ) {
    throw new Error("List selection cannot mix list items and plain blocks");
  }
  const requested = format === "unordered-list" ? "ul" : "ol";
  const after = before === requested ? "plain" : requested;
  const selectionRoot = before === "plain" ? parent : parent.parentElement;
  const bookmark = selectionRoot ? captureSelectionBookmark(selectionRoot) : null;
  for (const { meta } of elements) {
    const stateKey = segmentIdentity(current.pagePath, meta.id);
    if (!originalListStates.has(stateKey)) originalListStates.set(stateKey, before);
    originalBlockTags.set(stateKey, (meta.tag === "li" ? "p" : meta.tag) as BlockTag);
  }
  const operation: Op = {
    type: "toggleList",
    nodeId: elements[0]!.meta.id,
    nodeIds: elements.map(({ meta }) => meta.id),
    value: requested,
    before,
    after,
  };
  applyToggleListToDom(current.pagePath, operation, after);
  restoreSelectionBookmark(bookmark);
  const returnsToOriginal = operation.nodeIds.every(
    (nodeId) => originalListStates.get(segmentIdentity(current.pagePath, nodeId)) === after,
  );
  applyOp(current.pagePath, operation, "Update list", returnsToOriginal ? null : operation);
  return { ids: [...nodeIds], pagePath: current.pagePath, format };
}

function updateBlockFormatting(nodeId: string, format: BlockFormatting): FormattingUpdateResult {
  if (session) commitEdit();
  const current = state.current;
  if (!current) throw new Error("No page is loaded");
  const isListFormat = format === "unordered-list" || format === "ordered-list";
  if (isListFormat) {
    toggleListFormatting([nodeId], format);
    return { id: nodeId, pagePath: current.pagePath, format };
  }
  const meta = current.nodes.find((candidate) => candidate.id === nodeId);
  if (!meta || meta.kind !== "text" || !meta.textEditable || !isBlockTag(meta.tag)) {
    throw new Error(`Unknown or non-block-formatting Xyle node ${nodeId}`);
  }
  if (meta.segmentCount !== 1) {
    throw new Error(`Xyle node ${nodeId} has ambiguous text mapping`);
  }
  const element = currentNodeElement(nodeId);
  if (!element) throw new Error(`Xyle node ${nodeId} is not present in the preview`);
  const currentTag = element.tagName.toLowerCase();
  if (!isBlockTag(currentTag) && !isListTag(currentTag)) {
    throw new Error(`Xyle node ${nodeId} is not safely list-formattable`);
  }
  const tag = blockTagFor(format);
  if (currentTag === tag) return { id: nodeId, pagePath: current.pagePath, format };

  const identity = segmentIdentity(current.pagePath, nodeId);
  if (!originalBlockTags.has(identity)) originalBlockTags.set(identity, meta.tag);
  const operation: Op = { type: "formatBlock", nodeId, value: tag };
  applyBlockFormatToDom(current.pagePath, operation);
  applyOp(
    current.pagePath,
    operation,
    isListTag(tag) || isListTag(currentTag) ? "Change list style" : "Change heading level",
  );
  return { id: nodeId, pagePath: current.pagePath, format };
}

function updateText(nodeId: string, text: string): TextUpdateResult {
  if (/[\r\n]/.test(text)) throw new Error("Line-break editing is deferred.");
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

function updateLink(nodeId: string, text?: string, href?: string): LinkUpdateResult {
  if (text !== undefined && /[\r\n]/.test(text)) {
    throw new Error("Line-break editing is deferred.");
  }
  if (session) commitEdit();
  const current = state.current;
  if (!current) throw new Error("No page is loaded");
  const meta = current.nodes.find((candidate) => candidate.id === nodeId);
  if (!meta || meta.kind !== "link") throw new Error(`Unknown Xyle link ${nodeId}`);
  if (text === undefined && href === undefined) {
    throw new Error("update_link requires text or href");
  }
  if (href !== undefined && !isSafeUrl(href)) {
    throw new Error("Unsafe link destination rejected");
  }

  const element = currentNodeElement(nodeId) as HTMLAnchorElement | null;
  if (!element) throw new Error(`Xyle node ${nodeId} is not present in the preview`);

  let textPair: SegmentPair | undefined;
  if (text !== undefined) {
    if (!meta.textEditable || meta.segmentCount !== 1) {
      throw new Error(`Xyle link ${nodeId} has ambiguous text mapping`);
    }
    [textPair] = collectSegments(element);
    if (!textPair) throw new Error(`Xyle link ${nodeId} has no editable text`);
  }

  if (textPair) {
    const textOperation: Op = { type: "text", nodeId: `${nodeId}#0`, value: text ?? "" };
    rememberOriginalSegment(current.pagePath, textOperation.nodeId, textPair.value);
    applyOpToDom(current.pagePath, textOperation);
    applyOp(current.pagePath, textOperation, "Edit link text");
  }
  if (href !== undefined) {
    const hrefOperation: Op = { type: "href", nodeId, value: href };
    rememberOriginalAttr(current.pagePath, nodeId, "href", element.getAttribute("href") ?? "");
    applyOpToDom(current.pagePath, hrefOperation);
    applyOp(current.pagePath, hrefOperation, "Edit link");
  }

  return {
    id: nodeId,
    pagePath: current.pagePath,
    text: element.textContent ?? "",
    href: element.getAttribute("href") ?? "",
  };
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
  $("#xyle-count").textContent = count > 0 ? String(count) : "";
  $("#xyle-changes").setAttribute(
    "aria-label",
    count > 0 ? `Open ${count} change${count === 1 ? "" : "s"}` : "Open changes",
  );
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
            <button data-action="media" class="xyle-menu-item" role="menuitem">Media library</button>
            <button data-action="sections" class="xyle-menu-item" role="menuitem">Sections</button>
            <button data-action="seo" class="xyle-menu-item" role="menuitem">SEO metadata</button>
            <div class="xyle-menu-separator" role="separator"></div>
            <button data-action="logout" class="xyle-menu-item" role="menuitem">Log out</button>
          </div>
        </div>
        <button id="xyle-editables" class="xyle-icon-button" data-tooltip="Show editables" aria-label="Show editables" aria-pressed="false" title="Show editables">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M8 12h8"/></svg>
        </button>
      </div>
      ${demoTransport ? '<div id="xyle-demo-label"><strong>Private demo</strong>&nbsp;· Refresh to reset</div>' : ""}
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
  if (demoTransport) {
    $("[data-action=exit]").textContent = "Exit demo";
    $("[data-action=live]").remove();
    $("[data-action=logout]").textContent = "Reset demo";
  }
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
      if (!activeTools || toolbarActionInProgress) return;
      const path = event.composedPath();
      if (path.includes(activeTools)) {
        toolbarPhase = toolbarIsInline() ? "inline" : "active";
        window.clearTimeout(contextToolsCloseTimer);
        return;
      }
      // Inline editors are modal to their target. An outside pointer may not
      // silently discard the value; Save, Cancel, or Escape owns the exit.
      if (toolbarIsInline() || event.target === iframe) return;
      closeContextTools(false);
    },
    true,
  );
  window.addEventListener("resize", scheduleOverlayRefresh);
  window.addEventListener("scroll", scheduleOverlayRefresh, true);
}

function menuAction(action: string): void {
  if (action === "exit") exitEditor();
  if (action === "media") void openMediaDrawer();
  if (action === "sections") openSectionDrawer();
  if (action === "seo") openSeoEditor();
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

function confirmDiscard(action: string, onConfirm: () => void): boolean {
  const count = dirtyCount();
  if (count === 0) return true;
  $("#xyle-discard-confirmation")?.remove();
  const noun = count === 1 ? "change" : "changes";
  const prompt = document.createElement("aside");
  prompt.id = "xyle-discard-confirmation";
  prompt.className = "xyle-inline-confirmation";
  prompt.setAttribute("role", "alert");
  prompt.setAttribute("aria-label", "Confirm discard");
  prompt.replaceChildren(
    document.createRange().createContextualFragment(`
    <p>Discard ${count} unpublished ${noun} and ${action}?</p>
    <div class="xyle-inline-confirmation-actions">
      <button class="xyle-dialog-button" type="button" data-keep>Keep editing</button>
      <button class="xyle-dialog-button xyle-dialog-button--accent" type="button" data-discard>Discard</button>
    </div>`),
  );
  prompt.querySelector<HTMLButtonElement>("[data-keep]")?.addEventListener("click", () => {
    prompt.remove();
    $("#xyle-menu-btn")?.focus();
  });
  prompt.querySelector<HTMLButtonElement>("[data-discard]")?.addEventListener("click", () => {
    prompt.remove();
    onConfirm();
  });
  document.body.append(prompt);
  prompt.querySelector<HTMLButtonElement>("[data-keep]")?.focus();
  return false;
}

function discardAll(): void {
  activeMediaEditor?.();
  mediaMutationGeneration += 1;
  closeMediaDrawer(false);
  closeChangesDrawer(false);
  closeSectionDrawer(false);
  selectedImage = null;
  previewDoc()
    ?.querySelectorAll(".xyle-img-tools,.xyle-link-tools")
    .forEach((tools) => {
      tools.remove();
    });
  for (const { objectUrl } of state.assets.values()) URL.revokeObjectURL(objectUrl);
  state.assets.clear();
  stagedMediaLibrary.clear();
  state.ops = [];
  state.history = [];
  state.historyIndex = 0;
  state.changeSets.clear();
  richContentRegions.clear();
  richContentRegionAliases.clear();
  stableTargetIds.clear();
  changeIdAliases.clear();
  state.changeSetSequence = 0;
  activeChangeSet = null;
  originalSegments.clear();
  originalAttrs.clear();
  originalMedia.clear();
  createdMedia.clear();
  originalSeo.clear();
  originalMarkups.clear();
  duplicateSourceLabels.clear();
  originalFormats.clear();
  originalBlockTags.clear();
  originalListStates.clear();
  pendingRevisions.clear();
}

async function exitEditor(): Promise<void> {
  if (
    !confirmDiscard("exit", () => {
      unregisterWebMcp?.();
      unregisterWebMcp = null;
      discardAll();
      location.assign(demoTransport ? "/" : (state.current?.pagePath ?? "/"));
    })
  )
    return;
  unregisterWebMcp?.();
  unregisterWebMcp = null;
  discardAll();
  location.assign(demoTransport ? "/" : (state.current?.pagePath ?? "/"));
}

async function logout(skipDiscardPrompt = false): Promise<void> {
  if (demoTransport) {
    if (!skipDiscardPrompt && !confirmDiscard("reset", () => void logout(true))) return;
    discardAll();
    location.reload();
    return;
  }
  if (!skipDiscardPrompt && !confirmDiscard("log out", () => void logout(true))) return;
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
      $("#xyle-menu-btn")?.focus();
      return;
    }
    discardAll();
    location.assign(demoTransport ? "/" : "/edit");
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
    if (
      op.type === "duplicateSection" ||
      op.type === "duplicateGroupItem" ||
      op.type === "moveGroupItem" ||
      op.type === "setRegionOrder"
    )
      continue;
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
  removeTrappedDialog(document.getElementById("xyle-changes-drawer"));
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
    const target =
      previewDoc()?.querySelector<HTMLElement>(`[data-xyle-node="${baseId}"]`) ??
      previewDoc()?.querySelector<HTMLElement>(`[data-xyle-group-item="${baseId}"]`);
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

function displayNameForElement(element: Element | null | undefined): string {
  const heading = element?.querySelector("h1,h2,h3,h4,h5,h6");
  const value = heading?.textContent ?? element?.textContent ?? "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 80) : "Untitled section";
}

function displayNameForNode(pagePath: string, nodeId: string): string {
  return pagePath === state.current?.pagePath
    ? displayNameForElement(currentNodeElement(nodeId))
    : "Untitled section";
}

function displayNameForGroupItem(pagePath: string, groupId: string, itemId: string): string {
  if (pagePath !== state.current?.pagePath) return "Untitled item";
  const element = previewDoc()?.querySelector<HTMLElement>(
    `[data-xyle-group="${CSS.escape(groupId)}"] [data-xyle-group-item="${CSS.escape(itemId)}"]`,
  );
  return displayNameForElement(element);
}

function sectionMoveDirection(op: Extract<Op, { type: "moveSection" }>): "earlier" | "later" {
  const element = currentNodeElement(op.nodeId);
  const parent = element?.parentElement;
  const currentIndex =
    element && parent ? sectionChildren(parent).indexOf(element) : op.originalIndex;
  return currentIndex < op.originalIndex ? "earlier" : "later";
}

function changeTypeLabel(type: ChangeInfo["type"]): string {
  switch (type) {
    case "text":
      return "Text";
    case "href":
      return "Link";
    case "src":
    case "alt":
    case "media":
      return "Image";
    case "format":
    case "formatBlock":
    case "toggleList":
    case "html":
      return "Formatting";
    case "sectionVisibility":
    case "moveSection":
    case "duplicateSection":
      return "Section";
    case "duplicateGroupItem":
    case "moveGroupItem":
      return "Group item";
    case "setLayoutPreset":
      return "Layout";
    case "setRegionOrder":
      return "Order";
    case "seo":
      return "SEO";
  }
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
    case "format":
      return "Formatting";
    case "formatBlock":
      return isListTag(op.value) ? "List style" : "Heading level";
    case "toggleList":
      return "List formatting";
    case "html":
      return "Formatting";
    case "media":
      return "Media";
    case "seo":
      return "SEO metadata";
    case "sectionVisibility":
      return "Section visibility";
    case "moveSection":
      return "Section order";
    case "duplicateSection":
      return "Duplicate section";
    case "duplicateGroupItem":
      return "Duplicate Group item";
    case "moveGroupItem":
      return "Move Group item";
    case "setLayoutPreset":
      return "Layout";
    case "setRegionOrder":
      return "Region order";
  }
}

function originalValue(pagePath: string, op: Op): string {
  if (op.type === "text") {
    return originalSegments.get(segmentIdentity(pagePath, op.nodeId)) ?? "";
  }
  if (op.type === "format") {
    return originalFormats.get(segmentIdentity(pagePath, op.nodeId)) ?? "none";
  }
  if (op.type === "formatBlock") {
    const original = originalBlockTags.get(segmentIdentity(pagePath, op.nodeId));
    return original ? blockFormattingFor(original) : "paragraph";
  }
  if (op.type === "toggleList") {
    return op.before === "plain" ? "paragraphs" : op.before;
  }
  if (op.type === "html") {
    return originalMarkups.get(segmentIdentity(pagePath, op.nodeId)) ?? "";
  }
  if (op.type === "media") {
    const original = originalMedia.get(segmentIdentity(pagePath, op.nodeId));
    return original ? mediaStateDescription(original) : "";
  }
  if (op.type === "seo") return originalSeo.get(seoIdentity(pagePath, op.field)) ?? "";
  if (op.type === "sectionVisibility") return op.before ? "visible" : "hidden";
  if (op.type === "moveSection") return "original position";
  if (op.type === "duplicateSection" || op.type === "duplicateGroupItem") return "";
  if (op.type === "moveGroupItem" || op.type === "setLayoutPreset" || op.type === "setRegionOrder")
    return "";
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
  const trigger = changesDrawerTrigger ?? (document.activeElement as HTMLElement | null);
  closeChangesDrawer(false);
  setInteractionMode("drawer");
  changesDrawerTrigger = trigger;
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
  const userChanges = buildUserChanges();
  const changeCount = userChanges.length;
  $("#xyle-changes-count", drawer).textContent = changeCount > 0 ? String(changeCount) : "";
  document.body.append(drawer);
  const closeButton = $("#xyle-changes-close", drawer);
  closeButton.addEventListener("click", () => closeChangesDrawer());
  trapDialogFocus(drawer, () => closeChangesDrawer());
  $("#xyle-discard", drawer).addEventListener("click", () => {
    if (
      !confirmDiscard("reload the published page", () => {
        if (session) revertEdit();
        discardAll();
        drawer.remove();
        updateDirtyUi();
        void loadPage(state.current?.pagePath ?? "/index.html", { pushHistory: false });
      })
    )
      return;
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
  if (userChanges.length === 0) {
    drawer.querySelector(".xyle-drawer-actions")?.remove();
    list.innerHTML = `<p class="xyle-empty-state">No pending changes.</p>`;
    closeButton.focus();
    return;
  }
  const operationsByPage = new Map(
    [...new Set(userChanges.map((change) => change.pagePath))].map((pagePath) => [
      pagePath,
      userChanges.filter((change) => change.pagePath === pagePath),
    ]),
  );
  let pageIndex = 0;
  let changeNumber = 0;
  const renderedChangeSetActions = new Set<string>();
  for (const [pagePath, entries] of operationsByPage) {
    const group = document.createElement("section");
    group.className = "xyle-change-page-group";
    const pageLabel = document.createElement("h3");
    pageLabel.id = `xyle-change-page-${pageIndex++}`;
    pageLabel.className = "xyle-change-page";
    pageLabel.textContent = pagePath;
    group.setAttribute("aria-labelledby", pageLabel.id);
    group.append(pageLabel);
    for (const change of entries) {
      if (change.info.changeSetId && !renderedChangeSetActions.has(change.info.changeSetId)) {
        renderedChangeSetActions.add(change.info.changeSetId);
        const task = document.createElement("div");
        task.className = "xyle-change-set";
        const taskLabel = document.createElement("strong");
        taskLabel.className = "xyle-change-set-label";
        taskLabel.textContent = change.info.changeSetLabel ?? "Grouped changes";
        const taskUndo = document.createElement("button");
        taskUndo.type = "button";
        taskUndo.className = "xyle-undo-button xyle-change-set-undo";
        taskUndo.textContent = "Undo task";
        taskUndo.setAttribute("aria-label", `Undo task ${taskLabel.textContent}`);
        taskUndo.addEventListener("click", (event) => {
          event.stopPropagation();
          try {
            undoChangeSet(change.info.changeSetId!);
            drawer.remove();
            updateDirtyUi();
            openChangesDrawer();
          } catch (error) {
            flash((error as Error).message);
          }
        });
        task.append(taskLabel, taskUndo);
        group.append(task);
      }
      const row = document.createElement("div");
      const changeKey = `${pagePath}:${change.info.elementId}`;
      row.className = "xyle-change-row";
      row.dataset.changeKey = changeKey;
      row.classList.toggle("is-located", focusedChangeKey === changeKey);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Locate ${change.label} change on ${pagePath}`);
      row.addEventListener("click", () => focusChange(pagePath, change.info.elementId));
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        focusChange(pagePath, change.info.elementId);
      });
      const header = document.createElement("div");
      header.className = "xyle-change-row-header";
      const heading = document.createElement("div");
      heading.className = "xyle-change-heading";
      const number = document.createElement("span");
      number.className = "xyle-change-index";
      number.textContent = String(++changeNumber);
      number.setAttribute("aria-hidden", "true");
      const type = document.createElement("span");
      type.className = "xyle-change-type";
      type.textContent = changeTypeLabel(change.info.type);
      heading.append(number, type);
      const rowActions = document.createElement("div");
      rowActions.className = "xyle-change-row-actions";
      const locateButton = document.createElement("button");
      locateButton.type = "button";
      locateButton.className = "xyle-locate-button";
      locateButton.innerHTML =
        '<svg class="xyle-action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Locate</span>';
      locateButton.setAttribute("aria-label", `Locate ${change.label} change on ${pagePath}`);
      locateButton.addEventListener("click", (event) => {
        event.stopPropagation();
        focusChange(pagePath, change.info.elementId);
      });
      const undoButton = document.createElement("button");
      undoButton.type = "button";
      undoButton.innerHTML =
        '<svg class="xyle-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M4 12h9a7 7 0 0 1 7 7"/></svg><span>Revert</span>';
      undoButton.className = "xyle-undo-button";
      undoButton.setAttribute("aria-label", `Revert ${change.label} change on ${pagePath}`);
      undoButton.addEventListener("click", (event) => {
        event.stopPropagation();
        revertChange(change.info.changeId);
      });
      rowActions.append(locateButton, undoButton);
      header.append(heading, rowActions);
      const comparison = document.createElement("div");
      comparison.className = "xyle-change-comparison";
      // User-authored values are appended as text nodes so the privileged shell
      // never interprets edited content as markup.
      const beforeValue = change.info.before;
      const afterValue = change.info.after;
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

function groupOrderOperations(groupId: string, extra?: GroupOrderOperation): GroupOrderOperation[] {
  const operations: GroupOrderOperation[] = [];
  for (const { pagePath, op } of state.ops) {
    if (pagePath !== state.current?.pagePath) continue;
    if (op.type === "duplicateGroupItem" && op.groupId === groupId) {
      operations.push({
        type: "duplicateGroupItem",
        sourceItemId: op.sourceItemId,
        createdId: op.createdId,
        sequence: op.sequence,
      });
    } else if (op.type === "moveGroupItem" && op.groupId === groupId) {
      operations.push({
        type: "moveGroupItem",
        itemId: op.itemId,
        targetItemId: op.targetItemId,
        position: op.position,
        sequence: op.sequence,
      });
    }
  }
  if (extra) operations.push(extra);
  return operations;
}

function applyGroupOrderToDom(groupId: string, extra?: GroupOrderOperation): void {
  const current = state.current;
  const doc = previewDoc();
  const group = current?.groups.find((candidate) => candidate.id === groupId);
  const container = doc?.querySelector<HTMLElement>(`[data-xyle-group="${CSS.escape(groupId)}"]`);
  if (!current || !group || !container) return;
  const order = replayGroupOrder(
    group.items.map((item) => item.id),
    groupOrderOperations(groupId, extra),
  );
  const elements = new Map(
    [...container.children]
      .map((element) => [element.getAttribute("data-xyle-group-item"), element] as const)
      .filter((entry): entry is [string, Element] => !!entry[0]),
  );
  const ordered = order
    .map((id) => elements.get(id))
    .filter((element): element is Element => !!element);
  if (ordered.length !== order.length) return;
  container.replaceChildren(...ordered);
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
  if (op.type === "format") {
    const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
    if (el) applyFormatOperationToElement(el, op);
    return;
  }
  if (op.type === "html") {
    const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
    if (el) replaceElementContentsFromHtml(el, op.value);
    return;
  }
  if (op.type === "media") {
    const el = doc.querySelector<HTMLImageElement>(`[data-xyle-node="${op.nodeId}"]`);
    if (el?.tagName === "IMG") applyMediaStateToDom(el, op.value);
    return;
  }
  if (op.type === "seo") {
    applySeoToDom(op.field, op.value);
    return;
  }
  if (op.type === "formatBlock") {
    const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
    if (el) applyBlockFormatToDom(pagePath, op);
    return;
  }
  if (op.type === "toggleList") {
    applyToggleListToDom(pagePath, op, op.after);
    return;
  }
  if (op.type === "sectionVisibility") {
    const el = currentNodeElement(op.nodeId);
    if (el) el.hidden = !op.visible;
    return;
  }
  if (op.type === "duplicateGroupItem") {
    applyGroupItemDuplicateToDom(pagePath, op);
    applyGroupOrderToDom(op.groupId);
    return;
  }
  if (op.type === "moveGroupItem") {
    applyGroupOrderToDom(op.groupId);
    return;
  }
  if (op.type === "setLayoutPreset") {
    applyLayoutToDom(pagePath, op);
    return;
  }
  if (op.type === "duplicateSection") {
    const current = state.current;
    const source = currentNodeElement(op.sourceId);
    const sourceMeta = current?.nodes.find((candidate) => candidate.id === op.sourceId);
    if (!current || !source || !sourceMeta || !op.previewHtml) return;
    const parsed = new DOMParser().parseFromString(op.previewHtml, "text/html");
    const parsedClone = parsed.body.firstElementChild;
    if (!(parsedClone instanceof HTMLElement)) return;
    const clone = document.importNode(parsedClone, true) as HTMLElement;
    source.after(clone);
    const sourceNodeMap = new Map(
      Object.entries(op.nodeMap).map(([originalId, createdNodeId]) => [originalId, createdNodeId]),
    );
    registerCreatedSectionNodes(
      current,
      sourceMeta,
      clone,
      op.sourceId,
      op.createdId,
      sourceNodeMap,
    );
    registerCreatedMediaStates(pagePath, clone, sourceNodeMap, op.snapshotOperations);
    return;
  }
  if (op.type === "setRegionOrder") {
    const target = layoutTargetForId(op.targetId);
    if (target) applyRegionOrderToDom(target, op.order);
    return;
  }
  if (op.type === "moveSection") {
    const source = currentNodeElement(op.nodeId);
    const target = currentNodeElement(op.targetId);
    const parent = target?.parentElement;
    if (source && target && parent && source.parentElement === parent) {
      if (op.before) parent.insertBefore(source, target);
      else parent.insertBefore(source, target.nextSibling);
    }
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
  } else if (op.type === "format") {
    const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
    if (el) {
      restoreOriginalMarkup(pagePath, op.nodeId);
      for (const entry of state.ops) {
        if (
          entry.pagePath === pagePath &&
          entry.op.type === "format" &&
          entry.op.nodeId === op.nodeId
        ) {
          applyFormatOperationToElement(el, entry.op);
        }
      }
    }
  } else if (op.type === "formatBlock") {
    restoreOriginalBlockFormat(pagePath, op.nodeId);
  } else if (op.type === "toggleList") {
    applyToggleListToDom(pagePath, op, op.before);
  } else if (op.type === "sectionVisibility") {
    const el = currentNodeElement(op.nodeId);
    if (el) el.hidden = !op.before;
  } else if (op.type === "duplicateGroupItem") {
    doc
      .querySelector<HTMLElement>(`[data-xyle-group-item="${CSS.escape(op.createdId)}"]`)
      ?.remove();
    const current = state.current;
    if (current)
      removeCreatedSubtreeState(current, new Set([op.createdId, ...Object.values(op.nodeMap)]));
    applyGroupOrderToDom(op.groupId);
  } else if (op.type === "moveGroupItem") {
    applyGroupOrderToDom(op.groupId);
  } else if (op.type === "setLayoutPreset") {
    const target = layoutTargetForId(op.nodeId);
    if (target) restoreLayoutToDom(pagePath, target);
  } else if (op.type === "setRegionOrder") {
    const target = layoutTargetForId(op.targetId);
    if (target) applyRegionOrderToDom(target, "original");
  } else if (op.type === "duplicateSection") {
    currentNodeElement(op.createdId)?.remove();
    const current = state.current;
    if (current) removeCreatedSectionState(current, op);
  } else if (op.type === "moveSection") {
    const source = currentNodeElement(op.nodeId);
    const parent = source?.parentElement;
    if (source && parent) {
      const siblings = sectionChildren(parent);
      const currentIndex = siblings.indexOf(source);
      const target = siblings[op.originalIndex];
      if (target && target !== source) {
        if (currentIndex < op.originalIndex) parent.insertBefore(source, target.nextSibling);
        else parent.insertBefore(source, target);
      } else if (op.originalIndex >= siblings.length - 1) {
        parent.append(source);
      }
    }
  } else if (op.type === "html") {
    restoreOriginalMarkup(pagePath, op.nodeId);
  } else if (op.type === "media") {
    const el = doc.querySelector<HTMLImageElement>(`[data-xyle-node="${op.nodeId}"]`);
    const original = originalMedia.get(segmentIdentity(pagePath, op.nodeId));
    if (el?.tagName === "IMG" && original) applyMediaStateToDom(el, original);
  } else if (op.type === "seo") {
    applySeoToDom(op.field, originalSeo.get(seoIdentity(pagePath, op.field)) ?? "");
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
const originalMedia = new Map<string, MediaState>();
const createdMedia = new Map<string, MediaState>();
const originalSeo = new Map<string, string>();
const originalMarkups = new Map<string, string>();
const duplicateSourceLabels = new Map<string, string>();
const originalFormats = new Map<string, "bold" | "italic" | "underline" | "none">();
const originalBlockTags = new Map<string, BlockTag>();
const originalListStates = new Map<string, "plain" | "ul" | "ol">();
const pendingRevisions = new Map<string, number>();
const opRevisions = new WeakMap<object, number>();
let nextOpRevision = 0;

function allocateStructuralSequence(): number {
  return ++nextOpRevision;
}

function segmentIdentity(pagePath: string, id: string): string {
  return `${pagePath}@${id}`;
}
function attrIdentity(pagePath: string, id: string, attr: string): string {
  return `${pagePath}@${id}:${attr}`;
}
function formatTag(format: "bold" | "italic" | "underline"): "strong" | "em" | "u" {
  return format === "bold" ? "strong" : format === "italic" ? "em" : "u";
}
function applyFormatToElement(el: HTMLElement, format: "bold" | "italic" | "underline"): void {
  const existing = el.firstElementChild;
  if (existing?.getAttribute("data-xyle-format")) {
    while (existing.firstChild) el.insertBefore(existing.firstChild, existing);
    existing.remove();
  }
  const wrapper = el.ownerDocument.createElement(formatTag(format));
  wrapper.setAttribute("data-xyle-format", format);
  while (el.firstChild) wrapper.append(el.firstChild);
  el.append(wrapper);
}
function rangeForFormatOffsets(el: HTMLElement, start: number, end: number): Range | null {
  if (start < 0 || end <= start) return null;
  const textNodes = formattingTextNodes(el);
  let total = 0;
  let startPoint: { node: Text; offset: number } | null = null;
  let endPoint: { node: Text; offset: number } | null = null;
  for (const node of textNodes) {
    const length = node.length;
    if (!startPoint && start <= total + length) {
      startPoint = { node, offset: start - total };
    }
    if (!endPoint && end <= total + length) {
      endPoint = { node, offset: end - total };
      break;
    }
    total += length;
  }
  if (!startPoint || !endPoint) return null;
  const range = el.ownerDocument.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function applyFormatRangeToElement(
  el: HTMLElement,
  range: Range,
  format: "bold" | "italic" | "underline",
): boolean {
  if (
    !el.contains(range.startContainer) ||
    !el.contains(range.endContainer) ||
    [...el.children].some((child) => child.tagName !== "BR")
  ) {
    return false;
  }
  const wrapper = el.ownerDocument.createElement(formatTag(format));
  wrapper.setAttribute("data-xyle-format", format);
  try {
    const fragment = range.extractContents();
    wrapper.append(fragment);
    range.insertNode(wrapper);
    range.selectNodeContents(wrapper);
    const selection = previewSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.focus({ preventScroll: true });
  } catch {
    return false;
  }
  return true;
}

function applyFormatSelectionToElement(
  el: HTMLElement,
  format: "bold" | "italic" | "underline",
  start: number,
  end: number,
): boolean {
  const range = rangeForFormatOffsets(el, start, end);
  return range ? applyFormatRangeToElement(el, range, format) : false;
}
function applyFormatOperationToElement(
  el: HTMLElement,
  op: Extract<Op, { type: "format" }>,
): boolean {
  if (op.start !== undefined && op.end !== undefined) {
    return applyFormatSelectionToElement(el, op.value, op.start, op.end);
  }
  applyFormatToElement(el, op.value);
  return true;
}
function replaceBlockElement(el: HTMLElement, tag: BlockTag): void {
  const currentTag = el.tagName.toLowerCase();
  const replacement = el.ownerDocument.createElement(tag);
  for (const attribute of Array.from(el.attributes)) {
    replacement.setAttribute(attribute.name, attribute.value);
  }
  if (isListTag(tag) && !isListTag(currentTag)) {
    const item = el.ownerDocument.createElement("li");
    while (el.firstChild) item.append(el.firstChild);
    replacement.append(item);
  } else if (!isListTag(tag) && isListTag(currentTag)) {
    const items = Array.from(el.children);
    if (items.length !== 1 || items[0]?.tagName.toLowerCase() !== "li") {
      throw new Error("Only a single safe list item can return to a block");
    }
    while (items[0].firstChild) replacement.append(items[0].firstChild);
  } else {
    while (el.firstChild) replacement.append(el.firstChild);
  }
  el.replaceWith(replacement);
  const meta = state.current?.nodes.find(
    (candidate) => candidate.id === replacement.dataset.xyleNode,
  );
  if (meta) wireCandidate(replacement, meta);
}
function applyBlockFormatToDom(pagePath: string, op: Extract<Op, { type: "formatBlock" }>): void {
  if (pagePath !== state.current?.pagePath) return;
  const el = previewDoc()?.querySelector<HTMLElement>(`[data-xyle-node="${op.nodeId}"]`);
  if (el) replaceBlockElement(el, op.value);
}
function copyElementAttributes(from: Element, to: Element, omit = "data-xyle-node"): void {
  for (const attribute of Array.from(from.attributes)) {
    if (attribute.name !== omit) to.setAttribute(attribute.name, attribute.value);
  }
}

function wireListElement(element: HTMLElement, nodeId: string): void {
  const meta = state.current?.nodes.find((candidate) => candidate.id === nodeId);
  if (meta) wireCandidate(element, meta);
}

function createListElement(doc: Document, tag: "ul" | "ol", items: HTMLElement[]): HTMLElement {
  const list = doc.createElement(tag);
  for (const item of items) list.append(item);
  return list;
}

function mergeAdjacentLists(list: HTMLElement): HTMLElement {
  let merged = list;
  const previous = merged.previousElementSibling;
  if (previous instanceof HTMLElement && previous.tagName === merged.tagName) {
    while (merged.firstChild) previous.append(merged.firstChild);
    merged.remove();
    merged = previous;
  }
  const next = merged.nextElementSibling;
  if (next instanceof HTMLElement && next.tagName === merged.tagName) {
    while (next.firstChild) merged.append(next.firstChild);
    next.remove();
  }
  return merged;
}

function applyToggleListToDom(
  pagePath: string,
  op: Extract<Op, { type: "toggleList" }>,
  target: "plain" | "ul" | "ol",
): void {
  if (pagePath !== state.current?.pagePath) return;
  const doc = previewDoc();
  if (!doc) return;
  const elements = op.nodeIds.map((nodeId) =>
    doc.querySelector<HTMLElement>(`[data-xyle-node="${nodeId}"]`),
  );
  const parent = elements[0]?.parentElement;
  if (!parent || elements.some((element) => !element || element.parentElement !== parent)) {
    throw new Error("List blocks must be siblings");
  }
  const resolved = elements as HTMLElement[];
  const firstTag = resolved[0]!.tagName.toLowerCase();
  const currentList = firstTag === "li" ? parent : null;
  if (currentList && !isListTag(currentList.tagName.toLowerCase())) {
    throw new Error("List items must belong to a flat list");
  }
  if (!currentList) {
    if (target === "plain") return;
    const list = doc.createElement(target);
    parent.insertBefore(list, resolved[0]!);
    for (const [index, element] of resolved.entries()) {
      const item = doc.createElement("li");
      copyElementAttributes(element, item);
      item.dataset.xyleNode = op.nodeIds[index]!;
      while (element.firstChild) item.append(element.firstChild);
      list.append(item);
      element.remove();
      wireListElement(item, op.nodeIds[index]!);
    }
    mergeAdjacentLists(list);
    refreshMarkers();
    return;
  }
  const listParent = currentList.parentElement;
  if (!listParent) throw new Error("List has no parent container");
  const allItems = [...currentList.children].filter(
    (child): child is HTMLElement => child.tagName.toLowerCase() === "li",
  );
  const selectedIndexes = resolved.map((element) => allItems.indexOf(element));
  if (
    selectedIndexes.some((index) => index < 0) ||
    selectedIndexes.some(
      (index, indexInSelection) => index !== selectedIndexes[0]! + indexInSelection,
    )
  ) {
    throw new Error("List blocks must be contiguous siblings");
  }
  const start = selectedIndexes[0]!;
  const end = selectedIndexes.at(-1)! + 1;
  const beforeItems = allItems.slice(0, start);
  const selectedItems = allItems.slice(start, end);
  const afterItems = allItems.slice(end);
  const pieces: HTMLElement[] = [];
  if (beforeItems.length)
    pieces.push(createListElement(doc, op.before as "ul" | "ol", beforeItems));
  if (target === "plain") {
    for (const item of selectedItems) {
      const block = doc.createElement("p");
      copyElementAttributes(item, block);
      block.dataset.xyleNode = item.dataset.xyleNode ?? "";
      while (item.firstChild) block.append(item.firstChild);
      pieces.push(block);
      wireListElement(block, block.dataset.xyleNode);
    }
  } else {
    pieces.push(createListElement(doc, target, selectedItems));
  }
  if (afterItems.length) pieces.push(createListElement(doc, op.before as "ul" | "ol", afterItems));
  for (const piece of pieces) listParent.insertBefore(piece, currentList);
  currentList.remove();
  for (const item of listParent.querySelectorAll<HTMLElement>("li[data-xyle-node]")) {
    wireListElement(item, item.dataset.xyleNode!);
  }
  refreshMarkers();
}

function restoreOriginalBlockFormat(pagePath: string, nodeId: string): void {
  if (pagePath !== state.current?.pagePath) return;
  const tag = originalBlockTags.get(segmentIdentity(pagePath, nodeId));
  const el = previewDoc()?.querySelector<HTMLElement>(`[data-xyle-node="${nodeId}"]`);
  if (tag && el && el.tagName.toLowerCase() !== tag) replaceBlockElement(el, tag);
}
function replaceElementContentsFromHtml(el: HTMLElement, markup: string): void {
  const parsed = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
  el.replaceChildren(
    ...Array.from(parsed.body.childNodes).map((node) => el.ownerDocument.importNode(node, true)),
  );
}

function restoreOriginalMarkup(pagePath: string, nodeId: string): void {
  if (pagePath !== state.current?.pagePath) return;
  const markup = originalMarkups.get(segmentIdentity(pagePath, nodeId));
  const el = previewDoc()?.querySelector<HTMLElement>(`[data-xyle-node="${nodeId}"]`);
  if (markup !== undefined && el) {
    const parsed = new DOMParser().parseFromString(markup, "text/html");
    el.replaceChildren(
      ...Array.from(parsed.body.childNodes).map((node) => el.ownerDocument.importNode(node, true)),
    );
  }
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

  // Newlines in a text operation can be authored source whitespace. Preserve
  // them as text; authored and user-inserted <br> segments are represented by
  // their own rich-content operations.
  first.textContent = value;
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
    } else if (op.type === "format") {
      const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
      if (el) applyFormatOperationToElement(el, op);
    } else if (op.type === "formatBlock") {
      applyBlockFormatToDom(pagePath, op);
    } else if (op.type === "toggleList") {
      applyToggleListToDom(pagePath, op, op.after);
    } else if (op.type === "duplicateGroupItem") {
      applyGroupItemDuplicateToDom(pagePath, op);
    } else if (op.type === "duplicateSection") {
      const source = currentNodeElement(op.sourceId);
      const sourceMeta = state.current.nodes.find((candidate) => candidate.id === op.sourceId);
      if (source && sourceMeta && op.previewHtml) {
        const parsed = new DOMParser().parseFromString(op.previewHtml, "text/html");
        const parsedClone = parsed.body.firstElementChild;
        if (parsedClone instanceof HTMLElement) {
          const clone = document.importNode(parsedClone, true) as HTMLElement;
          source.after(clone);
          const sourceNodeMap = new Map(
            Object.entries(op.nodeMap).map(([originalId, createdNodeId]) => [
              originalId,
              createdNodeId,
            ]),
          );
          registerCreatedSectionNodes(
            state.current,
            sourceMeta,
            clone,
            op.sourceId,
            op.createdId,
            sourceNodeMap,
          );
          registerCreatedMediaStates(pagePath, clone, sourceNodeMap, op.snapshotOperations);
        }
      }
    } else if (op.type === "sectionVisibility") {
      const el = currentNodeElement(op.nodeId);
      if (el) el.hidden = !op.visible;
    } else if (op.type === "moveGroupItem") {
      applyGroupOrderToDom(op.groupId);
    } else if (op.type === "setLayoutPreset") {
      applyLayoutToDom(pagePath, op);
    } else if (op.type === "setRegionOrder") {
      const target = layoutTargetForId(op.targetId);
      if (target) applyRegionOrderToDom(target, op.order);
    } else if (op.type === "moveSection") {
      const source = currentNodeElement(op.nodeId);
      const target = currentNodeElement(op.targetId);
      const parent = target?.parentElement;
      if (source && target && parent && source.parentElement === parent) {
        if (op.before) parent.insertBefore(source, target);
        else parent.insertBefore(source, target.nextSibling);
      }
    } else if (op.type === "html") {
      const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
      if (el) replaceElementContentsFromHtml(el, op.value);
    } else if (op.type === "media") {
      const el = doc.querySelector<HTMLImageElement>(`[data-xyle-node="${op.nodeId}"]`);
      if (el?.tagName === "IMG") applyMediaStateToDom(el, op.value);
    } else if (op.type === "seo") {
      applySeoToDom(op.field, op.value);
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
  activeMediaEditor?.();
  if (commitActiveEditsAndCollect()) return;
  mediaMutationGeneration += 1;
  const button = sourceButton ?? $<HTMLButtonElement>("#xyle-publish");
  const label = sourceButton ? $("span", sourceButton) : $("#xyle-publish-label");
  const idleLabel = sourceButton ? "Publish" : "Publish changes";
  button.disabled = true;
  label.textContent = "Publishing…";

  const pages = collectPageOps();
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      baseSnapshotDigest: state.publishedSnapshotDigest,
      pages,
    }),
  );
  const referencedAssets = new Set(
    pages.flatMap((page) =>
      page.operations.flatMap((op) => {
        if (op.type === "src") return state.assets.has(op.value) ? [op.value] : [];
        if (op.type === "media") {
          const source = op.value.source;
          return source.kind === "staged" ? [source.assetId] : [];
        }
        if (op.type === "duplicateSection") {
          return op.assetRefs.map((asset) => asset.assetId);
        }
        return [];
      }),
    ),
  );
  for (const path of referencedAssets) {
    const asset = state.assets.get(path);
    if (!asset) continue;
    // Browsers may preserve a local clipboard path as File.name. Send only a
    // harmless basename as the multipart filename; the content-addressed path
    // remains the actual upload destination.
    const filename = asset.file.name.split(/[\\/]/).at(-1) || "upload";
    form.set(path, asset.file, `asset-${filename}`);
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
    stagedMediaLibrary.clear();
    state.ops = [];
    state.history = [];
    state.historyIndex = 0;
    state.changeSets.clear();
    richContentRegions.clear();
    richContentRegionAliases.clear();
    stableTargetIds.clear();
    changeIdAliases.clear();
    state.changeSetSequence = 0;
    activeChangeSet = null;
    originalSegments.clear();
    originalAttrs.clear();
    originalMedia.clear();
    createdMedia.clear();
    originalSeo.clear();
    originalMarkups.clear();
    duplicateSourceLabels.clear();
    originalFormats.clear();
    originalBlockTags.clear();
    originalListStates.clear();
    pendingRevisions.clear();
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
  const byPage = new Map<string, PendingOp[]>();
  for (const entry of state.ops) {
    const list = byPage.get(entry.pagePath) ?? [];
    list.push(entry);
    byPage.set(entry.pagePath, list);
  }
  const pages: PageOps[] = [];
  for (const [pagePath, entries] of byPage) {
    type DuplicateOp = Extract<Op, { type: "duplicateSection" | "duplicateGroupItem" }>;
    const duplicates = entries.filter(
      (entry): entry is PendingOp & { op: DuplicateOp } =>
        entry.op.type === "duplicateSection" || entry.op.type === "duplicateGroupItem",
    );
    const owned = new Set(
      duplicates.flatMap((entry) => [entry.op.createdId, ...Object.values(entry.op.nodeMap)]),
    );
    const operations: Op[] = [];
    for (const entry of entries) {
      const op = entry.op;
      if (op.type === "duplicateSection" || op.type === "duplicateGroupItem") {
        const createdNodeIds = new Set([op.createdId, ...Object.values(op.nodeMap)]);
        const createdOperations = entries
          .map(({ op: candidate }) => candidate)
          .filter((candidate) => {
            if (candidate.type === "duplicateSection" || candidate.type === "duplicateGroupItem")
              return false;
            const ids =
              candidate.type === "toggleList"
                ? candidate.nodeIds
                : "nodeId" in candidate
                  ? [candidate.nodeId]
                  : [];
            return ids.some((id) => createdNodeIds.has(id.split("#")[0]!));
          })
          .map((candidate) => structuredClone(candidate) as SnapshotOperation);
        const assetRefs = [...op.assetRefs];
        for (const candidate of [...op.snapshotOperations, ...createdOperations]) {
          if (candidate.type === "media" && candidate.value.source.kind === "staged") {
            assetRefs.push({ assetId: candidate.value.source.assetId });
          }
        }
        operations.push({
          ...op,
          createdOperations,
          assetRefs: [...new Map(assetRefs.map((asset) => [asset.assetId, asset])).values()],
        });
      } else if (op.type === "moveGroupItem") {
        operations.push(op);
      } else {
        const ids = op.type === "toggleList" ? op.nodeIds : "nodeId" in op ? [op.nodeId] : [];
        if (ids.some((id) => owned.has(id.split("#")[0]!))) continue;
        operations.push(op);
      }
    }
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
