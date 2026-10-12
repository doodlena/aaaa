import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ResultsList } from '../components/ResultsList';
import { createSelectionStore } from '../state/selection';
import { searchResponse, summary } from '../test/utils';

const renderList = (data = searchResponse()) =>
  render(
    <MemoryRouter>
      <ResultsList data={data} store={createSelectionStore()} />
    </MemoryRouter>,
  );

describe('ResultsList', () => {
  it('renders confirmed results with badges, match reasons and warnings', () => {
    renderList(
      searchResponse({
        items: [
          summary({
            match_reasons: [{ code: 'distance', km: 1.2 }, { code: 'food_group', value: 'groceries' }, { code: 'eligibility_confirmed', value: 'no_id_required' }],
            warnings: ['synthetic', 'eligibility_unknown'],
          }),
        ],
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('1 place matches your search');
    const card = screen.getByRole('listitem', { name: /Maple Community Pantry/ });
    expect(within(card).getByTestId('synthetic-badge')).toHaveTextContent('Test data; not a real resource');
    expect(within(card).getByText('Verified')).toBeInTheDocument();
    expect(within(card).getByText('Offers Groceries')).toBeInTheDocument();
    expect(within(card).getByText('No ID required (confirmed)')).toBeInTheDocument();
    expect(within(card).getByText('Requirements not confirmed')).toBeInTheDocument();
    expect(within(card).getByText(/0\.7 mi away/)).toBeInTheDocument();
  });

  it('lists uncertain matches in a separate, labelled section with what is unconfirmed', () => {
    renderList(
      searchResponse({
        uncertain: [summary({ id: 5, name: '[TEST] Birch Hill Church Pantry', unconfirmed: ['no_id_required', 'schedule'] })],
        uncertain_total: 1,
      }),
    );
    const section = screen.getByTestId('uncertain-section');
    expect(within(section).getByRole('heading', { name: 'May match — information not confirmed' })).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: '[TEST] Birch Hill Church Pantry' })).toBeInTheDocument();
    expect(within(section).getByText('Whether ID is required')).toBeInTheDocument();
    expect(within(section).getByText('Distribution days')).toBeInTheDocument();
    // not in the confirmed list
    const confirmed = screen.getByRole('list', { name: 'Places that match' });
    expect(within(confirmed).queryByRole('link', { name: '[TEST] Birch Hill Church Pantry' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('1 more may match');
  });

  it('shows the coverage notice unless coverage is complete', () => {
    const { unmount } = renderList(searchResponse({ coverage: { covered_jurisdictions: [], complete: false } }));
    expect(screen.getByText(/still adding resources in this area/)).toBeInTheDocument();
    unmount();
    renderList(searchResponse({ coverage: { covered_jurisdictions: ['arlington-county'], complete: true } }));
    expect(screen.queryByText(/still adding resources in this area/)).toBeNull();
  });

  it('shows an explicit unknown schedule rather than a date', () => {
    renderList(searchResponse({ items: [summary({ next_distribution: null, has_distribution_schedule: false, warnings: ['schedule_unknown'] })] }));
    expect(screen.getByText('Distribution days not confirmed. Call before you go.')).toBeInTheDocument();
  });

  it('renders an empty state', () => {
    renderList(searchResponse({ items: [], total: 0 }));
    expect(screen.getByText('No places found here')).toBeInTheDocument();
  });
});
