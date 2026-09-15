const Stripe = require('stripe');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    try {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        if (!secretKey) {
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'STRIPE_SECRET_KEY is missing in Netlify Environment Variables.' })
            };
        }

        const stripe = new Stripe(secretKey);
        const { songSlug, title, bundleType, amountRM, payerName, payerEmail, payerPhone } = JSON.parse(event.body);

        // Convert RM to sen (e.g. RM 5.00 -> 500 sen, RM 10.00 -> 1000 sen)
        const unitAmountInSen = Math.round(parseFloat(amountRM) * 100);

        // Dynamically detect site URL
        const host = event.headers.host;
        const protocol = event.headers['x-forwarded-proto'] || 'https';
        const siteUrl = `${protocol}://${host}`;

        const editionLabel = bundleType === 'both' 
            ? 'Complete Bundle (Piano + Guitar)' 
            : `${bundleType.charAt(0).toUpperCase() + bundleType.slice(1)} Edition`;

        // Create Stripe Checkout Session
        // By omitting automatic_payment_methods, Stripe automatically pulls
        // enabled methods (Cards, Apple Pay, Google Pay, GrabPay) directly from your Dashboard settings.
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            customer_email: payerEmail,
            line_items: [
                {
                    price_data: {
                        currency: 'myr',
                        product_data: {
                            name: `Tazaro: ${title}`,
                            description: `${editionLabel} • Print-Ready PDF, Universal MusicXML & Master Timeline`,
                        },
                        unit_amount: unitAmountInSen,
                    },
                    quantity: 1,
                }
            ],
            success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&song=${encodeURIComponent(songSlug)}&edition=${encodeURIComponent(bundleType)}`,
            cancel_url: `${siteUrl}/`,
            metadata: {
                songSlug,
                bundleType,
                payerName: payerName || '',
                payerPhone: payerPhone || ''
            }
        });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkoutUrl: session.url })
        };

    } catch (err) {
        console.error('[Stripe Session Error]:', err);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: err.message })
        };
    }
};
