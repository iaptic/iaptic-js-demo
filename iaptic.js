/** @typedef {'subscription'|'consumable'|'non_consumable'|'paid subscription'} ProductType */

/** 
 * @typedef {Object} PricingPhase
 * @property {number} priceMicros - Price in micros (1/1,000,000 of the currency unit)
 * @property {string} currency - Currency code (e.g., 'usd', 'eur')
 * @property {string} billingPeriod - ISO 8601 duration (e.g., 'P1M' for 1 month)
 * @property {'INFINITE_RECURRING'|'NON_RECURRING'|'FINITE_RECURRING'} recurrenceMode - How the subscription recurs
 * @property {'PayAsYouGo'|'PayUpFront'} paymentMode - Payment mode
 */

/**
 * @typedef {Object} Offer
 * @property {string} id - Offer identifier
 * @property {string} platform - Platform identifier (e.g., 'stripe', 'google', 'apple')
 * @property {'Subscription'|'Default'} offerType - Type of the offer
 * @property {PricingPhase[]} pricingPhases - Array of pricing phases
 */

/**
 * @typedef {Object} Product
 * @property {ProductType} type - Type of the product
 * @property {string} id - Product identifier
 * @property {string} title - Product title/name
 * @property {string} [description] - Optional product description
 * @property {Offer[]} offers - Array of offers for this product
 * @property {Object} [metadata] - Optional metadata object
 * @property {string} [platform] - Platform identifier (stripe)
 */

/**
 * @typedef {Object} ProductsResponse
 * @property {boolean} ok - Success indicator
 * @property {Product[]} products - Array of products
 */

/**
 * @typedef {Object} CheckoutResponse
 * @property {boolean} ok - Success indicator
 * @property {string} sessionId - Stripe checkout session ID
 * @property {string} url - Stripe checkout URL
 * @property {string} accessKey - Access key for future API calls
 */

/**
 * @typedef {'Renew'|'Cancel'} RenewalIntent
 */

/**
 * @typedef {Object} Purchase
 * @property {string} purchaseId - Purchase identifier (format: "stripe:sub_xyz")
 * @property {string} transactionId - Transaction identifier (format: "stripe:ch_xyz")
 * @property {string} productId - Product identifier (format: "stripe:prod_xyz")
 * @property {'stripe'} platform - Platform identifier
 * @property {string} purchaseDate - ISO 8601 date of initial purchase
 * @property {string} lastRenewalDate - ISO 8601 date of last renewal
 * @property {string} expirationDate - ISO 8601 date of expiration
 * @property {RenewalIntent} renewalIntent - Whether subscription will renew
 * @property {boolean} isTrialPeriod - Whether this is a trial period
 * @property {number} amountMicros - Price in micros (1/1,000,000 of the currency unit)
 * @property {string} currency - Currency code (e.g., 'USD')
 */

/**
 * @typedef {Object} NewAccessKeys
 * @property {string} [key: string] - New access key for the subscription
 */

/**
 * @typedef {Object} PurchasesResponse
 * @property {boolean} ok - Success indicator
 * @property {Purchase[]} purchases - Array of purchase details
 * @property {NewAccessKeys} [new_access_keys] - Map of new access keys by subscription ID
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {number} status - HTTP status code
 * @property {number} code - Error code
 * @property {string} message - Error message
 */

/**
 * @typedef {Object} ChangePlanResponse
 * @property {boolean} ok - Success indicator
 * @property {Purchase} purchase - Updated purchase details
 * @property {NewAccessKeys} [new_access_keys] - Map of new access keys by subscription ID
 */

/**
 * @typedef {Object} CachedProducts
 * @property {Product[]} products - Array of products
 * @property {number} fetchedAt - Timestamp when products were fetched
 */

/**
 * @typedef {Object} ScheduledRefresh
 * @property {string} id - Unique identifier for this refresh
 * @property {string} subscriptionId - ID of the subscription to refresh
 * @property {number} scheduledAt - Timestamp when refresh should occur
 * @property {boolean} completed - Whether the refresh has been performed
 * @property {boolean} inProgress - Whether a refresh is currently in progress
 * @property {string} reason - Why this refresh was scheduled
 */

/**
 * IapticStripe class handles subscription management using Iaptic's subscription management service.
 */
class IapticStripe {
  /** @type {string} Version number of the IapticStripe class */
  static VERSION = '1.0.0';

  /**
   * @param {Object} config - Configuration object
   * @param {string} config.stripePublicKey - Stripe public key
   * @param {string} config.appName - Iaptic app name
   * @param {string} config.apiKey - Iaptic Public API key
   * @param {string} config.customIapticUrl - Custom Iaptic API URL (optional)
   */
  constructor(config) {
    if (!config.stripePublicKey) {
      throw new Error('Missing required Stripe public key');
    }
    if (!config.appName || !config.apiKey) {
      throw new Error('Missing required Iaptic configuration');
    }
    
    this.stripe = Stripe(config.stripePublicKey);
    this.iapticUrl = config.customIapticUrl || 'https://validator.iaptic.com';
    if (this.iapticUrl.endsWith('/')) {
      this.iapticUrl = this.iapticUrl.slice(0, -1);
    }
    this.appName = config.appName;
    this.apiKey = config.apiKey;
    this.refreshScheduler = new IapticStripe.RefreshScheduler(this);
  }

  /**
   * Generate iaptic's authorization header
   * @private
   */
  authorizationHeader() {
    return `Basic ${IapticStripe.Utils.base64Encode(`${this.appName}:${this.apiKey}`)}`;
  }

  /**
   * Get cached products from localStorage
   * @private
   * @returns {CachedProducts|null}
   */
  _getCachedProducts() {
    return IapticStripe.Utils.storageGet('iaptic_products');
  }

  /**
   * Store products in localStorage cache
   * @private
   * @param {Product[]} products
   */
  _setCachedProducts(products) {
    IapticStripe.Utils.storageSet('iaptic_products', {
      products,
      fetchedAt: Date.now()
    });
  }

  /**
   * Get cached products or fetch them if not available
   * @returns {Promise<Product[]>} List of products and prices
   */
  async getProducts() {
    const cached = this._getCachedProducts();
    if (cached?.products) {
      return cached.products;
    }
    return this.refreshProducts();
  }

  /**
   * Fetches available products with price and updates cache.
   * 
   * @returns {Promise<Product[]>} List of products and prices
   */
  async refreshProducts() {
    // Check if we have recent cached data (less than 1 minute old)
    const cached = this._getCachedProducts();
    if (cached?.products && cached.fetchedAt > Date.now() - 60000) {
      return cached.products;
    }

    try {
      const response = await fetch(`${this.iapticUrl}/v3/stripe/prices`, {
        headers: {
          'Authorization': this.authorizationHeader()
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch prices from Iaptic');
      }
      
      /** @type {ProductsResponse} */
      const data = await response.json();
      if (!data.ok || !data.products) {
        throw new Error('Invalid response from Iaptic');
      }

      // Update cache
      this._setCachedProducts(data.products);
      return data.products;
    } catch (error) {
      console.error('Error fetching prices:', error);
      throw error;
    }
  }

  /**
   * Store an access key for a given ID (session or subscription)
   * @private
   * @param {string} id - Session ID or subscription ID
   * @param {string} accessKey - Access key to store
   */
  _storeAccessKey(id, accessKey) {
    try {
      if (id.startsWith('sub_')) {
        this._setSubscriptionId(id);
      }
      const storedKeys = this._getStoredAccessKeys();
      storedKeys[id] = accessKey;
      localStorage.setItem('iaptic_access_keys', JSON.stringify(storedKeys));
    } catch (error) {
      console.error('Error storing access key:', error);
    }
  }

  /**
   * Get stored access keys
   * @private
   * @returns {Object.<string, string>} Map of IDs to access keys
   */
  _getStoredAccessKeys() {
    try {
      const stored = localStorage.getItem('iaptic_access_keys');
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('Error reading stored access keys:', error);
      return {};
    }
  }

  /**
   * Get access key for a specific ID
   * @param {string} id - Session ID or subscription ID
   * @returns {string|null} Access key if found, null otherwise
   */
  getAccessKey(id) {
    if (!id) {
      id = this.getSubscriptionId() || this.getSessionId();
    }
    if (!id) return null;
    const keys = this._getStoredAccessKeys();
    // fallback to the session key as, initially, the subscription will have the same access key as the session
    return keys[id] || keys[this.getSessionId()] || null;
  }

  /**
   * Clear all stored data
   */
  clearStoredData() {
    localStorage.removeItem('iaptic_access_keys');
    localStorage.removeItem('iaptic_session_id');
    localStorage.removeItem('iaptic_subscription_id');
    localStorage.removeItem('iaptic_products'); // Add products cache clearing
    this.refreshScheduler.clearSchedules();
  }

  /**
   * Creates a checkout session.
   * 
   * @param {Object} params - Checkout parameters
   * @param {string} params.offerId - Stripe price ID
   * @param {string} params.applicationUsername - User identifier
   * @param {string} params.successUrl - URL to redirect on success
   * @param {string} params.cancelUrl - URL to redirect on cancel
   * @returns {Promise<void>}
   */
  async initCheckoutSession({
    offerId,
    applicationUsername,
    successUrl,
    cancelUrl
  }) {
    try {
      const response = await fetch(
        `${this.iapticUrl}/v3/stripe/checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.authorizationHeader()
          },
          body: JSON.stringify({
            offerId,
            applicationUsername,
            successUrl,
            cancelUrl
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }

      /** @type {CheckoutResponse} */
      const data = await response.json();
      if (!data.ok || !data.url) {
        throw new Error('Invalid checkout session response');
      }

      // Store both accessKey and sessionId
      if (data.sessionId) {
        this._setSessionId(data.sessionId);
        if (data.accessKey) {
          this._storeAccessKey(data.sessionId, data.accessKey);
        }
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      throw error;
    }
  }

  /**
   * Set the session ID
   * @param {string} id - The session ID to set
   */
  _setSessionId(id) {
    localStorage.setItem('iaptic_session_id', id);
  }

  /**
   * Get the stored session ID
   * @returns {string|null} The stored session ID or null if not found
   */
  getSessionId() {
    return localStorage.getItem('iaptic_session_id');
  }

  /**
   * Get the active subscription ID
   * @returns {string|null} The active subscription ID or null if not found
   */
  getSubscriptionId() {
    return localStorage.getItem('iaptic_subscription_id');
  }

  /**
   * Set the active subscription ID
   * @param {string} id - The subscription ID to set
   */
  _setSubscriptionId(id) {
    localStorage.setItem('iaptic_subscription_id', id);
  }

  /**
   * Get purchases status for a checkout session or subscription
   * 
   * A purchase can be a subscription or a one-time purchase. In case of a subscription, the response will include the current status of the subscription.
   * 
   * @param {string} id - Stripe subscription ID (sub_) or checkout session ID (cs_) (optional, default to the last checkout session if it was initiated on the same device)
   * @param {string} accessKey - Access key or API key (optional, default to the last access key if it was initiated on the same device)
   * 
   * @returns {Promise<Purchase[]>} Purchases status and details
   * @throws {Error} If id or accessKey is missing, or if the request fails
   */
  async getPurchases(id, accessKey) {
    if (!id) {
      id = this.getSubscriptionId() || this.getSessionId();
    }
    if (!accessKey) {
      accessKey = this.getAccessKey(id);
    }

    if (!id) {
      return [];
    }
    if (!accessKey) {
      throw new Error(`No access key available for this ID (${id})`);
    }

    try {
      const response = await fetch(
        IapticStripe.Utils.buildUrl(
          `${this.iapticUrl}/v3/stripe/purchases/${id}`,
          { access_key: accessKey }
        ),
        {
          headers: {
            'Authorization': this.authorizationHeader()
          }
        }
      );

      if (!response.ok) {
        /** @type {ErrorResponse} */
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch subscription status');
      }

      /** @type {PurchasesResponse} */
      const data = await response.json();
      if (!data.ok) {
        throw new Error('Invalid subscription status response');
      }

      // Schedule refreshes for each purchase
      data.purchases.forEach(purchase => {
        this.refreshScheduler.schedulePurchaseRefreshes(purchase);
      });

      // Store new access keys if provided
      if (data.new_access_keys) {
        Object.entries(data.new_access_keys).forEach(([subId, newKey]) => {
          this._storeAccessKey(subId, newKey);
        });
      }

      return data.purchases;
    } catch (error) {
      console.error('Error fetching subscription status:', error);
      throw error;
    }
  }

  /**
   * Redirects to Stripe Customer Portal for subscription management
   * @param {Object} params - Portal parameters
   * @param {string} params.returnUrl - URL to return to after managing subscription
   * @param {string} [params.id] - Session ID or subscription ID (optional, default to the last session/subscription ID)
   * @param {string} [params.accessKey] - Access key (optional, default to the stored access key for the ID)
   * @returns {Promise<void>}
   */
  async redirectToCustomerPortal({ returnUrl, id, accessKey }) {
    if (!id) {
      id = this.getSubscriptionId() || this.getSessionId();
    }
    if (!accessKey) {
      accessKey = this.getAccessKey(id);
    }

    if (!id) {
      throw new Error('No session ID available');
    }
    if (!accessKey) {
      throw new Error('No access key available');
    }

    try {
      const response = await fetch(
        `${this.iapticUrl}/v3/stripe/portal`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.authorizationHeader()
          },
          body: JSON.stringify({ 
            returnUrl,
            id,
            access_key: accessKey
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create portal session');
      }

      const data = await response.json();
      if (!data.ok || !data.url) {
        throw new Error('Invalid portal session response');
      }

      // Redirect to the customer portal
      window.location.href = data.url;
    } catch (error) {
      console.error('Error redirecting to customer portal:', error);
      throw error;
    }
  }

  /**
   * Changes the subscription plan
   * @param {Object} params - Change plan parameters
   * @param {string} params.offerId - Iaptic offer ID (e.g. "stripe:prod_xyz#price_xyz")
   * @param {string} [params.id] - Subscription ID (optional)
   * @param {string} [params.accessKey] - Access key (optional)
   * @returns {Promise<Purchase>} Updated purchase details
   */
  async changePlan({ offerId, id, accessKey }) {
    if (!id) {
      id = this.getSubscriptionId() || this.getSessionId();
    }
    if (!accessKey) {
      accessKey = this.getAccessKey(id);
    }

    if (!id) {
      throw new Error('No session ID available');
    }
    if (!accessKey) {
      throw new Error('No access key available');
    }

    try {
      const response = await fetch(
        `${this.iapticUrl}/v3/stripe/change-plan`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.authorizationHeader()
          },
          body: JSON.stringify({ 
            id,
            offerId,
            access_key: accessKey
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to change plan');
      }

      /** @type {ChangePlanResponse} */
      const data = await response.json();
      if (!data.ok || !data.purchase) {
        throw new Error('Invalid change plan response');
      }

      // Store any new access keys
      if (data.new_access_keys) {
        Object.entries(data.new_access_keys).forEach(([subId, newKey]) => {
          this._storeAccessKey(subId, newKey);
        });
      }

      // Schedule refreshes for the updated purchase
      this.refreshScheduler.schedulePurchaseRefreshes(data.purchase);

      // Also schedule an immediate refresh to catch any quick changes
      this.refreshScheduler.scheduleRefresh(
        data.purchase.purchaseId,
        new Date(Date.now() + 10000), // 10 seconds from now
        'post-change-verification'
      );

      return data.purchase;
    } catch (error) {
      console.error('Error changing plan:', error);
      throw error;
    }
  }

  /**
   * Format a price amount from micros
   * @param {number} amountMicros - Price in micros (1/1,000,000 of the currency unit)
   * @param {string} currency - Currency code (e.g., 'USD', 'EUR')
   * @returns {string} Formatted price with currency symbol
   */
  formatCurrency(amountMicros, currency) {
    if (typeof amountMicros !== 'number' || typeof currency !== 'string') {
      return '';
    }
    currency = currency.toUpperCase();

    try {
      const amount = amountMicros / 1000000;
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency
      }).format(amount).replace('.00', '');
    } catch (error) {
      // Fallback formatting for common currencies
      const amount = amountMicros / 1000000;
      
      // Common currency symbols and their position
      const currencyFormats = {
        USD: { symbol: '$', position: 'before' },
        EUR: { symbol: '€', position: 'before' },
        GBP: { symbol: '£', position: 'before' },
        JPY: { symbol: '¥', position: 'before' },
        CNY: { symbol: '¥', position: 'before' },
        KRW: { symbol: '₩', position: 'before' },
        INR: { symbol: '₹', position: 'before' },
        RUB: { symbol: '₽', position: 'after' },
        BRL: { symbol: 'R$', position: 'before' },
        CHF: { symbol: 'CHF', position: 'before' },
        CAD: { symbol: 'CA$', position: 'before' },
        AUD: { symbol: 'A$', position: 'before' },
        NZD: { symbol: 'NZ$', position: 'before' },
        HKD: { symbol: 'HK$', position: 'before' },
        SGD: { symbol: 'S$', position: 'before' },
        SEK: { symbol: 'kr', position: 'after' },
        NOK: { symbol: 'kr', position: 'after' },
        DKK: { symbol: 'kr', position: 'after' },
        PLN: { symbol: 'zł', position: 'after' }
      };

      const format = currencyFormats[currency];
      if (format) {
        // Let toLocaleString handle the decimals
        const formattedAmount = amount.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2
        });
        return (format.position === 'before' 
          ? `${format.symbol}${formattedAmount}`
          : `${formattedAmount} ${format.symbol}`).replace('.00', '');
      }

      // Default fallback for unknown currencies
      return `${currency} ${amount.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      })}`.replace('.00', '');
    }
  }

  /**
   * Format a billing period from ISO 8601 duration in plain english
   * @param {string} period - ISO 8601 duration (e.g., "P1M", "P1Y")
   * @returns {string} Human readable billing period (e.g., "Every 1 month", "Yearly")
   */
  formatBillingPeriodEN(period) {
    if (!period) return '';
    const match = period.match(/P(\d+)([YMWD])/);
    if (!match) return period;
    const [_, count, unit] = match;
    const displayCount = count === '1' ? '' : ' ' + count;
    switch (unit) {
      case 'Y': return count === '1' ? 'Yearly' : `Every${displayCount} years`;
      case 'M': return count === '1' ? 'Monthly' : `Every${displayCount} months`;
      case 'W': return count === '1' ? 'Weekly' : `Every${displayCount} weeks`;
      case 'D': return count === '1' ? 'Daily' : `Every${displayCount} days`;
      default: return period;
    }
  }

  /**
   * Returns a debug dump of the internal state
   * @returns {string} Formatted debug information
   */
  debugDump() {
    const dump = {
      version: IapticStripe.VERSION,
      config: {
        iapticUrl: this.iapticUrl,
        appName: this.appName,
        apiKey: this.apiKey, // this is iaptic the public (sharable) API key
      },
      storage: {
        sessionId: this.getSessionId(),
        subscriptionId: this.getSubscriptionId(),
        accessKeys: this._getStoredAccessKeys(),
        cachedProducts: this._getCachedProducts(),
      },
      refreshScheduler: {
        schedules: this.refreshScheduler.schedules.map(schedule => ({
          ...schedule,
          // Convert timestamp to readable date
          scheduledAt: new Date(schedule.scheduledAt).toISOString(),
        })),
      }
    };

    return JSON.stringify(dump, null, 2);
  }
}

/**
 * Helper class to manage subscription refresh schedules
 */
IapticStripe.RefreshScheduler = class {
    constructor(iapticStripe) {
        /** @type {ScheduledRefresh[]} */
        this.schedules = [];
        this.iapticStripe = iapticStripe;
    }

    /**
     * Set timeout for a specific schedule
     * @private
     */
    setTimeout(schedule) {
        const delay = schedule.scheduledAt - Date.now();
        if (delay <= 0) return;

        setTimeout(async () => {
            if (schedule.completed) return;
            
            // Check if there's already a refresh in progress for this subscription
            const inProgressRefresh = this.schedules.find(s => 
                s.subscriptionId === schedule.subscriptionId && s.inProgress
            );
            if (inProgressRefresh) {
                console.log(`Skipping refresh for ${schedule.subscriptionId} (${schedule.reason}): another refresh in progress`);
                return;
            }

            try {
                schedule.inProgress = true;
                await this.iapticStripe.getPurchases(schedule.subscriptionId);
                schedule.completed = true;
            } catch (error) {
                console.error('Error refreshing subscription:', error);
                
                // Schedule a retry if this wasn't already a retry attempt
                if (!schedule.reason.startsWith('retry-')) {
                    const retryDate = new Date(Date.now() + 30000); // 30 seconds later
                    this.scheduleRefresh(
                        schedule.subscriptionId,
                        retryDate,
                        `retry-${schedule.reason}`
                    );
                }
            } finally {
                schedule.inProgress = false;
            }
        }, delay);
    }

    /**
     * Schedule a refresh for a subscription
     * @param {string} subscriptionId - Subscription to refresh
     * @param {Date} date - When to refresh
     * @param {string} reason - Why this refresh is scheduled
     */
    scheduleRefresh(subscriptionId, date, reason) {
        const schedule = {
            id: `${subscriptionId}-${date.getTime()}`,
            subscriptionId,
            scheduledAt: date.getTime(),
            completed: false,
            inProgress: false,
            reason
        };

        // Don't schedule if we already have one for this subscription at this time
        if (this.schedules.some(s => s.id === schedule.id)) {
            return;
        }

        this.schedules.push(schedule);
        this.setTimeout(schedule);
    }

    /**
     * Schedule refreshes based on a purchase's important dates
     * @param {Purchase} purchase
     */
    schedulePurchaseRefreshes(purchase) {
        const expirationDate = new Date(purchase.expirationDate);
        
        // 10 seconds before expiration
        const beforeExpiration = new Date(expirationDate.getTime() - 10000);
        // 10 seconds after expiration
        const afterExpiration = new Date(expirationDate.getTime() + 10000);

        const dates = [
            { date: beforeExpiration, reason: 'pre-expiration' },
            { date: afterExpiration, reason: 'post-expiration' }
        ];

        // Schedule all dates that are in the future
        dates.forEach(({ date, reason }) => {
            if (date.getTime() > Date.now()) {
                this.scheduleRefresh(purchase.purchaseId, date, reason);
            }
        });
    }

    /**
     * Clear all schedules
     */
    clearSchedules() {
        this.schedules = [];
    }
}

/**
 * Browser compatibility helper functions
 * @private
 */
IapticStripe.Utils = class {
    /**
     * Base64 encode a string (btoa alternative)
     * @param {string} str - String to encode
     * @returns {string} Base64 encoded string
     */
    static base64Encode(str) {
        try {
            return btoa(str);
        } catch (e) {
            // Fallback for older browsers or non-ASCII characters
            const bytes = new TextEncoder().encode(str);
            const binString = Array.from(bytes, (x) => String.fromCodePoint(x)).join('');
            return btoa(binString);
        }
    }

    /**
     * Format a date to ISO string with timezone (for older browsers)
     * @param {Date} date - Date to format
     * @returns {string} ISO formatted date string
     */
    static toISOString(date) {
        try {
            return date.toISOString();
        } catch (e) {
            const pad = (num) => String(num).padStart(2, '0');
            return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${String(date.getUTCMilliseconds()).padStart(3, '0')}Z`;
        }
    }

    /**
     * Parse a JSON string safely
     * @param {string} str - JSON string to parse
     * @param {any} defaultValue - Default value if parsing fails
     * @returns {any} Parsed object or default value
     */
    static safeJSONParse(str, defaultValue = null) {
        try {
            return JSON.parse(str);
        } catch (e) {
            return defaultValue;
        }
    }

    /**
     * Stringify an object safely
     * @param {any} obj - Object to stringify
     * @param {string} defaultValue - Default value if stringification fails
     * @returns {string} JSON string
     */
    static safeJSONStringify(obj, defaultValue = '{}') {
        try {
            return JSON.stringify(obj);
        } catch (e) {
            return defaultValue;
        }
    }

    /**
     * Safe localStorage getter
     * @param {string} key - Key to get
     * @param {any} defaultValue - Default value if not found or error
     * @returns {any} Stored value or default
     */
    static storageGet(key, defaultValue = null) {
        try {
            const value = localStorage.getItem(key);
            return value ? this.safeJSONParse(value, defaultValue) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    }

    /**
     * Safe localStorage setter
     * @param {string} key - Key to set
     * @param {any} value - Value to store
     * @returns {boolean} Success status
     */
    static storageSet(key, value) {
        try {
            localStorage.setItem(key, this.safeJSONStringify(value));
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Create a URL with query parameters
     * @param {string} baseUrl - Base URL
     * @param {Object} params - Query parameters
     * @returns {string} Full URL with encoded parameters
     */
    static buildUrl(baseUrl, params) {
        try {
            const url = new URL(baseUrl);
            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    url.searchParams.append(key, value);
                }
            });
            return url.toString();
        } catch (e) {
            // Fallback for older browsers
            const query = Object.entries(params)
                .filter(([_, value]) => value !== undefined && value !== null)
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                .join('&');
            return query ? `${baseUrl}?${query}` : baseUrl;
        }
    }
}
