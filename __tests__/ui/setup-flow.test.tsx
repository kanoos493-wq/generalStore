/**
 * First-run flow.
 *
 * A brand new install must open the setup wizard - never a PIN prompt - and
 * finishing the wizard must store the shop profile and open the app. The PIN
 * path must create the verifier once, without asking for the PIN a second time.
 *
 * These run against a real SQLite database (node:sqlite) and the real store, so
 * they cover the wiring that broke on device (the wizard asked for a PIN first,
 * then crashed while salting it).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SetupWizardScreen from '../../src/app/screens/SetupWizardScreen';
import { pinManager, useAppStore } from '../../src/app/store/appStore';
import { loadSettings } from '../../src/services/settingsService';
import { cleanup, makeDb } from '../support/testDb';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

jest.setTimeout(60000);

async function bootFreshInstall() {
  const { db } = await makeDb();
  const settings = await loadSettings(db);
  useAppStore.setState({
    db,
    settings,
    language: 'en',
    ready: true,
    bootError: null,
    needsSetup: !settings.setupCompleted,
    hasPin: false,
    randomSourceReady: true,
    locked: false,
    lastActivity: Date.now(),
  });
  return db;
}

function pressNext() {
  fireEvent.press(screen.getByTestId('wizard-next'));
}

function typePin(pin: string) {
  for (const digit of pin) {
    fireEvent.press(screen.getByLabelText(digit));
  }
}

afterEach(() => {
  cleanup();
  useAppStore.setState({ db: null, settings: null, ready: false, needsSetup: false, hasPin: false, locked: true });
});

describe('first-run setup', () => {
  it('starts a fresh install in the wizard, not on a PIN prompt', async () => {
    await bootFreshInstall();
    render(<SetupWizardScreen />);

    expect(screen.getByText('Welcome to DukanDost')).toBeTruthy();
    expect(screen.queryByText('Enter your PIN')).toBeNull();
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
  });

  it('walks through the wizard without a PIN and opens the app', async () => {
    const db = await bootFreshInstall();
    render(<SetupWizardScreen />);

    pressNext(); // welcome -> store
    fireEvent.changeText(screen.getByTestId('wizard-store-name'), 'Al-Madina Store');
    pressNext(); // store -> operator
    pressNext(); // operator -> security
    fireEvent(screen.getByTestId('wizard-pin-toggle'), 'valueChange', false);
    pressNext(); // security -> review
    expect(screen.getByText('Ready to start')).toBeTruthy();
    pressNext(); // finish

    await waitFor(() => expect(useAppStore.getState().needsSetup).toBe(false));
    const settings = await loadSettings(db);
    expect(settings.setupCompleted).toBe(true);
    expect(settings.storeName).toBe('Al-Madina Store');
    expect(settings.pinEnabled).toBe(false);
    expect(useAppStore.getState().hasPin).toBe(false);
    // No PIN means no lock screen after setup.
    expect(useAppStore.getState().locked).toBe(false);
    expect(useAppStore.getState().shouldAutoLock()).toBe(false);
  });

  it('creates the PIN once and records the recovery answers', async () => {
    const db = await bootFreshInstall();
    render(<SetupWizardScreen />);

    pressNext(); // welcome -> store
    fireEvent.changeText(screen.getByTestId('wizard-store-name'), 'Kiryana Noor');
    pressNext(); // store -> operator
    pressNext(); // operator -> security

    typePin('4827');
    pressNext(); // enter -> confirm (PIN is validated, not saved yet)
    expect(screen.getByText('Confirm PIN')).toBeTruthy();

    typePin('4827');
    fireEvent.changeText(screen.getByTestId('wizard-answer-1'), 'Model Town');
    fireEvent.changeText(screen.getByTestId('wizard-answer-2'), 'Lahore');
    pressNext(); // security -> review
    expect(screen.getByText('Ready to start')).toBeTruthy();
    pressNext(); // finish

    await waitFor(() => expect(useAppStore.getState().hasPin).toBe(true), { timeout: 30000 });

    const settings = await loadSettings(db);
    expect(settings.setupCompleted).toBe(true);
    expect(settings.pinEnabled).toBe(true);
    // The PIN works and recovery was enrolled in the same step.
    expect(await pinManager.unlock('4827')).toBe(true);
    expect(await pinManager.unlock('1111')).toBe(false);
    expect(await pinManager.recoveryQuestions()).toHaveLength(2);
    // Signed in immediately after finishing setup - no second PIN prompt.
    expect(useAppStore.getState().locked).toBe(false);
  });

  it('refuses to continue without a store name', async () => {
    await bootFreshInstall();
    render(<SetupWizardScreen />);

    pressNext(); // welcome -> store
    pressNext(); // try to continue with an empty name
    expect(screen.getByText('Enter your store name to continue')).toBeTruthy();
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
  });
});
