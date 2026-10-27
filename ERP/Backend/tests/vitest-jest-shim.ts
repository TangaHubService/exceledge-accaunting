/**
 * Jest-only compatibility shim for the `vitest` import used by the fiscal
 * suites (rra-ebm-compliance, invoice-pdf, invoice-pdf-proforma,
 * fiscal-report-pdf). Mapped via jest.config.ts `moduleNameMapper` — vitest
 * itself ignores this file and resolves the real `vitest` package.
 *
 * Only the subset actually used by those suites is bridged
 * (describe/it/expect + vi.spyOn/vi.fn). Suites that rely on vitest module
 * mocking (`vi.mock`, hoisted by vitest) stay vitest-exclusive and are
 * excluded from the jest run (see jest.config.ts).
 */
const g = globalThis as any;

export const describe = g.describe;
export const it = g.it;
export const test = g.test;
// Jest 30 dropped the `toThrowError` alias the suites use — re-attach it so
// the same assertion source runs unmodified under both runners.
const jestExpect = g.expect;
function shimmedExpect(...args: any[]) {
  const matchers = jestExpect(...args);
  if (matchers && typeof matchers.toThrowError !== 'function' && typeof matchers.toThrow === 'function') {
    matchers.toThrowError = matchers.toThrow.bind(matchers);
  }
  return matchers;
}
Object.assign(shimmedExpect, jestExpect);
export const expect = shimmedExpect as typeof jestExpect;
export const beforeEach = g.beforeEach;
export const afterEach = g.afterEach;
export const beforeAll = g.beforeAll;
export const afterAll = g.afterAll;

declare const jest: any;

export const vi = {
  fn: (...args: any[]) => jest.fn(...args),
  spyOn: (...args: any[]) => (jest.spyOn as any)(...args),
};
