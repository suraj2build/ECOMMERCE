import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError } from '@fcp/shared';
import { LoyaltyService } from '../loyalty/service.js';

/**
 * Internal, staff-facing Customer 360 (M29, specs/28-admin.md ADM-002:
 * "a distinct, data-minimized Customer-Service-facing Customer 360 view,
 * separate from the customer's own self-service profile"). This is a
 * READ PROJECTION over the EXISTING Customer/Order/LoyaltyAccount/
 * StoreCreditAccount/Return/Exchange models - never a second copy of
 * customer data. Deliberately narrower than the customer's own
 * self-service profile (`customer-profile` module): no address book, no
 * recently-viewed history, no saved sizes/communication-preference
 * detail - a support agent needs enough context to help with an order,
 * not a full PII dossier (the data-minimization requirement this view
 * exists to satisfy).
 */
export class SupportService {
  private readonly loyalty: LoyaltyService;

  constructor(private readonly fastify: FastifyInstance) {
    this.loyalty = new LoyaltyService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /** CS-assisted lookup - the realistic entry point (a customer calls in and gives their mobile number). */
  async findCustomerByMobile(mobile: string): Promise<{ id: string; mobile: string; fullName: string | null }> {
    const customer = await this.prisma.customer.findUnique({
      where: { mobile },
      select: { id: true, mobile: true, fullName: true },
    });
    if (!customer) throw new NotFoundError('Customer', mobile);
    return customer;
  }

  async getInternalCustomer360(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, mobile: true, email: true, fullName: true, mobileVerifiedAt: true, createdAt: true },
    });
    if (!customer) throw new NotFoundError('Customer', customerId);

    const [orderStats, recentOrders, loyaltyBalance, storeCreditAccount, openReturnsCount, openExchangesCount] =
      await Promise.all([
        this.prisma.order.aggregate({
          where: { customerId, status: { not: 'CANCELLED' } },
          _count: { _all: true },
          _sum: { grandTotal: true },
        }),
        this.prisma.order.findMany({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, orderNumber: true, status: true, grandTotal: true, createdAt: true },
        }),
        this.loyalty.getBalanceForCustomer(customerId),
        this.prisma.storeCreditAccount.findUnique({ where: { customerId }, select: { balance: true } }),
        this.prisma.return.count({
          where: { order: { customerId }, status: { notIn: ['CANCELLED', 'DISPOSITIONED'] } },
        }),
        this.prisma.exchange.count({
          where: { order: { customerId }, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
        }),
      ]);

    return {
      id: customer.id,
      mobile: customer.mobile,
      email: customer.email,
      fullName: customer.fullName,
      isMobileVerified: customer.mobileVerifiedAt !== null,
      customerSince: customer.createdAt,
      lifetimeOrderCount: orderStats._count._all,
      lifetimeSpend: Number(orderStats._sum.grandTotal ?? 0),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        grandTotal: Number(o.grandTotal),
        createdAt: o.createdAt,
      })),
      loyalty: { availablePoints: loyaltyBalance.balance, pendingPoints: loyaltyBalance.pendingPoints },
      storeCreditBalance: Number(storeCreditAccount?.balance ?? 0),
      openReturnsCount,
      openExchangesCount,
    };
  }
}
