import { describe, expect, it } from 'vitest';
import { classifyAppleSignInError, identityTokenOf, nonceFromBytes, sha256Hex } from './appleSignIn';

describe('nonceFromBytes', () => {
  it('每個 byte 兩位 hex，不足補 0', () => {
    expect(nonceFromBytes(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });
});

describe('sha256Hex', () => {
  it('與已知向量相符（給 Apple 的是 hash 過的 nonce）', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('classifyAppleSignInError', () => {
  it('ASAuthorizationError 1001（使用者關掉表單）是取消，中英文訊息都認得', () => {
    expect(classifyAppleSignInError(new Error('The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)'))).toBe('cancelled');
    expect(classifyAppleSignInError({ message: '無法完成操作。(com.apple.AuthenticationServices.AuthorizationError錯誤1001。)' })).toBe('cancelled');
    expect(classifyAppleSignInError('user canceled')).toBe('cancelled');
  });
  it('其他代碼是失敗；1001 只認整個數字', () => {
    expect(classifyAppleSignInError(new Error('(com.apple.AuthenticationServices.AuthorizationError error 1000.)'))).toBe('failed');
    expect(classifyAppleSignInError(new Error('error 10011'))).toBe('failed');
    expect(classifyAppleSignInError(new Error('error 11001'))).toBe('failed');
    expect(classifyAppleSignInError(undefined)).toBe('failed');
  });
});

describe('identityTokenOf', () => {
  it('只接受非空字串', () => {
    expect(identityTokenOf({ identityToken: 'eyJ.x.y' })).toBe('eyJ.x.y');
    expect(identityTokenOf({ identityToken: '' })).toBeNull();
    expect(identityTokenOf({ identityToken: null })).toBeNull();
    expect(identityTokenOf(undefined)).toBeNull();
  });
});
