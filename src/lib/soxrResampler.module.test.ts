import { describe, expect, it, vi } from 'vitest';
import { resolveSoxrModuleFactory } from './soxrResampler';

describe('Emscripten factory interop', () => {
  it('accepts direct, default and nested-default production exports', () => {
    const factory = vi.fn();
    expect(resolveSoxrModuleFactory(factory)).toBe(factory);
    expect(resolveSoxrModuleFactory({ default: factory })).toBe(factory);
    expect(resolveSoxrModuleFactory({ default: { default: factory } })).toBe(factory);
  });

  it('fails explicitly for a missing factory instead of calling an object', () => {
    expect(() => resolveSoxrModuleFactory({ default: {} })).toThrow('未导出可调用工厂');
  });
});
