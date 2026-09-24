/**
 * Typed application error hierarchy. HTTP-layer error handling maps these
 * to consistent, documented response shapes (see
 * services/commerce-api/src/plugins/error-handler.ts) - never a raw stack
 * trace leaked to the client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} '${id}' not found` : `${entity} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

/** Raised specifically when inventory cannot satisfy a requested reservation. */
export class InsufficientStockError extends AppError {
  constructor(skuId: string, requested: number, available: number) {
    super(
      `Insufficient stock for SKU ${skuId}: requested ${requested}, available ${available}`,
      409,
      'INSUFFICIENT_STOCK',
      { skuId, requested, available },
    );
  }
}

/**
 * Raised when a requested inventory mutation would violate a physical
 * or allocation invariant InventoryService itself is responsible for
 * guarding (independent-review finding #5) - e.g. a SALE that would
 * decrement onHand/reserved below zero, or that references an
 * allocation which is not a genuine, sufficient, already-CONVERTED
 * reservation. Distinct from InsufficientStockError (a reservation
 * request that legitimately can't be granted): this means the caller's
 * own data is inconsistent with what the ledger actually holds, which
 * must never be silently clamped/masked - the whole mutation is
 * rejected so the caller can surface it as an operational exception.
 */
export class InventoryIntegrityError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'INVENTORY_INTEGRITY_VIOLATION', details);
  }
}

/**
 * Raised when a request is well-formed but cannot be processed because
 * required compliance configuration (GST registration, tax rate/HSN
 * reference data, etc. - specs/32-india-tax-invoicing.md) is absent.
 * Distinct from ValidationError (client sent something wrong) and
 * NotFoundError (a specific entity id doesn't exist): this means the
 * *system* is not yet configured to answer the question safely, so the
 * engine must refuse rather than guess (CLAUDE.md SS0, spec 32).
 */
export class TaxConfigurationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'TAX_CONFIGURATION_MISSING', details);
  }
}
