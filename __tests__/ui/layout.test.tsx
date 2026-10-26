import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { BottomBar, BrandMark, Screen } from '../../src/app/components';

// Fixed insets so the assertions are about the layout contract, not the host.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

describe('system-bar safety', () => {
  it('keeps plain screen content clear of the status and navigation bars', () => {
    render(
      <Screen>
        <Text>body</Text>
      </Screen>,
    );
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain('"paddingTop":24');
    expect(json).toContain('"paddingBottom":16');
  });

  it('offsets a scrolling screen below the status bar', () => {
    render(
      <Screen scroll footer={<Text>save</Text>}>
        <Text>body</Text>
      </Screen>,
    );
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain('"paddingTop":24');
  });

  it('puts the bottom action bar above the gesture / three-button area', () => {
    render(
      <BottomBar>
        <Text>checkout</Text>
      </BottomBar>,
    );
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain('"paddingBottom":16');
  });
});

describe('branding', () => {
  it('renders the brand mark with an accessibility label', () => {
    render(<BrandMark size={72} />);
    expect(screen.getByLabelText('DukanDost')).toBeTruthy();
  });

  it('keeps the mark square for any requested size', () => {
    const { toJSON } = render(<BrandMark size={48} />);
    const view = toJSON() as unknown as { props: { style: { width: number; height: number } } };
    expect(view.props.style.width).toBe(48);
    expect(view.props.style.height).toBe(48);
  });
});
