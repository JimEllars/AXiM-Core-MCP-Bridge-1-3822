import type {Env} from '../types';

function generateRandomHex(length: number) {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export async function handleSendInvoice(args: Record<string, unknown> | undefined, env: Env) {
  if (!args || typeof args !== 'object') {
    throw new Error('Arguments missing for axim_send_invoice.');
  }

  const {
    client_name,
    client_email,
    items,
    tax_rate = 0.0,
    payment_terms = 'Net-15',
    currency = 'usd',
    company_name = 'AXiM Commercial Services',
    memo = ''
  } = args as any;

  if (typeof client_name !== 'string' || typeof client_email !== 'string') {
    throw new Error('Missing or invalid client_name or client_email.');
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Missing or invalid items array. Minimum 1 item required.');
  }

  let subtotal = 0;
  const processedItems = items.map(item => {
    if (typeof item.description !== 'string' || typeof item.quantity !== 'number' || typeof item.unit_price !== 'number') {
      throw new Error('Invalid item structure. Each item must have description, quantity, and unit_price.');
    }
    const lineTotal = Math.round(item.quantity * item.unit_price * 100) / 100;
    subtotal += lineTotal;
    return {
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: lineTotal
    };
  });

  const taxAmount = Math.round(subtotal * (typeof tax_rate === 'number' ? tax_rate : 0) * 100) / 100;
  const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;
  const invoiceNumber = `INV-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2, '0')}-${generateRandomHex(6).toUpperCase()}`;

  let paymentLink = `https://pay.axim.us.com/checkout/${invoiceNumber.toLowerCase()}`;

  if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith('mock_')) {
    try {
      const lineItemsParams = new URLSearchParams();
      processedItems.forEach((item, index) => {
        lineItemsParams.append(`line_items[${index}][price_data][currency]`, currency);
        lineItemsParams.append(`line_items[${index}][price_data][product_data][name]`, item.description);
        lineItemsParams.append(`line_items[${index}][price_data][unit_amount]`, String(Math.round(item.unit_price * 100)));
        lineItemsParams.append(`line_items[${index}][quantity]`, String(item.quantity));
      });
      lineItemsParams.append('mode', 'payment');
      lineItemsParams.append('success_url', `https://pay.axim.us.com/success?session_id={CHECKOUT_SESSION_ID}`);
      lineItemsParams.append('cancel_url', `https://pay.axim.us.com/cancel`);

      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: lineItemsParams.toString()
      });

      if (stripeRes.ok) {
        const stripeData = await stripeRes.json() as {url: string};
        if (stripeData.url) {
          paymentLink = stripeData.url;
        }
      }
    } catch (e) {
      // fallback to mock URL if stripe fails
    }
  }

  let deliveryStatus = 'SIMULATED_SUCCESS';
  if (env.EMAILIT_API_KEY) {
    try {
      const emailRes = await fetch('https://api.emailit.com/v1/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.EMAILIT_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: [{email: client_email}],
          subject: `Invoice ${invoiceNumber} from ${company_name}`,
          html: `<p>Dear ${client_name},</p><p>Please find your invoice for $${totalAmount.toFixed(2)} attached. You can pay here: <a href="${paymentLink}">${paymentLink}</a></p><p>Thank you!</p>`
        })
      });
      if (emailRes.ok) {
        deliveryStatus = 'SUCCESS';
      } else {
        deliveryStatus = 'FAILED';
      }
    } catch (e) {
      deliveryStatus = 'FAILED';
    }
  }

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          invoice_number: invoiceNumber,
          client_name,
          client_email,
          currency,
          subtotal,
          tax_amount: taxAmount,
          total_amount: totalAmount,
          payment_link: paymentLink,
          status: 'SENT',
          items: processedItems,
          metadata: { company_name, memo, payment_terms }
        })
      });
    } catch (e) {
      // ignore
    }
  }

  const dueDate = new Date();
  if (payment_terms === 'Net-15') {
    dueDate.setDate(dueDate.getDate() + 15);
  } else if (payment_terms === 'Net-30') {
    dueDate.setDate(dueDate.getDate() + 30);
  }

  return {
    invoice_number: invoiceNumber,
    subtotal,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    payment_link: paymentLink,
    delivery_status: deliveryStatus,
    due_date: dueDate.toISOString().split('T')[0]
  };
}
