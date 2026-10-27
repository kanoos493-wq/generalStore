/**
 * Error boundary.
 *
 * A render error with no boundary unmounts the tree and the app process dies —
 * the "it auto closes" symptom. This asserts a throwing child is caught and
 * turned into a recoverable screen, and that retry re-mounts it.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import ErrorBoundary from '../../src/app/ErrorBoundary';

function Boom({ blow = true }: { blow?: boolean }) {
  if (blow) {
    throw new Error('kaboom');
  }
  return <TextOk />;
}

function TextOk() {
  const { Text } = require('react-native');
  return <Text>all good</Text>;
}

// React logs the caught error to console.error; silence it for a clean run.
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom blow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('catches a render crash and shows a recoverable screen', () => {
    render(
      <ErrorBoundary area="Dashboard">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('kaboom')).toBeTruthy();
    // The escape hatch must be present and tappable.
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('re-renders children after a retry', () => {
    // Start broken, then flip the child to healthy on retry.
    let broken = true;
    function Toggle() {
      const { Text } = require('react-native');
      if (broken) {throw new Error('still broken');}
      return <Text>recovered</Text>;
    }

    render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    act(() => {
      broken = false;
    });
    fireEvent.press(screen.getByText('Try again'));

    expect(screen.getByText('recovered')).toBeTruthy();
  });
});
