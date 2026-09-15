exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { songSlug, title, bundleType, amountRM } = JSON.parse(event.body);
        
        const secretKey = process.env.TOYYIBPAY_SECRET_KEY;
        const categoryCode = process.env.TOYYIBPAY_CATEGORY_CODE || 'da5q4x1n';

        if (!secretKey) {
            return {
                statusCode: 500,
                body: JSON.stringify({ 
                    error: 'TOYYIBPAY_SECRET_KEY is missing in Netlify Environment Variables.' 
                })
            };
        }

        // ToyyibPay requires amount in CENTS (Sen): RM 5.00 -> 500, RM 10.00 -> 1000
        const amountInCents = Math.round(parseFloat(amountRM) * 100);

        // Detect current site URL dynamically
        const host = event.headers.host;
        const protocol = event.headers['x-forwarded-proto'] || 'https';
        const siteUrl = `${protocol}://${host}`;

        const returnUrl = `${siteUrl}/success.html?song=${encodeURIComponent(songSlug)}&edition=${encodeURIComponent(bundleType)}`;
        const callbackUrl = `${siteUrl}/.netlify/functions/toyyibpay-callback`;
        const orderRef = `TAZ-${songSlug}-${bundleType}-${Date.now()}`;

        // Prepare standard URL-encoded form body for ToyyibPay API
        const payload = new URLSearchParams();
        payload.append('userSecretKey', secretKey);
        payload.append('categoryCode', categoryCode);
        payload.append('billName', `Tazaro: ${title.substring(0, 30)}`);
        payload.append('billDescription', `${bundleType.toUpperCase()} Edition (PDF, MXL, MID)`);
        payload.append('billPriceSetting', '1');
        payload.append('billPayorInfo', '0'); // 0 = ToyyibPay collects payer details on their payment gateway
        payload.append('billAmount', amountInCents.toString());
        payload.append('billReturnUrl', returnUrl);
        payload.append('billCallbackUrl', callbackUrl);
        payload.append('billExternalReferenceNo', orderRef);

        const response = await fetch('https://toyyibpay.com/index.php/api/createBill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload.toString()
        });

        const data = await response.json();

        // ToyyibPay returns: [{"BillCode": "abcdef12"}]
        if (Array.isArray(data) && data[0] && data[0].BillCode) {
            const billCode = data[0].BillCode;
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    billCode: billCode,
                    paymentUrl: `https://toyyibpay.com/${billCode}`
                })
            };
        } else {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'ToyyibPay rejected bill creation', details: data })
            };
        }

    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
};
