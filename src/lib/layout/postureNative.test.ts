import { describe, expect, it, vi } from 'vitest';

// 側邊姿態（iPhone Duo 的直立軌）只在 iOS 判定：Android 橫向時打孔鏡頭或三鍵導覽列的單邊 inset 會超過門檻，誤判成側邊姿態。
vi.mock('../native/platform', () => ({ isNative: () => true, nativePlatform: () => 'android' }));

describe('posture：Android 不做側邊姿態判定', () => {
  it('startPosture 在 Android 回 null，不碰 DOM', async () => {
    const { startPosture } = await import('./posture');
    expect(startPosture()).toBeNull();
    expect(startPosture()).toBeNull();
  });
});
