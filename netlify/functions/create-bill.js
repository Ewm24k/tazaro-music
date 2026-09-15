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

        // ToyyibPay strictly requires amount in CENTS (Sen): RM 5.00 -> 500, RM 10.00 -> 1000
        const amountInCents = Math.round(parseFloat(amountRM) * 100);

        // Strict 30-character limit on billName (ToyyibPay constraint)
        const safeTitle = (title || 'Music Sheet').replace(/[^a-zA-Z0-9 ]/g, '').trim();
        const billName = `TAZ ${safeTitle}`.substring(0, 30);

        // Detect current site URL dynamically
        const host = event.headers.host;
        const protocol = event.headers['x-forwarded-proto'] || 'https';
        const siteUrl = `${protocol}://${host}`;

        const returnUrl = `${siteUrl}/success.html?song=${encodeURIComponent(songSlug)}&edition=${encodeURIComponent(bundleType)}`;
        const callbackUrl = `${siteUrl}/.netlify/functions/toyyibpay-callback`;
        const orderRef = `TAZ-${Date.now().toString().slice(-8)}`;

        // Prepare standard URL-encoded form body
        const payload = new URLSearchParams();
        payload.append('userSecretKey', secretKey.trim());
        payload.append('categoryCode', categoryCode.trim());
        payload.append('billName', billName);
        payload.append('billDescription', `${bundleType.toUpperCase()} Edition (PDF, MXL, MID)`.substring(0, 100));
        payload.append('billPriceSetting', '1'); // 1 = Fixed amount
        payload.append('billPayorInfo', '1');    // 1 = Allow customer to enter/edit their real details on checkout
        payload.append('billAmount', amountInCents.toString());
        payload.append('billReturnUrl', returnUrl);
        payload.append('billCallbackUrl', callbackUrl);
        payload.append('billExternalReferenceNo', orderRef);

        // MANDATORY FIELDS FOR TOYYIBPAY (Defaults provided, user can edit on FPX gateway screen)
        payload.append('billTo', 'Valued Customer');
        payload.append('billEmail', 'customer@tazaro.com');
        payload.append('billPhone', '0123456789');

        const response = await fetch('https://toyyibpay.com/index.php/api/createBill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload.toString()
        });

        const rawText = await response.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'ToyyibPay returned non-JSON response', raw: rawText })
            };
        }

        // ToyyibPay returns an array on success: [{"BillCode": "abcdef12"}]
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
            // Extracts exact ToyyibPay error message (e.g. invalid category, invalid secret key, etc.)
            const errorMessage = (Array.isArray(data) && data[0]?.msg) || JSON.stringify(data);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: `ToyyibPay Error: ${errorMessage}`, rawData: data })
            };
        }

    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
};
