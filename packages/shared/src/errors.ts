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
