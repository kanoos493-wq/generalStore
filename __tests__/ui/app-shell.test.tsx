/**
 * The app shell that appears *after* setup.
 *
 * The first-run wizard was the only path exercised on a phone, and the shell it
 * hands over to had never rendered anywhere: `Navigation` called
 * `useNavigationState()` while rendering the very `NavigationContainer` that
 * provides that context, so mounting it threw and the app closed. This test
 * mounts the real shell against a real database, so that hand-off stays honest.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import Navigation from '../../src/app/navigation';
import { useAppStore } from '../../src/app/store/appStore';
import { loadSettings } from '../../src/services/settingsService';
import { cleanup, makeDb } from '../support/testDb';

/**
 * The navigator reads safe-area context itself, so the mock has to provide the
 * whole surface (provider, view and context) and not just the hook.
 */
jest.mock('react-native-safe-area-context', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  const insets = { top: 24, bottom: 16, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => ReactLib.createElement(View, null, children),
    SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) =>
      ReactLib.createElement(View, props, children),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    SafeAreaInsetsContext: ReactLib.createContext(insets),
    initialWindowMetrics: { insets, frame },
  };
});

jest.setTimeout(60000);

async function bootAfterSetup() {
  const { db } = await makeDb();
  const settings = await loadSettings(db);
  act(() => {
    useAppStore.setState({
      db,
      settings,
      language: 'en',
      ready: true,
      bootError: null,
      needsSetup: false,
      hasPin: false,
      randomSourceReady: true,
      locked: false,
      lastActivity: Date.now(),
    });
  });
  return db;
}

afterEach(() => {
  cleanup();
  act(() => {
    useAppStore.setState({ db: null, settings: null, ready: false, needsSetup: false, hasPin: false, locked: true });
  });
});

describe('app shell after setup', () => {
  it('mounts the navigator and lands on the dashboard', async () => {
    await bootAfterSetup();
    render(<Navigation />);

    // Tab labels come from the real navigator, so a missing context or a broken
    // screen registration fails here instead of on the phone.
    await waitFor(() => expect(screen.getByText('Sale')).toBeTruthy());
    expect(screen.getByText('Products')).toBeTruthy();
    expect(screen.getByText('More')).toBeTruthy();
  });

  it('renders the empty-shop dashboard with its quick actions', async () => {
    await bootAfterSetup();
    render(<Navigation />);

    await waitFor(() => expect(screen.getByText('Gross sales')).toBeTruthy());
    expect(screen.getByText('Expected cash')).toBeTruthy();
    expect(screen.getByText('Quick actions')).toBeTruthy();
  });
});
