/**
 * Converts currency code to currency symbol
 * @param {string} currencyCode - Currency code (e.g., 'EUR', 'USD', 'GBP')
 * @returns {string} Currency symbol (e.g., '€', '$', '£')
 */
export function getCurrencySymbol(currencyCode) {
    if (!currencyCode) return '$';
    
    const currency = currencyCode.toUpperCase().trim();
    
    const currencyMap = {
        'EUR': '€',
        'USD': '$',
        'GBP': '£',
        'JPY': '¥',
        'CNY': '¥',
        'AUD': 'A$',
        'CAD': 'C$',
        'CHF': 'CHF',
        'NZD': 'NZ$',
        'INR': '₹',
        'BRL': 'R$',
        'ZAR': 'R',
        'MXN': '$',
        'SGD': 'S$',
        'HKD': 'HK$',
        'NOK': 'kr',
        'SEK': 'kr',
        'DKK': 'kr',
        'PLN': 'zł',
        'RUB': '₽',
        'TRY': '₺',
        'KRW': '₩',
        'THB': '฿',
    };
    
    // If currency code exists in map, return symbol
    if (currencyMap[currency]) {
        return currencyMap[currency];
    }
    
    // If already a symbol or unknown, return as is or default to $
    // Check if it's already a symbol (single character or known multi-char symbols)
    if (currency.length <= 2 && !currencyMap[currency]) {
        return currency;
    }
    
    return '$'; // Default fallback
}

/**
 * Formats a numeric amount as currency with proper symbol and thousands separators
 * @param {number} amount - The amount to format
 * @param {string} currencyCode - Currency code (e.g., 'EUR', 'USD', 'GBP')
 * @returns {string} Formatted currency string (e.g., '£23,451') or '--' if invalid
 */
export function formatCurrency(amount, currencyCode) {
    // Return placeholder if amount is null/undefined or not a number
    if (amount == null || typeof amount !== 'number' || isNaN(amount)) {
        return '--';
    }

    // Get the currency symbol using existing function
    const symbol = getCurrencySymbol(currencyCode);

    // Format with thousands separators and no decimals
    const formatted = new Intl.NumberFormat('en-GB', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);

    return `${symbol}${formatted}`;
}