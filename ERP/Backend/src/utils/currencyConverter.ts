import https from 'https';

const EXCHANGE_RATE_API_URL = 'https://api.exchangerate-api.com/v4/latest/USD';

/**
 * Get the latest USD to RWF exchange rate.
 * @returns {Promise<number>} The exchange rate.
 */
export const getUsdToRwfRate = (): Promise<number> => {
    return new Promise((resolve) => {
        https.get(EXCHANGE_RATE_API_URL, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (parsedData && parsedData.rates && parsedData.rates.RWF) {
                        resolve(parsedData.rates.RWF);
                    } else {
                        console.error('Invalid response from exchange rate API, using fallback.');
                        resolve(1300); // Fallback
                    }
                } catch (error) {
                    console.error('Failed to parse exchange rate response, using fallback:', error);
                    resolve(1300); // Fallback
                }
            });
        }).on('error', (err) => {
            console.error('Failed to fetch exchange rate, using fallback:', err);
            resolve(1300); // Fallback
        });
    });
};

/**
 * Convert USD to RWF.
 * @param {number} usdAmount The amount in USD.
 * @returns {Promise<number>} The amount in RWF.
 */
export const convertUsdToRwf = async (usdAmount: number): Promise<number> => {
    const rate = await getUsdToRwfRate();
    return usdAmount * rate;
};
