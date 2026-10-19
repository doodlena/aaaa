import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, REQUEST_TIMEOUT_MS, request } from '../api/client';
import { Loading, SLOW_AFTER_MS } from '../components/Status';
import '../i18n';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a sleeping server', () => {
  it('explains the wait after a few seconds', () => {
    vi.useFakeTimers();
    render(<Loading label="Looking for help nearby…" />);
    expect(screen.queryByText(/waking up/)).toBeNull();
    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS));
    expect(screen.getByRole('status')).toHaveTextContent('The server is waking up');
  });

  it('gives up with a "try again" error instead of loading forever', async () => {
    vi.useFakeTimers();
    // a fetch that never answers, but stops when aborted (like a real one)
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const pending = request('GET', '/resources/search?x=1');
    const caught = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const err = await caught;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).i18nKey).toBe('errors.timeout');
  });
});
