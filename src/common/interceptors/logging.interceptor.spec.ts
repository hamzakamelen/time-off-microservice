import { LoggingInterceptor } from './logging.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/time-off',
        }),
      }),
    } as unknown as ExecutionContext;
  });

  it('should log the request and return the response', (done) => {
    const mockHandler: CallHandler = {
      handle: () => of({ data: 'test' }),
    };

    interceptor.intercept(mockContext, mockHandler).subscribe({
      next: (value) => {
        expect(value).toEqual({ data: 'test' });
      },
      complete: () => done(),
    });
  });

  it('should log even when response is empty', (done) => {
    const mockHandler: CallHandler = {
      handle: () => of(undefined),
    };

    interceptor.intercept(mockContext, mockHandler).subscribe({
      next: (value) => {
        expect(value).toBeUndefined();
      },
      complete: () => done(),
    });
  });

  it('should not interfere with error responses', (done) => {
    const mockHandler: CallHandler = {
      handle: () => throwError(() => new Error('Test error')),
    };

    interceptor.intercept(mockContext, mockHandler).subscribe({
      error: (err) => {
        expect(err.message).toBe('Test error');
        done();
      },
    });
  });
});
