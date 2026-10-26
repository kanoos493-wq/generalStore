/** Business-rule errors surfaced to the UI as friendly messages. */
export class BusinessError extends Error {
  constructor(message: string, readonly code: string = 'business_rule') {
    super(message);
    this.name = 'BusinessError';
  }
}

export class ValidationError extends BusinessError {
  constructor(message: string, readonly field?: string) {
    super(message, 'validation');
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends BusinessError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, 'not_found');
    this.name = 'NotFoundError';
  }
}

export class InsufficientStockError extends BusinessError {
  constructor(readonly productName: string, readonly availableMicro: number, readonly requestedMicro: number) {
    super(`Insufficient stock for ${productName}`, 'insufficient_stock');
    this.name = 'InsufficientStockError';
  }
}

export class DuplicateDocumentError extends BusinessError {
  constructor(docType: string, clientRef: string) {
    super(`${docType} was already saved (duplicate submission blocked)`, `duplicate_${docType}_${clientRef}`);
    this.name = 'DuplicateDocumentError';
  }
}

export class CreditLimitExceededError extends BusinessError {
  constructor(readonly customerName: string, readonly limitPaisa: number, readonly resultingPaisa: number) {
    super(`Credit limit exceeded for ${customerName}`, 'credit_limit');
    this.name = 'CreditLimitExceededError';
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) {return error.message;}
  return String(error);
}
