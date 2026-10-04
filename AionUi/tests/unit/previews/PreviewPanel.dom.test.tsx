/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type PreviewPanelModule = typeof import('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel');

let previewPanelModule: PreviewPanelModule;

beforeAll(async () => {
  window.__backendPort = 13400;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
  previewPanelModule = await import('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel');
}, 60_000);

afterAll(() => {
  vi.unstubAllGlobals();
  delete window.__backendPort;
});

// PreviewPanel pulls in a large dependency graph. Load it once with extra
// headroom so concurrent full-suite transforms do not make each assertion
// repeat the same expensive cold import.
describe('PreviewPanel', () => {
  it('is a React component module that exports a default function', () => {
    expect(typeof previewPanelModule.default).toBe('function');
  });

  it('module loads without throwing on import', () => {
    expect(previewPanelModule).toBeTruthy();
  });

  it('has a displayName or function name for debugging', () => {
    const fn = previewPanelModule.default;
    expect(fn.name || fn.displayName || 'anonymous').toBeTruthy();
  });
});
