import { StripeGateway } from '../stripe/StripeGateway';
import { InvoiceStore } from '../invoices/InvoiceStore';
// ARCHITECTURAL VIOLATION 3: Billing controller tight coupling with auth session generator!
import { SessionToken } from '../../auth/session';

export class CheckoutController {
  constructor(
    private stripe: StripeGateway,
    private invoices: InvoiceStore,
    private session: SessionToken
  ) {}

  async checkout(userId: string, planId: string, token: string): Promise<{ success: boolean; invoiceId: string }> {
    const charge = await this.stripe.charge(1000, token);
    const invoice = this.invoices.create(userId, 1000);
    return { success: charge.success, invoiceId: invoice.id };
  }
}
