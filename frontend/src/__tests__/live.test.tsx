import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { LiveSummary } from '../components/Live';
import { ResultCard } from '../components/ResultCard';
import { sortFeed } from '../components/TodayShelves';
import { HomePage } from '../pages/HomePage';
import { ResourcePage } from '../pages/ResourcePage';
import { mockFetch, renderApp, searchResponse, summary } from '../test/utils';
import { detailFixture, liveOpen, visitPlan } from './fixtures';

describe('live shelf status', () => {
  it('badge names the pantry as source with a relative time, and levels are text (not colour only)', () => {
    render(<LiveSummary live={liveOpen()} />);
    expect(screen.getByText('Open today')).toBeInTheDocument();
    expect(screen.getByTestId('posted-by')).toHaveTextContent(/Posted by the pantry\s*·\s*2 h ago/);
    const shelf = screen.getByRole('list', { name: 'On the shelf today' });
    const tags = within(shelf).getAllByRole('listitem');
    expect(tags).toHaveLength(3);
    expect(tags[0]).toHaveTextContent(/Plenty$/);
    expect(tags[1]).toHaveTextContent(/Some$/);
    expect(tags[2]).toHaveTextContent(/Low$/);
    // every level is a visible word; the bars are decorative
    for (const word of ['Plenty', 'Some', 'Low']) expect(within(shelf).getByText(word)).toBeVisible();
    shelf.querySelectorAll('.level__bars').forEach((b) => expect(b).toHaveAttribute('aria-hidden', 'true'));
    // status glyph is decorative; the status is carried by text
    expect(document.querySelector('.sglyph')).toHaveAttribute('aria-hidden', 'true');
  });

  it('closed status uses a distinct label and shape class', () => {
    render(<LiveSummary live={liveOpen({ status: 'closed', items: [], message: 'Closed for training' })} />);
    expect(screen.getByText('Closed today')).toBeInTheDocument();
    expect(document.querySelector('[data-live-status="closed"] .sglyph--closed')).not.toBeNull();
  });

  it('result card shows the live post and open reports', () => {
    render(
      <MemoryRouter>
        <ul>
          <ResultCard item={summary({ live: liveOpen(), open_reports: 2 })} selected={false} onSelect={() => {}} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('live-summary')).toHaveTextContent('Posted by the pantry');
    expect(screen.getByText('2 recent reports — being checked')).toBeInTheDocument();
  });

  it('feed puts open pantries first and skips ones without a post', () => {
    const a = summary({ id: 1, live: liveOpen({ status: 'closed' }) });
    const b = summary({ id: 2, live: null });
    const c = summary({ id: 3, live: liveOpen({ status: 'open' }) });
    expect(sortFeed([a, b, c]).map((r) => r.id)).toEqual([3, 1]);
  });

  it('home leads with today\'s shelves from the API', async () => {
    mockFetch([{ path: '/api/resources/search', body: searchResponse({ items: [summary({ live: liveOpen() }), summary({ id: 9, name: 'No post' })] }) }]);
    renderApp(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("What's on the shelf today, near you");
    const feed = await screen.findByRole('list', { name: "Today's shelves near you" });
    expect(within(feed).getByRole('link', { name: '[TEST] Maple Community Pantry' })).toBeInTheDocument();
    expect(within(feed).queryByText('No post')).toBeNull();
  });

  it('detail: "Today at this pantry" shows live items; without a post it says stock is not confirmed', async () => {
    mockFetch([
      { path: '/api/resources/1', body: detailFixture({ live: liveOpen(), current_inventory: liveOpen().items }) },
      { path: '/api/resources/1/visit-plan', body: visitPlan },
    ]);
    const { unmount } = renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    const today = await screen.findByTestId('today-section');
    expect(within(today).getByRole('heading', { name: 'Today at this pantry' })).toBeInTheDocument();
    expect(within(today).getByText('Posted by the pantry')).toBeInTheDocument();
    expect(within(today).getByText('Plenty')).toBeInTheDocument();
    expect(within(today).queryByText('Current stock has not been confirmed.')).toBeNull();
    unmount();

    mockFetch([
      { path: '/api/resources/1', body: detailFixture() },
      { path: '/api/resources/1/visit-plan', body: visitPlan },
    ]);
    renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    const none = await screen.findByTestId('today-section');
    expect(within(none).getByText('Current stock has not been confirmed.')).toBeInTheDocument();
    expect(within(none).queryByText('Posted by the pantry')).toBeNull();
  });
});
