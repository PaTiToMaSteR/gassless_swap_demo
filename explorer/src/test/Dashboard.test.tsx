import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Dashboard from '../pages/Dashboard';
import { MemoryRouter } from 'react-router-dom';
import * as useBlockchain from '../hooks/useBlockchain';

// Mock the hooks
vi.mock('../hooks/useBlockchain', () => ({
    useLatestBlocks: vi.fn(),
    useLatestTransactions: vi.fn(),
}));

describe('Dashboard', () => {
    it('renders loading state initially', () => {
        vi.mocked(useBlockchain.useLatestBlocks).mockReturnValue({ blocks: [], loading: true });
        vi.mocked(useBlockchain.useLatestTransactions).mockReturnValue({ transactions: [], loading: true });

        render(
            <MemoryRouter>
                <Dashboard />
            </MemoryRouter>
        );

        expect(screen.getByText(/Loading blocks.../i)).toBeInTheDocument();
        expect(screen.getByText(/Loading transactions.../i)).toBeInTheDocument();
    });

    it('renders blocks and transactions when loaded', () => {
        const mockBlocks = [
            { hash: '0x123', number: 100, timestamp: 1625247600, miner: '0xminer', transactions: [] }
        ];
        const mockTxs = [
            { hash: '0xtx1', from: '0xsender', value: BigInt(100000), receipt: { gasUsed: 21000, effectiveGasPrice: 1000000000 } }
        ];

        vi.mocked(useBlockchain.useLatestBlocks).mockReturnValue({ blocks: mockBlocks as any, loading: false });
        vi.mocked(useBlockchain.useLatestTransactions).mockReturnValue({ transactions: mockTxs as any, loading: false });

        render(
            <MemoryRouter>
                <Dashboard />
            </MemoryRouter>
        );

        expect(screen.getByText(/#100/i)).toBeInTheDocument();
        expect(screen.getByText(/0xmine.../i)).toBeInTheDocument();
        expect(screen.getByText(/0xtx1.../i)).toBeInTheDocument();
    });
});
