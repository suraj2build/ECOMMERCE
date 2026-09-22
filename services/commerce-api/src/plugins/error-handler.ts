import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '@fcp/shared';

/**
 * Consistent, documented error response shape across every route.
 * Never leaks a raw stack trace or internal error message to the client
 * (SECURITY.md §4) - unexpected errors are logged with full detail
 * server-side and returned to the client as a generic 500.
 */
const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.flatten(),
        },
      });
      return;
    }

    // Fastify's own validation errors (schema-based route validation)
    if (error.validation) {
      reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: error.message, details: error.validation },
      });
      return;
    }

    // Fastify's own framework-level errors (malformed JSON body, request
    // body over the size limit, unsupported content-type, etc.) already
    // carry a safe 4xx statusCode and a generic, non-leaking message -
    // certification-pass finding: without this, every one of them fell
    // through to the catch-all 500 below, misrepresenting a client
    // mistake as a server fault.
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      reply.status(error.statusCode).send({
        error: { code: error.code ?? 'BAD_REQUEST', message: error.message },
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled error');
    reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    });
  });
};

export default fp(errorHandlerPlugin, { name: 'error-handler' });
