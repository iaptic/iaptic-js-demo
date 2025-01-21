// Direct Stripe usage example (without Iaptic)
const iaptic = IapticJS.createAdapter(window.IAPTIC_STRIPE_CREDENTIALS);

function showMessage(type) {
    const container = document.getElementById('message-container');
    if (type === 'success') {
        container.innerHTML = `
            <div class="alert alert-success" role="alert">
                <h4 class="alert-title">Payment successful</h4>
                <div class="text-muted">
                    Thank you for your subscription!
                </div>
            </div>
        `;
    } else if (type === 'cancel') {
        container.innerHTML = `
            <div class="alert alert-warning" role="alert">
                <h4 class="alert-title">Payment canceled</h4>
                <div class="text-muted">The payment process was canceled.</div>
            </div>
        `;
    } else if (type === 'success-plan-change') {
        container.innerHTML = `
            <div class="alert alert-success" role="alert">
                <h4 class="alert-title">Plan changed successfully</h4>
                <div class="text-muted">
                    Your subscription has been updated to the new plan.
                </div>
            </div>
        `;
    } else if (type === 'error-plan-change') {
        container.innerHTML = `
            <div class="alert alert-danger" role="alert">
                <h4 class="alert-title">Failed to change plan</h4>
                <div class="text-muted">
                    There was an error updating your subscription. Please try again or contact support.
                </div>
            </div>
        `;
    }
    container.scrollIntoView({ behavior: 'smooth' });
}

function displaySubscriptionDetails(products, purchases) {
    const container = document.getElementById('subscription-container');
    if (!container) return;

    if (purchases && purchases.length > 0) {
        const subscriptions = purchases.filter(p => p.renewalIntent && p.expirationDate);
        const purchase = subscriptions.find(p => !p.cancelationReason) || subscriptions[0];
        const startDate = new Date(purchase.purchaseDate).toLocaleDateString();
        const lastRenewal = new Date(purchase.lastRenewalDate).toLocaleDateString();
        const nextRenewal = new Date(purchase.expirationDate).toLocaleDateString();
        
        // Find the corresponding product
        const productId = purchase.productId.replace('stripe:', '');
        const product = products?.find(p => p.id === productId);
        const offer = product?.offers.find(o => o.id === purchase.offerId);
        
        container.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Current Subscription</h3>
                </div>
                <div class="card-body">
                    <table class="table table-sm">
                        <tr>
                            <td class="text-muted">Plan:</td>
                            <td>${product?.title || 'Subscription'}</td>
                        </tr>
                        ${product?.description ? `
                        <tr>
                            <td class="text-muted">Description:</td>
                            <td>${product.description}</td>
                        </tr>
                        ` : ''}
                        <tr>
                            <td class="text-muted">Amount:</td>
                            <td>${IapticJS.Utils.formatCurrency(purchase.amountMicros, purchase.currency)}</td>
                        </tr>
                        <tr>
                            <td class="text-muted">Billing Period:</td>
                            <td>${offer && product.type === 'paid subscription' ? IapticJS.Utils.formatBillingPeriodEN(offer.pricingPhases.slice(-1)[0].billingPeriod) : 'Recurring'}</td>
                        </tr>
                        <tr>
                            <td class="text-muted">Status:</td>
                            <td>
                                ${purchase.cancelationReason
                                    ? '<span class="badge bg-danger-lt">Cancelled</span>'
                                    : purchase.renewalIntent === 'Renew'
                                        ? '<span class="badge bg-success-lt">Active</span>'
                                        : '<span class="badge bg-warning-lt">Canceling</span>'
                                }
                            </td>
                        </tr>
                        <tr>
                            <td class="text-muted">Start Date:</td>
                            <td>${startDate}</td>
                        </tr>
                        <tr>
                            <td class="text-muted">Last Renewal:</td>
                            <td>${lastRenewal}</td>
                        </tr>
                        <tr>
                            <td class="text-muted">Next Renewal:</td>
                            <td>${nextRenewal}</td>
                        </tr>
                        ${purchase.isTrialPeriod ? `
                        <tr>
                            <td class="text-muted">Trial Period:</td>
                            <td><span class="badge bg-info-lt">Yes</span></td>
                        </tr>
                        ` : ''}
                    </table>
                    <div class="mt-4">
                        <h4>Change Plan</h4>
                        <div class="row g-3">
                            ${products
                                ?.filter(product => {
                                    // Only keep subscription products
                                    if (product.type !== 'paid subscription') return false;
                                    // Only keep products with matching currency offers
                                    const hasMatchingOffers = product.offers.some(offer => 
                                        offer.pricingPhases.slice(-1)[0].currency.toLowerCase() === purchase.currency.toLowerCase()
                                    );
                                    // Keep if it's purchasable or if it's the current plan
                                    return (hasMatchingOffers && product.metadata?.canPurchase !== 'false') || 
                                           product.id === productId;
                                })
                                // Sort by monthly USD price
                                .sort((a, b) => {
                                    const getMonthlyPrice = (product) => {
                                        const monthlyOffer = product.offers.find(o => 
                                            o.pricingPhases.slice(-1)[0].currency.toLowerCase() === 'usd' &&
                                            o.pricingPhases.slice(-1)[0].billingPeriod.includes('M')
                                        );
                                        return monthlyOffer ? monthlyOffer.pricingPhases.slice(-1)[0].priceMicros : 0;
                                    };
                                    return getMonthlyPrice(a) - getMonthlyPrice(b);
                                })
                                .map(product => {
                                    const isCurrentPlan = product.id === productId;
                                    const matchingOffers = product.offers.filter(offer => 
                                        offer.pricingPhases.slice(-1)[0].currency.toLowerCase() === purchase.currency.toLowerCase()
                                    );
                                    
                                    if (matchingOffers.length === 0) return '';
                                    
                                    const hasCurrentOffer = matchingOffers.some(o => o.id === purchase.offerId);
                                    
                                    // Sort offers by billing period (monthly first)
                                    const sortedOffers = matchingOffers.sort((a, b) => {
                                        const aIsMonthly = a.pricingPhases.slice(-1)[0].billingPeriod.includes('M');
                                        const bIsMonthly = b.pricingPhases.slice(-1)[0].billingPeriod.includes('M');
                                        return aIsMonthly ? -1 : 1;
                                    });
                                    const isCurrentOfferCancelled = purchase.cancelationReason;

                                    return `
                                        <div class="col-3">
                                            <div class="card h-100 ${hasCurrentOffer ? 'bg-primary-lt' : ''}">
                                                <div class="card-body">
                                                    <div class="text-center mb-3">
                                                        <h5 class="mb-1">${product.title}</h5>
                                                        <div class="text-muted small">
                                                            ${product.description || ''}
                                                        </div>
                                                    </div>
                                                    <div class="text-center mb-3">
                                                        <div class="mb-1">
                                                            <span class="badge bg-blue-lt">
                                                                ${product.metadata?.quota || 0} requests/month
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <span class="badge bg-purple-lt">
                                                                ${getSupportLevelLabel(product.metadata?.supportLevel)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    
                                                    <div class="pricing-options">
                                                        ${sortedOffers.map(offer => {
                                                            const phase = offer.pricingPhases.slice(-1)[0];
                                                            const isCurrentOffer = offer.id === purchase.offerId;
                                                            const period = IapticJS.Utils.formatBillingPeriodEN(phase.billingPeriod).toLowerCase();
                                                            
                                                            return `
                                                                <div class="mb-2 text-center">
                                                                    <div class="h4 mb-1">
                                                                        ${IapticJS.Utils.formatCurrency(phase.priceMicros, phase.currency)}
                                                                        <small class="text-muted">/${period}</small>
                                                                    </div>
                                                                    ${isCurrentOffer 
                                                                        ? isCurrentOfferCancelled
                                                                            ? `<button class="btn btn-primary btn-sm" 
                                                                                  onclick="handlePlanChange('${offer.id}')">
                                                                               Renew 
                                                                           </button>`
                                                                            : '<span class="badge bg-primary-lt">Current Plan</span>'
                                                                        : `<button class="btn btn-primary btn-sm" 
                                                                                  onclick="handlePlanChange('${offer.id}')">
                                                                                Switch to ${period}
                                                                           </button>`
                                                                    }
                                                                </div>
                                                            `;
                                                        }).join('')}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                        </div>
                    </div>
                    <div class="mt-3">
                        <button class="btn btn-sm" 
                                data-bs-toggle="collapse" 
                                data-bs-target="#technicalDetails" 
                                aria-expanded="false">
                            <span class="text-muted">Show technical details...</span>
                        </button>
                        <div class="collapse mt-3" id="technicalDetails">
                            <div class="card card-body bg-light">
                                <table class="table table-sm">
                                    <tr>
                                        <td class="text-muted">Purchase ID:</td>
                                        <td><code>${purchase.purchaseId}</code></td>
                                    </tr>
                                    <tr>
                                        <td class="text-muted">Transaction ID:</td>
                                        <td><code>${purchase.transactionId}</code></td>
                                    </tr>
                                    <tr>
                                        <td class="text-muted">Product ID:</td>
                                        <td><code>${purchase.productId}</code></td>
                                    </tr>
                                    <tr>
                                        <td class="text-muted">Offer ID:</td>
                                        <td><code>${purchase.offerId || 'N/A'}</code></td>
                                    </tr>
                                </table>
                                <div class="mt-3">
                                    <button class="btn btn-sm" 
                                            data-bs-toggle="collapse" 
                                            data-bs-target="#rawJson" 
                                            aria-expanded="false">
                                        <span class="text-muted">Show raw JSON...</span>
                                    </button>
                                    <div class="collapse mt-2" id="rawJson">
                                        <pre class="bg-dark text-light p-3 rounded"><code>${JSON.stringify(purchase, null, 2)}</code></pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else {
        container.innerHTML = ''; // Clear the container if no subscription
    }
}

function showLoadingSpinner(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = `
        <div class="text-center p-4">
            <div class="spinner-border text-primary" role="status"></div>
            <div class="text-muted mt-2">Loading...</div>
        </div>
    `;
}

/** @returns {Purchase[]} */
async function displayPurchases() {
    const container = document.getElementById('subscription-container');
    if (!container) return [];
    
    showLoadingSpinner('subscription-container');
    
    try {
        const purchases = await iaptic.getPurchases();
        if (purchases && purchases.length > 0) {
            displaySubscriptionDetails(await iaptic.getProducts(), purchases);
        } else {
            container.innerHTML = ''; // Clear the container if no subscription
        }
        return purchases;
    } catch (error) {
        // Silently fail if no purchases found
        console.log('No active purchases found:', error);
        container.innerHeML = '';
        return [];
    }
}

async function checkUrlHash() {
    const hash = window.location.hash.substring(1);
    if (hash === 'success') {
        showMessage('success');
        history.replaceState(null, '', window.location.pathname);
    } else if (hash === 'cancel') {
        showMessage('cancel');
        history.replaceState(null, '', window.location.pathname);
    } else if (hash === 'success-plan-change') {
        showMessage('success-plan-change');
        history.replaceState(null, '', window.location.pathname);
    } else if (hash === 'cancel-plan-change') {
        showMessage('cancel-plan-change');
        history.replaceState(null, '', window.location.pathname);
    }
}

function getSupportLevelLabel(level) {
    switch (level) {
        case '0': return 'Basic Support';
        case '1': return 'Email Support';
        case '2': return 'Personalized Support';
        default: return 'Support';
    }
}

async function displayPrices(purchases) {
    const subscriptionContainer = document.getElementById('pricing-container');
    const onetimeContainer = document.getElementById('onetime-container');
    if (!subscriptionContainer || !onetimeContainer) return;
    
    showLoadingSpinner('pricing-container');
    showLoadingSpinner('onetime-container');
    
    try {
        const products = await iaptic.getProducts();
        
        // Refresh subscription details now that we have product information
        const hasActiveSubscription = purchases && purchases.length > 0;
        displaySubscriptionDetails(products, purchases);
        
        // Clear both containers
        subscriptionContainer.innerHTML = '';
        onetimeContainer.innerHTML = '';
        
        // Split products by type
        const subscriptionProducts = products.filter(p => 
            p.type === 'paid subscription' && p.metadata?.canPurchase !== 'false'
        );
        const otherProducts = products.filter(p => 
            (p.type === 'non_consumable' || p.type === 'consumable') && 
            p.metadata?.canPurchase !== 'false'
        );
        
        if (hasActiveSubscription) {
            subscriptionContainer.innerHTML = `
                <div class="text-center">
                    <button class="btn btn-primary" onclick="handleManageSubscription()">
                        Manage Subscription
                    </button>
                </div>
            `;
        } else if (subscriptionProducts.length > 0) {
            subscriptionContainer.innerHTML = `
                <h3 class="mb-3">Subscription Plans</h3>
                <div class="row w-100 g-3">
                    ${renderSubscriptionProducts(subscriptionProducts)}
                </div>
            `;
        }
        
        if (otherProducts.length > 0) {
            onetimeContainer.innerHTML = `
                <h3 class="mb-3">One-time Purchases</h3>
                <div class="row w-100 g-3">
                    ${renderOtherProducts(otherProducts)}
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading prices:', error);
    }
}

// Helper function to render subscription products
function renderSubscriptionProducts(products) {
    return products
        // Sort by monthly USD price
        .sort((a, b) => {
            const getMonthlyPrice = (product) => {
                const monthlyOffer = product.offers.find(o => 
                    o.pricingPhases.slice(-1)[0].currency.toLowerCase() === 'usd' &&
                    o.pricingPhases.slice(-1)[0].billingPeriod.includes('M')
                );
                return monthlyOffer ? monthlyOffer.pricingPhases.slice(-1)[0].priceMicros : 0;
            };
            return getMonthlyPrice(a) - getMonthlyPrice(b);
        })
        .map(product => {
            // Sort offers by billing period (monthly first)
            const sortedOffers = product.offers.sort((a, b) => {
                const aIsMonthly = a.pricingPhases.slice(-1)[0].billingPeriod.includes('M');
                const bIsMonthly = b.pricingPhases.slice(-1)[0].billingPeriod.includes('M');
                return aIsMonthly ? -1 : 1;
            });

            return `
                <div class="col-3">
                    <div class="card h-100">
                        <div class="card-body">
                            <div class="text-center mb-3">
                                <h5 class="mb-1">${product.title}</h5>
                                <div class="text-muted small">
                                    ${product.description || ''}
                                </div>
                            </div>
                            <div class="text-center mb-3">
                                ${product.metadata?.quota ? `
                                    <div class="mb-1">
                                        <span class="badge bg-blue-lt">
                                            ${product.metadata.quota} requests/month
                                        </span>
                                    </div>
                                ` : ''}
                                ${product.metadata?.supportLevel ? `
                                    <div>
                                        <span class="badge bg-purple-lt">
                                            ${getSupportLevelLabel(product.metadata.supportLevel)}
                                        </span>
                                    </div>
                                ` : ''}
                            </div>
                            
                            <div class="pricing-options">
                                ${renderSubscriptionOffers(sortedOffers)}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
}

// Helper function to render other products (non-subscription)
function renderOtherProducts(products) {
    return products.map(product => {
        const offer = product.offers[0]; // Usually only one offer for non-subscription products
        const phase = offer?.pricingPhases.slice(-1)[0];
        
        return `
            <div class="col-3">
                <div class="card h-100">
                    <div class="card-body">
                        <div class="text-center mb-3">
                            <h5 class="mb-1">${product.title}</h5>
                            <div class="text-muted small">
                                ${product.description || ''}
                            </div>
                        </div>
                        ${product.metadata?.quota ? `
                            <div class="text-center mb-3">
                                <span class="badge bg-blue-lt">
                                    ${product.metadata.quota} requests
                                </span>
                            </div>
                        ` : ''}
                        <div class="text-center">
                            <div class="h4 mb-3">
                                ${phase ? IapticJS.Utils.formatCurrency(phase.priceMicros, phase.currency) : 'Free'}
                            </div>
                            <button class="btn btn-primary" 
                                    onclick="handlePurchase('${offer?.id}')">
                                Purchase
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Helper function to render subscription offers
function renderSubscriptionOffers(offers) {
    return offers.map(offer => {
        const phase = offer.pricingPhases.slice(-1)[0];
        const period = IapticJS.Utils.formatBillingPeriodEN(phase.billingPeriod).toLowerCase();
        const isFree = phase.priceMicros === 0;
        
        return `
            <div class="mb-2 text-center">
                <div class="h4 mb-1">
                    ${IapticJS.Utils.formatCurrency(phase.priceMicros, phase.currency)}
                    <small class="text-muted">/${period}</small>
                </div>
                ${!isFree ? `
                    <button class="btn btn-primary btn-sm" 
                            onclick="handleSubscription('${offer.id}')">
                        Subscribe ${period}
                    </button>
                ` : ''}
            </div>
        `;
    }).join('');
}

// Add this new function to handle one-time purchases
async function handlePurchase(offerId) {
    try {
        await iaptic.initCheckoutSession({
            offerId,
            applicationUsername: 'user_dev',
            successUrl: returnUrl('success'),
            cancelUrl: returnUrl('cancel')
        });
    } catch (error) {
        console.error('Error creating purchase:', error);
    }
}

function returnUrl(withHash) {
    return window.location.href.split('#')[0] + '#' + withHash;
}

async function handleSubscription(offerId) {
    try {
        await iaptic.initCheckoutSession({
            offerId,
            applicationUsername: 'user_dev',
            successUrl: returnUrl('success'),
            cancelUrl: returnUrl('cancel')
        });
    } catch (error) {
        console.error('Error creating subscription:', error);
    }
}

async function handleManageSubscription() {
    try {
        await iaptic.redirectToCustomerPortal({
            returnUrl: window.location.href
        });
    } catch (error) {
        console.error('Error managing subscription:', error);
    }
}

async function handlePlanChange(newOfferId) {
    try {
        const newPurchase = await iaptic.changePlan({
            offerId: newOfferId,
        });
        
        // Update the display with the new purchase information
        displaySubscriptionDetails({
            ok: true,
            purchases: [newPurchase]
        });
        
        // Show success message
        showMessage('success-plan-change');
        
        // Refresh prices display to show updated current plan
        displayPrices([newPurchase]);
    } catch (error) {
        console.error('Error changing plan:', error);
        showMessage('error-plan-change');
    }
}

// Initialize the display when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    const purchases = await displayPurchases();
    displayPrices(purchases);
    checkUrlHash();
});

// Listen for hash changes
window.addEventListener('hashchange', checkUrlHash);


