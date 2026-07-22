import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ProtocolErrorCode } from '@city/game-protocol';

/**
 * Konsistente Fehlerstruktur für REST-Antworten. Nach außen werden niemals
 * Stacktraces, interne Pfade oder Datenbankdetails ausgegeben.
 */
interface ErrorResponseBody {
  statusCode: number;
  code: ProtocolErrorCode;
  message: string;
  timestamp: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ??
            exception.message);

      response.status(status).json({
        statusCode: status,
        code: this.codeForStatus(status),
        message: Array.isArray(message) ? message.join(', ') : message,
        timestamp: new Date().toISOString(),
        path: request.url,
      } satisfies ErrorResponseBody);
      return;
    }

    // Unerwartete Fehler: intern aussagekräftig loggen, extern generisch.
    this.logger.error(
      `Unexpected error on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'UNEXPECTED_ERROR',
      message: 'Internal server error',
      timestamp: new Date().toISOString(),
      path: request.url,
    } satisfies ErrorResponseBody);
  }

  private codeForStatus(status: number): ProtocolErrorCode {
    if (status === HttpStatus.BAD_REQUEST) return 'VALIDATION_ERROR';
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return 'PERSISTENCE_ERROR';
    return 'UNEXPECTED_ERROR';
  }
}
