import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('shows the page title', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Blood Bank Management System' }),
    ).toBeInTheDocument();
  });
});
