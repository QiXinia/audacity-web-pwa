import { describe, it, expect } from 'vitest';
import { wasmProcessor } from '@/wasm/processor';

/**
 * 选区编辑操作测试：
 * - 选区删除（切割 + 拼接）
 * - 选区复制粘贴
 * - 选区插入
 * - 选区替换
 * 这些操作在真实代码中由 projectService 组合 WASM 工具函数完成，
 * 这里直接测试底层缓冲区操作的正确性
 */
describe('选区编辑 - 底层缓冲区操作', () => {
  function makeSine(length: number, freq = 440, sampleRate = 44100): Float32Array {
    const buf = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      buf[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.5;
    }
    return buf;
  }

  describe('sliceBuffer - 选区截取', () => {
    it('截取中间一段', () => {
      const input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const selected = wasmProcessor.sliceBuffer(input, 3, 7);
      expect(selected.length).toBe(4);
      expect(selected[0]).toBe(3);
      expect(selected[3]).toBe(6);
    });

    it('选区起点在 0', () => {
      const input = new Float32Array([0, 1, 2, 3]);
      const selected = wasmProcessor.sliceBuffer(input, 0, 2);
      expect(selected.length).toBe(2);
      expect(selected[0]).toBe(0);
      expect(selected[1]).toBe(1);
    });

    it('选区终点是缓冲区末尾', () => {
      const input = new Float32Array([0, 1, 2, 3]);
      const selected = wasmProcessor.sliceBuffer(input, 2, 4);
      expect(selected.length).toBe(2);
      expect(selected[0]).toBe(2);
      expect(selected[1]).toBe(3);
    });

    it('选区超出边界自动裁剪', () => {
      const input = new Float32Array([0, 1, 2]);
      const selected = wasmProcessor.sliceBuffer(input, -5, 10);
      expect(selected.length).toBe(3);
    });

    it('空选区返回空数组', () => {
      const input = new Float32Array([0, 1, 2]);
      const selected = wasmProcessor.sliceBuffer(input, 1, 1);
      expect(selected.length).toBe(0);
    });
  });

  describe('选区删除 = 前半 + 后半 拼接', () => {
    function deleteSelection(buffer: Float32Array, start: number, end: number): Float32Array {
      const before = wasmProcessor.sliceBuffer(buffer, 0, start);
      const after = wasmProcessor.sliceBuffer(buffer, end, buffer.length);
      return wasmProcessor.concatBuffers(before, after);
    }

    it('删除中间选区', () => {
      const input = new Float32Array([0, 1, 2, 3, 4, 5]);
      const result = deleteSelection(input, 2, 4);
      expect(result.length).toBe(4);
      expect([...result]).toEqual([0, 1, 4, 5]);
    });

    it('删除开头选区', () => {
      const input = new Float32Array([0, 1, 2, 3]);
      const result = deleteSelection(input, 0, 2);
      expect(result.length).toBe(2);
      expect([...result]).toEqual([2, 3]);
    });

    it('删除末尾选区', () => {
      const input = new Float32Array([0, 1, 2, 3]);
      const result = deleteSelection(input, 2, 4);
      expect(result.length).toBe(2);
      expect([...result]).toEqual([0, 1]);
    });

    it('删除全部选区', () => {
      const input = new Float32Array([0, 1, 2]);
      const result = deleteSelection(input, 0, 3);
      expect(result.length).toBe(0);
    });

    it('空选区不改变内容', () => {
      const input = new Float32Array([0, 1, 2]);
      const result = deleteSelection(input, 1, 1);
      expect(result.length).toBe(3);
      expect([...result]).toEqual([0, 1, 2]);
    });
  });

  describe('选区插入 = 前半 + 粘贴内容 + 后半', () => {
    function insertAt(buffer: Float32Array, pos: number, content: Float32Array): Float32Array {
      const before = wasmProcessor.sliceBuffer(buffer, 0, pos);
      const after = wasmProcessor.sliceBuffer(buffer, pos, buffer.length);
      return wasmProcessor.concatBuffers(wasmProcessor.concatBuffers(before, content), after);
    }

    it('在中间插入内容', () => {
      const input = new Float32Array([0, 1, 4, 5]);
      const clip = new Float32Array([2, 3]);
      const result = insertAt(input, 2, clip);
      expect(result.length).toBe(6);
      expect([...result]).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('在开头插入内容', () => {
      const input = new Float32Array([2, 3]);
      const clip = new Float32Array([0, 1]);
      const result = insertAt(input, 0, clip);
      expect(result.length).toBe(4);
      expect([...result]).toEqual([0, 1, 2, 3]);
    });

    it('在末尾插入内容', () => {
      const input = new Float32Array([0, 1]);
      const clip = new Float32Array([2, 3]);
      const result = insertAt(input, 2, clip);
      expect(result.length).toBe(4);
      expect([...result]).toEqual([0, 1, 2, 3]);
    });

    it('插入空内容不改变', () => {
      const input = new Float32Array([0, 1, 2]);
      const result = insertAt(input, 1, new Float32Array([]));
      expect(result.length).toBe(3);
      expect([...result]).toEqual([0, 1, 2]);
    });
  });

  describe('选区替换 = 先删除选区再插入内容', () => {
    function replaceSelection(
      buffer: Float32Array,
      start: number,
      end: number,
      replacement: Float32Array,
    ): Float32Array {
      const before = wasmProcessor.sliceBuffer(buffer, 0, start);
      const after = wasmProcessor.sliceBuffer(buffer, end, buffer.length);
      return wasmProcessor.concatBuffers(wasmProcessor.concatBuffers(before, replacement), after);
    }

    it('用较短内容替换选区', () => {
      const input = new Float32Array([0, 1, 2, 3, 4, 5]);
      const replacement = new Float32Array([9]);
      const result = replaceSelection(input, 2, 5, replacement);
      expect(result.length).toBe(4);
      expect([...result]).toEqual([0, 1, 9, 5]);
      // 索引 2-4（半开区间 [2,5)）替换为 [9]，索引 5 保留
      // 修正：选区 [2,5) = 元素 2,3,4 ；替换为 [9] ；保留 [0,1] + [9] + [5]
    });

    it('用较长内容替换选区', () => {
      const input = new Float32Array([0, 1, 5]);
      const replacement = new Float32Array([2, 3, 4]);
      const result = replaceSelection(input, 1, 2, replacement);
      expect(result.length).toBe(5);
      expect([...result]).toEqual([0, 2, 3, 4, 5]);
    });
  });

  describe('长音频选区操作正确性', () => {
    const SAMPLE_RATE = 44100;

    it('删除选区后总时长变短', () => {
      const duration = 2; // 2 秒
      const totalSamples = SAMPLE_RATE * duration;
      const input = makeSine(totalSamples, 440, SAMPLE_RATE);

      // 删除中间 0.5 秒
      const startSample = Math.floor(SAMPLE_RATE * 0.5);
      const endSample = Math.floor(SAMPLE_RATE * 1.0);
      const before = wasmProcessor.sliceBuffer(input, 0, startSample);
      const after = wasmProcessor.sliceBuffer(input, endSample, totalSamples);
      const result = wasmProcessor.concatBuffers(before, after);

      const expectedLength = totalSamples - (endSample - startSample);
      expect(result.length).toBe(expectedLength);
      // 前后样本值应保留原有特征
      expect(result[0]).toBeCloseTo(input[0], 5);
      expect(result[startSample - 1]).toBeCloseTo(input[startSample - 1], 5);
      expect(result[startSample]).toBeCloseTo(input[endSample], 5);
    });

    it('复制粘贴后总时长变长', () => {
      const input = makeSine(SAMPLE_RATE, 440, SAMPLE_RATE); // 1 秒
      const selection = wasmProcessor.sliceBuffer(
        input,
        Math.floor(SAMPLE_RATE * 0.25),
        Math.floor(SAMPLE_RATE * 0.75),
      );
      // 选区应约 0.5 秒长
      expect(selection.length).toBeCloseTo(SAMPLE_RATE * 0.5, 0);
      // 粘贴到开头
      const pasted = wasmProcessor.concatBuffers(selection, input);
      expect(pasted.length).toBe(SAMPLE_RATE + selection.length);
    });
  });
});
