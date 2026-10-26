import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Badge, Kpi, Row, Section } from '../../src/app/components';

describe('shared components', () => {
  it('renders a label/value row', () => {
    render(<Row label="Subtotal" value="PKR 1,500" />);
    expect(screen.getByText('Subtotal')).toBeTruthy();
    expect(screen.getByText('PKR 1,500')).toBeTruthy();
  });

  it('renders a KPI with its caption', () => {
    render(<Kpi label="Today's sales" value="PKR 12,340" sub="18 bills" />);
    expect(screen.getByText("Today's sales")).toBeTruthy();
    expect(screen.getByText('PKR 12,340')).toBeTruthy();
    expect(screen.getByText('18 bills')).toBeTruthy();
  });

  it('renders a badge and a section title', () => {
    render(
      <Section title="Recent sales">
        <Badge text="Paid" tone="success" />
      </Section>,
    );
    expect(screen.getByText('Recent sales')).toBeTruthy();
    expect(screen.getByText('Paid')).toBeTruthy();
  });
});
