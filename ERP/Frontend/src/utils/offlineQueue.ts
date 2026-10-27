export interface QueuedSale {
    id: string;
    payload: any;
    timestamp: number;
}

const OFFLINE_QUEUE_KEY = 'pos_offline_sales_queue';

export const offlineQueue = {
    /**
     * Add a sale to the offline queue
     */
    enqueue: (payload: any): void => {
        try {
            const queue = offlineQueue.getQueue();
            const newEntry: QueuedSale = {
                id: `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                payload,
                timestamp: Date.now(),
            };
            queue.push(newEntry);
            localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        } catch (error) {
            console.error('Failed to enqueue sale:', error);
        }
    },

    /**
     * Get all queued sales
     */
    getQueue: (): QueuedSale[] => {
        try {
            const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Failed to get offline queue:', error);
            return [];
        }
    },

    /**
     * Remove a sale from the queue by ID
     */
    dequeue: (id: string): void => {
        try {
            const queue = offlineQueue.getQueue();
            const filtered = queue.filter(item => item.id !== id);
            localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(filtered));
        } catch (error) {
            console.error('Failed to dequeue sale:', error);
        }
    },

    /**
     * Clear the entire queue
     */
    clear: (): void => {
        localStorage.removeItem(OFFLINE_QUEUE_KEY);
    },

    /**
     * Check if there are items in the queue
     */
    hasItems: (): boolean => {
        return offlineQueue.getQueue().length > 0;
    },

    /**
     * Get the count of queued items
     */
    count: (): number => {
        return offlineQueue.getQueue().length;
    },

    /**
     * Save products to local cache
     */
    saveProducts: (products: any[]): void => {
        localStorage.setItem('pos_cached_products', JSON.stringify(products));
    },

    /**
     * Get cached products
     */
    getProducts: (): any[] => {
        const stored = localStorage.getItem('pos_cached_products');
        return stored ? JSON.parse(stored) : [];
    },

    /**
     * Save customers to local cache
     */
    saveCustomers: (customers: any[]): void => {
        localStorage.setItem('pos_cached_customers', JSON.stringify(customers));
    },

    /**
     * Get cached customers
     */
    getCustomers: (): any[] => {
        const stored = localStorage.getItem('pos_cached_customers');
        return stored ? JSON.parse(stored) : [];
    }
};
