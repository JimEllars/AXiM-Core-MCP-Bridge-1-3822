import {describe, expect, it} from './testHarness';
import {handleSendInvoice} from '../src/tools/sendInvoice';
import type {Env} from '../src/types';

const baseEnv: Env = {
  ENVIRONMENT: 'test',
  PASSPORT_VERIFY_URL: '',
};

describe('handleSendInvoice tool', () => {
  it('throws on missing required args', async () => {
    let threw = false;
    try {
      await handleSendInvoice({}, baseEnv);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('calculates totals correctly with tax', async () => {
    const args = {
      client_name: 'Test Client',
      client_email: 'test@example.com',
      items: [
        { description: 'Item 1', quantity: 2, unit_price: 10.50 }, // 21.00
        { description: 'Item 2', quantity: 1, unit_price: 15.00 }  // 15.00
      ], // subtotal = 36.00
      tax_rate: 0.10 // 3.60
    };

    const res = await handleSendInvoice(args, baseEnv);
    expect(res.subtotal).toBe(36.00);
    expect(res.tax_amount).toBe(3.60);
    expect(res.total_amount).toBe(39.60);
  });

  it('uses fallback math logic correctly', async () => {
    const args = {
      client_name: 'Test Client',
      client_email: 'test@example.com',
      items: [
        { description: 'Item 1', quantity: 1, unit_price: 100 }
      ]
    };

    const res = await handleSendInvoice(args, baseEnv);
    expect(res.subtotal).toBe(100);
    expect(res.tax_amount).toBe(0);
    expect(res.total_amount).toBe(100);
    expect(res.payment_link.startsWith('https://pay.axim.us.com/checkout/inv-')).toBe(true);
    expect(res.delivery_status).toBe('SIMULATED_SUCCESS');
  });
});
