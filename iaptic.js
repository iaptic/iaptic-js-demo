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
 * IapticStripe class handles subscription management using Iaptic's subscription management service.
 */
class IapticStripe {

  /**
   * @param {Object} config - Configuration object
   * @param {string} config.stripePublicKey - Stripe public key
   * @param {string} config.appName - Iaptic app name
   * @param {string} config.apiKey - Iaptic API key
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
  }

  /**
   * Generate iaptic's authorization header
   * @private
   */
  authorizationHeader() {
    return `Basic ${btoa(`${this.appName}:${this.apiKey}`)}`;
  }

  /**
   * Fetches available products with price.
   * 
   * @returns {Promise<Product[]>} List of products and prices
   */
  async getProducts() {
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
   * Clear all stored access keys
   */
  clearStoredData() {
    localStorage.removeItem('iaptic_access_keys');
    localStorage.removeItem('iaptic_session_id');
    localStorage.removeItem('iaptic_subscription_id');
  }

  /**
   * Creates a checkout session.
   * 
   * @param {Object} params - Checkout parameters
   * @param {string} params.offerId - Stripe price ID
   * @param {string} params.applicationUsername - User identifier
   * @param {string} params.successUrl - URL to redirect on success
   * @param {string} params.cancelUrl - URL to redirect on cancel
   * @returns {Promise<CheckoutResponse>} Checkout session response
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
        const error = await response.json();
        throw new Error(error.message || 'Failed to create checkout session');
      }
      
      /** @type {CheckoutResponse} */
      const data = await response.json();
      if (!data.ok || !data.sessionId) {
        throw new Error('Invalid checkout session response');
      }

      // Store session ID and access key
      localStorage.setItem('iaptic_session_id', data.sessionId);
      if (data.accessKey) {
        this._storeAccessKey(data.sessionId, data.accessKey);
      }
      
      return this.stripe.redirectToCheckout({ 
        sessionId: data.sessionId 
      });
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw error;
    }
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
        `${this.iapticUrl}/v3/stripe/purchases/${id}?access_key=${encodeURIComponent(accessKey)}`,
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
}
