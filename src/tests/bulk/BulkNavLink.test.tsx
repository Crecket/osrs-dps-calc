import {
  describe, expect, jest, test,
} from '@jest/globals';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

let mockPathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));

// required after the mock is registered, so the component sees the mocked usePathname
// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const BulkNavLink = require('@/bulk/components/BulkNavLink').default as React.FC;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

process.env.NEXT_PUBLIC_BASE_PATH = '/osrs-dps';

const render = (path: string) => {
  mockPathname = path;
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<BulkNavLink />));
  const link = container.querySelector('a')!;
  act(() => root.unmount());
  return link;
};

describe('BulkNavLink', () => {
  // both directions are full page loads, so the browser's back button never remounts the calculator client-side
  test('links to the calculator from the bulk tool', () => {
    const link = render('/');
    expect(link.getAttribute('href')).toBe('/osrs-dps/calc');
    expect(link.textContent).toContain('Build setups in the calculator');
  });

  test('links back to the bulk tool with a full page load', () => {
    const link = render('/calc');
    expect(link.textContent).toContain('Back to bulk tool');
    // a plain anchor carries the base path itself (next/link would add it from the router instead)
    expect(link.getAttribute('href')).toBe('/osrs-dps/');
  });
});
