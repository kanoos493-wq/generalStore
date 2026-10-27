/**
 * Toast feedback.
 *
 * Forms used to call `navigation.goBack()` after a save with no confirmation,
 * so the user could never tell whether an action landed. This covers the store
 * and the host's show → auto-hide lifecycle.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import ToastHost from '../../src/app/ToastHost';
import { showToast, useToastStore } from '../../src/app/toast';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

beforeEach(() => {
  useToastStore.setState({ message: null, tone: 'success', seq: 0 });
});

describe('toast', () => {
  it('stores the message and tone via showToast', () => {
    act(() => showToast('Saved', 'success'));
    expect(useToastStore.getState().message).toBe('Saved');
    expect(useToastStore.getState().tone).toBe('success');
    expect(useToastStore.getState().seq).toBe(1);
  });

  it('bumps the sequence so an identical message re-announces', () => {
    act(() => showToast('Saved'));
    act(() => showToast('Saved'));
    expect(useToastStore.getState().seq).toBe(2);
  });

  it('renders the message and auto-hides after the visible window', async () => {
    jest.useFakeTimers();
    try {
      render(<ToastHost />);
      act(() => showToast('Sale saved', 'success'));
      expect(screen.getByText('Sale saved')).toBeTruthy();

      // Advance past the visible window; the hide animation then clears it.
      act(() => {
        jest.advanceTimersByTime(2500);
      });
      await waitFor(() => expect(useToastStore.getState().message).toBeNull());
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders nothing when there is no message', () => {
    render(<ToastHost />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});