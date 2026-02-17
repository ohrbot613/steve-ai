import { useState, useEffect } from 'react';

/**
 * Custom hook to fetch bank balance from Xero API endpoint
 * Fetches once on mount and handles loading, success, and error states
 *
 * @returns {Object} { balance, loading, error }
 *   - balance: { total, currency, accounts } or null if not authenticated
 *   - loading: boolean indicating fetch in progress
 *   - error: string error message or null
 */
export function useXeroBalance() {
    const [balance, setBalance] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function fetchBalance() {
            try {
                const response = await fetch('/api/v2/scripts/get-bank-balance', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include' // JWT cookie auth
                });

                // Handle 401 - user not authenticated with Xero (not an error state)
                if (response.status === 401) {
                    setBalance(null);
                    setError(null);
                    return;
                }

                const data = await response.json();

                // Handle non-OK responses (other than 401)
                if (!response.ok) {
                    setError('Could not load bank balance');
                    return;
                }

                // Check for success response structure
                if (data.success === true && data.accounts && data.baseCurrency) {
                    // Sum all ACTIVE accounts in base currency
                    const filtered = data.accounts
                        .filter(acc =>
                            acc.status === 'ACTIVE' &&
                            acc.currencyCode === data.baseCurrency
                        );

                    // Prefer xeroBalance (live authorised transactions) over statementBalance
                    const xeroTotal = filtered.reduce((sum, acc) => {
                        const bal = acc.xeroBalance != null ? acc.xeroBalance : acc.statementBalance;
                        return sum + (bal || 0);
                    }, 0);

                    const statementTotal = filtered.reduce((sum, acc) => {
                        return sum + (acc.statementBalance || 0);
                    }, 0);

                    // Determine which source is being used
                    const hasXeroBalance = filtered.some(acc => acc.xeroBalance != null);
                    const hasMismatch = hasXeroBalance && Math.abs(xeroTotal - statementTotal) > 0.01;

                    setBalance({
                        total: xeroTotal,          // Primary display (unchanged behavior)
                        statementTotal,            // For mismatch indicator
                        currency: data.baseCurrency,
                        accounts: data.accounts,
                        source: hasXeroBalance ? 'xero' : 'statement',
                        hasMismatch
                    });
                    setError(null);
                } else {
                    setError('Could not load bank balance');
                }
            } catch (err) {
                console.error('Error fetching Xero balance:', err);
                setError('Could not load bank balance');
            } finally {
                setLoading(false);
            }
        }

        fetchBalance();
    }, []); // Empty dependency array - fetch once on mount

    return { balance, loading, error };
}
